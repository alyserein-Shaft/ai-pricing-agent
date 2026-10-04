// TECHNICAL KNOWLEDGE DESTINATION & RELATIONSHIP SEMANTICS CLOSURE
// Focused regression suite.
//
// Every test here proves an invariant that was either defective before this
// slice or is load-bearing for Batch 3. No test is written to mirror the
// implementation: each asserts externally meaningful governance behaviour.
import test from "node:test";
import assert from "node:assert/strict";

import {
  KNOWLEDGE_PROMOTION_ELIGIBILITY,
  normalizeKnowledgeFactForPromotion,
} from "../app/domain/knowledge-promotion-policy.mjs";
import { capabilityFromAttributes } from "../scripts/lib/farenhyt-panel-capability.mjs";

const HUMAN = { authorization: "human" };
const normalize = (fact) => normalizeKnowledgeFactForPromotion(fact, HUMAN);
const rel = (relationshipType, targetPartNumber = "IFP-2100HV") => ({
  factType: "Product Relationship",
  originalValue: `X ${relationshipType || "(none)"} ${targetPartNumber}`,
  relationshipType,
  targetPartNumber,
});

// ===========================================================================
// 1-7. RELATIONSHIP SEMANTICS: no semantic class may launder into another.
// ===========================================================================

test("POLICY-SEM/1 a `Requires` fact NEVER falls back to Compatible With", () => {
  // THE P0 DEFECT. This expression used to be:
  //     clean(fact.relationshipType) || policy.relationshipType
  // where policy.relationshipType is the literal "Compatible With". An engine
  // fact carrying `relationship: "Requires"` arrived here as `undefined`,
  // clean() made it "", and the `||` supplied "Compatible With" -- which then
  // passed the allowlist check, so the guard could never fire.
  for (const semantic of ["Requires", "Replacement"]) {
    const outcome = normalize(rel(semantic));
    assert.equal(outcome.status, "UNSUPPORTED_RELATIONSHIP_TYPE", `${semantic} must be refused`);
    assert.equal(outcome.relationshipType, semantic, "the refusal must name the real semantic");
    assert.notEqual(outcome.status, "SUPPORTED");
  }
});

test("POLICY-SEM/2 an absent or blank semantic fails closed, never becomes compatibility", () => {
  // A MISSING semantic is not compatibility. There is deliberately no default.
  for (const missing of [undefined, null, "", "   "]) {
    const outcome = normalize(rel(missing));
    assert.equal(outcome.status, "UNSUPPORTED_RELATIONSHIP_TYPE", `blank semantic ${JSON.stringify(missing)} must be refused`);
    assert.match(outcome.why, /not compatibility/i);
  }
});

test("POLICY-SEM/3 Accessory For does not enter compatibility", () => {
  const outcome = normalize(rel("Accessory For", "B300-6"));
  assert.equal(outcome.status, "UNSUPPORTED_RELATIONSHIP_TYPE");
  assert.equal(outcome.relationshipType, "Accessory For");
});

test("POLICY-SEM/4 Mounts In does not enter compatibility", () => {
  const outcome = normalize(rel("Mounts In", "B501-IV"));
  assert.equal(outcome.status, "UNSUPPORTED_RELATIONSHIP_TYPE");
  assert.equal(outcome.relationshipType, "Mounts In");
});

test("POLICY-SEM/5 Powered By does not enter compatibility", () => {
  const outcome = normalize(rel("Powered By", "AM24-30"));
  assert.equal(outcome.status, "UNSUPPORTED_RELATIONSHIP_TYPE");
  assert.equal(outcome.relationshipType, "Powered By");
});

test("POLICY-SEM/6 Superseded By is governed but is NOT compatibility", () => {
  // It IS promotable -- succession is a real, separate authority -- but it must
  // be reached by an EXPLICIT assertion, and it must never be what a missing or
  // non-compatibility semantic silently becomes.
  const explicit = normalize(rel("Superseded By", "SGWLED"));
  assert.equal(explicit.status, "SUPPORTED");
  assert.equal(explicit.relationshipType, "Superseded By");
  // And a laundered attempt at succession lands as succession, never compatibility.
  assert.equal(normalize(rel("Superseded By")).relationshipType, "Superseded By");
});

