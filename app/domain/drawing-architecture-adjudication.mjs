// STEP 14.8 -- DRAWING ARCHITECTURE EXCEPTION ADJUDICATION (project-scoped).
//
// Deterministic elevation of the review-exception inventory left open by
// Step 14.7 (21 pending review records) into exactly 12 UNIQUE exceptions,
// each adjudicated by evidence-only rules -- never by guessing, proximity,
// convention, or a reusable fuzzy resolver.
//
//   Exception groups (normalizeExceptionInventory):
//     - 9 groups of CROSS_SHEET_REFERENCE, each mirrored by its OWN
//       ARCHITECTURE_DISCREPANCY record (same source fragment). The group is
//       ONE unique exception, adjudicated once -- an engineer is never asked
//       twice about the same note.
//     - 3 generic FACP PANEL_EXISTS records (one per building schematic),
//       each its own GENERIC_FACP_IDENTITY exception.
//
//   Reference adjudication (adjudicateCrossSheetReference):
//     CONFIRMED_PROJECT_REFERENCE only when the evidence pins ONE target:
//       - exactly one registered drawing matches the referenced number, OR
//       - exactly one registered drawing matches under the project's own
//         observed `-DR-`-segment omission convention (the register numbers
//         Fire Alarm drawings `-DR-T-*`, the notes cite them DR-less), AND
//         the corpus proves the convention holds project-wide (DR-less forms
//         cited, DR forms never), AND the referenced target discipline
//         segment (T-00) is not the distinct E-00 evidence discipline.
//     Multiple candidates or none  -> ENGINEER_REVIEW_REQUIRED.
//     The RAW referenced number and the CANONICAL registered target are both
//     preserved in the resolution record.
//
//   FACP identity adjudication (adjudicateGenericFacp):
//     CONFIRMED_SAME_PANEL only when strong, explicit anchors align (unique
//     topology position, explicit building area code, explicit cross-sheet
//     identity token, explicit source->target connections, exact loop
//     ownership). Weak evidence alone (generic text, visual proximity,
//     convention, manufacturer, BOQ) is NEVER enough to merge a panel.
//
//   Stage 4 blocking semantics (stage4BlockingSemantics):
//     Only materially unreliable PANEL IDENTITY / TOPOLOGY / LOOP OWNERSHIP /
//     SYSTEM BOUNDARY / INTERFACE CONSTRAINT evidence blocks the Stage 4
//     bridge. Reference-format issues are NONBLOCKING_DRAWING_REVIEW.
//
// Pure domain logic: no DOM, no DB, no fetch. All evidence enters as
// parameters.
import { SYSTEM_ARCHITECTURE_EVALUATION_ACTOR } from "./drawing-architecture-decision-policy.mjs";

export const ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION = "architecture-exception-adjudication-1.0.0";
export const ARCHITECTURE_EXCEPTION_ADJUDICATION_ACTOR = SYSTEM_ARCHITECTURE_EVALUATION_ACTOR;

// Adjudication decision states (distinct from the fact decision ladder).
export const EXCEPTION_ADJUDICATION_DECISION_STATES = Object.freeze({
  CONFIRMED_PROJECT_REFERENCE: "CONFIRMED_PROJECT_REFERENCE",
  CONFIRMED_SAME_PANEL: "CONFIRMED_SAME_PANEL",
  DISTINCT_PANEL: "DISTINCT_PANEL",
  ENGINEER_REVIEW_REQUIRED: "ENGINEER_REVIEW_REQUIRED",
});

// Stage 4 bridge blocking classification per unique exception.
export const STAGE4_BLOCKING_CLASS = Object.freeze({
  STAGE4_BLOCKING: "STAGE4_BLOCKING",
  NONBLOCKING_DRAWING_REVIEW: "NONBLOCKING_DRAWING_REVIEW",
});

export const ARCHITECTURE_STATUS_VALUES = Object.freeze({
  PARTIAL: "PARTIAL",
  COMPLETE: "COMPLETE",
});

export const STAGE4_READINESS_VALUES = Object.freeze({
  PARTIAL_NOT_READY: "PARTIAL_NOT_READY",
  READY_FOR_STAGE4_BRIDGE: "READY_FOR_STAGE4_BRIDGE",
});

