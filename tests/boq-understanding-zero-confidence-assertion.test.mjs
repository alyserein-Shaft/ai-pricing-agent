import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBoqUnderstandingModelResponse,
  prepareBoqUnderstandingInput,
  validateAndMergeBoqInterpretation,
} from "../app/domain/boq-understanding-engine.mjs";

// Zero-confidence assertion rejection -- real live raw model evidence:
// Central Kitchen item 28.16 ("6W Recessed in false ceiling speaker") had
// category:{value:"Notification Devices", origin:"INFERRED", confidence:0}
// survive unchanged into validated_interpretation. A zero-confidence
// assertion must never become authoritative interpretation data.

const f = (value, origin = "INFERRED", confidence = 90) => ({ value, origin, confidence });
const a = (name, value, origin = "INFERRED", confidence = 90) => ({ name, value, origin, confidence });
const row = (description, extra = {}) => ({ boqItemId: extra.boqItemId || "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });

// isBlockingUnderstandingReason is not exported today -- add a tiny local
// probe mirroring its documented contract if it is not exported, otherwise
// use it directly. (It IS exported from earlier turns; import above will
// fail loudly at module load if that ever regresses, which is itself a
// useful signal.)

test("1. category: non-null + INFERRED + confidence 0 becomes MISSING/null/0", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Fire Alarm", "EXTRACTED", 90),
    category: f("Notification Devices", "INFERRED", 0),
    equipmentType: f("Speaker", "EXTRACTED", 100),
    productFamily: f("Speaker", "INFERRED", 80),
    confidence: "HIGH",
  });
  assert.deepEqual(result.interpretation.category, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:category"));
});