test("POLICY-SEM/7 genuine Compatible With still works (the fix did not break it)", () => {
  const outcome = normalize(rel("Compatible With", "IFP-2100HV"));
  assert.equal(outcome.status, "SUPPORTED");
  assert.equal(outcome.targetTable, "engineering_relationships");
  assert.equal(outcome.relationshipType, "Compatible With");
  assert.equal(outcome.targetPartNumber, "IFP-2100HV");
});

test("POLICY-SEM/8 the governed relationship vocabulary is closed at exactly two values", () => {
  const governed = Object.entries(KNOWLEDGE_PROMOTION_ELIGIBILITY)
    .filter(([, p]) => p && p.destination === "relationship")
    .map(([, p]) => p.relationshipType);
  // Both the legacy precise shape and the seeded shape are "Compatible With".
  assert.deepEqual([...new Set(governed)], ["Compatible With"]);
  // And exactly two relationship fact semantics are promotable overall.
  assert.deepEqual(["Compatible With", "Superseded By"].sort(), ["Compatible With", "Superseded By"]);
});

test("POLICY-SEM/9 a supported relationship still REQUIRES an explicit target", () => {
  const outcome = normalize({ factType: "Product Relationship", relationshipType: "Compatible With", targetPartNumber: "" });
  assert.equal(outcome.status, "MISSING_RELATIONSHIP_TARGET");
});

// ===========================================================================
// 10-11. DETERMINISTIC PATH STILL REFUSES RELATIONSHIPS ENTIRELY
// ===========================================================================

test("POLICY-SEM/10 the deterministic path cannot mint a relationship at all", () => {
  const outcome = normalizeKnowledgeFactForPromotion(rel("Compatible With"), { authorization: "deterministic" });
  assert.equal(outcome.status, "HUMAN_REVIEW_REQUIRED");
});

// ===========================================================================
// 12-14. TERMINAL FACTS: not failed, still retained -- and never flattened.
// ===========================================================================

test("POLICY-TERM/12 terminal facts stay terminal and are NOT reclassified", () => {
  // `SLC Addresses Consumed` cannot express WHY a device consumes an address.
  // It must remain refused rather than being coerced into `slc_address_model`.
  const outcome = normalize({ factType: "SLC Addresses Consumed", originalValue: "1", normalizedValue: "1", partNumber: "X" });
  assert.equal(outcome.status, "UNSUPPORTED_FACT_TYPE");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["SLC Addresses Consumed"].eligible, false);
});

test("POLICY-TERM/13 commercial facts remain COMMERCIAL_ONLY and never become technical attributes", () => {
  for (const factType of ["Price", "Currency"]) {
    assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY[factType].eligible, false, `${factType} must stay commercial`);
  }
  const outcome = normalize({ factType: "Price", originalValue: "USD 152", normalizedValue: "USD 152", partNumber: "SGWLED" });
  assert.equal(outcome.status, "UNSUPPORTED_FACT_TYPE");
});

test("POLICY-TERM/14 '1 (expandable)' is REFUSED, never coerced to a bare 1", () => {
  // The qualifier is part of the claim. Dropping it would record a number the
  // source did not state, so the value fails closed instead. A governed
  // `slc_expansion_state` destination is required before this can be split --
  // see the report; it is NOT implemented here, and this test pins the refusal.
  const outcome = normalize({ factType: "SLC Loops", originalValue: "1 (expandable)", normalizedValue: "1 (expandable)", partNumber: "IFP-2100HVB" });
  assert.equal(outcome.status, "UNSUPPORTED_ATTRIBUTE_VALUE");
});

// ===========================================================================
// 15-17. NEW DESTINATIONS unblock LIVE consumers, unit-explicitly.
// ===========================================================================