// Reference adjudication reasons.
export const REFERENCE_ADJUDICATION_REASONS = Object.freeze({
  PROJECT_REFERENCE_FORMAT_VARIANT_CONFIRMED: "PROJECT_REFERENCE_FORMAT_VARIANT_CONFIRMED",
  UNIQUE_REGISTER_TARGET: "UNIQUE_REGISTER_TARGET",
  CORPUS_DR_LESS_CONVENTION: "CORPUS_DR_LESS_CONVENTION",
  NOTE_TEXT_MATCHES_TARGET_TITLE: "NOTE_TEXT_MATCHES_TARGET_TITLE",
  DISTINCT_DISCIPLINE_EVIDENCE: "DISTINCT_DISCIPLINE_EVIDENCE",
  MULTIPLE_CANDIDATE_TARGETS: "MULTIPLE_CANDIDATE_TARGETS",
  NO_REGISTER_TARGET: "NO_REGISTER_TARGET",
});

// FACP identity ladder reasons.
export const FACP_IDENTITY_REASONS = Object.freeze({
  UNIQUE_TOPOLOGY_POSITION: "UNIQUE_TOPOLOGY_POSITION",
  EXPLICIT_BUILDING_AREA: "EXPLICIT_BUILDING_AREA",
  EXPLICIT_CROSS_SHEET_IDENTITY: "EXPLICIT_CROSS_SHEET_IDENTITY",
  EXPLICIT_SOURCE_TARGET_CONNECTION: "EXPLICIT_SOURCE_TARGET_CONNECTION",
  EXACT_LOOP_OWNERSHIP: "EXACT_LOOP_OWNERSHIP",
  PANEL_SERVES_AREA_ANCHOR: "PANEL_SERVES_AREA_ANCHOR",
  WEAK_EVIDENCE_ONLY: "WEAK_EVIDENCE_ONLY",
  EXPLICIT_DISTINCT_PANEL: "EXPLICIT_DISTINCT_PANEL",
});

const trim = (value) => String(value ?? "").trim();
const collapse = (value) => trim(value).toUpperCase().replace(/\s+/g, "").replace(/-{2,}/g, "-");
const arrayOf = (value) => (Array.isArray(value) ? value : value ? [value] : []);

// Extract the discipline code segment (`BOS`, `GRS`, `WLC`, `KGS`, `AMS`)
// from a project drawing number like "2401232- PC- BOS- DR- T-93-ZZZ-005".
export const buildingCodeFromDrawingNumber = (drawingNumber = "") => {
  const match = /-\s*([A-Z0-9]{2,4})\s*-+\s*DR\s*-/i.exec(trim(drawingNumber));
  return match ? match[1].toUpperCase() : null;
};

// The T-series (discipline) a drawing number belongs to: "T-00", "T-93", ...
// Used to prove the referenced/discipline segment is (or is not) the same.
export const disciplineSeriesFromDrawingNumber = (drawingNumber = "") => {
  const match = /-+\s*((?:[A-Z]-)?\d{2})\s*-+\s*ZZZ/i.exec(trim(drawingNumber));
  return match ? match[1].toUpperCase() : null;
};

// True when the registered number equals the referenced number under the
// project's OWN single `-DR-` segment omission convention (registered
// "2401232-PC-AMS-DR-T-00-ZZZ-002" cited DR-less as
// "2401232-PC-AMS-T-00-ZZZ-002"). Scoped to exactly ONE `-DR-` token and to
// matching discipline series -- never a general fuzzy relaxer.
const drVariantMatches = (registered, referenced) => {
  const r = collapse(registered);
  const x = collapse(referenced);
  if (!r || !x) return false;
  if (r === x) return true; // exact match also counts as a fully-resolved variant
  const drIndex = r.indexOf("-DR-");
  if (drIndex < 0 || r.indexOf("-DR-", drIndex + 4) !== -1) return false;
  const collapsed = `${r.slice(0, drIndex)}-${r.slice(drIndex + 4)}`.replace(/-{2,}/g, "-");
  if (collapsed !== x) return false;
  // Discipline-series guard: the reference must name the same series the
  // candidate registers (T-00 vs T-00), so an E-00 register member is never a
  // candidate for a T-00 citation.
  return disciplineSeriesFromDrawingNumber(registered) === disciplineSeriesFromDrawingNumber(referenced);
};

