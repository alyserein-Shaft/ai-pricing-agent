import test from "node:test";
import assert from "node:assert/strict";

import {
  CROSS_SHEET_EVIDENCE_MODE,
  CROSS_SHEET_ELIGIBILITY_CONDITIONS,
  resolveCrossSheetGovernedQuantityEvidence,
} from "../app/domain/drawing-cross-sheet-quantity-evidence.mjs";

const PROJECT = "project_p";
const LEGEND_DOC = "doc_legend";
const TARGET_A = "doc_a";
const TARGET_B = "doc_b";

const definition = (over = {}) => ({
  token: "T",
  description: "FIREMAN TELEPHONE JACK",
  legendDocumentId: LEGEND_DOC,
  symbolAssetId: "asset_symbol_T",
  reviewActorId: "omair",
  ...over,
});

const applicability = (over = {}) => ({
  id: "archRow_1",
  token: "T",
  object: "FIREMAN TELEPHONE JACK",
  targetDocumentId: TARGET_A,
  targetDocumentVersionId: "ver_1",
  targetIntakeVersionId: "iv_1",
  reviewActorId: "omair",
  ...over,
});

const target = (over = {}) => ({
  documentId: TARGET_A,
  documentVersionId: "ver_1",
  drawingIntakeVersionId: "iv_1",
  drawingNumber: "P-0001-DR-T-93-ZZZ-005",
  drawingNumberGoverned: true,
  currentIntakeCompleted: true,
  ...over,
});

const occurrence = (over = {}) => ({
  projectId: PROJECT,
  occurrenceId: "asset_T_field_1",
  token: "T",
  documentId: TARGET_A,
  documentVersionId: "ver_1",
  intakeVersionId: "iv_1",
  pageNumber: 1,
  boundingBox: { x: 10, y: 20, width: 4, height: 8 },
  sourceAssetIds: ["asset_T_field_1"],
  identityAuthority: "GOVERNED_LAYOUT_LEGEND_LINK",
  ...over,
});

// A complete, fully governed bundle: 3 occurrences on sheet A, 2 on sheet B.
const completeBundle = (over = {}) => ({
  projectId: PROJECT,
  legendSource: {
    documentId: LEGEND_DOC,
    documentVersionId: "ver_legend",
    drawingIntakeVersionId: "iv_legend",
    drawingNumber: "P-0001-DR-T-00-ZZZ-002",
    currentIntakeCompleted: true,
  },
  definitions: [definition()],
  applicability: [applicability(), applicability({ id: "archRow_2", targetDocumentId: TARGET_B, targetDocumentVersionId: "ver_2", targetIntakeVersionId: "iv_2" })],
  targets: [target(), target({ documentId: TARGET_B, documentVersionId: "ver_2", drawingIntakeVersionId: "iv_2", drawingNumber: "P-0001-DR-T-93-ZZZ-006" })],
  occurrences: [
    occurrence(),
    occurrence({ occurrenceId: "asset_T_field_2", sourceAssetIds: ["asset_T_field_2"] }),
    occurrence({ occurrenceId: "asset_T_field_3", sourceAssetIds: ["asset_T_field_3"] }),
    occurrence({ occurrenceId: "asset_T_field_4", documentId: TARGET_B, documentVersionId: "ver_2", intakeVersionId: "iv_2", sourceAssetIds: ["asset_T_field_4"] }),
    occurrence({ occurrenceId: "asset_T_field_5", documentId: TARGET_B, documentVersionId: "ver_2", intakeVersionId: "iv_2", sourceAssetIds: ["asset_T_field_5"] }),
  ],
  coverage: [
    { documentId: TARGET_A, state: "COMPLETE", acceptedOccurrences: 3 },
    { documentId: TARGET_B, state: "COMPLETE", acceptedOccurrences: 2 },
  ],
  exclusions: [{ documentId: LEGEND_DOC, sourceAssetId: "asset_symbol_T", reason: "GOVERNED_LEGEND_SYMBOL" }],
  ambiguity: [],
  foreignEvidencePresent: false,
  ...over,
});

const failedConditions = (result) => result.failedConditions.map((entry) => entry.condition);

test("2. a complete governed cross-sheet chain satisfies the handoff", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle());
  assert.equal(result.ok, true);
  assert.equal(result.handoff.evidenceMode, CROSS_SHEET_EVIDENCE_MODE);
  assert.equal(result.handoff.totalApprovedOccurrenceCount, 5);
  assert.equal(result.handoff.groups[0].approvedOccurrenceCount, 5);
  assert.equal(result.handoff.contributingTargets.length, 2);
  for (const condition of CROSS_SHEET_ELIGIBILITY_CONDITIONS) {
    assert.ok(result.handoff.eligibility.satisfied[condition], `${condition} must be satisfied`);
  }
});