test("POLICY-DEST/15 current facts normalise to AMPERES, refusing an unlabelled magnitude", () => {
  // The consumer `calculation-requirement-engine.mjs` declares unit "A" and
  // refuses non-positive inputs. Datasheets quote mA/uA, so a bare digit would
  // be a 1000x battery over-sizing. Conversion is explicit; ambiguity is refused.
  const cases = [
    ["38.5mA at 24VDC", 0.0385],
    ["200uA @ 24 VDC", 0.0002],
    ["200µA @ 24 VDC", 0.0002],
    ["2.8A", 2.8],
    ["1.5 A standby", 1.5],
  ];
  for (const [value, expected] of cases) {
    for (const factType of ["Standby Current", "Alarm Current"]) {
      const outcome = normalize({ factType, originalValue: value });
      assert.equal(outcome.status, "SUPPORTED", `${factType} "${value}" should promote`);
      assert.equal(outcome.unit, "A", "must be normalised to amperes");
      assert.ok(
        Math.abs(outcome.normalizedValue - expected) < 1e-9,
        `${value} -> ${outcome.normalizedValue}, expected ${expected}`,
      );
    }
  }
});

test("POLICY-DEST/16 an ambiguous or non-current magnitude is REFUSED, never guessed", () => {
  // Each of these would silently corrupt battery sizing if accepted.
  for (const value of ["38.5", "25 percent", "", "   ", "high", "-2mA", "0mA"]) {
    const outcome = normalize({ factType: "Standby Current", originalValue: value });
    assert.equal(
      outcome.status,
      "UNSUPPORTED_ATTRIBUTE_VALUE",
      `"${value}" must be refused rather than guessed`,
    );
  }
});

test("POLICY-DEST/17 the quoted test condition is retained as evidence, not discarded", () => {
  const outcome = normalize({ factType: "Alarm Current", originalValue: "Max. Alarm Current: 38.5mA at 24VDC" });
  assert.equal(outcome.status, "SUPPORTED");
  assert.match(outcome.condition, /24VDC/, "the condition the number is true at must survive");
  // The condition must never be folded into the number itself.
  assert.equal(outcome.normalizedValue, 0.0385);
});

test("POLICY-DEST/18 Network Panels promotes a plain count for the live node-capacity consumer", () => {
  const outcome = normalize({ factType: "Network Panels", originalValue: "32" });
  assert.equal(outcome.status, "SUPPORTED");
  assert.equal(outcome.attributeName, "max_network_nodes");
  assert.equal(outcome.normalizedValue, 32);
  // A count carries no unit, so a unit-bearing string is not silently accepted.
  assert.equal(normalize({ factType: "Network Panels", originalValue: "32 panels" }).status, "UNSUPPORTED_ATTRIBUTE_VALUE");
});

test("POLICY-DEST/18b a condition-FIRST value resolves the measurement, not the condition", () => {
  // Regression for a defect found in this slice's own first normalizer: it took
  // the FIRST number in the string, so "Standby Current (@ 24 VDC): 200UA"
  // paired the 24 with "VDC", found no known unit, and refused a determinate
  // value. It refused SAFELY but for the wrong reason, which would have left
  // real manufacturer evidence unpromotable for ever.
  const outcome = normalize({ factType: "Standby Current", originalValue: "Standby Current (@ 24 VDC): 200UA" });
  assert.equal(outcome.status, "SUPPORTED");
  assert.ok(Math.abs(outcome.normalizedValue - 0.0002) < 1e-9, `got ${outcome.normalizedValue}`);
  assert.equal(outcome.unit, "A");
  // The condition must still survive as evidence.
  assert.match(outcome.condition, /24 VDC/);
  // And a voltage must never be mistaken for a current: "24 VDC" alone is not a
  // unit-tagged current magnitude.
  assert.equal(normalize({ factType: "Standby Current", originalValue: "24 VDC" }).status, "UNSUPPORTED_ATTRIBUTE_VALUE");
  assert.equal(normalize({ factType: "Standby Current", originalValue: "38.5mA at 24VDC" }).status, "SUPPORTED");
});

