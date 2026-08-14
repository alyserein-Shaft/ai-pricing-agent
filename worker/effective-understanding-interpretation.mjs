import { interpretationInputFingerprint, prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";
import { sanitizePersistedAiInterpretation } from "../app/domain/estimator-understanding-review.mjs";
import { qualityItem } from "./estimator-understanding-api.mjs";

const parse = (value, fallback = null) => {
  try { return value == null ? fallback : (typeof value === "string" ? JSON.parse(value) : value); } catch { return fallback; }
};

const currentInputFor = (row, source) => prepareBoqUnderstandingInput({
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
});

const newestFirst = (left, right) => {
  if (left.runMode === "CONTROLLED_RETRY" && left.parentRunId === right.runId) return -1;
  if (right.runMode === "CONTROLLED_RETRY" && right.parentRunId === left.runId) return 1;
  return Number(right.versionNumber || 0) - Number(left.versionNumber || 0)
    || String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    || String(right.interpretationId || "").localeCompare(String(left.interpretationId || ""));
};

export function resolveEffectiveUnderstandingInterpretation(row, interpretations, source) {
  const input = currentInputFor(row, source);
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