test("3. an ungoverned legend definition cannot qualify", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle({ definitions: [] }));
  assert.equal(result.ok, false);
  assert.ok(failedConditions(result).includes("LEGEND_DEFINITION_GOVERNED"));
});

test("4. ungoverned applicability cannot qualify", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle({ applicability: [] }));
  assert.equal(result.ok, false);
  assert.ok(failedConditions(result).includes("APPLICABILITY_GOVERNED"));
  // Applicability for a symbol with no governed definition is not authority.
  const mismatched = resolveCrossSheetGovernedQuantityEvidence(completeBundle({ applicability: [applicability({ token: "Z" })] }));
  assert.equal(mismatched.ok, false);
  assert.ok(failedConditions(mismatched).includes("APPLICABILITY_GOVERNED"));
});

test("5. a stale or foreign drawing cannot qualify", () => {
  const stale = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    targets: [target({ currentIntakeCompleted: false }), target({ documentId: TARGET_B, documentVersionId: "ver_2", drawingIntakeVersionId: "iv_2" })],
  }));
  assert.equal(stale.ok, false);
  assert.ok(failedConditions(stale).includes("TARGETS_CURRENT"));

  const foreign = resolveCrossSheetGovernedQuantityEvidence(completeBundle({ foreignEvidencePresent: true }));
  assert.equal(foreign.ok, false);
  assert.ok(failedConditions(foreign).includes("PROJECT_EVIDENCE_ONLY"));

  const foreignOccurrence = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    occurrences: [...completeBundle().occurrences, occurrence({ projectId: "project_other" })],
  }));
  assert.equal(foreignOccurrence.ok, false);
  assert.ok(failedConditions(foreignOccurrence).includes("PROJECT_EVIDENCE_ONLY"));
});

test("6. a missing governed drawing number cannot qualify", () => {
  const missing = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    targets: [target({ drawingNumber: null }), target({ documentId: TARGET_B, documentVersionId: "ver_2", drawingIntakeVersionId: "iv_2" })],
  }));
  assert.equal(missing.ok, false);
  assert.ok(failedConditions(missing).includes("TARGET_DRAWING_NUMBERS_GOVERNED"));

  // Present but not human-approved is equally disqualifying.
  const unapproved = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    targets: [target({ drawingNumberGoverned: false }), target({ documentId: TARGET_B, documentVersionId: "ver_2", drawingIntakeVersionId: "iv_2" })],
  }));
  assert.equal(unapproved.ok, false);
  assert.ok(failedConditions(unapproved).includes("TARGET_DRAWING_NUMBERS_GOVERNED"));
});

test("7. missing measured coverage cannot qualify", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle({ coverage: [{ documentId: TARGET_A, state: "COMPLETE" }] }));
  assert.equal(result.ok, false);
  assert.ok(failedConditions(result).includes("MEASURED_COVERAGE_PRESENT"));
});

test("8. a governed legend definition can never appear as a field occurrence", () => {
  // If a definition symbol leaks into the field evidence, the whole handoff is
  // refused rather than quietly counted.
  const leaked = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    occurrences: [...completeBundle().occurrences, occurrence({ occurrenceId: "asset_symbol_T", sourceAssetIds: ["asset_symbol_T"] })],
  }));
  assert.equal(leaked.ok, false);
  assert.ok(failedConditions(leaked).includes("LEGEND_DEFINITION_OCCURRENCES_EXCLUDED"));

  // A clean bundle carries the exclusion in its exclusion list instead.
  const clean = resolveCrossSheetGovernedQuantityEvidence(completeBundle());
  assert.equal(clean.ok, true);
  assert.equal(clean.handoff.totalApprovedOccurrenceCount, 5);
  assert.ok(clean.handoff.exclusions.some((entry) => entry.reason === "GOVERNED_LEGEND_SYMBOL"));
});