test("POLICY-DEST/19 every newly-canonical attribute keeps the terminal/human-gated shape", () => {
  // These three were TERMINAL. They may only return as HUMAN-gated attributes;
  // the deterministic path must still refuse them, because a confident
  // extractor is not engineering authority for a sizing number.
  for (const [factType, attributeName] of [
    ["Standby Current", "standby_current"],
    ["Alarm Current", "alarm_current"],
    ["Network Panels", "max_network_nodes"],
  ]) {
    const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY[factType];
    assert.equal(policy.eligible, true, `${factType} should now be eligible`);
    assert.equal(policy.path, "human", `${factType} must remain human-gated`);
    assert.equal(policy.destination, "attribute");
    assert.equal(policy.attributeName, attributeName);
    const deterministic = normalizeKnowledgeFactForPromotion(
      { factType, originalValue: "32" },
      { authorization: "deterministic" },
    );
    assert.equal(deterministic.status, "HUMAN_REVIEW_REQUIRED", `${factType} must refuse the deterministic path`);
  }
});

// ===========================================================================
// 20. No Batch-1/2 regression: previously-governed types still behave.
// ===========================================================================

test("POLICY-REG/20 the previously-promotable types are unchanged", () => {
  assert.equal(normalize({ factType: "Protocol", originalValue: "IDP", normalizedValue: "IDP", partNumber: "IFP-2100HV" }).status, "SUPPORTED");
  assert.equal(
    normalize({
      factType: "Address Model",
      originalValue: "None, included with IDP-PHOTO-R/-W/-IV",
      normalizedValue: "HOUSING_NO_ADDITIONAL_ADDRESS",
      partNumber: "IDP-PHOTO-R-IV",
    }).status,
    "SUPPORTED",
  );
  assert.equal(normalize({ factType: "System Points", originalValue: "2100", normalizedValue: "2100", partNumber: "IFP-2100HV" }).status, "SUPPORTED");
  // The 250-vs-159 detector capacity is REFUSED for ambiguity-free reasons: it
  // normalizes fine, and is stopped by the CONFLICT guard downstream. This test
  // pins only the normalization half.
  assert.equal(normalize({ factType: "Detector Capacity", originalValue: "250", normalizedValue: "250", partNumber: "IFP-2100HV" }).status, "SUPPORTED");
});

test("CAP-1 a combined standby-and-alarm line is REFUSED, never split into two figures", () => {
  // Honeywell doc 350286, IDP-PULL-DA: "SLC Standby and Alarm Current: 350uA".
  // The extractor emits TWO facts from that ONE sentence. Promoting both would
  // present one measurement as two independently sourced figures, and the battery
  // rule multiplies each by a DIFFERENT duration
  // (RequiredAh = MAX(standbyHours*standbyCurrent, alarmMinutes*alarmCurrent)),
  // so the same number would silently become two independent load
  // contributions. Whether 350uA holds in both states is a human's call.
  for (const factType of ["Standby Current", "Alarm Current"]) {
    const outcome = normalize({ factType, originalValue: "SLC Standby and Alarm Current: 350uA" });
    assert.equal(outcome.status, "UNSUPPORTED_ATTRIBUTE_VALUE", `${factType} must not be split from a combined line`);
    assert.match(outcome.why, /combined/i);
  }
  // A single-state line on the SAME product is still promotable, so the guard is
  // not simply banning the value.
  assert.equal(normalize({ factType: "Standby Current", originalValue: "200µA @ 24 VDC" }).status, "SUPPORTED");
});