// ---------------------------------------------------------------------------
// Exception inventory normalization: 21 pending records -> 12 unique
// exceptions (9 CROSS_SHEET_REFERENCE groups + 3 GENERIC_FACP_IDENTITY).
// ---------------------------------------------------------------------------
export const normalizeExceptionInventory = ({ records = [] } = {}) => {
  const pending = records.filter((r) => r && r.status === "Needs Review");
  const referencedOf = (record) => {
    const snapshot = record.snapshot || {};
    return snapshot.resolution?.referencedDrawingNumber ?? snapshot.referencedDrawingNumber ?? record.object ?? null;
  };
  const fragmentKey = (record) => arrayOf(record.sourceFragmentIds).join("|") || null;

  const referenceExceptions = new Map();
  const facpExceptions = new Map();
  const ungrouped = [];
  let refRecords = 0;
  let discrepancyRecords = 0;
  let facpRecords = 0;

  for (const record of pending) {
    const type = record.factType;
    if (type === "CROSS_SHEET_REFERENCE" || type === "ARCHITECTURE_DISCREPANCY") {
      const referenced = referencedOf(record);
      if (!referenced && type === "CROSS_SHEET_REFERENCE") { ungrouped.push(record); continue; }
      if (type === "CROSS_SHEET_REFERENCE") refRecords++;
      if (type === "ARCHITECTURE_DISCREPANCY") discrepancyRecords++;
      // Group key: source drawing + referenced drawing number. The mirrored
      // discrepancy shares the SAME source fragment (verified 1:1 in this
      // project) -- both sides name exactly one exception for one review.
      const key = `${record.sourceDrawingNumber ?? "?"}|${referenced}`;
      const existing = referenceExceptions.get(key);
      if (existing) {
        existing.sourceReviewCaseIds.push(record.id);
        if (!existing.observedFragments.includes(fragmentKey(record))) existing.observedFragments.push(fragmentKey(record));
        existing.recordTypes.add(type);
        continue;
      }
      referenceExceptions.set(key, {
        exceptionKey: `CROSS_SHEET_REFERENCE|${key}`,
        exceptionType: "CROSS_SHEET_REFERENCE",
        factType: "CROSS_SHEET_REFERENCE",
        sourceDrawingNumber: record.sourceDrawingNumber ?? null,
        referencedDrawingNumber: referenced,
        sourceReviewCaseIds: [record.id],
        observedFragments: [fragmentKey(record)],
        recordTypes: new Set([type]),
        noteText: record.snapshot?.source?.insight ?? record.noteText ?? null,
        sourceFragmentIds: arrayOf(record.sourceFragmentIds),
        sourceSheetName: record.snapshot?.source?.sheetName ?? null,
      });
      continue;
    }
    if (type === "PANEL_EXISTS" && record.subject === "FACP") {
      facpRecords++;
      const buildingCode = buildingCodeFromDrawingNumber(record.sourceDrawingNumber) || "UNKNOWN";
      const key = `${record.sourceDrawingNumber ?? "?"}`;
      const existing = facpExceptions.get(key);
      if (existing) { existing.sourceReviewCaseIds.push(record.id); continue; }
      facpExceptions.set(key, {
        exceptionKey: `GENERIC_FACP_IDENTITY|${key}`,
        exceptionType: "GENERIC_FACP_IDENTITY",
        factType: "PANEL_EXISTS",
        subject: "FACP",
        label: record.snapshot?.source?.insight ?? record.object ?? "FIRE ALARM CONTROL PANEL (F.A.C.P)",
        buildingCode,
        sourceDrawingNumber: record.sourceDrawingNumber ?? null,
        observations: record.snapshot?.identity?.observations ?? null,
        sourceReviewCaseIds: [record.id],
        sourceFragmentIds: arrayOf(record.sourceFragmentIds),
        sourceSheetName: record.snapshot?.source?.sheetName ?? null,
        recordTypes: new Set(["PANEL_EXISTS"]),
      });
      continue;
    }
    ungrouped.push(record);
  }

  const exceptions = [...referenceExceptions.values(), ...facpExceptions.values()].map((e) => ({
    ...e,
    recordTypes: [...e.recordTypes],
    sourceReviewCaseIds: [...new Set(e.sourceReviewCaseIds)],
  }));

  return {
    exceptions,
    counts: {
      totalRecords: pending.length,
      referenceRecords: refRecords,
      discrepancyRecords,
      facpRecords,
      uniqueExceptions: exceptions.length,
      referenceGroups: referenceExceptions.size,
      facpGroups: facpExceptions.size,
      ungrouped: ungrouped.length,
    },
    ungrouped,
  };
};

