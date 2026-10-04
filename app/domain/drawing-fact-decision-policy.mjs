// DRAWING FACT DECISION AUTHORITY + CANONICAL PROMOTION ELIGIBILITY
// (Step 14.6). Pure, deterministic, hard-ladder policy that answers:
//   "Can this drawing-derived interpretation become a canonical drawing fact
//    automatically, or does it genuinely require engineer review?"
//
// This is NOT product approval, NOT Technical Matching approval, NOT
// commercial selection. A confirmed drawing fact means only: "the drawing
// explicitly/deterministically establishes this interpretation" (Statistics
// of scope: symbol identity, device-family description, qualifier, legend
// system membership). Confidence score alone is NEVER decision authority;
// every rung here is a hard evidential check.
//
// Decision ladder ordering (hard stops, no favorable signals below a rung
// can promote past a blocking one above it):
//   1. STALE ladder        -- source currency/integrity is broken
//   2. REJECTED ladder     -- the deterministic claim is proven wrong
//   3. Engineer-review set -- any ambiguity / conflict / missing evidence /
//                             unresolved duplicate routes to review
//   4. Confirmed ladder    -- exactly one fully-viable EXACT candidate with
//                             complete provenance and resolved identity
import { LEGEND_JOIN_CLASSIFICATION } from "./drawing-legend-spatial-join.mjs";

export const DRAWING_FACT_DECISION_STATES = Object.freeze({
  CONFIRMED_DRAWING_FACT: "CONFIRMED_DRAWING_FACT",
  CONFIRMED_WITH_WARNING: "CONFIRMED_WITH_WARNING",
  ENGINEER_REVIEW_REQUIRED: "ENGINEER_REVIEW_REQUIRED",
  REJECTED_INTERPRETATION: "REJECTED_INTERPRETATION",
  STALE: "STALE",
});

export const DRAWING_FACT_DECISION_POLICY_VERSION = "drawing-fact-decision-1.0.0";

// Repository-equivalent canonical actor (mirrors the already-governed
// `system:deterministic-technical-evaluation` actor used by the technical
// auto-rejection path). The authority is deterministic governed evidence,
// never an opaque "AI approved".
export const SYSTEM_DRAWING_EVALUATION_ACTOR = "system:deterministic-drawing-evaluation";

export const DRAWING_FACT_EVIDENCE_KINDS = Object.freeze({
  EXPLICIT: "EXPLICIT",
  DERIVED: "DERIVED",
});

const meaningful = value => typeof value === "string" && value.trim().length > 0;
const normalizedText = value => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Harmless (non-blocking) warnings. A row confirmed with one of these keeps
// CONFIRMED_WITH_WARNING -- the fact is still deterministic, it simply carries
// an honest caution for downstream consumers.
export const DRAWING_FACT_HARMLESS_WARNINGS = Object.freeze({
  NATIVE_SYMBOL_EMPTY_ABBREVIATION: "NATIVE_SYMBOL_EMPTY_ABBREVIATION",
});

const staled = (input, reason) => input.finishReasons([reason]);
const reviewed = (input, reason) => input.finishReasons([reason]);
const rejected = (input, reason) => input.finishReasons([reason]);

const withVerdict = (state, { reasons, warnings = [], candidateProposalId = null, evidenceKind = null, input }) => ({
  state,
  // "eligible"/"autoConfirmEligible" both mean promotion may proceed.
  eligible: state === DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT || state === DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING,
  autoConfirmEligible: state === DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT || state === DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING,
  decisionReasons: reasons,
  warnings,
  decisionPolicyVersion: DRAWING_FACT_DECISION_POLICY_VERSION,
  joinClassification: input.joinRow?.classification ?? input.snapshot?.joinClassification ?? null,
  candidateCount: (input.joinRow?.candidates?.length) ?? input.snapshot?.proposalCandidateCount ?? 0,
  candidateProposalId,
  evidenceKind,
  proposalEvidenceFingerprint: input.snapshot?.initializationProvenance?.proposalEvidenceFingerprint ?? null,
});

