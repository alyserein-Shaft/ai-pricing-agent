import test from "node:test";
import assert from "node:assert/strict";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation } from "../app/domain/boq-understanding-engine.mjs";
import { qualityItem } from "../worker/estimator-understanding-api.mjs";

// Governed-aware essential classification policy + false-positive
// SOURCE_PROVENANCE_CONTRADICTION + deterministic wattage extraction -- real
// Central Kitchen 28.16/28.17 gap: Public Address (and Access Control,
// Structured Cabling) rows were permanently forced into NEEDS_REVIEW because
// category/productFamily were treated as mandatory even though no governed
// taxonomy exists for those systems, AND a correctly-echoed known system was
// wrongly flagged as a provenance contradiction, AND an explicit wattage
// rating in the description was silently dropped.

const f = (value, origin = "EXTRACTED", confidence = 90) => ({ value, origin, confidence });
const row = (description, extra = {}) => ({ boqItemId: "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });

const qualityRow = (interpretation, overrides = {}) => ({
  itemReference: "X", rowType: "BOQ Item", description: "6W Recessed in false ceiling speaker",
  numericQuantity: 1, originalQuantity: 1, normalizedUnit: "EA", originalUnit: "EA",
  sourceSystem: "Public Address", sourceCategory: null, sourceSubcategory: null,
  manufacturer: null, sourceModel: null, sourcePartNumber: null, currentValues: "{}", sourceLocation: null,
  status: "NEEDS_REVIEW", errorCode: null, model: "test-model", usageMetadata: null,
  interpretation: JSON.stringify(interpretation),
  ...overrides,
});

// ---------------------------------------------------------------------------
// A. Real Public Address item: "6W Recessed in false ceiling speaker"
// ---------------------------------------------------------------------------

test("A1. Public Address speaker: system/equipmentType extracted, category/productFamily missing, wattage retained deterministically", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 90),
    equipmentType: f("speaker", "EXTRACTED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.system.value, "Public Address");
  assert.equal(result.interpretation.equipmentType.value, "speaker");
  assert.deepEqual(result.interpretation.category, { value: null, origin: "MISSING", confidence: 0 });
  assert.deepEqual(result.interpretation.productFamily, { value: null, origin: "MISSING", confidence: 0 });
  assert.deepEqual(result.interpretation.attributes.power_rating, { value: "6 W", origin: "EXTRACTED", confidence: 100 });
});

test("A2. Public Address speaker: missing category/productFamily alone no longer blocks Understanding completion (engine status)", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 90),
    equipmentType: f("speaker", "EXTRACTED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.status, "COMPLETED");
});

test("A3. Public Address speaker: quality report has no ESSENTIAL_CLASSIFICATION_MISSING and no blockingMissingFields solely from ungoverned category/productFamily", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 80),
    system: f("Public Address", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("speaker", "EXTRACTED", 80),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    // Deliberately no attributes here: this test isolates the essential-
    // classification fix in qualityItem. Wattage retention itself is proven
    // separately at the engine level (A1/B) -- deterministic attribute
    // values like power_rating/operatingVoltage are reformatted with an
    // inserted space (e.g. "6W" -> "6 W"), which the UNMODIFIED, in-scope
    // attribute provenance check (deliberately untouched per this task's
    // "do not weaken provenance checks for ... attributes" requirement) can
    // separately flag against the raw, unspaced description text -- a real,
    // pre-existing, out-of-scope quirk unrelated to the fix under test here.
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "HIGH",
    reviewReasons: [],
  };
  // persistedStatus is COMPLETED here so finalStatus isolates the quality-
  // report's OWN reconciliation (currentUnsafe) rather than merely echoing a
  // NEEDS_REVIEW the engine already persisted for an unrelated reason.
  const item = qualityItem(qualityRow(interpretation, { status: "COMPLETED" }));
  assert.equal(item.reviewReasons.includes("ESSENTIAL_CLASSIFICATION_MISSING"), false);
  assert.deepEqual(item.blockingMissingFields, []);
  assert.deepEqual(item.informationalMissingFields.sort(), ["category", "productFamily", "subcategory"].sort());
  assert.equal(item.finalStatus, "COMPLETED");
});

test("A4. Public Address speaker: EXTRACTED system matching the row's own authoritative sourceSystem does NOT flag SOURCE_PROVENANCE_CONTRADICTION", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 80),
    system: f("Public Address", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("speaker", "EXTRACTED", 80),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW",
    reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { sourceSystem: "Public Address" }));
  assert.equal(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"), false);
});

// ---------------------------------------------------------------------------
// B. "30W Recessed in false ceiling speaker, weather proof"
// ---------------------------------------------------------------------------

