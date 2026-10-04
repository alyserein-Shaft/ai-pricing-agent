import test from "node:test";
import assert from "node:assert/strict";
import {
  isCoreIdentityStronglySupported,
  prepareBoqUnderstandingInput,
  STRONG_IDENTITY_CONFIDENCE_THRESHOLD,
  validateAndMergeBoqInterpretation,
} from "../app/domain/boq-understanding-engine.mjs";
import { qualityItem } from "../worker/estimator-understanding-api.mjs";

// Final BOQ Understanding closure pass -- two fixes:
// 1. Deterministic provenance evidence: a canonicalizing deterministic rule
//    (indoor_outdoor/defog/notificationFeature/ecsCapability) stores a FIXED
//    LABEL that is never itself a literal substring of the source, even
//    though the rule only ever fires on real literal evidence (real 28.17
//    gap: indoor_outdoor="Outdoor" from literal "weather proof").
// 2. Evidence-backed LOW-confidence suppression: a bare model top-level
//    "confidence":"LOW" self-report must not be the final authority over
//    workflow status when the backend can independently establish that core
//    identity (system, equipmentType) is strongly source-supported.

const f = (value, origin = "EXTRACTED", confidence = 90) => ({ value, origin, confidence });
const a = (name, value, origin = "EXTRACTED", confidence = 90) => ({ name, value, origin, confidence });
const row = (description, extra = {}) => ({ boqItemId: "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });

const qualityRow = (interpretation, overrides = {}) => ({
  itemReference: "X", rowType: "BOQ Item", description: interpretation.normalizedDescription?.value || "",
  numericQuantity: 1, originalQuantity: 1, normalizedUnit: "EA", originalUnit: "EA",
  sourceSystem: null, sourceCategory: null, sourceSubcategory: null,
  manufacturer: null, sourceModel: null, sourcePartNumber: null, currentValues: "{}", sourceLocation: null,
  status: "COMPLETED", errorCode: null, model: "test-model", usageMetadata: null,
  interpretation: JSON.stringify(interpretation),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fix 1: deterministic provenance evidence
// ---------------------------------------------------------------------------

test("1. weather proof -> deterministic Outdoor produces no provenance contradiction", () => {
  const description = "30W Recessed in false ceiling speaker, weather proof";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Public Address" }));
  assert.equal(input.deterministicFactEvidence.indoor_outdoor, "weather proof");
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    equipmentType: f("speaker", "EXTRACTED", 100),
    confidence: "LOW",
  });
  const item = qualityItem(qualityRow(result.interpretation, { description, sourceSystem: "Public Address" }));
  assert.equal(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"), false);
  assert.deepEqual(result.interpretation.attributes.indoor_outdoor, { value: "Outdoor", origin: "EXTRACTED", confidence: 100 });
});

test("2. anti-fog / notification / ECS canonicalized deterministic facts use their recorded literal evidence correctly", () => {
  const cases = [
    { description: "IP wall mountedanti fog camera, IR, bullet Type", key: "defog", value: "Defog", evidence: "anti fog" },
    { description: "Smoke Detector Ceiling Mounted with Sounder", key: "notificationFeature", value: "Sounder Required", evidence: "Sounder" },
    { description: "Integrated Fire Alarm & Emergency Communication System panel", key: "ecsCapability", value: "ECS Capable", evidence: "Emergency Communication System" },
  ];
  for (const { description, key, value, evidence } of cases) {
    // Ungoverned system on purpose: this test verifies deterministicFactEvidence
    // recording + the provenance check, not governed attribute-name
    // normalization (which requires a resolved productFamily and would
    // otherwise drop these facts for an unrelated, already-covered reason --
    // see UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED coverage elsewhere).
    const input = prepareBoqUnderstandingInput(row(description, { system: "Public Address" }));
    assert.equal(input.deterministicFactEvidence[key], evidence, `${key} evidence`);
    const result = validateAndMergeBoqInterpretation(input, {
      normalizedDescription: f(description, "EXTRACTED", 100),
      system: f("Public Address", "EXTRACTED", 100),
      equipmentType: f("camera", "EXTRACTED", 100),
      confidence: "LOW",
    });
    assert.deepEqual(result.interpretation.attributes[key], { value, origin: "EXTRACTED", confidence: 100 }, `${key} fact`);
    const item = qualityItem(qualityRow(result.interpretation, { description, sourceSystem: "Public Address" }));
    assert.equal(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"), false, `${key} contradiction`);
  }
});

test("3. a model-proposed unsupported canonical-looking value still triggers provenance contradiction (no deterministic exemption without a real deterministic trigger)", () => {
  // The description has NO weatherproof/outdoor/indoor/anti-fog/sounder/ECS
  // wording at all -- deterministicFactEvidence will be empty for these keys
  // -- so a model that independently fabricates indoor_outdoor="Outdoor"
  // must still be caught.
  const description = "Generic ceiling speaker";
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f(description, "EXTRACTED", 80),
    system: f("Public Address", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("speaker", "EXTRACTED", 80),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: { indoor_outdoor: f("Outdoor") },
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW", reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description, sourceSystem: "Public Address" }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});

test("4. the 27.09-style productFamily hallucination (duplicate of system value) remains caught", () => {
  const description = "2 No RJ-45 outlets for telepohne and data";
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f(description, "EXTRACTED", 80),
    system: f("Structured Cabling", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("outlets", "EXTRACTED", 80),
    productFamily: f("Structured Cabling", "EXTRACTED", 80),
    attributes: {}, manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW", reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description, sourceSystem: "Structured Cabling" }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});

// ---------------------------------------------------------------------------
// Fix 2: evidence-backed LOW-confidence suppression
// ---------------------------------------------------------------------------

test("5. strong EXTRACTED/source-supported system + equipmentType + top-level LOW + no other blockers reaches COMPLETED (engine + quality report)", () => {
  const description = "6W Recessed in false ceiling speaker";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    equipmentType: f("speaker", "EXTRACTED", 100),
    confidence: "LOW",
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.interpretation.confidence, "LOW", "the model's own reported confidence stays visible/untouched");
  const item = qualityItem(qualityRow(result.interpretation, { description, sourceSystem: "Public Address", status: "COMPLETED" }));
  assert.equal(item.finalStatus, "COMPLETED");
  assert.ok(item.reviewReasons.includes("MODEL_CONFIDENCE_LOW"), "MODEL_CONFIDENCE_LOW stays visible even when non-blocking");
});

test("6. INFERRED/50 equipmentType + LOW remains NEEDS_REVIEW (28.14-shaped)", () => {
  const description = "Card access controller for four doors";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Access Control" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "INFERRED", 50),
    system: f("Access Control", "INFERRED", 50),
    equipmentType: f("Card access controller", "INFERRED", 50),
    confidence: "LOW",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  const item = qualityItem(qualityRow(result.interpretation, { description, sourceSystem: "Access Control", status: "NEEDS_REVIEW" }));
  assert.equal(item.finalStatus, "NEEDS_REVIEW");
  assert.ok(item.reviewReasons.includes("MODEL_CONFIDENCE_LOW"));
});

test("7. INFERRED/50 system + equipmentType remains NEEDS_REVIEW (27.04-shaped)", () => {
  const description = "Outlet";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Structured Cabling" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "INFERRED", 50),
    system: f("Structured Cabling", "INFERRED", 50),
    equipmentType: f("Rack", "INFERRED", 50),
    confidence: "LOW",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("8. governed Fire Alarm/CCTV safety remains unchanged: missing category/productFamily still blocks regardless of strong system/equipmentType identity", () => {
  const description = "Generic fire alarm equipment";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Fire Alarm" }));
  assert.equal(input.taxonomyContext.families.length, 0);
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Fire Alarm", "EXTRACTED", 100),
    equipmentType: f("Equipment", "EXTRACTED", 100),
    confidence: "LOW",
  });
  assert.equal(result.status, "NEEDS_REVIEW", "strong identity does not bypass governed classificationMissing");
});

test("8b. governed Fire Alarm/CCTV positive path: a valid candidate + complete classification + strong identity can complete even with top-level LOW", () => {
  const description = "Addressable optical smoke detector with built-in isolator";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Fire Alarm" }));
  const key = input.taxonomyContext.families[0]?.selectionKey;
  assert.ok(key);
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    taxonomyCandidateKey: f(key, "EXTRACTED", 90),
    equipmentType: f("Optical Smoke Detector", "EXTRACTED", 90),
    confidence: "LOW",
  });
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.interpretation.category.value);
  assert.ok(result.interpretation.productFamily.value);
});

test("8c. an invalid governed candidate key still fails closed regardless of confidence/identity strength", () => {
  const description = "Addressable optical smoke detector with built-in isolator";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Fire Alarm" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    taxonomyCandidateKey: f("NOT-A-REAL-KEY", "EXTRACTED", 90),
    equipmentType: f("Optical Smoke Detector", "EXTRACTED", 90),
    confidence: "LOW",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_INVALID"));
});

test("9a. every existing hard blocker still overrides strong identity: explicit ambiguity", () => {
  const description = "6W Recessed in false ceiling speaker";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    equipmentType: f("speaker", "EXTRACTED", 100),
    ambiguities: [f("Could be a different wattage variant", "INFERRED", 90)],
    confidence: "LOW",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("9b. every existing hard blocker still overrides strong identity: ZERO_CONFIDENCE_ASSERTION_REJECTED", () => {
  const description = "6W Recessed in false ceiling speaker";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    category: f("Notification Devices", "INFERRED", 0),
    equipmentType: f("speaker", "EXTRACTED", 100),
    confidence: "LOW",
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:category"));
});

test("9c. every existing hard blocker still overrides strong identity: genuine SOURCE_PROVENANCE_CONTRADICTION at the quality-report layer", () => {
  const description = "6W Recessed in false ceiling speaker";
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("speaker", "EXTRACTED", 100),
    productFamily: f("Public Address", "EXTRACTED", 90),
    attributes: {}, manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW", reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description, sourceSystem: "Public Address", status: "COMPLETED" }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
  assert.equal(item.finalStatus, "NEEDS_REVIEW", "a genuine contradiction still blocks even though system/equipmentType alone are strong");
});

test("9d. every existing hard blocker still overrides strong identity: GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID at the quality-report layer", () => {
  const description = "Addressable optical smoke detector with built-in isolator";
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: { value: null, origin: "MISSING", confidence: 0 },
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("Optical Smoke Detector", "EXTRACTED", 90),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {}, manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW", reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description, sourceSystem: "Fire Alarm", status: "NEEDS_REVIEW" }));
  assert.ok(item.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_MISSING_OR_INVALID"));
  assert.equal(item.finalStatus, "NEEDS_REVIEW");
});

test("isCoreIdentityStronglySupported is threshold-gated and origin-strict (unit coverage of the shared helper itself)", () => {
  assert.equal(STRONG_IDENTITY_CONFIDENCE_THRESHOLD, 70);
  const strongSystem = { value: "Public Address", origin: "EXTRACTED", confidence: 100 };
  const strongEquipmentType = { value: "speaker", origin: "EXTRACTED", confidence: 100 };
  assert.equal(isCoreIdentityStronglySupported({ system: strongSystem, equipmentType: strongEquipmentType, systemMatchesAuthoritativeSource: true, systemProvenanceSupported: false, equipmentTypeProvenanceSupported: true }), true);
  // Below-threshold confidence fails regardless of origin/match.
  assert.equal(isCoreIdentityStronglySupported({ system: strongSystem, equipmentType: { ...strongEquipmentType, confidence: 50 }, systemMatchesAuthoritativeSource: true, systemProvenanceSupported: false, equipmentTypeProvenanceSupported: true }), false);
  // INFERRED equipmentType fails even at high confidence.
  assert.equal(isCoreIdentityStronglySupported({ system: strongSystem, equipmentType: { ...strongEquipmentType, origin: "INFERRED", confidence: 95 }, systemMatchesAuthoritativeSource: true, systemProvenanceSupported: false, equipmentTypeProvenanceSupported: true }), false);
  // MISSING system fails regardless of everything else.
  assert.equal(isCoreIdentityStronglySupported({ system: { value: null, origin: "MISSING", confidence: 0 }, equipmentType: strongEquipmentType, systemMatchesAuthoritativeSource: true, systemProvenanceSupported: true, equipmentTypeProvenanceSupported: true }), false);
  // Neither authoritative match nor provenance support -> fails.
  assert.equal(isCoreIdentityStronglySupported({ system: strongSystem, equipmentType: strongEquipmentType, systemMatchesAuthoritativeSource: false, systemProvenanceSupported: false, equipmentTypeProvenanceSupported: true }), false);
  // No equipmentType provenance support -> fails.
  assert.equal(isCoreIdentityStronglySupported({ system: strongSystem, equipmentType: strongEquipmentType, systemMatchesAuthoritativeSource: true, systemProvenanceSupported: false, equipmentTypeProvenanceSupported: false }), false);
});

test("UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED remains unchanged: a model-proposed technicalAttribute for an ungoverned system is still dropped, deterministic facts still survive", () => {
  const description = "6W Recessed in false ceiling speaker";
  const input = prepareBoqUnderstandingInput(row(description, { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f(description, "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    equipmentType: f("speaker", "EXTRACTED", 100),
    technicalAttributes: [a("mounting_type", "Recessed")],
    confidence: "LOW",
  });
  assert.equal(result.interpretation.attributes.mounting_type, undefined);
  assert.deepEqual(result.interpretation.attributes.power_rating, { value: "6 W", origin: "EXTRACTED", confidence: 100 });
  assert.ok(result.interpretation.reviewReasons.includes("UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED"));
});