const viableCandidateCandidate = (candidate, { symbolRequired }) => {
  const metrics = candidate?.metrics ?? {};
  const row = metrics.row ?? null;
  const symbol = metrics.symbol ?? null;
  const containmentOk = Boolean(row && row.containment >= 0.9 && row.intersectionArea > 0);
  const symbolOk = !symbolRequired || Boolean(symbol && symbol.containment >= 0.75 && symbol.intersectionArea > 0);
  const agrees = Boolean(candidate.descriptionAgreement && candidate.labelAgreement);
  return candidate && candidate.classification === LEGEND_JOIN_CLASSIFICATION.EXACT && agrees && containmentOk && symbolOk;
};

/**
 * Decide the governed drawing-fact state for one review case from its stored
 * snapshot + join evidence + current source currency.
 *
 * Input (all plain data, prepared by the caller):
 *   structure              {id, documentVersionId, intakeVersionId, status, supersededAt, outputFingerprint}
 *   currentStructureId     resolved current structure id (or null if caller has none)
 *   documentCurrentVersionId
 *   intake                 {id, status, supersededAt}
 *   snapshot               parsed stored case current_snapshot
 *   legendRow              {id, section, tableKey, abbreviation, description, notes, symbolGeometry, sourceFragmentIds, boundingBox}
 *   joinRow                {rowId, tableId, classification, candidates, duplicateProposalCandidates}
 *   evidenceFingerprint    CURRENT proposal-evidence fingerprint (recomputed from current proposals)
 *   proposalSectionById    {proposalId -> section|null} for cross-system determination
 */