test("B. 30W weatherproof Public Address speaker retains both wattage and indoor/outdoor evidence", () => {
  const input = prepareBoqUnderstandingInput(row("30W Recessed in false ceiling speaker, weather proof", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("30W Recessed in false ceiling speaker, weather proof", "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 100),
    equipmentType: f("speaker", "EXTRACTED", 100),
    confidence: "HIGH",
  });
  assert.deepEqual(result.interpretation.attributes.power_rating, { value: "30 W", origin: "EXTRACTED", confidence: 100 });
  assert.deepEqual(result.interpretation.attributes.indoor_outdoor, { value: "Outdoor", origin: "EXTRACTED", confidence: 100 });
});

// ---------------------------------------------------------------------------
// C. Governed Fire Alarm / CCTV items remain strict
// ---------------------------------------------------------------------------

test("C1. governed Fire Alarm item with missing category/productFamily still blocks (engine status)", () => {
  const input = prepareBoqUnderstandingInput(row("Generic fire alarm equipment", { system: "Fire Alarm" }));
  assert.equal(input.taxonomyContext.families.length, 0, "fixture must have no discoverable candidate, so category/productFamily genuinely stay MISSING");
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Generic fire alarm equipment", "EXTRACTED", 100),
    system: f("Fire Alarm", "EXTRACTED", 90),
    equipmentType: f("Equipment", "EXTRACTED", 90),
    confidence: "HIGH",
  });
  assert.deepEqual(result.interpretation.category, { value: null, origin: "MISSING", confidence: 0 });
  assert.deepEqual(result.interpretation.productFamily, { value: null, origin: "MISSING", confidence: 0 });
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("C2. governed Fire Alarm item with a valid candidate and complete classification still reaches COMPLETED (positive governed path unaffected)", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable optical smoke detector with built-in isolator", { system: "Fire Alarm" }));
  const key = input.taxonomyContext.families[0]?.selectionKey;
  assert.ok(key, "fixture must resolve a real governed candidate");
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable optical smoke detector with built-in isolator", "EXTRACTED", 100),
    taxonomyCandidateKey: f(key, "EXTRACTED", 90),
    equipmentType: f("Optical Smoke Detector", "EXTRACTED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.interpretation.category.value);
  assert.ok(result.interpretation.productFamily.value);
});

test("C3. governed Fire Alarm item with missing category/productFamily still flags ESSENTIAL_CLASSIFICATION_MISSING in the quality report", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("Generic fire alarm equipment", "EXTRACTED", 90),
    system: f("Fire Alarm", "EXTRACTED", 90),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("Equipment", "EXTRACTED", 90),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "HIGH",
    reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description: "Generic fire alarm equipment", sourceSystem: "Fire Alarm" }));
  assert.ok(item.reviewReasons.includes("ESSENTIAL_CLASSIFICATION_MISSING"));
  assert.ok(item.blockingMissingFields.includes("category"));
  assert.ok(item.blockingMissingFields.includes("productFamily"));
  assert.equal(item.finalStatus, "NEEDS_REVIEW");
});

test("C4. governed candidate-key safety is unchanged: an invalid candidate key still fails closed to MISSING", () => {
  const input = prepareBoqUnderstandingInput(row("Addressable optical smoke detector with built-in isolator", { system: "Fire Alarm" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Addressable optical smoke detector with built-in isolator", "EXTRACTED", 100),
    taxonomyCandidateKey: f("NOT-A-REAL-KEY", "EXTRACTED", 90),
    equipmentType: f("Optical Smoke Detector", "EXTRACTED", 90),
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.system.value, null);
  assert.equal(result.interpretation.category.value, null);
  assert.equal(result.interpretation.productFamily.value, null);
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_INVALID"));
  assert.equal(result.status, "NEEDS_REVIEW");
});

// ---------------------------------------------------------------------------
// D. Genuine provenance hallucination still triggers
// ---------------------------------------------------------------------------

test("D1. UPS fixture: EXTRACTED system with no known sourceSystem and no literal evidence still triggers SOURCE_PROVENANCE_CONTRADICTION", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("160 KVA 30 Min backup", "EXTRACTED", 80),
    system: f("UPS", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("Backup equipment", "INFERRED", 70),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW",
    reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description: "160 KVA 30 Min backup", sourceSystem: null }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});

test("D2. a model claiming a DIFFERENT EXTRACTED system than the row's own known sourceSystem, unsupported by literal text, still triggers the contradiction (the exact-match fix does not broaden into a general exemption)", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 80),
    system: f("Fire Alarm", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("speaker", "EXTRACTED", 80),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW",
    reviewReasons: [],
  };
  // Row's own authoritative system is "Public Address", not "Fire Alarm" --
  // the model's claim does not match it and is not literally in the text.
  const item = qualityItem(qualityRow(interpretation, { sourceSystem: "Public Address" }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});

test("D3. provenance checks for category, equipmentType, productFamily, and attributes are unchanged (a fabricated equipmentType still triggers)", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 80),
    system: f("Public Address", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("industrial siren", "EXTRACTED", 80),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW",
    reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { sourceSystem: "Public Address" }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});

// ---------------------------------------------------------------------------
// E. Existing zero-confidence rejection, taxonomy contamination protection,
// and UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED remain unchanged
// ---------------------------------------------------------------------------

