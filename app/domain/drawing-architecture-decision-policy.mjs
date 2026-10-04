// SYSTEM ARCHITECTURE FACT DECISION AUTHORITY (Step 14.7).
// Pure, deterministic, hard-ladder policy that answers:
//   "Can this architecture interpretation (panel / location / network link /
//    loop / interface / cross-sheet reference) become a canonical drawing
//    architecture fact automatically, or does it genuinely require engineer
//    review?"
//
// Mirrors the governed drawing-fact decision authority (Step 14.6,
// drawing-fact-decision-policy.mjs) and reuses its principles and actor
// (system:deterministic-drawing-evaluation). An architecture fact means only:
// "the riser/schematic/network-diagram evidence deterministically establishes
// this interpretation." NEVER product approval, NEVER technical approval,
// NEVER a commercial/pricing decision.
//
// Decision ladder ordering (hard stops -- no favorable signal below a rung
// can promote past a blocking one above it):
//   1. STALE ladder   -- source currency/integrity is broken
//   2. REJECTED ladder -- the deterministic claim is cross-system or sourced
//                         from a non-authoritative sheet type
//   3. Engineer-review set -- ambiguity / missing evidence / unresolved
//                             reference / line-only inference routes to review
//   4. Confirmed ladder  -- exactly one fully-viable, EXPLICIT, evidenced
//                           candidate (DERIVED only when backed by
//                           deterministic geometry)
//
// Pure domain logic: no DOM, no fetch, no DB.
import { DRAWING_FACT_EVIDENCE_KINDS } from "./drawing-fact-decision-policy.mjs";

export const ARCHITECTURE_FACT_DECISION_STATES = Object.freeze({
  CONFIRMED_ARCHITECTURE_FACT: "CONFIRMED_ARCHITECTURE_FACT",
  CONFIRMED_WITH_WARNING: "CONFIRMED_WITH_WARNING",
  ENGINEER_REVIEW_REQUIRED: "ENGINEER_REVIEW_REQUIRED",
  REJECTED_INTERPRETATION: "REJECTED_INTERPRETATION",
  STALE: "STALE",
});

export const ARCHITECTURE_FACT_DECISION_POLICY_VERSION = "architecture-fact-decision-1.0.0";

// Repository-equivalent canonical actor (identical to the governed
// SYSTEM_DRAWING_EVALUATION_ACTOR -- architecture facts are drawing facts).
export const SYSTEM_ARCHITECTURE_EVALUATION_ACTOR = "system:deterministic-drawing-evaluation";

export const ARCHITECTURE_EVIDENCE_KINDS = DRAWING_FACT_EVIDENCE_KINDS;

// Which sheet type (classifyDrawingType bucket, already reduced to
// architecture vocabulary) is a PRIMARY authority for each fact type.
// Architecturally PRIMARY sources are Riser Diagram / Schematic / Single-Line.
// Legend sheets establish symbol identity only (Step 14.6) -- they are never
// an architecture source. Cause & Effect / Schedule / Detail / Layout are
// supporting at best, never PRIMARY for panel/loop/interface existence.
export const ARCHITECTURE_PRIMARY_SHEETS = Object.freeze(["Riser Diagram", "Schematic / Single-Line"]);

// Per-fact-type hard requirements. `allowDerived` marks fact types whose
// DERIVED evidence (deterministic geometry only) may still auto-confirm with
// a warning. `requiresObject` marks relation-carrying types that need a
// resolved target. `alwaysEngineerReview` marks fact types that are recorded
// but NEVER auto-promoted (engineering discrepancies, area mappings that this
// pipeline cannot prove geometrically).
export const ARCHITECTURE_FACT_REQUIREMENTS = Object.freeze({
  PANEL_EXISTS: { requiresObject: false, allowDerived: false, alwaysEngineerReview: false },
  PANEL_LABEL: { requiresObject: false, allowDerived: false, alwaysEngineerReview: false },
  PANEL_SERVES_AREA: { requiresObject: true, allowDerived: true, alwaysEngineerReview: false },
  PANEL_LOOP_RELATION: { requiresObject: true, allowDerived: true, alwaysEngineerReview: false },
  PANEL_NETWORK_LINK: { requiresObject: true, allowDerived: false, alwaysEngineerReview: false },
  SLC_LOOP_EXISTS: { requiresObject: false, allowDerived: false, alwaysEngineerReview: false },
  SLC_LOOP_SERVES_AREA: { requiresObject: true, allowDerived: true, alwaysEngineerReview: true },
  SLC_DEVICE_BRANCH: { requiresObject: true, allowDerived: true, alwaysEngineerReview: true },
  NAC_CIRCUIT_EXISTS: { requiresObject: false, allowDerived: false, alwaysEngineerReview: false },
  MODULE_CONNECTED_TO_PANEL: { requiresObject: true, allowDerived: true, alwaysEngineerReview: true },
  INTERFACE_CONNECTED_TO_SYSTEM: { requiresObject: true, allowDerived: false, alwaysEngineerReview: false },
  EXTERNAL_SYSTEM_INTERFACE: { requiresObject: true, allowDerived: false, alwaysEngineerReview: false },
  FIRE_ALARM_NETWORK_TOPOLOGY: { requiresObject: true, allowDerived: true, alwaysEngineerReview: false },
  CROSS_SHEET_REFERENCE: { requiresObject: true, allowDerived: false, alwaysEngineerReview: false },
  LAYOUT_LEGEND_LINK: { requiresObject: true, allowDerived: false, alwaysEngineerReview: false },
  ARCHITECTURE_DISCREPANCY: { requiresObject: false, allowDerived: false, alwaysEngineerReview: true },
});