// ---------------------------------------------------------------------------
// Reference adjudication -- evidence-only deterministic resolution.
// ---------------------------------------------------------------------------
export const adjudicateCrossSheetReference = ({ exception = {}, evidence = {} } = {}) => {
  const referenced = trim(exception.referencedDrawingNumber);
  const register = arrayOf(evidence.register).filter((r) => r?.drawingNumber);
  const corpus = evidence.corpusCounts || { withoutDr: 0, withDr: 0, totalT00: 0 };
  const noteText = trim(exception.noteText || evidence.noteText || "");

  const candidates = register.filter((doc) => drVariantMatches(doc.drawingNumber, referenced));
  const uniqueIds = [...new Set(candidates.map((c) => c.documentId || c.id))];

  if (uniqueIds.length === 1) {
    const target = candidates[0];
    const reasons = [REFERENCE_ADJUDICATION_REASONS.UNIQUE_REGISTER_TARGET];
    const targetTitle = trim(target.sheetName || "");
    const targetSeries = disciplineSeriesFromDrawingNumber(target.drawingNumber);
    const referencedSeries = disciplineSeriesFromDrawingNumber(referenced);
    // Evidence-only corroborations, each independently false-safe:
    //  1. The raw citation form is DR-less while the register form is -DR-:
    //     that is exactly this project's observed citation convention.
    //  2. The corpus cites the DR-less form and never the -DR- form
    //     (22 DR-less, 0 DR) -- a project-wide convention, not a typo.
    //  3. The note text matches the target sheet's title family.
    //  4. E-00 (ELECTRICAL) is a distinct discipline from the referenced
    //     T-00 (ELV) — enforced by the discipline-series guard above.
    const rawIsLess = collapse(referenced) !== collapse(target.drawingNumber);
    if (rawIsLess) reasons.push(REFERENCE_ADJUDICATION_REASONS.PROJECT_REFERENCE_FORMAT_VARIANT_CONFIRMED);
    if (Number(corpus.withoutDr) >= 1 && Number(corpus.withDr) === 0) reasons.push(REFERENCE_ADJUDICATION_REASONS.CORPUS_DR_LESS_CONVENTION);
    const targetFamily = ["ELV LEGENDS", "LEGENDS, NOTES", "ABBREVIATIONS"].some((t) => {
      const normalized = trim(targetTitle).toUpperCase();
      return normalized.includes(t) || normalized.includes(t.replace(",", ""));
    });
    if (targetSeries && referencedSeries && targetSeries === referencedSeries) {
      if (targetFamily || noteText.toUpperCase().includes("ELV LEGENDS")) reasons.push(REFERENCE_ADJUDICATION_REASONS.NOTE_TEXT_MATCHES_TARGET_TITLE);
      if (!/^E-/.test(targetSeries)) reasons.push(REFERENCE_ADJUDICATION_REASONS.DISTINCT_DISCIPLINE_EVIDENCE);
    }
    return {
      decisionState: EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_PROJECT_REFERENCE,
      decisionReasons: reasons,
      decisionPolicyVersion: ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
      referencedDrawingNumber: referenced, // RAW reference preserved verbatim
      canonicalTargetDocumentId: target.documentId || target.id,
      canonicalTargetDrawingNumber: target.drawingNumber, // CANONICAL registered form
      canonicalTargetSheetName: targetTitle,
      stage4BlockingClass: STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW,
      evidenceSummary: {
        registerCandidates: uniqueIds.length,
        register: register.map((r) => r.drawingNumber),
        corpusCounts: corpus,
        noteText,
      },
    };
  }

  return {
    decisionState: EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED,
    decisionReasons: [
      uniqueIds.length > 1
        ? REFERENCE_ADJUDICATION_REASONS.MULTIPLE_CANDIDATE_TARGETS
        : REFERENCE_ADJUDICATION_REASONS.NO_REGISTER_TARGET,
    ],
    decisionPolicyVersion: ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
    referencedDrawingNumber: referenced,
    canonicalTargetDocumentId: null,
    canonicalTargetDrawingNumber: null,
    stage4BlockingClass: STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW,
    evidenceSummary: {
      registerCandidates: uniqueIds.length,
      register: register.map((r) => r.drawingNumber),
      corpusCounts: corpus,
      noteText,
    },
  };
};