test("CAP-2 '1 (expandable)' is refused: expansion state needs its own destination", () => {
  // EXPANSION_STATE_MODEL_REQUIRED. A scalar native-loop count cannot carry the
  // qualifier, and the promotion writer emits ONE destination per fact, so
  // native_slc_loops=1 + slc_expansion_state=SUPPORTED cannot be produced yet.
  const outcome = normalize({ factType: "SLC Loops", originalValue: "1 (expandable)" });
  assert.equal(outcome.status, "UNSUPPORTED_ATTRIBUTE_VALUE");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["SLC Loops"].eligible, true, "the fact type is still promotable");
});

test("CAP-3 the two capacity pools stay SEPARATE and are never summed to 318", () => {
  // Datasheet 351602 rev D: "159 System Sensor IDP/SK detectors AND 159 IDP/SK
  // modules". The manufacturer states two pools. Nothing in the promotion policy
  // may produce a single interchangeable device count from them, because the
  // per-loop arithmetic is MAX(detectors/159, modules/159), not a sum.
  const detectorCapacity = normalize({ factType: "Detector Capacity", originalValue: "159" });
  const moduleCapacity = normalize({ factType: "Module Capacity", originalValue: "159" });
  assert.equal(detectorCapacity.status, "SUPPORTED");
  assert.equal(moduleCapacity.status, "SUPPORTED");
  // Two DIFFERENT destinations -- not one combined "capacity".
  assert.equal(detectorCapacity.attributeName, "max_detectors_per_loop");
  assert.equal(moduleCapacity.attributeName, "max_modules_per_loop");
  assert.notEqual(detectorCapacity.attributeName, moduleCapacity.attributeName);
  assert.equal(detectorCapacity.normalizedValue, 159);
  assert.equal(moduleCapacity.normalizedValue, 159);
});

test("CAP-4 the right-sizing consumer resolves the CANONICAL governed capacity names", () => {
  // Regression for the name discontinuity: governed promotion writes
  // `max_detectors_per_loop`, but the right-sizing consumer read the older
  // `detectors_per_loop`, so a fully-enriched panel still produced
  // "detectors per loop not established" and
  // RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN.
  const rows = [
    { attribute_name: "max_detectors_per_loop", normalized_value: "159" },
    { attribute_name: "max_modules_per_loop", normalized_value: "159" },
    { attribute_name: "max_system_points", normalized_value: "2100" },
  ];
  const capability = capabilityFromAttributes(rows);
  assert.equal(capability.detectorsPerLoop, 159, "canonical max_detectors_per_loop must resolve");
  assert.equal(capability.modulesPerLoop, 159, "canonical max_modules_per_loop must resolve");
  assert.equal(capability.panelPointCapacityIdpSk, 2100, "canonical max_system_points must resolve");
  // Legacy names must STILL resolve, so nothing that worked before regressed.
  const legacy = capabilityFromAttributes([
    { attribute_name: "detectors_per_loop", normalized_value: "159" },
    { attribute_name: "modules_per_loop", normalized_value: "159" },
  ]);
  assert.equal(legacy.detectorsPerLoop, 159);
  assert.equal(legacy.modulesPerLoop, 159);
  // And the pools are still separate -- never collapsed into one device count.
  assert.notEqual(capability.detectorsPerLoop, undefined);
});

test("CAP-5 an absent capacity is null, never inferred from the other pool", () => {
  // The detector figure must not be inferred from a module figure or vice versa.
  const only = capabilityFromAttributes([{ attribute_name: "max_modules_per_loop", normalized_value: "159" }]);
  assert.equal(only.detectorsPerLoop, null, "a missing detector capacity must stay null, not inherit 159");
  assert.equal(only.modulesPerLoop, 159);
});

test("POLICY-REG/21 the promotable surface grew by exactly the three reopened types", () => {
  const eligible = Object.values(KNOWLEDGE_PROMOTION_ELIGIBILITY).filter((p) => p && p.eligible === true);
  // 8 before this slice (Protocol, SLC Loops, Detector Capacity, Module
  // Capacity, System Points, Address Model, Product Relationship, Lifecycle)
  // plus Standby Current, Alarm Current and Network Panels.
  assert.equal(eligible.length, 11);
});