const meaningful = (value) => typeof value === "string" && value.trim().length > 0;
const normalizedText = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const withVerdict = (state, { reasons, warnings = [], evidenceKind = null, input }) => ({
  state,
  // Eligible means the fact may be promoted into the approved architecture
  // object in a governed promotion pass.
  eligible: state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT || state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING,
  autoConfirmEligible: state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT || state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING,
  decisionReasons: reasons,
  warnings,
  decisionPolicyVersion: ARCHITECTURE_FACT_DECISION_POLICY_VERSION,
  evidenceKind,
});

/**
 * Decide the governed state for one architecture-fact candidate.
 *
 * Input (plain data, prepared by the caller -- never raw DB rows):
 *   fact           {factType, subject, relation, object, scope, evidenceKind,
 *                    source: {documentId, documentVersionId, intakeVersionId,
 *                             drawingType, pageNumber, sourceRegion,
 *                             sourceFragmentIds, insight}}
 *   factRequirements   ARCHITECTURE_FACT_REQUIREMENTS[factType]
 *   source         {intake: {id,status,supersededAt}, documentCurrentVersionId,
 *                   currentIntakeId}
 *   stored         {evidenceFingerprint, caseVersion, status, reviewedBy,
 *                   initializationProvenance}
 *   current        {evidenceFingerprint}  -- recomputed from current evidence
 *   assignment     {deterministic, nearest, multipleNear}  -- DERIVED geometry
 *   resolution     {state, resolvedDocumentIds, referencedDrawingNumber,
 *                    applicableSystem}    -- cross-sheet reference resolution
 */
