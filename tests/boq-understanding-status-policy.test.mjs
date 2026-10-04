import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BOQ_UNDERSTANDING_ENGINE_VERSION,
  BOQ_UNDERSTANDING_PROMPT_VERSION,
  BOQ_UNDERSTANDING_SCHEMA_VERSION,
  interpretationConfigFingerprint,
  prepareBoqUnderstandingInput,
  stableStringify,
  validateAndMergeBoqInterpretation,
} from "../app/domain/boq-understanding-engine.mjs";
import { evaluateUnderstandingAuthority } from "../app/domain/estimator-understanding-review.mjs";

// AI Understanding status-policy correction -- focused regression coverage
// (items A-M of the task). Understanding answers "what is this BOQ item?";
// Matching answers "do I have enough technical evidence to select the
// correct product/part number?" These tests prove the two are no longer
// conflated in validateAndMergeBoqInterpretation's status decision, while
// every governance/safety invariant stays exactly as strict as before.

const f = (value, origin = "INFERRED", confidence = 90) => ({ value, origin, confidence });
const a = (name, value, origin = "INFERRED", confidence = 90) => ({ name, value, origin, confidence });
const row = (description, extra = {}) => ({ boqItemId: extra.boqItemId || "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });

// A complete, HIGH-confidence Fire Alarm classification whose ONLY gap is
// the governed family's own matching/SKU attributes (protocol,
// compatible_panel_family, loop_compatibility, operating_voltage) -- exactly
// the live NVR / Smoke Detector / Heat Detector / MCP / Strobe /
// Sounder-Strobe pattern described in this task.
const completeClassificationMissingMatchingAttrs = (overrides = {}) => ({
  normalizedDescription: f("Addressable smoke detector with compatible base", "EXTRACTED", 100),
  taxonomyCandidateKey: f("FA-1"),
  system: f("Fire Alarm"),
  category: f("Detection Devices"),
  equipmentType: f("Addressable Smoke Detector"),
  productFamily: f("Addressable Smoke Detector"),
  technicalAttributes: [a("product_type", "Detector"), a("addressing", "Addressable")],
  confidence: "HIGH",
  ...overrides,
});

test("A. HIGH-confidence complete Fire Alarm classification with missing operating_voltage/protocol/etc. => COMPLETED understanding, missing info preserved", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, completeClassificationMissingMatchingAttrs());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.interpretation.system.value, "Fire Alarm");
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
  for (const name of ["protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]) {
    assert.deepEqual(result.interpretation.attributes[name], { value: null, origin: "MISSING", confidence: 0 }, name);
    assert.ok(result.interpretation.reviewReasons.includes(`APPLICABLE_ATTRIBUTE_MISSING:${name}`), name);
    assert.ok(result.interpretation.missingInformation.some((entry) => entry.value === name), name);
  }
});

// Matching-readiness semantic correction -- product_type/protocol/
// compatible_panel_family/loop_compatibility/operating_voltage were
// reclassified from "Mandatory" to "Comparison" importance in
// fire-alarm-taxonomy.mjs (the Al Mousa School Heat Detector audit proved
// this blanket rule was never actually enforced by any real matching
// execution path -- buildSearchScope/executeProductMatching never read it).
// This row's classification is genuinely complete and evidence-faithful
// (nothing was invented to make it so); it is correctly matching-ready even
// though those five SKU-level attributes remain unestablished -- their
// absence is a real, visible gap (still recorded in reviewReasons/
// missingInformation per test A above) but never a pre-discovery blocker.
test("B. the same row is matching-ready downstream once Understanding COMPLETEs -- missing SKU-level attributes are comparison gaps, not pre-discovery blockers", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, completeClassificationMissingMatchingAttrs());
  assert.equal(result.status, "COMPLETED");
  // evaluateUnderstandingAuthority always operates on a SANITIZED interpretation
  // in production (see mutateUnderstandingReview's own canonical = sanitizeReviewedInterpretation(...)
  // call) -- result.interpretation itself still carries boqItemId, a key
  // sanitizeReviewedInterpretation rejects, so it must be stripped here too or
  // the authority computation silently falls back to its own
  // no-interpretation-available branch regardless of this test's actual point.
  const { boqItemId: _boqItemId, ...interpretation } = result.interpretation;
  const authority = evaluateUnderstandingAuthority({ interpretation, reviewStatus: "AWAITING_REVIEW", taxonomyValid: true });
  assert.equal(authority.technicalMatchReadiness.ready, true);
  assert.deepEqual(authority.matchingBlockers, []);
});