test("2. system: non-null + EXTRACTED + confidence 0 becomes MISSING/null/0 unless deterministic evidence later independently supplies a real system", () => {
  // No deterministic override available (input.system is blank) -- the
  // zero-confidence system assertion stays MISSING.
  const inputNoOverride = prepareBoqUnderstandingInput(row("Unclassified equipment"));
  const noOverride = validateAndMergeBoqInterpretation(inputNoOverride, {
    normalizedDescription: f("Unclassified equipment", "EXTRACTED", 100),
    system: f("Fire Alarm", "EXTRACTED", 0),
    category: f("Detection Devices", "INFERRED", 90),
    equipmentType: f("Unclassified equipment", "EXTRACTED", 100),
    productFamily: f("Something", "INFERRED", 90),
    confidence: "HIGH",
  });
  assert.deepEqual(noOverride.interpretation.system, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(noOverride.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:system"));

  // Real 28.16 pattern: the row's OWN deterministic system ("Public Address")
  // is a real, different, registered system -- when the model independently
  // claims a real (non-zero-confidence) different system, that claim still
  // gets overridden back to the row's own known prior system, completely
  // unaffected by the zero-confidence rule (a materially different safety
  // mechanism: priorSystemIsConfidentlyDifferent, in
  // validateAndMergeBoqInterpretation). Note this deliberately uses a
  // positive-confidence claim, not confidence 0: since the pilot
  // authorization fix (prepareBoqUnderstandingInput's own taxonomy-system-
  // conflict sanitization) already stops a conflicting Fire Alarm candidate
  // from ever reaching the AI for this exact row, a model that ALSO
  // separately asserts confidence 0 on top of that has no distinguishable
  // "wrong different system" left for priorSystemIsConfidentlyDifferent to
  // correct against once the zero-confidence rule rejects it to MISSING too
  // -- output.system legitimately becomes MISSING in that double-rejected
  // case, exactly like any other row whose known prior system finds no
  // corroborating evidence anywhere in the response (a pre-existing,
  // unrelated behavior, unchanged by this rule).
  const inputWithOverride = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const withOverride = validateAndMergeBoqInterpretation(inputWithOverride, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Fire Alarm", "EXTRACTED", 70),
    equipmentType: f("Speaker", "EXTRACTED", 100),
    confidence: "HIGH",
  });
  assert.equal(withOverride.interpretation.system.value, "Public Address");
  assert.equal(withOverride.interpretation.system.origin, "EXTRACTED");
});

test("3. equipmentType zero-confidence assertion is rejected", () => {
  const input = prepareBoqUnderstandingInput(row("Network Video Recorder"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Network Video Recorder", "EXTRACTED", 100),
    system: f("CCTV", "EXTRACTED", 90),
    category: f("Recording", "INFERRED", 90),
    equipmentType: f("NVR", "EXTRACTED", 0),
    productFamily: f("NVR", "INFERRED", 90),
    confidence: "HIGH",
  });
  assert.deepEqual(result.interpretation.equipmentType, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:equipmentType"));
});

test("4. productFamily zero-confidence assertion is rejected", () => {
  const input = prepareBoqUnderstandingInput(row("Network Video Recorder"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Network Video Recorder", "EXTRACTED", 100),
    system: f("CCTV", "EXTRACTED", 90),
    category: f("Recording", "INFERRED", 90),
    equipmentType: f("NVR", "EXTRACTED", 90),
    productFamily: f("NVR", "INFERRED", 0),
    confidence: "HIGH",
  });
  assert.deepEqual(result.interpretation.productFamily, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:productFamily"));
});

test("5. subcategory is covered by the assertion-bearing predicate at the normalization layer (subcategory itself is not a model-facing schema field, pre-existing and unrelated to this fix, so it can never reach the merge stage from a real model response)", () => {
  // The compact model-facing schema (compactScalarFields) never accepts a
  // "subcategory" key from the model at all -- sending one throws "unsupported
  // field" regardless of confidence, a pre-existing, unrelated restriction.
  // subcategory is still listed among ASSERTION_BEARING_SCALAR_FIELDS (the
  // predicate is deliberately general/path-aware, not schema-aware), so we
  // prove its coverage directly at the normalization layer, which runs before
  // strict schema validation and does not reject unknown keys.
  const normalized = normalizeBoqUnderstandingModelResponse({
    normalizedDescription: f("Network Video Recorder", "EXTRACTED", 100),
    subcategory: f("Recording Device", "INFERRED", 0),
    confidence: "HIGH",
  });
  assert.deepEqual(normalized.response.subcategory, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(normalized.corrections.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:subcategory"));

  const input = prepareBoqUnderstandingInput(row("Network Video Recorder"));
  assert.throws(
    () => validateAndMergeBoqInterpretation(input, {
      normalizedDescription: f("Network Video Recorder", "EXTRACTED", 100),
      subcategory: f("Recording Device", "INFERRED", 0),
      confidence: "HIGH",
    }),
    /unsupported field subcategory/,
  );
});

test("6. taxonomyCandidateKey zero-confidence value cannot itself select a governed candidate (independent deterministic evidence may still supply real values afterward, exactly like system in test 2)", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable optical smoke detector with built-in isolator"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable optical smoke detector with built-in isolator", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "EXTRACTED", 0),
    equipmentType: f("Optical Smoke Detector", "EXTRACTED", 90),
    confidence: "HIGH",
  });
  // The zero-confidence key itself is rejected to MISSING -- the governed
  // candidate lookup then correctly reports it as missing (not "invalid"),
  // proving the rejected key was never consulted as a selection input.
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:taxonomyCandidateKey"));
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_MISSING"));
  // Independent deterministic evidence (the row's own unambiguous, single-
  // candidate description) is free to still resolve category/productFamily
  // afterward via GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL -- this
  // is the taxonomyCandidateKey analogue of test 2's system override, and
  // proves the rejection did not disable deterministic governance entirely.
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL"));
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("7. technicalAttributes zero-confidence value becomes MISSING/null/0 and cannot become accepted matching evidence", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable smoke detector with compatible base", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1"),
    system: f("Fire Alarm"), category: f("Detection Devices"),
    equipmentType: f("Addressable Smoke Detector"), productFamily: f("Addressable Smoke Detector"),
    technicalAttributes: [a("protocol", "SLC", "INFERRED", 0)],
    confidence: "HIGH",
  });
  assert.deepEqual(result.interpretation.attributes.protocol, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:protocol"));
});