test("9. WLC printed multiplicity ambiguity is preserved and never interpreted", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    ambiguity: [{ documentId: TARGET_B, label: "PRINTED_MULTIPLICITY_LABEL", printedLabel: "2 Nos", status: "AMBIGUOUS", interpretation: null }],
  }));
  assert.equal(result.ok, true);
  const flag = result.handoff.ambiguityFlags[0];
  assert.equal(flag.status, "AMBIGUOUS");
  assert.equal(flag.interpretation, null);
  // No multiplication of a printed label may appear anywhere in the payload.
  const serialized = JSON.stringify(result.handoff);
  assert.ok(!/\b\d+\s*[x×]\s*\d+\b/.test(serialized), "no printed-label multiplication may exist in the handoff");
});

test("10. occurrence count is never turned into quantity authority", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle());
  const group = result.handoff.groups[0];
  assert.equal(group.approvedOccurrenceCount, 5);
  assert.equal(group.occurrenceCountUnit, "approved_occurrences");
  assert.equal(group.isDeviceQuantity, false);
  assert.equal(group.deviceQuantity, null);
  assert.equal(group.deviceQuantityStatus, "PRINTED_QUANTITY_AUTHORITY_REQUIRED");
  assert.equal(result.handoff.quantityAuthority.isDeviceQuantity, false);
  assert.equal(result.handoff.quantityAuthority.deviceQuantity, null);
  assert.equal(result.handoff.quantityAuthority.isEngineerApprovedQuantity, false);
  assert.equal(result.handoff.quantityAuthority.decidedBy, "QUANTITY_REASONING_STAGE_REQUIRED");
});

test("11. no AI confidence or model score can satisfy a gate", () => {
  // Absurd confidence values on occurrences change nothing, because no gate
  // reads them.
  const lowConfidence = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    occurrences: completeBundle().occurrences.map((entry) => ({ ...entry, confidence: 0.01, scoreComponents: { shape: 0 } })),
  }));
  assert.equal(lowConfidence.ok, true);
  assert.equal(lowConfidence.handoff.totalApprovedOccurrenceCount, 5);
  // And a match score can never rescue missing provenance.
  const rescued = resolveCrossSheetGovernedQuantityEvidence(completeBundle({
    occurrences: [occurrence({ sourceAssetIds: [], confidence: 0.99, scoreComponents: { shape: 1 } })],
  }));
  assert.equal(rescued.ok, false);
  assert.ok(failedConditions(rescued).includes("OCCURRENCE_PROVENANCE_COMPLETE"));
});

test("12. the occurrence provenance chain is never flattened away", () => {
  const result = resolveCrossSheetGovernedQuantityEvidence(completeBundle());
  const serialized = JSON.stringify(result.handoff);
  for (const key of ["targetIntakeVersionId", "applicabilityFactId", "legendDefinitionKey", "legendSourceIntakeVersionId", "governedDrawingNumber"]) {
    assert.ok(serialized.includes(key), `provenance chain must retain ${key}`);
  }
  assert.equal(result.handoff.occurrenceProvenance.length, 5);
  for (const entry of result.handoff.occurrenceProvenance) {
    assert.ok(entry.occurrenceId && entry.targetDocumentId && entry.targetIntakeVersionId, "each occurrence keeps its own chain");
    assert.ok(entry.sourceAssetIds.length > 0 && entry.boundingBox, "each occurrence keeps exact asset + geometry provenance");
    assert.ok(entry.applicabilityFactId, "each occurrence names its governed applicability fact");
    assert.ok(entry.legendDefinitionKey && entry.legendSourceIntakeVersionId, "each occurrence resolves to the governed legend definition and its source intake");
  }
  assert.deepEqual(result.handoff.provenanceChain.order, [
    "fieldOccurrence", "targetDrawingIntake", "governedApplicabilityFact", "governedLegendDefinition", "legendSourceAssets",
  ]);
});

test("13. the same-document recognition path is preserved and still preferred", async () => {
  const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../worker/drawing-quantity-evidence-api.mjs", import.meta.url), "utf8"));
  // The recognition version is resolved FIRST and gates the same-document read.
  assert.ok(source.includes("const version = await currentRecognitionVersion(env.DB, document.id);"));
  const recognitionIndex = source.indexOf("const version = await currentRecognitionVersion");
  const crossSheetIndex = source.indexOf("loadCrossSheetGovernedQuantityEvidence(env.DB");
  assert.ok(recognitionIndex < crossSheetIndex, "cross-sheet mode must be a fallback, never a bypass");
  // The preserved same-document payload is labelled, and coverage/comparison
  // operations remain bound to a recognition version.
  assert.ok(source.includes("evidenceMode: SAME_DOCUMENT_EVIDENCE_MODE"));
  assert.ok(source.includes("This operation requires a same-document symbol recognition version."));
});
