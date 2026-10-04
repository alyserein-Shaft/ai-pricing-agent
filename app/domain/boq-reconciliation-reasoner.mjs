// BOQ RECONCILIATION ADAPTER over the shared Project Evidence Reasoner.
//
// This is deliberately NOT a second AI system. `project-evidence-reasoner.mjs`
// already owns the model call, the evidence packet, the fabrication firewall
// (`UNKNOWN_EVIDENCE_ID` rejects a whole output), the quantity-claim ban
// (`QUANTITY_CLAIM_FORBIDDEN`), the stale/foreign-evidence exclusion and the
// authority firewall that downgrades promoting actions. All of that is reused
// as-is. This module adds only what BOQ reconciliation actually needs:
//
//   1. a DETERMINISTIC pre-comparison, so exact equality never costs a model call;
//   2. a BOQ verdict vocabulary + materiality axis the generic reasoner has no
//      concept of;
//   3. a mapping from the generic reasoner result onto those verdicts.
//
// AUTHORITY. The adapter can classify SEMANTIC EQUIVALENCE and nothing else. It
// cannot change a quantity, a unit, or a source anchor: those three are always
// re-derived from the deterministic source rows and are structurally absent from
// anything the model contributes. Its output state is `AI_PROPOSED`.
import {
  applyAuthorityFirewall,
  normalizeReasoningEvidence,
  reasonAcrossProjectEvidence,
  validateReasoningResult,
} from "./project-evidence-reasoner.mjs";

export const BOQ_RECONCILIATION_REASONER_VERSION = "boq-reconciliation-reasoner-1.0.0";
export const BOQ_RECONCILIATION_QUESTION_TYPE = "BOQ_RECONCILIATION";

export const BOQ_RECONCILIATION_VERDICTS = Object.freeze([
  "SEMANTICALLY_IDENTICAL",
  "NORMALIZATION_EQUIVALENT",
  "MERGE_EQUIVALENT",
  "SPLIT_REQUIRED",
  "QUANTITY_CONFLICT",
  "UNIT_CONFLICT",
  "DESCRIPTION_SCOPE_CONFLICT",
  "SOURCE_ANCHOR_CONFLICT",
  "INSUFFICIENT_EVIDENCE",
]);

export const BOQ_RECONCILIATION_MATERIALITY = Object.freeze(["NON_MATERIAL", "MATERIAL"]);

// Verdicts that assert a DIFFERENCE the reviewer must see. Everything else is an
// equivalence claim and is therefore non-material by construction.
const MATERIAL_VERDICTS = new Set([
  "SPLIT_REQUIRED",
  "QUANTITY_CONFLICT",
  "UNIT_CONFLICT",
  "DESCRIPTION_SCOPE_CONFLICT",
  "SOURCE_ANCHOR_CONFLICT",
  "INSUFFICIENT_EVIDENCE",
]);

const normalizeText = (value) =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:()]/g, "");

// The unit vocabulary the controlled normalization is allowed to rewrite. `No`
// and `Each` are the same measure and `LS`/`Lump Sum` likewise; anything else is
// a genuine unit conflict and is NEVER auto-treated as equivalent.
const UNIT_EQUIVALENCE = new Map([
  ["no", "each"],
  ["no.", "each"],
  ["nos", "each"],
  ["each", "each"],
  ["ls", "lump sum"],
  ["lump sum", "lump sum"],
  ["lumpsum", "lump sum"],
]);

const canonicalUnit = (value) => UNIT_EQUIVALENCE.get(String(value ?? "").trim().toLowerCase()) ?? null;
const sameDescription = (a, b) => normalizeText(a) === normalizeText(b) && normalizeText(a) !== "";