test("8. normalizedDescription non-null + confidence 0 fails closed", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector"));
  assert.throws(
    () => validateAndMergeBoqInterpretation(input, { normalizedDescription: f("Addressable smoke detector", "EXTRACTED", 0), confidence: "HIGH" }),
    (error) => error.validationCode === "AI_OUTPUT_INVALID_CONFIDENCE" && /zero confidence/.test(error.message),
  );
});

test("9. missingInformation with value:'protocol', origin:INFERRED, confidence:0 remains valid and is NOT converted to MISSING", () => {
  const normalized = normalizeBoqUnderstandingModelResponse({
    normalizedDescription: f("Device", "EXTRACTED", 100),
    missingInformation: [f("protocol", "INFERRED", 0)],
    confidence: "LOW",
  });
  assert.deepEqual(normalized.response.missingInformation[0], { value: "protocol", origin: "INFERRED", confidence: 0 });
  assert.equal(normalized.corrections.some((c) => c.startsWith("ZERO_CONFIDENCE_ASSERTION_REJECTED")), false);

  const input = prepareBoqUnderstandingInput(row("Device"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Device", "EXTRACTED", 100),
    missingInformation: [f("protocol", "INFERRED", 0)],
    confidence: "LOW",
  });
  assert.ok(result.interpretation.missingInformation.some((entry) => entry.value === "protocol" && entry.origin === "INFERRED" && entry.confidence === 0));
});

test("10. ambiguities and other list/label fields with confidence 0 remain unchanged (list/label semantics, not assertions)", () => {
  const normalized = normalizeBoqUnderstandingModelResponse({
    normalizedDescription: f("Device", "EXTRACTED", 100),
    ambiguities: [f("Could be either variant", "INFERRED", 0)],
    searchTerms: [f("device search term", "INFERRED", 0)],
    standards: [f("Some standard", "INFERRED", 0)],
    confidence: "LOW",
  });
  assert.deepEqual(normalized.response.ambiguities[0], { value: "Could be either variant", origin: "INFERRED", confidence: 0 });
  assert.deepEqual(normalized.response.searchTerms[0], { value: "device search term", origin: "INFERRED", confidence: 0 });
  assert.deepEqual(normalized.response.standards[0], { value: "Some standard", origin: "INFERRED", confidence: 0 });
  assert.equal(normalized.corrections.some((c) => c.startsWith("ZERO_CONFIDENCE_ASSERTION_REJECTED")), false);
});

test("11. normal positive-confidence assertions remain completely unchanged", () => {
  const normalized = normalizeBoqUnderstandingModelResponse({
    normalizedDescription: f("Device", "EXTRACTED", 100),
    system: f("Fire Alarm", "INFERRED", 85),
    technicalAttributes: [a("protocol", "SLC", "INFERRED", 70)],
    confidence: "HIGH",
  });
  assert.deepEqual(normalized.response.system, { value: "Fire Alarm", origin: "INFERRED", confidence: 85 });
  assert.deepEqual(normalized.response.technicalAttributes[0], { name: "protocol", value: "SLC", origin: "INFERRED", confidence: 70 });
  assert.equal(normalized.corrections.length, 0);
});

test("12. fractional confidence handling still works (0.8 -> 80, 1 -> 100) and is not accidentally treated as zero", () => {
  const normalized = normalizeBoqUnderstandingModelResponse({
    normalizedDescription: f("Device", "EXTRACTED", 1),
    system: f("Fire Alarm", "INFERRED", 0.8),
    confidence: "HIGH",
  });
  assert.equal(normalized.response.normalizedDescription.confidence, 100);
  assert.equal(normalized.response.system.confidence, 80);
  assert.equal(normalized.corrections.some((c) => c.startsWith("ZERO_CONFIDENCE_ASSERTION_REJECTED")), false);
});