test("E1. zero-confidence assertion rejection is unaffected: a non-null category at confidence 0 still becomes MISSING/null/0", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 70),
    category: f("Notification Devices", "INFERRED", 0),
    equipmentType: f("speaker", "EXTRACTED", 100),
    confidence: "MEDIUM",
  });
  assert.deepEqual(result.interpretation.category, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(result.interpretation.reviewReasons.includes("ZERO_CONFIDENCE_ASSERTION_REJECTED:category"));
});

test("E2. taxonomy-system-conflict authorization is unaffected: Public Address row still receives no Fire Alarm taxonomy candidate", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  assert.deepEqual(input.taxonomyContext, { version: null, system: null, families: [], attributeNames: [] });
});

test("E3. UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED is unaffected: a model-proposed technicalAttribute for Public Address is still dropped, while the deterministic wattage fact is not", () => {
  const input = prepareBoqUnderstandingInput(row("6W Recessed in false ceiling speaker", { system: "Public Address" }));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("6W Recessed in false ceiling speaker", "EXTRACTED", 100),
    system: f("Public Address", "EXTRACTED", 90),
    equipmentType: f("speaker", "EXTRACTED", 90),
    technicalAttributes: [{ name: "mounting_type", value: "Recessed", origin: "EXTRACTED", confidence: 90 }],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.attributes.mounting_type, undefined);
  assert.deepEqual(result.interpretation.attributes.power_rating, { value: "6 W", origin: "EXTRACTED", confidence: 100 });
  assert.ok(result.interpretation.reviewReasons.includes("UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED"));
});

// ---------------------------------------------------------------------------
// F. Deterministic numeric-unit spacing normalization does not create a
// SOURCE_PROVENANCE_CONTRADICTION for the engine's own canonical
// reformatting ("6W" -> "6 W", "24VDC" -> "24 VDC"), while a genuinely
// unsupported value, or a genuine system hallucination, still triggers it.
// ---------------------------------------------------------------------------

const provenanceInterpretation = (description, system, equipmentType, attributes) => ({
  boqItemId: "boq_1",
  normalizedDescription: f(description, "EXTRACTED", 80),
  system: f(system, "EXTRACTED", 80),
  category: { value: null, origin: "MISSING", confidence: 0 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: f(equipmentType, "EXTRACTED", 80),
  productFamily: { value: null, origin: "MISSING", confidence: 0 },
  attributes,
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
  confidence: "HIGH",
  reviewReasons: [],
});

test("F1. source '6W Recessed in false ceiling speaker' + deterministic power_rating='6 W' -> no provenance contradiction", () => {
  const description = "6W Recessed in false ceiling speaker";
  const interpretation = provenanceInterpretation(description, "Public Address", "speaker", { power_rating: f("6 W", "EXTRACTED", 100) });
  const item = qualityItem(qualityRow(interpretation, { description }));
  assert.equal(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"), false);
});

test("F2. source '30W Recessed in false ceiling speaker, weather proof' + power_rating='30 W' -> no contradiction", () => {
  const description = "30W Recessed in false ceiling speaker, weather proof";
  const interpretation = provenanceInterpretation(description, "Public Address", "speaker", { power_rating: f("30 W", "EXTRACTED", 100) });
  const item = qualityItem(qualityRow(interpretation, { description }));
  assert.equal(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"), false);
});

test("F3. source '24VDC panel' + canonical operatingVoltage='24 VDC' (the existing deterministic voltage pathway's own representation) -> no contradiction", () => {
  const description = "24VDC panel";
  const interpretation = provenanceInterpretation(description, "Public Address", "panel", { operatingVoltage: f("24 VDC", "EXTRACTED", 100) });
  const item = qualityItem(qualityRow(interpretation, { description }));
  assert.equal(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"), false);
});

test("F4. unsupported EXTRACTED '48 W' against a source containing only '6W' still produces a provenance contradiction", () => {
  const description = "6W Recessed in false ceiling speaker";
  const interpretation = provenanceInterpretation(description, "Public Address", "speaker", { power_rating: f("48 W", "EXTRACTED", 100) });
  const item = qualityItem(qualityRow(interpretation, { description }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});

test("F5. the existing UPS/system hallucination fixture still produces a provenance contradiction (numeric-unit normalization does not suppress a genuine non-numeric mismatch)", () => {
  const interpretation = {
    boqItemId: "boq_1",
    normalizedDescription: f("160 KVA 30 Min backup", "EXTRACTED", 80),
    system: f("UPS", "EXTRACTED", 80),
    category: { value: null, origin: "MISSING", confidence: 0 },
    subcategory: { value: null, origin: "MISSING", confidence: 0 },
    equipmentType: f("Backup equipment", "INFERRED", 70),
    productFamily: { value: null, origin: "MISSING", confidence: 0 },
    attributes: {},
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
    confidence: "LOW",
    reviewReasons: [],
  };
  const item = qualityItem(qualityRow(interpretation, { description: "160 KVA 30 Min backup", sourceSystem: null }));
  assert.ok(item.reviewReasons.includes("SOURCE_PROVENANCE_CONTRADICTION"));
});
