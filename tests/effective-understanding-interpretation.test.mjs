import test from "node:test";
import assert from "node:assert/strict";
import { interpretationInputFingerprint, prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";
import { resolveEffectiveUnderstandingInterpretation } from "../worker/effective-understanding-interpretation.mjs";
import { understandingReviewSelectionAuthority } from "../worker/estimator-understanding-review-api.mjs";

const fact = (value, origin = "INFERRED", confidence = 70) => ({ value, origin, confidence });
const proposal = (classification) => JSON.stringify({
  boqItemId: "server-owned-id",
  normalizedDescription: fact("Addressable Flasher", "EXTRACTED", 100),
  system: fact(classification.system), category: fact(classification.category), subcategory: fact(null, "MISSING", 0),
  equipmentType: fact(classification.equipmentType, "EXTRACTED", 70), productFamily: fact(classification.productFamily),
  attributes: {}, manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [], confidence: "MEDIUM", reviewReasons: [],
});
const row = {
  boqItemId: "boqitem-addressable-flasher", rowType: "BOQ Item", itemReference: "27.06.10", description: "Addressable Flasher",
  numericQuantity: "12", originalQuantity: "12", normalizedUnit: "No", originalUnit: "No", sourceSystem: null,
  sourceCategory: null, sourceSubcategory: null, manufacturer: null, sourceModel: null, sourcePartNumber: null,
  currentValues: "{}", sourceLocation: JSON.stringify({ sheet: "BOQ", row: 10 }), evidenceDocumentVersionId: "document-version-current", evidenceExtractionVersion: 1,
};
const sourceLocation = JSON.parse(row.sourceLocation);
const input = prepareBoqUnderstandingInput({ id: row.boqItemId, rowType: row.rowType, description: row.description, numericQuantity: row.numericQuantity, originalQuantity: row.originalQuantity, normalizedUnit: row.normalizedUnit, originalUnit: row.originalUnit, system: row.sourceSystem, category: row.sourceCategory, subcategory: row.sourceSubcategory, manufacturer: row.manufacturer, model: row.sourceModel, partNumber: row.sourcePartNumber, currentValues: {}, sourceLocation });
const currentFingerprint = interpretationInputFingerprint(input);

test("real Addressable Flasher parent and retry shape resolves the valid current controlled retry", () => {
  const parent = { interpretationId: "parent", runId: "parent-run", runMode: "CONTROLLED_PILOT", parentRunId: null, versionNumber: 2, createdAt: "2026-08-13", inputFingerprint: currentFingerprint, status: "NEEDS_REVIEW", interpretation: proposal({ system: null, category: null, equipmentType: "Addressable Flasher", productFamily: null }), model: "8b" };
  const retry = { interpretationId: "retry", runId: "retry-run", runMode: "CONTROLLED_RETRY", parentRunId: "parent-run", versionNumber: 3, createdAt: "2026-08-14", inputFingerprint: currentFingerprint, status: "NEEDS_REVIEW", interpretation: proposal({ system: "Fire Alarm", category: "Notification Devices", equipmentType: "Flasher", productFamily: "Strobe" }), model: "8b" };
  const newerFailed = { ...retry, interpretationId: "failed", versionNumber: 4, status: "FAILED" };
  const newerInvalid = { ...retry, interpretationId: "invalid", versionNumber: 5, interpretation: JSON.stringify({ unsafe: true }) };
  const stale = { ...retry, interpretationId: "stale", versionNumber: 6, inputFingerprint: "stale-fingerprint" };
  const result = resolveEffectiveUnderstandingInterpretation(row, [parent, retry, newerFailed, newerInvalid, stale], sourceLocation);
  assert.equal(result.state, "AVAILABLE");
  assert.equal(result.selected.interpretationId, "retry");
  assert.deepEqual(result.classification, { system: "Fire Alarm", category: "Notification Devices", equipmentType: "Flasher", productFamily: "Strobe", subcategory: null });
  assert.equal(result.taxonomy.acceptedCandidate, true);
  assert.equal(result.proposal.boqItemId, undefined);
});

test("no single valid current interpretation returns unavailable rather than fabricated missing facts", () => {
  const result = resolveEffectiveUnderstandingInterpretation(row, [{ interpretationId: "failed", versionNumber: 9, inputFingerprint: currentFingerprint, status: "FAILED", interpretation: proposal({ system: "Fire Alarm", category: "Notification Devices", equipmentType: "Flasher", productFamily: "Strobe" }) }], sourceLocation);
  assert.equal(result.state, "UNAVAILABLE_OR_STALE");
  assert.equal(result.proposal, null);
  assert.equal(result.classification, null);
});

test("review mutation authority binds to the exact effective interpretation", () => {
  const first = { ...row, effective: { currentInputFingerprint: currentFingerprint, selected: { interpretationId: "retry", versionNumber: 3 } }, reviewVersion: 0 };
  const changed = { ...row, effective: { currentInputFingerprint: currentFingerprint, selected: { interpretationId: "another", versionNumber: 4 } }, reviewVersion: 0 };
  assert.notEqual(understandingReviewSelectionAuthority("project", first), understandingReviewSelectionAuthority("project", changed));
});
