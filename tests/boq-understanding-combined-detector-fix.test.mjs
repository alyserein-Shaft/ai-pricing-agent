import test from "node:test";
import assert from "node:assert/strict";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation } from "../app/domain/boq-understanding-engine.mjs";
import { buildFireAlarmTaxonomyContext, classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";
import { isCanonicalPair } from "../app/domain/system-knowledge-registry.mjs";
import { validateUnderstandingForApproval } from "../app/domain/estimator-understanding-review.mjs";

// Real Al Mousa School gap: "Combined smoke and heat detector" (row 17) and
// "Combined smoke and heat sensor" (rows 65/109) name TWO governed functions
// in one BOQ line, but the AI's own persisted proposal for row 17 collapsed
// this to system=Fire Alarm/category=Detection Devices/productFamily=
// "Addressable Heat Detector" with detector_technology="heat detector" --
// smoke detection lost entirely, from the model's own structured output, not
// from any downstream approval gate. These tests prove the deterministic
// merge-layer guard (buildFireAlarmTaxonomyContext's multiFunctionConflict,
// consumed in validateAndMergeBoqInterpretation) rejects that single-function
// collapse even when the model itself proposes it, without inventing any
// fact the row's own text does not state.

const f = (value, origin = "INFERRED", confidence = 90) => ({ value, origin, confidence });
const a = (name, value, origin = "INFERRED", confidence = 90) => ({ name, value, origin, confidence });
const row = (description, extra = {}) => ({ boqItemId: extra.boqItemId || "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });
// The exact shape the real, persisted Row 17 AI proposal had: a confident,
// internally-consistent heat-only classification -- proving the guard fires
// even against a model that is not silent and not obviously wrong on its own
// terms, not just against a missing/ambiguous model response.
const heatOnlyCollapseResponse = (description) => ({
  normalizedDescription: f(description, "EXTRACTED", 100),
  taxonomyCandidateKey: f("FA-1", "INFERRED", 78),
  system: f("Fire Alarm", "INFERRED", 78),
  category: f("Detection Devices", "INFERRED", 78),
  equipmentType: f("Addressable Heat Detector", "EXTRACTED", 100),
  productFamily: f("Addressable Heat Detector", "INFERRED", 78),
  technicalAttributes: [a("detector_technology", "heat detector", "EXTRACTED", 100)],
  confidence: "HIGH",
});

for (const description of ["Combined smoke and heat detector", "Combined smoke and heat sensor"]) {
  test(`"${description}" cannot produce a heat-only (or smoke-only) structured interpretation`, () => {
    const input = prepareBoqUnderstandingInput(row(description));
    const result = validateAndMergeBoqInterpretation(input, heatOnlyCollapseResponse(description));
    // 1/2. Neither function may be silently represented alone: no single
    // governed family is asserted, and status is forced to review.
    assert.equal(result.interpretation.category.value, null, "category must not silently collapse to a single-function family");
    assert.equal(result.interpretation.productFamily.value, null, "productFamily must not silently collapse to a single-function family");
    assert.notEqual(result.interpretation.productFamily.value, "Addressable Heat Detector");
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.ok(result.interpretation.reviewReasons.includes("MULTI_FUNCTION_DETECTION_REQUIRES_REVIEW"), `reviewReasons: ${JSON.stringify(result.interpretation.reviewReasons)}`);
    assert.ok(result.interpretation.ambiguities.some((entry) => /smoke detection and heat detection/i.test(String(entry.value))), "an auditable, human-readable ambiguity note must explain why");
    // Preserve only what is explicit: both functions stay visible via
    // detector_technology, never reduced to "heat" or "smoke" alone.
    assert.equal(result.interpretation.attributes.detector_technology.value, "Smoke and Heat");
    assert.equal(result.interpretation.attributes.detector_technology.origin, "EXTRACTED");
  });
}

test("plain 'Heat detector' remains heat-only (unaffected by the multi-function guard)", () => {
  const input = prepareBoqUnderstandingInput(row("Heat detector"));
  assert.equal(input.taxonomyContext.multiFunctionConflict, false);
  // The taxonomy now offers only the neutral "Heat Detector" candidate for
  // bare text -- so even a model that (wrongly) proposes "Addressable Heat
  // Detector" free-text cannot make it canonical: the governed candidate
  // selection always wins over the model's own category/productFamily
  // fields once a taxonomyCandidateKey is selected (see
  // boq-understanding-engine.mjs's governed-candidate branch).
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Heat detector", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 90),
    system: f("Fire Alarm", "INFERRED", 90),
    category: f("Detection Devices", "INFERRED", 90),
    equipmentType: f("Heat Detector", "EXTRACTED", 100),
    productFamily: f("Addressable Heat Detector", "INFERRED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.productFamily.value, "Heat Detector", "a bare source must not canonically assert Addressable");
  assert.notEqual(result.interpretation.productFamily.value, "Addressable Heat Detector");
  assert.ok(!result.interpretation.reviewReasons.includes("MULTI_FUNCTION_DETECTION_REQUIRES_REVIEW"));
});

// Al Mousa School fix -- Row 15's exact real gap: Understanding approval is
// all-or-nothing per version, so a productFamily of "Addressable Heat
// Detector" on a bare "Heat detector" row would canonically assert
// addressability even though the separate `addressing` attribute correctly
// stays MISSING. These three tests prove the required behavior directly.
test("Heat Detector fix 1/3 -- 'Heat detector' does not assert Addressable", () => {
  const ctx = buildFireAlarmTaxonomyContext({ description: "Heat detector" });
  assert.deepEqual(ctx.families.map((f) => f.family), ["Heat Detector"]);
  const input = prepareBoqUnderstandingInput(row("Heat detector"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Heat detector", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 70),
    system: f("Fire Alarm", "INFERRED", 70),
    category: f("Detection Devices", "INFERRED", 70),
    equipmentType: f("Heat Detector", "EXTRACTED", 100),
    productFamily: f("Heat Detector", "INFERRED", 70),
    confidence: "LOW",
  });
  assert.equal(result.interpretation.system.value, "Fire Alarm");
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.productFamily.value, "Heat Detector");
  assert.equal(result.interpretation.attributes.addressing.value, null);
  assert.equal(result.interpretation.attributes.addressing.origin, "MISSING", "addressing must remain unasserted, not defaulted to any value");
  // A truthful generic classification must itself be approvable (boqItemId
  // is server-owned and never part of the reviewed contract -- stripped
  // here exactly as sanitizePersistedAiInterpretation does in production).
  const { boqItemId: _boqItemId, ...approvalCandidate } = result.interpretation;
  const approval = validateUnderstandingForApproval(approvalCandidate);
  assert.equal(approval.ok, true, JSON.stringify(approval));
  assert.equal(isCanonicalPair("Fire Alarm", "Detection Devices", "Heat Detector"), true);
});

test("Heat Detector fix 2/3 -- 'Addressable heat detector' can assert Addressable", () => {
  const ctx = buildFireAlarmTaxonomyContext({ description: "Addressable heat detector" });
  assert.deepEqual(ctx.families.map((f) => f.family), ["Addressable Heat Detector"]);
  const input = prepareBoqUnderstandingInput(row("Addressable heat detector"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable heat detector", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 90),
    system: f("Fire Alarm", "INFERRED", 90),
    category: f("Detection Devices", "INFERRED", 90),
    equipmentType: f("Addressable Heat Detector", "EXTRACTED", 100),
    productFamily: f("Addressable Heat Detector", "INFERRED", 90),
    technicalAttributes: [a("addressing", "Addressable", "EXTRACTED", 100)],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.productFamily.value, "Addressable Heat Detector");
  assert.equal(result.interpretation.attributes.addressing.value, "Addressable");
  const { boqItemId: _boqItemId, ...approvalCandidate } = result.interpretation;
  const approval = validateUnderstandingForApproval(approvalCandidate);
  assert.equal(approval.ok, true, JSON.stringify(approval));
});

test("Heat Detector fix 3/3 -- 'Conventional heat detector' preserves Conventional, never Addressable", () => {
  const ctx = buildFireAlarmTaxonomyContext({ description: "Conventional heat detector" });
  assert.deepEqual(ctx.families.map((f) => f.family), ["Conventional Detector"]);
  const input = prepareBoqUnderstandingInput(row("Conventional heat detector"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Conventional heat detector", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 90),
    system: f("Fire Alarm", "INFERRED", 90),
    category: f("Detection Devices", "INFERRED", 90),
    equipmentType: f("Heat Detector", "EXTRACTED", 100),
    productFamily: f("Conventional Detector", "INFERRED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.productFamily.value, "Conventional Detector");
  assert.notEqual(result.interpretation.productFamily.value, "Addressable Heat Detector");
});

// Real catalog wording must not regress: the manufacturer's own official
// description separates "Addressable" from "thermal detector" ("Intelligent
// Addressable Fixed temperature ... thermal detector"), never contiguous --
// this is the exact IDP-HEAT-ROR-IV text classifyFireAlarmFamilyFromText
// already governs (see fire-alarm-taxonomy-integration.test.mjs).
test("real catalog wording with non-contiguous 'Addressable ... thermal detector' still resolves to Addressable Heat Detector", () => {
  const catalogText = "Intelligent Addressable Fixed temperature and rate-of rise thermal detector (Rate-of-rise detection 15F/min (9C/min) (Base Not Included)(Ivory Color)";
  assert.deepEqual(
    classifyFireAlarmFamilyFromText(catalogText),
    { category: "Detection Devices", family: "Addressable Heat Detector" },
  );
});

// Real catalog conventional detector-head boilerplate must still resolve to
// Conventional Detector, never the new neutral family (2351TEM/5151-CH/5351E
// -- see Sprint 1.37's own comment in fire-alarm-taxonomy.mjs).
test("real catalog conventional detector-head boilerplate still resolves to Conventional Detector, not the neutral Heat Detector family", () => {
  assert.deepEqual(
    classifyFireAlarmFamilyFromText("HEAT DETECTOR HEAD, FIXED/RATE OF RISE, REQUIRES BASE Made in China UL Listed.  Plugin Detector Base part is B401-SS"),
    { category: "Detection Devices", family: "Conventional Detector" },
  );
});

// No unsupported fact is invented merely because a neutral family exists.
test("the neutral Heat Detector family invents no manufacturer, protocol, panel compatibility, voltage, certification or accessory fact", () => {
  const input = prepareBoqUnderstandingInput(row("Heat detector"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Heat detector", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 70),
    system: f("Fire Alarm", "INFERRED", 70),
    category: f("Detection Devices", "INFERRED", 70),
    equipmentType: f("Heat Detector", "EXTRACTED", 100),
    productFamily: f("Heat Detector", "INFERRED", 70),
    confidence: "LOW",
  });
  // The governed attribute checklist (product_type, addressing, protocol,
  // compatible_panel_family, loop_compatibility, operating_voltage,
  // detector_technology) may be recorded, but only as explicit MISSING gaps
  // -- never a fabricated non-null value, and never anything the model
  // itself didn't supply (no technicalAttributes were given here at all).
  for (const [name, entry] of Object.entries(result.interpretation.attributes)) {
    assert.equal(entry.value, null, `${name} must not carry an invented value`);
    assert.equal(entry.origin, "MISSING", `${name} must be recorded as MISSING, not asserted`);
  }
  assert.equal(result.interpretation.manufacturerPreferences.length, 0);
  assert.equal(result.interpretation.requiredAccessories.length, 0);
  assert.equal(result.interpretation.standards.length, 0);
  assert.equal(result.interpretation.compatibilityRequirements.length, 0);
});

test("plain 'Addressable smoke detector' remains smoke-only (unaffected by the multi-function guard)", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector"));
  assert.equal(input.taxonomyContext.multiFunctionConflict, false);
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable smoke detector", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 90),
    system: f("Fire Alarm", "INFERRED", 90),
    category: f("Detection Devices", "INFERRED", 90),
    equipmentType: f("Addressable Smoke Detector", "EXTRACTED", 100),
    productFamily: f("Addressable Smoke Detector", "INFERRED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
  assert.ok(!result.interpretation.reviewReasons.includes("MULTI_FUNCTION_DETECTION_REQUIRES_REVIEW"));
});

test("the multi-function guard invents no addressability, manufacturer, protocol, accessory, compatibility or certification fact", () => {
  const input = prepareBoqUnderstandingInput(row("Combined smoke and heat detector"));
  const result = validateAndMergeBoqInterpretation(input, heatOnlyCollapseResponse("Combined smoke and heat detector"));
  assert.deepEqual(Object.keys(result.interpretation.attributes), ["detector_technology"], "no attribute beyond the explicit smoke/heat signal may be asserted");
  assert.equal(result.interpretation.manufacturerPreferences.length, 0);
  assert.equal(result.interpretation.standards.length, 0);
  assert.equal(result.interpretation.compatibilityRequirements.length, 0);
  assert.equal(result.interpretation.requiredAccessories.length, 0);
});

// Direct taxonomy-layer proof (independent of the merge layer above) that the
// guard is driven purely by the row's own text, matching the two real
// repeated phrasings exactly, and does not fire on unrelated Fire Alarm text.
test("buildFireAlarmTaxonomyContext flags multiFunctionConflict only for explicit combined smoke+heat text", () => {
  assert.equal(buildFireAlarmTaxonomyContext({ description: "Combined smoke and heat detector" }).multiFunctionConflict, true);
  assert.equal(buildFireAlarmTaxonomyContext({ description: "Combined smoke and heat sensor" }).multiFunctionConflict, true);
  assert.equal(buildFireAlarmTaxonomyContext({ description: "Heat detector" }).multiFunctionConflict, false);
  assert.equal(buildFireAlarmTaxonomyContext({ description: "Smoke detector" }).multiFunctionConflict, false);
  assert.equal(buildFireAlarmTaxonomyContext({ description: "Fire alarm control panel with smoke and heat zone mapping" }).multiFunctionConflict, false, "no bare 'detector'/'sensor' noun for the conjunction to attach to");
  assert.deepEqual(buildFireAlarmTaxonomyContext({ description: "Combined smoke and heat detector" }).families, [], "no single-function family may be silently emitted");
});
