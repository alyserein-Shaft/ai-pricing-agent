import { interpretationInputFingerprint, prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";
import { sanitizePersistedAiInterpretation } from "../app/domain/estimator-understanding-review.mjs";
import { qualityItem } from "./estimator-understanding-api.mjs";

const parse = (value, fallback = null) => {
  try { return value == null ? fallback : (typeof value === "string" ? JSON.parse(value) : value); } catch { return fallback; }
};

// Sprint 1.0 -- confirmedSpecification must be included here, matching
// worker/estimator-understanding-api.mjs's runUnderstandingBatch (the real
// path that ORIGINALLY computes and stores an interpretation's
// input_fingerprint via prepareBoqUnderstandingInput(row, confirmedSpecifications[...])).
// Before this fix, this function always recomputed the "current" fingerprint
// with no confirmed specification evidence at all, so an interpretation whose
// classification depended on confirmed specification evidence (e.g. a
// governed family resolved only because a linked, approved specification
// clause supplied a distinguishing word the BOQ row text itself lacks) could
// never be matched back to as current -- review would report
// UNAVAILABLE_OR_STALE forever, independent of approval status. Defaults to
// [] so a caller that hasn't been updated to pass confirmedSpecification
// keeps its prior (unaffected-by-this-fix) behavior.
const currentInputFor = (row, source, confirmedSpecification = []) => prepareBoqUnderstandingInput({
  id: row.boqItemId,
  rowType: row.rowType,
  description: row.description,
  numericQuantity: row.numericQuantity,
  originalQuantity: row.originalQuantity,
  normalizedUnit: row.normalizedUnit,
  originalUnit: row.originalUnit,
  system: row.sourceSystem,
  category: row.sourceCategory,
  subcategory: row.sourceSubcategory,
  manufacturer: row.manufacturer,
  model: row.sourceModel,
  partNumber: row.sourcePartNumber,
  currentValues: parse(row.currentValues, {}),
  sourceLocation: source,
}, confirmedSpecification);

const newestFirst = (left, right) => {
  if (left.runMode === "CONTROLLED_RETRY" && left.parentRunId === right.runId) return -1;
  if (right.runMode === "CONTROLLED_RETRY" && right.parentRunId === left.runId) return 1;
  return Number(right.versionNumber || 0) - Number(left.versionNumber || 0)
    || String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    || String(right.interpretationId || "").localeCompare(String(left.interpretationId || ""));
};

export function resolveEffectiveUnderstandingInterpretation(row, interpretations, source, confirmedSpecification = []) {
  const input = currentInputFor(row, source, confirmedSpecification);
  const currentInputFingerprint = interpretationInputFingerprint(input);
  const currentAttempts = (Array.isArray(interpretations) ? interpretations : [])
    .filter((entry) => entry.inputFingerprint === currentInputFingerprint)
    .sort(newestFirst);
  const latestCurrentAttempt = currentAttempts[0] || null;
  const eligible = currentAttempts.flatMap((entry) => {
    if (entry.inputFingerprint !== currentInputFingerprint || !["COMPLETED", "NEEDS_REVIEW"].includes(entry.status)) return [];
    const proposal = sanitizePersistedAiInterpretation(parse(entry.interpretation, null));
    return proposal ? [{ ...entry, proposal }] : [];
  }).sort(newestFirst);
  const selected = eligible[0] || null;
  if (!selected) return {
    state: "UNAVAILABLE_OR_STALE",
    currentInputFingerprint,
    selected: null,
    latestCurrentAttempt,
    proposal: null,
    proposalStatus: "UNAVAILABLE",
    classification: null,
    provenance: null,
    confidence: null,
    blockingMissingFields: [],
    informationalMissingFields: [],
    reviewReasons: ["CURRENT_INTERPRETATION_UNAVAILABLE"],
    taxonomy: { version: input.taxonomyContext?.version || null, candidateAvailable: Boolean(input.taxonomyContext?.families?.length), acceptedCandidate: false, category: null, productFamily: null },
    requiredAttributeNames: input.taxonomyContext?.attributeNames || [],
  };
  const quality = qualityItem({ ...row, status: selected.status, errorCode: selected.errorCode, model: selected.model, usageMetadata: selected.usageMetadata, interpretation: selected.interpretation });
  const classification = {
    system: selected.proposal.system?.value ?? null,
    category: selected.proposal.category?.value ?? null,
    equipmentType: selected.proposal.equipmentType?.value ?? null,
    productFamily: selected.proposal.productFamily?.value ?? null,
    subcategory: selected.proposal.subcategory?.value ?? null,
  };
  const candidate = (input.taxonomyContext?.families || []).find((entry) => entry.category === classification.category && entry.family === classification.productFamily);
  return {
    state: "AVAILABLE",
    currentInputFingerprint,
    selected,
    latestCurrentAttempt,
    proposal: selected.proposal,
    proposalStatus: quality.finalStatus,
    classification,
    provenance: Object.fromEntries(["system", "category", "equipmentType", "productFamily", "subcategory"].map((key) => [key, selected.proposal[key]?.origin || "MISSING"])),
    confidence: selected.proposal.confidence || "LOW",
    blockingMissingFields: quality.blockingMissingFields,
    informationalMissingFields: quality.informationalMissingFields,
    reviewReasons: quality.reviewReasons,
    quality,
    taxonomy: { version: input.taxonomyContext?.version || null, candidateAvailable: Boolean(input.taxonomyContext?.families?.length), acceptedCandidate: Boolean(candidate), category: candidate?.category || null, productFamily: candidate?.family || null },
    requiredAttributeNames: input.taxonomyContext?.attributeNames || [],
  };
}
