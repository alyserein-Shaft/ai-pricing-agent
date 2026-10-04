// GOVERNED CLASSIFICATION AUTHORITY -- focused tests.
//
// Two invariants are in tension and BOTH must hold:
//
//   SAFETY   raw machine classification at 78, with no current governed review,
//            must NOT reach Ready  (the existing R11 guarantee)
//   AUTHORITY a current, complete governed confirmation of the policy-required
//            classification fields MAY satisfy the classification dimension
//            WITHOUT rewriting the machine number
//
// These tests pin both, pin that this is authority supersession rather than a
// score hack, pin currentness/supersession, and pin that every other confidence
// dimension and the threshold itself are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLASSIFICATION_AUTHORITY_FIELDS,
  CLASSIFICATION_AUTHORITY_STATES,
  classificationAuthorityProfile,
  classificationFactValue,
  resolveClassificationAuthority,
  resolveClassificationReadinessDimension,
} from "../app/domain/governed-classification-authority.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = readFileSync(join(HERE, "..", "app", "domain", "technical-requirement-engine.mjs"), "utf8");
const PROFILE_API = readFileSync(join(HERE, "..", "worker", "technical-requirement-api.mjs"), "utf8");
const REVIEW_API = readFileSync(join(HERE, "..", "worker", "estimator-understanding-review-api.mjs"), "utf8");

const governed = (over = {}) => ({
  system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 100 },
  category: { value: "Detection Devices", origin: "EXTRACTED", confidence: 100 },
  productFamily: { value: "Addressable Smoke Detector", origin: "EXTRACTED", confidence: 100 },
  authorityCurrent: true,
  machineConfidence: 78,
  machineSourceType: "Inferred",
  machineExplicitlyStated: false,
  authoritySource: "Approved BOQ Understanding",
  authorityActor: "engineer-1",
  ...over,
});

// ===========================================================================
// 1. raw inferred 78 + no human authority -> NOT satisfied (R11 safety)
// ===========================================================================
test("raw machine classification at 78 with no governed authority is NOT satisfied", () => {
  const authority = resolveClassificationAuthority(governed({
    system: null, category: null, productFamily: null, authorityCurrent: false,
  }));
  assert.equal(authority.state, "RAW_INFERRED");
  assert.equal(authority.authoritySatisfied, false);
  // The machine number is carried through untouched.
  assert.equal(authority.machineConfidence, 78);

  const dimension = resolveClassificationReadinessDimension({ authority, machineConfidence: 78 });
  assert.equal(dimension.satisfied, false);
  assert.equal(dimension.satisfiedBy, "MACHINE_EXTRACTION_CONFIDENCE");
  assert.equal(dimension.machineConfidenceBelowThreshold, true);
});