test("C. CONFIDENCE_SCALE_NORMALIZED alone => COMPLETED when everything else is safe", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable smoke detector with compatible base", "EXTRACTED", 1),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 1),
    system: f("Fire Alarm", "INFERRED", 1),
    category: f("Detection Devices", "INFERRED", 1),
    equipmentType: f("Addressable Smoke Detector", "INFERRED", 1),
    productFamily: f("Addressable Smoke Detector", "INFERRED", 1),
    confidence: "HIGH",
  });
  assert.ok(result.interpretation.reviewReasons.includes("CONFIDENCE_SCALE_NORMALIZED"));
  assert.equal(result.status, "COMPLETED");
});

test("D. RESERVED_SOURCE_ATTRIBUTE_REMOVED alone => COMPLETED when everything else is safe", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, completeClassificationMissingMatchingAttrs({
    technicalAttributes: [a("product_type", "Detector"), a("addressing", "Addressable"), a("itemNumber", "27.06.01")],
  }));
  assert.ok(result.interpretation.reviewReasons.includes("RESERVED_SOURCE_ATTRIBUTE_REMOVED"));
  assert.equal("itemNumber" in result.interpretation.attributes, false);
  assert.equal(result.status, "COMPLETED");
});

test("E. GOVERNED_CANDIDATE_KEY_MISSING still forces NEEDS_REVIEW", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable Flasher"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable Flasher", "EXTRACTED", 100),
    system: f("Fire Alarm", "INFERRED", 70),
    category: f("Notification Devices", "INFERRED", 70),
    equipmentType: f("Addressable Flasher", "EXTRACTED", 100),
    productFamily: f("Strobe", "INFERRED", 70),
    confidence: "HIGH",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_MISSING"));
});