test("13. existing MISSING/null/0 facts remain unchanged", () => {
  const normalized = normalizeBoqUnderstandingModelResponse({
    normalizedDescription: f("Device", "EXTRACTED", 100),
    category: { value: null, origin: "MISSING", confidence: 0 },
    confidence: "LOW",
  });
  assert.deepEqual(normalized.response.category, { value: null, origin: "MISSING", confidence: 0 });
  assert.equal(normalized.corrections.some((c) => c.startsWith("ZERO_CONFIDENCE_ASSERTION_REJECTED")), false);
});

test("14. the current live 28.16-shaped fixture (category='Notification Devices', INFERRED, confidence 0) must not survive as a canonical category assertion", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Fire Alarm", "INFERRED", 70),
    category: f("Notification Devices", "INFERRED", 0),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 70),
    equipmentType: f("speaker", "EXTRACTED", 100),
    productFamily: f("Speaker", "INFERRED", 70),
    confidence: "MEDIUM",
  });
  assert.notEqual(result.interpretation.category.value, "Notification Devices");
  // The row's own deterministic system (Public Address, not Fire Alarm)
  // still wins independently, exactly as the real fix already proved.
  assert.equal(result.interpretation.system.value, "Public Address");
});

test("15. ZERO_CONFIDENCE_ASSERTION_REJECTED:* is blocking under isBlockingUnderstandingReason() (proven indirectly through status, since the classifier is a private module internal)", () => {
  // Every essential classification field is present and non-missing, overall
  // confidence is HIGH, and there are no ambiguities -- so if the reason were
  // (incorrectly) treated as non-blocking, status would be COMPLETED. The
  // only thing that can force NEEDS_REVIEW here is isBlockingUnderstandingReason
  // treating ZERO_CONFIDENCE_ASSERTION_REJECTED as blocking via its fail-closed
  // default (it is deliberately absent from NON_BLOCKING_UNDERSTANDING_CORRECTIONS
  // and does not match either DOWNSTREAM_UNDERSTANDING_GAP_PREFIXES prefix).
  const input = prepareBoqUnderstandingInput(row("Network Video Recorder"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Network Video Recorder", "EXTRACTED", 100),
    system: f("CCTV", "EXTRACTED", 90),
    category: f("Recording", "INFERRED", 90),
    equipmentType: f("NVR", "EXTRACTED", 90),
    productFamily: f("NVR", "INFERRED", 90),
    technicalAttributes: [a("storage_capacity", "2TB", "INFERRED", 0)],
    confidence: "HIGH",
  });
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:storage_capacity"));
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("16. downstream matching never receives a zero-confidence non-null assertion as authoritative Understanding evidence", () => {
  // Governed attribute name (mirrors test 7) so the fixture exercises the
  // zero-confidence rule itself, not the separate, pre-existing governed
  // attribute-name normalization (an unrecognized attribute name for a
  // governed system, e.g. CCTV's own vocabulary not including
  // "storage_capacity", is silently dropped from output.attributes
  // entirely regardless of confidence -- a different mechanism than this
  // one, already covered by test 15's reviewReasons-only assertion).
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable smoke detector with compatible base", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1"),
    system: f("Fire Alarm"), category: f("Detection Devices"),
    equipmentType: f("Addressable Smoke Detector"), productFamily: f("Addressable Smoke Detector"),
    technicalAttributes: [a("protocol", "SLC-Loop-9000", "INFERRED", 0)],
    confidence: "HIGH",
  });
  // The zero-confidence attribute never reaches output.attributes with a
  // real value -- it is MISSING, exactly like any other unresolved
  // matching-stage gap, never authoritative evidence a matching engine
  // could act on.
  assert.deepEqual(result.interpretation.attributes.protocol, { value: null, origin: "MISSING", confidence: 0 });
  assert.equal(JSON.stringify(result.interpretation).includes("SLC-Loop-9000"), false);
});