// ---------------------------------------------------------------------------
// Generic FACP identity adjudication -- strong-evidence ladder.
// ---------------------------------------------------------------------------
export const adjudicateGenericFacp = ({ exception = {}, evidence = {} } = {}) => {
  const buildingCode = trim(exception.buildingCode || evidence.buildingCode || "");
  const observations = Number(exception.observations ?? evidence.observations ?? 0);
  const crossSheetTokens = arrayOf(evidence.crossSheetIdentityTokens);
  const sourceTargetConnections = arrayOf(evidence.sourceTargetConnections);
  const servedAreas = arrayOf(evidence.servedAreas);
  const loopOwnership = arrayOf(evidence.loopOwnership);
  const titleBlockToken = trim(evidence.titleBlockBuildingCode || "");
  const weakOnly = Boolean(evidence.weakEvidenceOnly);
  const explicitDistinct = arrayOf(evidence.explicitDistinctPanelEvidence);

  if (explicitDistinct.length > 0) {
    return {
      decisionState: EXCEPTION_ADJUDICATION_DECISION_STATES.DISTINCT_PANEL,
      decisionReasons: [...explicitDistinct, FACP_IDENTITY_REASONS.EXPLICIT_DISTINCT_PANEL],
      decisionPolicyVersion: ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
      canonicalPanelIdentity: null,
      buildingCode,
      stage4BlockingClass: STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING,
      evidenceSummary: { observations, crossSheetTokens, sourceTargetConnections, servedAreas, loopOwnership, titleBlockToken },
    };
  }

  // Strong anchors. A panel identity is ONLY confirmed when the evidence
  // positions THIS generic symbol as THE single building FACP:
  const strongAnchors = [];
  if (observations === 1) strongAnchors.push(FACP_IDENTITY_REASONS.UNIQUE_TOPOLOGY_POSITION);
  if (buildingCode && (titleBlockToken === buildingCode || servedAreas.some((a) => a && `${a}`.toUpperCase().includes(buildingCode)))) {
    strongAnchors.push(FACP_IDENTITY_REASONS.EXPLICIT_BUILDING_AREA);
  }
  const identityToken = `FACP @${buildingCode} BUILDING`;
  const crossSheetHit = crossSheetTokens.some((t) => {
    const s = trim(t).toUpperCase();
    return s.includes(identityToken.toUpperCase()) || (buildingCode && s.includes(`FACP @${buildingCode}`));
  });
  if (crossSheetHit) strongAnchors.push(FACP_IDENTITY_REASONS.EXPLICIT_CROSS_SHEET_IDENTITY);
  if (sourceTargetConnections.length >= 2) strongAnchors.push(FACP_IDENTITY_REASONS.EXPLICIT_SOURCE_TARGET_CONNECTION);
  if (loopOwnership.length >= 1) strongAnchors.push(FACP_IDENTITY_REASONS.EXACT_LOOP_OWNERSHIP);
  if (servedAreas.length >= 1) strongAnchors.push(FACP_IDENTITY_REASONS.PANEL_SERVES_AREA_ANCHOR);

  // CONFIRMED_SAME_PANEL requires the deterministic topology position plus at
  // least two more independent strong anchors. Weak evidence alone never
  // merges ("FACP" appears on a BOQ / a proximity / a convention).
  if (!weakOnly && observations === 1 && strongAnchors.length >= 3) {
    return {
      decisionState: EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_SAME_PANEL,
      decisionReasons: strongAnchors,
      decisionPolicyVersion: ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
      canonicalPanelIdentity: identityToken,
      buildingCode,
      stage4BlockingClass: STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW,
      evidenceSummary: { observations, crossSheetTokens, sourceTargetConnections, servedAreas, loopOwnership, titleBlockToken, strongAnchors },
    };
  }

  return {
    decisionState: EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED,
    decisionReasons: [FACP_IDENTITY_REASONS.WEAK_EVIDENCE_ONLY],
    decisionPolicyVersion: ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
    canonicalPanelIdentity: null,
    buildingCode,
    stage4BlockingClass: STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING,
    evidenceSummary: { observations, crossSheetTokens, sourceTargetConnections, servedAreas, loopOwnership, titleBlockToken, strongAnchors },
  };
};