test("F. GOVERNED_CANDIDATE_KEY_INVALID still forces NEEDS_REVIEW", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable optical smoke detector"));
  const result = validateAndMergeBoqInterpretation(input, completeClassificationMissingMatchingAttrs({ taxonomyCandidateKey: f("FA-999-does-not-exist") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_INVALID"));
});

test("G. GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL still forces NEEDS_REVIEW (real Central Kitchen 'FACP Addressable type.' pattern)", () => {
  const input = prepareBoqUnderstandingInput(row("FACP Addressable type.", { system: "Fire Alarm" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("FACP Addressable type.", "EXTRACTED", 100),
    system: f("Fire Alarm", "EXTRACTED", 100),
    equipmentType: f("FACP Addressable type.", "EXTRACTED", 100),
    confidence: "HIGH",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL"));
  assert.equal(result.interpretation.productFamily.value, "Fire Alarm Control Panel");
});

test("H. LOW confidence still forces NEEDS_REVIEW even with a complete classification and no other reviewReasons", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, { ...completeClassificationMissingMatchingAttrs(), confidence: "LOW" });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.confidence, "LOW");
});

test("I. explicit ambiguity still forces NEEDS_REVIEW", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector with compatible base"));
  const result = validateAndMergeBoqInterpretation(input, {
    ...completeClassificationMissingMatchingAttrs(),
    ambiguities: [f("Could be either a conventional or addressable variant", "INFERRED", 90)],
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(result.interpretation.ambiguities.length > 0);
});

test("J. essential productFamily/equipmentType missing still forces NEEDS_REVIEW", () => {
  const input = prepareBoqUnderstandingInput(row("Unclassified equipment"));
  const withoutProductFamily = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Unclassified equipment", "EXTRACTED", 100),
    system: f("Fire Alarm", "INFERRED", 90),
    category: f("Detection Devices", "INFERRED", 90),
    equipmentType: f("Unclassified equipment", "EXTRACTED", 100),
    confidence: "HIGH",
  });
  assert.equal(withoutProductFamily.status, "NEEDS_REVIEW");
  assert.equal(withoutProductFamily.interpretation.productFamily.origin, "MISSING");

  const withoutEquipmentType = validateAndMergeBoqInterpretation(prepareBoqUnderstandingInput(row("Unclassified equipment", { boqItemId: "boq_2" })), {
    normalizedDescription: f("Unclassified equipment", "EXTRACTED", 100),
    confidence: "HIGH",
  });
  assert.equal(withoutEquipmentType.status, "NEEDS_REVIEW");
  assert.equal(withoutEquipmentType.interpretation.equipmentType.origin, "MISSING");
});

// K/L -- real Central Kitchen Public Address speaker pattern: a row already
// tagged system="Public Address" (no registered governed system pack) whose
// model response hallucinated Fire Alarm's own governed attribute
// vocabulary onto it.
const ungovernedSpeakerRow = () => prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
const ungovernedSpeakerResponse = () => ({
  normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
  system: f("Public Address", "EXTRACTED", 100),
  category: f("Speakers", "INFERRED", 80),
  equipmentType: f("Speaker", "EXTRACTED", 100),
  productFamily: f("Ceiling Speaker", "INFERRED", 80),
  technicalAttributes: [
    a("operating_voltage", "6W"),
    a("addressing", "recessed"),
    a("protocol", "false ceiling"),
    a("compatible_panel_family", "speaker"),
    a("loop_compatibility", "compatible"),
  ],
  confidence: "HIGH",
});

test("K. an ungoverned Public Address row cannot retain the model's hallucinated technicalAttributes", () => {
  const result = validateAndMergeBoqInterpretation(ungovernedSpeakerRow(), ungovernedSpeakerResponse());
  for (const name of ["operating_voltage", "addressing", "protocol", "compatible_panel_family", "loop_compatibility"]) {
    assert.equal(name in result.interpretation.attributes, false, name);
  }
  assert.ok(result.interpretation.reviewReasons.includes("UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED"));
});

test("L. dropping ungoverned attributes creates no false authority and never silently turns the row into Fire Alarm/CCTV", () => {
  const result = validateAndMergeBoqInterpretation(ungovernedSpeakerRow(), ungovernedSpeakerResponse());
  assert.equal(result.interpretation.system.value, "Public Address");
  assert.notEqual(result.interpretation.system.value, "Fire Alarm");
  assert.notEqual(result.interpretation.system.value, "CCTV");
  // No governed taxonomy candidate mechanics applied -- category/productFamily
  // are exactly what the (untrusted, unvalidated-for-governance) model itself
  // proposed, never promoted to a canonical governed pair.
  assert.equal(result.interpretation.productFamily.value, "Ceiling Speaker");
  // The correction itself is bounded and auditable, not a fabricated fact:
  // it carries no value, just a flag that something was safely dropped.
  assert.equal(result.interpretation.reviewReasons.filter((reason) => reason === "UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED").length, 1);
  // Status is still governed by the ordinary essential-classification/confidence/
  // ambiguity rules -- this row completes because its own classification is
  // clean, not because attributes were dropped.
  assert.equal(result.status, "COMPLETED");
});

// CCTV note (real live gap): camera_type validator allows only Dome/Bullet/PTZ;
// the live model produced "Indoor" on a Dome row -- semanticallyValidated
// correctly rejects it (ATTRIBUTE_VALUE_REJECTED:camera_type), and the CCTV
// validator itself must stay exactly as strict. But when productFamily is
// already canonically "Dome Camera", the rejected camera_type is a
// downstream matching gap, not proof the item was misidentified.
test("CCTV: a rejected camera_type (validator unchanged, still strict) no longer blocks Understanding once productFamily is already canonical", () => {
  const input = prepareBoqUnderstandingInput(row("5MP IP dome camera, PoE"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("5MP IP dome camera, PoE", "EXTRACTED", 100),
    system: f("CCTV", "EXTRACTED", 100),
    taxonomyCandidateKey: f("CCTV-1"),
    category: f("Cameras", "INFERRED", 80),
    equipmentType: f("Dome Camera", "EXTRACTED", 100),
    productFamily: f("Dome Camera", "INFERRED", 80),
    technicalAttributes: [a("camera_type", "Indoor", "EXTRACTED", 100), a("megapixels", 5, "EXTRACTED", 100)],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.productFamily.value, "Dome Camera");
  // The validator itself is untouched: "Indoor" is still rejected, never
  // silently accepted or coerced into "Dome".
  assert.equal(result.interpretation.attributes.camera_type?.value ?? null, null);
  assert.ok(result.interpretation.reviewReasons.some((reason) => reason.startsWith("ATTRIBUTE_VALUE_REJECTED:camera_type:")));
  assert.equal(result.status, "COMPLETED");
});

test("interpretationConfigFingerprint now includes engine version, so this status-policy change alone produces a fresh configuration fingerprint", () => {
  const metadata = { provider: "cloudflare-workers-ai-binding", model: "@cf/meta/llama-3.1-8b-instruct-fast", modelVersion: "8b" };
  const fingerprint = interpretationConfigFingerprint(metadata);
  const fingerprintWithoutEngineVersion = interpretationConfigFingerprint({ ...metadata, engineVersion: "ignored-should-not-be-read-from-input" });
  // Passing a spoofed engineVersion on the input config has no effect --
  // interpretationConfigFingerprint always hashes the module's own
  // BOQ_UNDERSTANDING_ENGINE_VERSION constant, never a caller-supplied one.
  assert.equal(fingerprint, fingerprintWithoutEngineVersion);
  // Deterministic provenance evidence + evidence-backed LOW-confidence
  // suppression bumped this to v6; the property this test actually proves
  // (the module's own engine version is always hashed, never a caller-
  // supplied one) is version-number-agnostic.
  assert.match(BOQ_UNDERSTANDING_ENGINE_VERSION, /^boq-understanding-engine-v6/);
});

test("current config fingerprint genuinely differs from the previous engine v4 configuration (v4 -> v5 governed-aware classification + deterministic power bump)", () => {
  const metadata = { provider: "cloudflare-workers-ai-binding", model: "@cf/meta/llama-3.1-8b-instruct-fast", modelVersion: "8b" };
  const currentFingerprint = interpretationConfigFingerprint(metadata);
  // Reproduces interpretationConfigFingerprint's own exact hashing (sha256 of
  // stableStringify), substituting the literal PRIOR engine version string
  // this constant held before today's bump -- proving the fingerprint a
  // manifest computed under the old engine identity would have produced is
  // not the same fingerprint current code produces, so a stale manifest can
  // never be mistaken for one produced under this policy.
  const priorV4Fingerprint = createHash("sha256").update(stableStringify({
    provider: metadata.provider,
    model: metadata.model,
    modelVersion: metadata.modelVersion,
    promptVersion: BOQ_UNDERSTANDING_PROMPT_VERSION,
    schemaVersion: BOQ_UNDERSTANDING_SCHEMA_VERSION,
    engineVersion: "boq-understanding-engine-v4-zero-confidence-assertion-rejection",
  })).digest("hex");
  assert.notEqual(currentFingerprint, priorV4Fingerprint);
});

test("current config fingerprint genuinely differs from the previous engine v5 configuration (v5 -> v6 deterministic provenance evidence + confidence calibration bump)", () => {
  const metadata = { provider: "cloudflare-workers-ai-binding", model: "@cf/meta/llama-3.1-8b-instruct-fast", modelVersion: "@cf/meta/llama-3.1-8b-instruct-fast" };
  const currentFingerprint = interpretationConfigFingerprint(metadata);
  const priorV5Fingerprint = createHash("sha256").update(stableStringify({
    provider: metadata.provider,
    model: metadata.model,
    modelVersion: metadata.modelVersion,
    promptVersion: BOQ_UNDERSTANDING_PROMPT_VERSION,
    schemaVersion: BOQ_UNDERSTANDING_SCHEMA_VERSION,
    engineVersion: "boq-understanding-engine-v5-governed-aware-classification-and-deterministic-power",
  })).digest("hex");
  assert.notEqual(currentFingerprint, priorV5Fingerprint);
  assert.match(BOQ_UNDERSTANDING_ENGINE_VERSION, /^boq-understanding-engine-v6/);
});