export const decideDrawingFact = (input = {}) => {
  const {
    structure = {},
    currentStructureId = null,
    documentCurrentVersionId = null,
    intake = {},
    snapshot = {},
    legendRow = null,
    joinRow = null,
    evidenceFingerprint = null,
    proposalSectionById = {},
  } = input;

  const finishStale = reason => withVerdict(DRAWING_FACT_DECISION_STATES.STALE, { reasons: [reason], input });
  const finishReview = (reasons) => withVerdict(DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED, { reasons: Array.isArray(reasons) ? reasons : [reasons], input });
  const finishRejected = reason => withVerdict(DRAWING_FACT_DECISION_STATES.REJECTED_INTERPRETATION, { reasons: [reason], input });

  // -------------------------------------------------------------------------
  // 1. STALE ladder -- the fact cannot be current; nothing else is considered.
  // -------------------------------------------------------------------------
  if (structure.status && structure.status !== "Completed") return finishStale("STRUCTURE_NOT_COMPLETED");
  if (structure.supersededAt) return finishStale("STRUCTURE_SUPERSEDED");
  if (structure.id && currentStructureId && structure.id !== currentStructureId) return finishStale("STRUCTURE_NOT_CURRENT");
  if (structure.documentVersionId && documentCurrentVersionId && structure.documentVersionId !== documentCurrentVersionId) return finishStale("DOCUMENT_VERSION_CHANGED");
  if (structure.intakeVersionId && intake.id && structure.intakeVersionId !== intake.id) return finishStale("INTAKE_VERSION_CHANGED");
  if (intake.status && intake.status !== "Completed") return finishStale("INTAKE_NOT_COMPLETED");
  if (intake.supersededAt) return finishStale("INTAKE_SUPERSEDED");
  const storedFingerprint = snapshot?.initializationProvenance?.proposalEvidenceFingerprint ?? null;
  if (evidenceFingerprint && storedFingerprint && evidenceFingerprint !== storedFingerprint) return finishStale("PROPOSAL_EVIDENCE_CHANGED");

  // -------------------------------------------------------------------------
  // 2. Structural health / provenance completeness -> engineer review.
  // -------------------------------------------------------------------------
  const reviewReasons = [];
  if (!legendRow) reviewReasons.push("MISSING_LEGEND_ROW_BINDING");
  if (!snapshot.initializationProvenance) reviewReasons.push("MISSING_INITIALIZATION_PROVENANCE");
  const fragmentCount = Array.isArray(snapshot.sourceFragmentIds) ? snapshot.sourceFragmentIds.length : 0;
  const cellFragmentCount = (snapshot.cells || []).reduce((sum, cell) => sum + ((cell.original_fragments || []).length || 0), 0);
  if (fragmentCount === 0 && cellFragmentCount === 0) reviewReasons.push("MISSING_FRAGMENT_PROVENANCE");
  if (!legendRow?.section) reviewReasons.push("SYSTEM_IDENTITY_AMBIGUOUS");
  if ((snapshot.validationIssues || []).some(issue => String(issue.severity ?? "").toLowerCase() === "error" && String(issue.status ?? "Open") === "Open")) reviewReasons.push("OPEN_VALIDATION_ISSUE");
  if (structure.summaryRequiresCrossSheet && structure.summaryRequiresCrossSheet === true) reviewReasons.push("CROSS_SHEET_EVIDENCE_REQUIRED");
  if (reviewReasons.length) return finishReview(reviewReasons);

  // -------------------------------------------------------------------------
  // 3. Candidate set analysis.
  // -------------------------------------------------------------------------
  const candidates = joinRow?.candidates || [];
  const symbolRequired = Boolean(legendRow.symbolGeometry && legendRow.symbolGeometry.length > 0);
  const viable = candidates.filter(candidate => viableCandidateCandidate(candidate, { symbolRequired }));

  if (candidates.length === 0) {
    // No candidate at all: unmatched row -> identity cannot be proven here.
    return finishReview(["NO_DETERMINISTIC_CANDIDATE", ...(snapshot.attributionState === "UNATTRIBUTED" ? ["UNATTRIBUTED_ROW_NO_EVIDENCE"] : [])]);
  }

  // Defensive cross-system / wrong-source determination (REJECTED ladder).
  for (const candidate of candidates) {
    const candidateSection = proposalSectionById[candidate.proposalId] ?? null;
    if (legendRow.section && candidateSection && normalizedText(legendRow.section) !== normalizedText(candidateSection)) {
      return finishRejected("CROSS_SYSTEM_MATCH");
    }
    if (candidate.projectId && legendRow.projectId && candidate.projectId !== legendRow.projectId) return finishRejected("PROPOSAL_SOURCE_MISMATCH");
    if (candidate.documentId && legendRow.documentId && candidate.documentId !== legendRow.documentId) return finishRejected("PROPOSAL_SOURCE_MISMATCH");
  }

  if (viable.length !== 1) {
    if (candidates.length > 1) return finishReview(["MULTIPLE_PROPOSAL_CANDIDATES", ...(joinRow?.duplicateProposalCandidates ? ["UNRESOLVED_DUPLICATE_CANDIDATES"] : [])]);
    return finishReview(["PROPOSAL_JOIN_BELOW_EXACT"]);
  }

  const winner = viable[0];
  const hasTextualCode = meaningful(snapshot.abbreviation ?? legendRow.abbreviation);
  const hasVectorSymbol = Boolean((snapshot.symbolGeometry || legendRow.symbolGeometry || []).length > 0);

  // -------------------------------------------------------------------------
  // 4. Confirmed ladder.
  // -------------------------------------------------------------------------
  const baseReasons = ["STRUCTURE_CURRENT", "DOCUMENT_VERSION_CURRENT", "INTAKE_CURRENT", "EVIDENCE_FINGERPRINT_MATCH", "SINGLE_EXACT_CANDIDATE", "PROVENANCE_COMPLETE", "SYSTEM_IDENTITY_RESOLVED"];
  if (hasTextualCode) {
    const reasons = [...baseReasons, "SYMBOL_CODE_PRESENT"];
    return withVerdict(DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT, {
      reasons,
      candidateProposalId: winner.proposalId,
      evidenceKind: DRAWING_FACT_EVIDENCE_KINDS.EXPLICIT,
      input,
    });
  }
  // Native-symbol row (null/empty abbreviation): confirmable ONLY when identity
  // is deterministically established from governed vector/spatial evidence and
  // an EXACT candidate with full agreement — never on the null itself.
  if (hasVectorSymbol) {
    const reasons = [...baseReasons, "SYMBOL_VECTOR_IDENTITY_DETERMINISTIC"];
    return withVerdict(DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING, {
      reasons,
      warnings: [DRAWING_FACT_HARMLESS_WARNINGS.NATIVE_SYMBOL_EMPTY_ABBREVIATION],
      candidateProposalId: winner.proposalId,
      evidenceKind: DRAWING_FACT_EVIDENCE_KINDS.DERIVED,
      input,
    });
  }
  // Null abbreviation with NO provable identity -> genuine symbol uncertainty.
  return finishReview(["NATIVE_SYMBOL_AMBIGUOUS_IDENTITY"]);
};

// Convenience predicate used by tests + downstream consumers.
export const isAutoConfirmEligible = decision =>
  decision?.eligible === true &&
  (decision.state === DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT || decision.state === DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);