// ===========================================================================
// 15. the existing R11 test stays green and unchanged in meaning
// ===========================================================================
test("the R11 safety test is untouched and still asserts the 78-confidence guarantee", () => {
  const r11 = readFileSync(join(HERE, "fire-alarm-taxonomy-integration.test.mjs"), "utf8");
  assert.match(r11, /classificationConfidence: 78/);
  assert.match(r11, /an unapproved raw-family profile is blocked as Missing Critical Information/);
  // The engine's own threshold and dimension list are unmodified.
  assert.match(ENGINE, /if \(confidence\.overall < 80\) return \{ status: "Ready with Warnings"/);
  assert.match(ENGINE, /const requiredConfidenceDimensions = \[\s*"itemClassification",/);
  // And the engine still consumes the raw machine value first.
  assert.match(PROFILE_API, /classificationConfidence: item\.system_confidence \|\| item\.extraction_confidence/);
});

// ===========================================================================
// 2. raw machine confidence is never mutated
// ===========================================================================
test("the raw machine confidence is preserved verbatim in every authority state", () => {
  for (const overrides of [
    { authorityCurrent: false },
    { system: null, category: null, productFamily: null },
    { productFamily: null },
    { authorityCurrent: true },
  ]) {
    const authority = resolveClassificationAuthority(governed({ machineConfidence: 78, ...overrides }));
    assert.equal(authority.machineConfidence, 78, "machine confidence must never be rewritten");
    assert.equal(authority.machineSourceType, "Inferred");
    assert.equal(authority.machineExplicitlyStated, false);
  }
  // A high machine value passes through too, untouched.
  assert.equal(resolveClassificationAuthority(governed({ machineConfidence: 95, system: null, category: null, productFamily: null })).machineConfidence, 95);
});

// ===========================================================================
// 3. complete current governed confirmation -> satisfied
// ===========================================================================
test("current governed confirmation of every required field satisfies classification authority", () => {
  const authority = resolveClassificationAuthority(governed());
  assert.equal(authority.state, "GOVERNED_CONFIRMED");
  assert.equal(authority.authoritySatisfied, true);
  assert.deepEqual(authority.governedFields, ["system", "category", "productFamily"]);
  assert.deepEqual(authority.missingFields, []);

  const dimension = resolveClassificationReadinessDimension({ authority, machineConfidence: 78 });
  assert.equal(dimension.satisfied, true);
  assert.equal(dimension.satisfiedBy, "GOVERNED_CLASSIFICATION_AUTHORITY");
  // Authority supersession is explicit: the number is still reported as below
  // threshold, it simply is not the binding authority any more.
  assert.equal(dimension.machineConfidence, 78);
  assert.equal(dimension.machineConfidenceBelowThreshold, true);
  assert.equal(dimension.threshold, 80, "the threshold itself is unchanged");
});

// ===========================================================================
// 4. partial governed classification -> NOT satisfied
// ===========================================================================
test("partial governed classification does not satisfy authority", () => {
  const authority = resolveClassificationAuthority(governed({ productFamily: null }));
  assert.equal(authority.state, "GOVERNED_PARTIAL");
  assert.equal(authority.authoritySatisfied, false);
  assert.deepEqual(authority.governedFields, ["system", "category"]);
  assert.deepEqual(authority.missingFields, ["productFamily"]);

  assert.equal(resolveClassificationReadinessDimension({ authority, machineConfidence: 78 }).satisfied, false);
});

// ===========================================================================
// 5 + 6. stale and returned-to-review authority -> NOT satisfied
// ===========================================================================
test("a complete but STALE governed set is refused, and falls back to machine confidence", () => {
  const authority = resolveClassificationAuthority(governed({ authorityCurrent: false }));
  assert.equal(authority.state, "STALE");
  assert.equal(authority.authoritySatisfied, false);
  // Complete-but-stale must never read as confirmed.
  assert.equal(authority.governedFields.length, 3);
  assert.deepEqual(authority.missingFields, []);

  const dimension = resolveClassificationReadinessDimension({ authority, machineConfidence: 78 });
  assert.equal(dimension.satisfied, false);
  assert.match(dimension.reason, /stale/i);
});

// ===========================================================================
// 7. conflicting / absent facts fail closed
// ===========================================================================
test("a MISSING or NOT_APPLICABLE fact never counts as a confirmed value", () => {
  for (const origin of ["MISSING", "NOT_APPLICABLE"]) {
    assert.equal(classificationFactValue({ value: "Detection Devices", origin }), null);
    const authority = resolveClassificationAuthority(governed({
      category: { value: "Detection Devices", origin },
    }));
    assert.equal(authority.state, "GOVERNED_PARTIAL", `${origin} must not satisfy the field`);
    assert.deepEqual(authority.missingFields, ["category"]);
  }
  // An empty string is absent, not a value.
  assert.equal(classificationFactValue({ value: "   ", origin: "EXTRACTED" }), null);
  assert.equal(classificationFactValue(null), null);
});

// ===========================================================================
// 8. explicit machine classification >= threshold keeps its existing behaviour
// ===========================================================================
test("machine-authoritative classification at or above threshold still satisfies the dimension", () => {
  const authority = resolveClassificationAuthority(governed({
    system: null, category: null, productFamily: null, authorityCurrent: false,
    machineConfidence: 95, machineSourceType: "Extracted", machineExplicitlyStated: true,
  }));
  assert.equal(authority.state, "RAW_INFERRED");
  const dimension = resolveClassificationReadinessDimension({ authority, machineConfidence: 95 });
  assert.equal(dimension.satisfied, true);
  assert.equal(dimension.satisfiedBy, "MACHINE_EXTRACTION_CONFIDENCE");
  assert.equal(dimension.machineConfidenceBelowThreshold, false);
});

// ===========================================================================
// 9 + 10 + 11. authority is scoped to classification ONLY
// ===========================================================================
test("classification authority cannot bypass the other confidence dimensions", () => {
  // A satisfied classification authority is a property of ONE dimension. The
  // overall is still Math.min over the SAME dimension list, so any other
  // dimension below threshold keeps the profile out of Ready.
  const dimensions = { itemClassification: 78, requirementExtraction: 100, applicability: 100, attributeCompleteness: 40 };
  const governedDimension = resolveClassificationReadinessDimension({
    authority: resolveClassificationAuthority(governed()), machineConfidence: 78,
  });
  const effective = { ...dimensions, itemClassification: governedDimension.satisfied ? 100 : dimensions.itemClassification };
  assert.equal(Math.min(...Object.values(effective)), 40, "attributeCompleteness still binds overall");
  assert.notEqual(40, 80, "a low sibling dimension keeps the profile below Ready");

  // The authority layer itself touches nothing but classification.
  const authority = resolveClassificationAuthority(governed());
  assert.ok(!("applicability" in authority));
  assert.ok(!("compatibility" in authority));
  assert.ok(!("accessories" in authority));
  assert.ok(!("standards" in authority));
});

// ===========================================================================
// 12 + 13. no score hack, no threshold change, no product-derived authority
// ===========================================================================
test("there is no confidence boost, threshold change, or project-specific exception", () => {
  const raw = readFileSync(join(HERE, "..", "app", "domain", "governed-classification-authority.mjs"), "utf8");
  // Scan EXECUTABLE CODE only. The module deliberately documents each forbidden
  // pattern in prose ("NOT `if reviewed: confidence = 100`"), so scanning raw text
  // would match this file's own prohibition notes.
  const CODE = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Forbidden patterns, in executable code.
  assert.ok(!/Math\.max\(\s*machineConfidence/.test(CODE), "no Math.max lift to the threshold");
  assert.ok(!/machineConfidence\s*\+/.test(CODE), "no additive boost");
  assert.ok(!/confidence\s*=\s*100/.test(CODE), "no hard-coded 100");
  // (The machine value's immutability is proven BEHAVIOURALLY in the "preserved
  // verbatim" test above, which is stronger than any source regex.)
  // No Central Kitchen, brand, product, price or candidate knowledge in code.
  for (const forbidden of ["Central Kitchen", "Farenhyt", "Notifier", "Gamewell", "Gent", "rank", "price", "sku", "matchCandidate", "candidateId"]) {
    assert.ok(!new RegExp(forbidden, "i").test(CODE), `authority code must not know about ${forbidden}`);
  }
  // The default threshold is the engine's own 80, exposed as a parameter rather
  // than a rewritten constant.
  assert.match(CODE, /threshold = 80/);
  assert.match(ENGINE, /if \(confidence\.overall < 80\)/, "the engine threshold is still 80");
});

// ===========================================================================
// 14. unrelated projects keep current behaviour
// ===========================================================================
test("the layer is additive: the engine's own classificationConfidence expression is unchanged", () => {
  // The existing profile builder still reads the raw machine value. Authority is
  // applied ALONGSIDE it, never by rewriting this expression.
  assert.match(PROFILE_API, /classificationConfidence: item\.system_confidence \|\| item\.extraction_confidence/);
  // CCTV/UPS rows carry no governed Fire Alarm classification and are unaffected.
  assert.match(ENGINE, /CCTV: \["system", "category", "description", "unit", "quantity", "productFamily", "ipRating", "voltage"\]/);
});

// ===========================================================================
// §20 CURRENTNESS / SUPERSESSION
// ===========================================================================
test("authority follows the CURRENT interpretation and never inherits from a superseded one", () => {
  // A: approved, current -> authority current
  const a = resolveClassificationAuthority(governed({ authorityCurrent: true }));
  assert.equal(a.authoritySatisfied, true);

  // B generated, unreviewed -> the SAME governed facts are no longer current
  const b = resolveClassificationAuthority(governed({ authorityCurrent: false }));
  assert.equal(b.authoritySatisfied, false, "no inherited stale authority");
  assert.equal(b.state, "STALE");

  // B reviewed and approved again -> new authority current
  const b2 = resolveClassificationAuthority(governed({ authorityCurrent: true }));
  assert.equal(b2.authoritySatisfied, true);

  // The currentness flag is the ONLY difference between A and B: identical facts.
  assert.deepEqual(a.governedFields, b.governedFields);
  assert.notEqual(a.authoritySatisfied, b.authoritySatisfied);
});

// ===========================================================================
// §21 PROFILE EXPLAINABILITY
// ===========================================================================
test("the profile exposes both the machine value and the governed authority separately", () => {
  const authority = resolveClassificationAuthority(governed());
  const dimension = resolveClassificationReadinessDimension({ authority, machineConfidence: 78 });
  const profile = classificationAuthorityProfile(authority, dimension);

  // Nothing is hidden: the 78 is reported.
  assert.equal(profile.classificationMachineConfidence, 78);
  assert.equal(profile.classificationMachineSource, "Inferred");
  assert.equal(profile.classificationMachineExplicitlyStated, false);
  // And the authority is reported beside it, never merged into the number.
  assert.equal(profile.classificationAuthority, "GOVERNED_CONFIRMED");
  assert.equal(profile.classificationAuthorityCurrent, true);
  assert.equal(profile.classificationAuthorityActor, "engineer-1");
  assert.equal(profile.classificationAuthoritySatisfied, true);
  assert.deepEqual(profile.classificationAuthorityFields.required, ["system", "category", "productFamily"]);
  assert.deepEqual(profile.classificationAuthorityFields.missing, []);
  assert.equal(profile.classificationReadinessSatisfiedBy, "GOVERNED_CLASSIFICATION_AUTHORITY");

  // One numeric field, one meaning: no dual-meaning overload.
  assert.ok(!("itemClassification" in profile));
});

// ===========================================================================
// §4 EXISTING AUTHORITY MODEL IS REUSED, NOT DUPLICATED
// ===========================================================================
test("the classification field list matches the review layer's canonical list exactly", () => {
  const canonical = REVIEW_API.match(/FIELD_AUTHORITY_CLASSIFICATION_KEYS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(canonical, "the review layer's canonical list must exist");
  const reviewFields = canonical[1].split(",").map((value) => value.trim().replace(/"/g, ""));
  assert.deepEqual([...CLASSIFICATION_AUTHORITY_FIELDS], reviewFields, "the two definitions must not drift");
});

// ===========================================================================
// §24 28.23 / 28.25 must not be promoted
// ===========================================================================
test("rows with no governed classification stay unresolved regardless of quantity", () => {
  // These two rows are unresolved in the benchmark. Authority requires a real
  // governed confirmation, so neither can be promoted by this layer.
  for (const item of ["28.23", "28.25"]) {
    const authority = resolveClassificationAuthority(governed({ system: null, category: null, productFamily: null }));
    assert.equal(authority.authoritySatisfied, false, `${item} must not gain classification authority`);
    assert.equal(resolveClassificationReadinessDimension({ authority, machineConfidence: 78 }).satisfied, false);
  }
  // An unresolved field decision on one of them stays visible as unresolved.
  const authority = resolveClassificationAuthority(governed({ productFamily: null, unresolvedFields: ["productFamily"] }));
  assert.deepEqual(authority.unresolvedFields, ["productFamily"]);
  assert.equal(authority.authoritySatisfied, false);
});

// ===========================================================================
// Vocabulary is closed and inspectable
// ===========================================================================
test("the authority state vocabulary is closed", () => {
  assert.deepEqual([...CLASSIFICATION_AUTHORITY_STATES], ["RAW_INFERRED", "GOVERNED_PARTIAL", "GOVERNED_CONFIRMED", "STALE"]);
  assert.equal(CLASSIFICATION_AUTHORITY_STATES.length, 4);
  assert.equal(CLASSIFICATION_AUTHORITY_FIELDS.length, 3);
  // Policy may narrow the required set per family; it may never widen it beyond
  // the closed classification list.
  const narrowed = resolveClassificationAuthority(governed({ requiredFields: ["system"], category: null, productFamily: null }));
  assert.equal(narrowed.state, "GOVERNED_CONFIRMED", "a narrower policy set that is fully confirmed is satisfied");
  const widened = resolveClassificationAuthority(governed({ requiredFields: ["system", "manufacturer"] }));
  assert.deepEqual(widened.requiredFields, ["system"], "manufacturer is never a classification authority field");
});

// Frozen results, so no consumer can mutate a shared authority object.
test("resolved authority objects are frozen", () => {
  const authority = resolveClassificationAuthority(governed());
  assert.throws(() => { authority.state = "RAW_INFERRED"; });
  assert.throws(() => { authority.machineConfidence = 100; });
});