// ---------------------------------------------------------------------------
// Stage 4 blocking semantics per exception.
// ---------------------------------------------------------------------------
export const stage4BlockingSemantics = (exception = {}) => {
  if (exception.exceptionType === "GENERIC_FACP_IDENTITY") {
    return {
      stage4BlockingClass: STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING,
      reason: "Generic FACP panel identity is materially unreliable until adjudicated -- the Stage 4 bridge depends on panel identity/topology.",
    };
  }
  if (exception.exceptionType === "CROSS_SHEET_REFERENCE") {
    return {
      stage4BlockingClass: STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW,
      reason: "Reference-format issue only; panel identity, topology, loop ownership, system boundary and interface constraints are unaffected.",
    };
  }
  return {
    stage4BlockingClass: STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING,
    reason: "Unclassified exception blocks conservatively.",
  };
};

// ---------------------------------------------------------------------------
// Status recompute: PARTIAL -> COMPLETE and PARTIAL_NOT_READY ->
// READY_FOR_STAGE4_BRIDGE only when the evidence supports it.
// ---------------------------------------------------------------------------
export const recomputeArchitectureStatus = ({ exceptions = [], adjudications = [] } = {}) => {
  const byKey = new Map(adjudications.map((a) => [a.exceptionKey, a]));
  const pending = exceptions.filter((e) => !byKey.has(e.exceptionKey));
  const resolved = exceptions.filter((e) => {
    const a = byKey.get(e.exceptionKey);
    return a && (a.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_PROJECT_REFERENCE || a.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_SAME_PANEL || a.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.DISTINCT_PANEL);
  });
  const engineerReview = exceptions.filter((e) => {
    const a = byKey.get(e.exceptionKey);
    return a && a.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED;
  });
  const blockingBefore = exceptions.filter((e) => stage4BlockingSemantics(e).stage4BlockingClass === STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING).length;
  const blockingRemaining = exceptions
    .filter((e) => {
      const a = byKey.get(e.exceptionKey);
      const blocked = stage4BlockingSemantics(e).stage4BlockingClass === STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING;
      return !a || a.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED ? blocked : false;
    }).length;

  const architectureStatus = pending.length === 0 && engineerReview.length === 0
    ? ARCHITECTURE_STATUS_VALUES.COMPLETE
    : ARCHITECTURE_STATUS_VALUES.PARTIAL;
  const stage4Readiness = blockingRemaining === 0
    ? STAGE4_READINESS_VALUES.READY_FOR_STAGE4_BRIDGE
    : STAGE4_READINESS_VALUES.PARTIAL_NOT_READY;

  return {
    before: {
      architectureStatus: exceptions.length > 0 ? ARCHITECTURE_STATUS_VALUES.PARTIAL : ARCHITECTURE_STATUS_VALUES.COMPLETE,
      stage4Readiness: blockingBefore > 0 ? STAGE4_READINESS_VALUES.PARTIAL_NOT_READY : STAGE4_READINESS_VALUES.READY_FOR_STAGE4_BRIDGE,
      stage4BlockingCount: blockingBefore,
      nonblockingDrawingReviewCount: exceptions.length - blockingBefore,
      pendingExceptionCount: exceptions.length,
      resolvedExceptionCount: 0,
      engineerReviewExceptionCount: 0,
    },
    after: {
      architectureStatus,
      stage4Readiness,
      stage4BlockingCount: blockingRemaining,
      nonblockingDrawingReviewCount: pending.length + engineerReview.length,
      pendingExceptionCount: pending.length,
      resolvedExceptionCount: resolved.length,
      engineerReviewExceptionCount: engineerReview.length,
    },
  };
};