export const decideArchitectureFact = (input = {}) => {
  const {
    fact = {},
    source = {},
    stored = {},
    current = {},
    assignment = {},
    resolution = null,
  } = input;
  const requirements = ARCHITECTURE_FACT_REQUIREMENTS[fact.factType] || ARCHITECTURE_FACT_REQUIREMENTS.PANEL_EXISTS;
  const sourceFragments = Array.isArray(fact.source?.sourceFragmentIds) ? fact.source.sourceFragmentIds : [];
  const intake = source.intake || {};

  const finishStale = (reason) => withVerdict(ARCHITECTURE_FACT_DECISION_STATES.STALE, { reasons: [reason], input });
  const finishReview = (reasons) => withVerdict(ARCHITECTURE_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED, { reasons: Array.isArray(reasons) ? reasons : [reasons], input, evidenceKind: fact.evidenceKind });
  const finishRejected = (reason) => withVerdict(ARCHITECTURE_FACT_DECISION_STATES.REJECTED_INTERPRETATION, { reasons: [reason], input, evidenceKind: fact.evidenceKind });

  // -------------------------------------------------------------------------
  // 1. STALE ladder -- the fact cannot be current; nothing else is considered.
  // -------------------------------------------------------------------------
  if (intake.status && intake.status !== "Completed") return finishStale("INTAKE_NOT_COMPLETED");
  if (intake.supersededAt) return finishStale("INTAKE_SUPERSEDED");
  if (fact.source?.intakeVersionId && source.currentIntakeId && fact.source.intakeVersionId !== source.currentIntakeId) return finishStale("INTAKE_VERSION_CHANGED");
  if (fact.source?.documentVersionId && source.documentCurrentVersionId && fact.source.documentVersionId !== source.documentCurrentVersionId) return finishStale("DOCUMENT_VERSION_CHANGED");
  const storedFingerprint = stored.initializationProvenance?.evidenceFingerprint ?? stored.evidenceFingerprint ?? null;
  if (current.evidenceFingerprint && storedFingerprint && current.evidenceFingerprint !== storedFingerprint) return finishStale("ARCHITECTURE_EVIDENCE_CHANGED");
  // A superseded candidate (the same fact re-extracted from a newer intake) is
  // recorded as a version relation, not promoted from the old intake.
  if (fact.supersededByCurrentIntake) return finishStale("SUPERSEDED_BY_CURRENT_INTAKE");

  // -------------------------------------------------------------------------
  // 2. REJECTED ladder -- the deterministic claim is cross-system or sourced
  // from a sheet that cannot author this fact type.
  // -------------------------------------------------------------------------
  if (fact.scope && normalizedText(fact.scope) !== "FIREALARM" && !fact.scopeCrossSystemAllowed) return finishRejected("CROSS_SYSTEM_SCOPE");
  const authoritative = ARCHITECTURE_PRIMARY_SHEETS.includes(fact.source?.drawingType);
  if (!authoritative && requirements.alwaysEngineerReview === false && !fact.supportingSourceAllowed) return finishRejected("FACT_SOURCE_NOT_ARCHITECTURE");
  if (fact.source?.system && normalizedText(fact.source.system) !== "FIREALARM" && requirements.alwaysEngineerReview === false) return finishRejected("CROSS_SYSTEM_SOURCE");

  // -------------------------------------------------------------------------
  // 3. Engineer-review set.
  // -------------------------------------------------------------------------
  const reviewReasons = [];
  if (requirements.alwaysEngineerReview) reviewReasons.push(`${fact.factType}_AUTO_CONFIRM_NOT_AUTHORIZED`);
  if (sourceFragments.length === 0) reviewReasons.push("MISSING_FRAGMENT_PROVENANCE");
  if (!fact.source?.insight) reviewReasons.push("MISSING_EXCERPT_EVIDENCE");
  if (!fact.source?.pageNumber && fact.source?.pageNumber !== 0) reviewReasons.push("MISSING_PAGE_PROVENANCE");
  if (requirements.requiresObject && !meaningful(fact.object)) reviewReasons.push("MISSING_RELATION_OBJECT");

  // Ambiguity detections.
  if (fact.identity?.resolution === "AMBIGUOUS") reviewReasons.push("PANEL_IDENTITY_AMBIGUOUS");
  // A single generic FACP symbol with no scope hint (no building pairing, no
  // label expansion) does not establish WHICH panel the sheet means -- the
  // panel identity stays unresolved until evidence (label or location) pins it.
  if (fact.factType === "PANEL_EXISTS" && fact.subject === "FACP" && Number(fact.identity?.observations ?? 0) === 1 && !fact.identity?.scopeHint) reviewReasons.push("GENERIC_PANEL_IDENTITY_UNRESOLVED");
  if (assignment && assignment.multipleNear) reviewReasons.push("ASSIGNMENT_AMBIGUOUS_NEAREST");
  if (fact.evidenceKind === DRAWING_FACT_EVIDENCE_KINDS.DERIVED) {
    if (!assignment || !assignment.deterministic) {
      if (!requirements.allowDerived || !assignment) reviewReasons.push("DERIVED_EVIDENCE_NOT_DETERMINISTIC");
    }
  }

  // Cross-sheet reference resolution.
  if (fact.factType === "CROSS_SHEET_REFERENCE") {
    if (!resolution) reviewReasons.push("CROSS_SHEET_RESOLUTION_MISSING");
    else if (resolution.state !== "Resolved") {
      reviewReasons.push(resolution.state === "Ambiguous" ? "CROSS_SHEET_AMBIGUOUS_TARGET" : "CROSS_SHEET_UNRESOLVED_TARGET");
    }
  }

  if (reviewReasons.length) return finishReview(reviewReasons);

  // -------------------------------------------------------------------------
  // 4. Confirmed ladder.
  // -------------------------------------------------------------------------
  const baseReasons = ["INTAKE_CURRENT", "DOCUMENT_VERSION_CURRENT", "ARCHITECTURE_EVIDENCE_FINGERPRINT_MATCH", "FRAGMENT_PROVENANCE_COMPLETE", "SOURCE_AUTHORITATIVE_FOR_FACTTYPE", fact.factType === "CROSS_SHEET_REFERENCE" ? "CROSS_SHEET_EXACT_RESOLUTION" : "SINGLE_UNSUPERVISED_EXPLICIT_EVIDENCE"];
  if (fact.evidenceKind === DRAWING_FACT_EVIDENCE_KINDS.DERIVED && requirements.allowDerived) {
    return withVerdict(ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING, {
      reasons: [...baseReasons, "DETERMINISTIC_GEOMETRY_ASSIGNMENT"],
      warnings: ["DERIVED_FROM_DETERMINISTIC_GEOMETRY"],
      evidenceKind: fact.evidenceKind,
      input,
    });
  }
  if (fact.evidenceKind === DRAWING_FACT_EVIDENCE_KINDS.EXPLICIT) {
    return withVerdict(ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT, {
      reasons: [...baseReasons, "EXPLICIT_SHEET_EVIDENCE"],
      evidenceKind: fact.evidenceKind,
      input,
    });
  }
  // DEFENSIVE: an unknown evidence kind should never promote.
  return finishReview(["EVIDENCE_KIND_UNKNOWN"]);
};

// Convenience predicate used by the review worker + tests.
export const isArchitectureAutoConfirmEligible = (decision) =>
  decision?.eligible === true &&
  (decision.state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT || decision.state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);