// Pure, no model. Compares ONE controlled candidate against the current BOQ line
// and the raw source rows that back the candidate.
export const reconcileBoqLineDeterministically = ({ candidate, currentLine = null, sourceRows = [] } = {}) => {
  const anchors = [...(candidate?.sourceAnchors || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const sourceUnits = [...new Set(sourceRows.map((row) => canonicalUnit(row?.unit)).filter(Boolean))];
  const sourceDescriptions = [...new Set(sourceRows.map((row) => normalizeText(row?.description)).filter(Boolean))];
  const sourceQuantity = sourceRows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);

  const differences = [];
  const unitA = canonicalUnit(currentLine?.unit);
  const unitB = canonicalUnit(candidate?.unit);

  // Anchors are the candidate's own provenance. They are compared, never edited.
  const currentAnchors = [...(currentLine?.sourceAnchors || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (currentAnchors.length && JSON.stringify(currentAnchors) !== JSON.stringify(anchors)) {
    differences.push({ field: "sourceAnchors", expected: anchors, actual: currentAnchors });
  }
  if (unitA && unitB && unitA !== unitB) differences.push({ field: "unit", expected: candidate?.unit, actual: currentLine?.unit });
  if (currentLine && Number(currentLine.quantity) !== Number(candidate?.quantity)) {
    differences.push({ field: "quantity", expected: candidate?.quantity, actual: currentLine.quantity });
  }
  // The consolidation itself must add up: if the candidate's stated quantity is
  // not the sum of its own anchored rows, that is a quantity conflict at source.
  if (sourceRows.length && sourceQuantity !== Number(candidate?.quantity)) {
    differences.push({ field: "consolidatedQuantity", expected: candidate?.quantity, actualFromSourceRows: sourceQuantity });
  }
  if (sourceDescriptions.length > 1) {
    differences.push({ field: "sourceDescriptionVariants", variants: sourceDescriptions });
  }
  if (currentLine && !sameDescription(currentLine.description, candidate?.description)) {
    differences.push({ field: "description", expected: candidate?.description, actual: currentLine.description });
  }

  return {
    candidateId: candidate?.id ?? null,
    description: candidate?.description ?? null,
    sourceAnchors: anchors,
    sourceRowCount: sourceRows.length,
    sourceQuantity,
    sourceUnitVariants: sourceUnits,
    sourceDescriptionVariants: sourceDescriptions,
    differences,
    // EXACT means: same anchors, same consolidated quantity proven from source,
    // one source unit, one source description, and no field-level difference.
    isExact: differences.length === 0,
    requiresAi: differences.length > 0,
  };
};

// Generic reasoner result -> BOQ verdict + materiality.
export const mapReasonerResultToBoqVerdict = ({ deterministic, result }) => {
  if (!result || result.status === "INSUFFICIENT_EVIDENCE") {
    return { verdict: "INSUFFICIENT_EVIDENCE", materiality: "MATERIAL", proposedMapping: null, explanation: result?.reasoningSummary || "The reasoner could not resolve this pair from current project evidence.", confidence: 0 };
  }
  const has = (field) => deterministic.differences.some((difference) => difference.field === field);
  let verdict = "SEMANTICALLY_IDENTICAL";
  if (has("sourceAnchors")) verdict = "SOURCE_ANCHOR_CONFLICT";
  else if (has("consolidatedQuantity") || has("quantity")) verdict = "QUANTITY_CONFLICT";
  else if (has("unit")) verdict = "UNIT_CONFLICT";
  else if (has("description")) verdict = "DESCRIPTION_SCOPE_CONFLICT";
  else if (has("sourceDescriptionVariants")) {
    // Several source wordings behind one consolidated candidate is exactly what a
    // controlled NORMALIZATION is for, provided the model agrees they are one class.
    verdict = "NORMALIZATION_EQUIVALENT";
  }
  if (result.status === "CONTRADICTED" && verdict === "NORMALIZATION_EQUIVALENT") verdict = "DESCRIPTION_SCOPE_CONFLICT";
  if (result.status === "AMBIGUOUS") verdict = "INSUFFICIENT_EVIDENCE";
  return {
    verdict,
    materiality: MATERIAL_VERDICTS.has(verdict) ? "MATERIAL" : "NON_MATERIAL",
    proposedMapping: verdict === "NORMALIZATION_EQUIVALENT" || verdict === "SEMANTICALLY_IDENTICAL" ? deterministic.candidateId : null,
    explanation: result.reasoningSummary || result.proposedInterpretation || "",
    confidence: Number(result.modelConfidence || 0),
    citedEvidenceIds: result.citedEvidenceIds || [],
    recommendedAction: result.recommendedAction,
  };
};

// The one entry point. Deterministic first; the model is called ONLY for
// non-exact pairs, and its failure yields INSUFFICIENT_EVIDENCE (human review),
// never a guessed equivalence.
export async function reconcileBoqScope({
  projectId,
  documentId,
  documentVersionId,
  extractionId,
  candidates = [],
  currentLines = [],
  sourceRows = [],
  provider = null,
  maxAiCalls = 12,
} = {}) {
  const currentByAnchor = new Map();
  for (const line of currentLines) {
    for (const anchor of line?.sourceAnchors || []) currentByAnchor.set(Number(anchor), line);
  }
  const rowsByAnchor = new Map();
  for (const row of sourceRows) rowsByAnchor.set(Number(row?.sourceRow), row);

  const exact = [];
  const nonExact = [];
  for (const candidate of candidates) {
    const rows = (candidate.sourceAnchors || []).map((anchor) => rowsByAnchor.get(Number(anchor))).filter(Boolean);
    // A candidate's "current line" is the current BOQ line carrying the same anchors.
    const current = (candidate.sourceAnchors || []).map((anchor) => currentByAnchor.get(Number(anchor))).find(Boolean) || null;
    const outcome = reconcileBoqLineDeterministically({ candidate, currentLine: current, sourceRows: rows });
    (outcome.isExact ? exact : nonExact).push(outcome);
  }

  const reconciled = [];
  let aiCalls = 0;
  for (const outcome of nonExact.slice(0, Math.max(0, maxAiCalls))) {
    const rows = sourceRows.filter((row) => outcome.sourceAnchors.includes(Number(row.sourceRow)));
    const evidence = [
      ...rows.map((row) => ({
        evidenceKey: `boq-source-row:${row.sourceRow}`,
        scope: "PROJECT",
        projectId,
        documentId,
        documentVersionId,
        currentness: row.currentness || "CURRENT",
        superseded: Boolean(row.superseded),
        sourceType: "BOQ_SOURCE_ROW",
        // Framed as "one of the rows consolidated INTO the candidate", never as a
        // standalone line. Without this the model compares row 17 against row 65
        // and reports their differing per-row quantities as a conflict, when the
        // quantities are simply the parts of one consolidated total.
        extractedText: `Source row ${row.sourceRow} consolidated INTO candidate "${outcome.description}": raw description "${row.description}"; this row's contribution to the consolidated total is ${row.quantity} ${row.unit}; section ${row.section || "n/a"}`,
        governanceState: row.governanceState || "UNSPECIFIED",
        authorityCeiling: row.authorityCeiling || "SUPPORTING",
        locator: { sourceRow: row.sourceRow },
      })),
      {
        evidenceKey: `boq-candidate:${outcome.candidateId}`,
        scope: "PROJECT",
        projectId,
        documentId,
        documentVersionId,
        currentness: "CURRENT",
        sourceType: "BOQ_NORMALIZED_CANDIDATE",
        extractedText: `CONTROLLED NORMALIZED CANDIDATE "${outcome.description}": consolidated total ${rows.reduce((s, r) => s + Number(r.quantity || 0), 0)} across ${rows.length} source row(s); source anchors ${outcome.sourceAnchors.join(",")}; source wordings seen: ${outcome.sourceDescriptionVariants.map((v) => `"${v}"`).join(" | ")}. This is the line under review.`,
        governanceState: "AI_PROPOSED",
        authorityCeiling: "PROPOSAL_ONLY",
      },
    ];
    const accepted = normalizeReasoningEvidence({ projectId, evidence });
    const result = await reasonAcrossProjectEvidence({
      projectId,
      questionId: `boq-reconcile:${outcome.candidateId}`,
      question: `Is the controlled normalized BOQ line "${outcome.description}" a CORRECT consolidation of its own source rows? The source rows use these different wordings: ${outcome.sourceDescriptionVariants.map((v) => `"${v}"`).join(" and ")}. Do those wordings denote the SAME device class (so one consolidated line is right), or different device classes (so a SPLIT is required)? Do NOT treat the differing per-row quantities as a conflict: they are the parts of one consolidated total.`,
      questionType: BOQ_RECONCILIATION_QUESTION_TYPE,
      evidence: accepted.accepted,
      provider,
      modelCalls: aiCalls,
    });
    aiCalls += 1;
    reconciled.push({
      ...outcome,
      // Carry the reasoner's fail-closed REASON through. Without it a refusal is
      // indistinguishable from a model that merely opined "insufficient", which
      // would hide whether a governance guard fired (e.g. a fabricated citation or
      // a forbidden quantity claim) versus a genuine evidence shortfall.
      ai: {
        status: result.status,
        reason: result.failClosedReason ?? null,
        errors: result.modelError ?? result.errors ?? result.validation?.errors ?? null,
        model: result.model ?? null,
        modelCalls: result.modelCalls ?? null,
        verdict: mapReasonerResultToBoqVerdict({ deterministic: outcome, result }),
      },
    });
  }
  // Anything beyond the AI budget stays unreconciled and therefore human-owned.
  for (const outcome of nonExact.slice(Math.max(0, maxAiCalls))) {
    reconciled.push({ ...outcome, ai: null, verdict: "INSUFFICIENT_EVIDENCE", materiality: "MATERIAL", explanation: "Not attempted: AI call budget exhausted.", confidence: 0 });
  }

  const material = reconciled.filter((entry) => entry.materiality === "MATERIAL" || entry.ai?.verdict?.materiality === "MATERIAL");
  return {
    version: BOQ_RECONCILIATION_REASONER_VERSION,
    questionType: BOQ_RECONCILIATION_QUESTION_TYPE,
    scope: { projectId, documentId, documentVersionId, extractionId },
    deterministicExactMatches: exact.length,
    exact,
    nonExact: reconciled,
    aiCalls,
    materialDifferences: material,
    state: "AI_PROPOSED",
    authorityWrites: 0,
  };
}

export { validateReasoningResult, applyAuthorityFirewall };
