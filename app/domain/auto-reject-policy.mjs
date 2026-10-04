// STAGE 4D-4 -- PURE DETERMINISTIC AUTO-REJECTION POLICY GATE.
//
// Stage 4D-3 proved each candidate's technical decision state; Stage 4D-4 is
// the FIRST live automatic technical action, and it is DETERMINISTIC
// REJECTION ONLY. This module is the single explicit policy gate that the
// governed write path must consult before recording an auto-rejection:
//
//     canAutoRejectTechnicalCandidate(decision, context) -> Eligibility
//
// AUTO-REJECTION IS ALLOWED ONLY FOR A PROVEN, CURRENT, CANDIDATE-ATTRIBUTABLE,
// DETERMINISTIC TECHNICAL FAILURE. It is never allowed for missing evidence,
// insufficient authority, ambiguity, missing project context, missing
// architecture, calculation input gaps, conflicting governing requirements,
// regulatory/AHJ uncertainty, manual substitution, approved-deviation cases,
// or stale evidence -- those remain engineer exceptions / stale.
//
// This module is pure (no DB, no fetch, no worker imports, no side effects, no
// randomness) and fails closed: unknown or malformed input is NEVER
// auto-reject eligible. It never re-evaluates the engineering facts -- it
// consumes the Stage 4D-3 decision (including the new deterministic
// technicalFailures trace) and only checks the eligibility boundary. During a
// fresh matching run the decision is current by construction, so the engine
// attach and the write path both pass governingBasisCurrent:true; the live
// write path independently re-verifies against the persisted run afterwards.
const ELIGIBLE = Symbol("auto-reject-eligible");
const BLOCKED = Symbol("auto-reject-blocked");

export const AUTO_REJECT_POLICY_VERSION = "auto-reject-policy-4d-4.0.0";

// The only deterministic failure types Stage 4D-3 may prove that an automatic
// rejection may act on. Anything else (or anything unknown) is not eligible.
export const AUTO_REJECT_ELIGIBLE_FAILURE_TYPES = Object.freeze([
  "ENVELOPE_MANDATORY_MISMATCH",
  "CALCULATED_FAIL",
  "PROHIBITED_MANUFACTURER",
  "NOT_APPROVED_MANUFACTURER",
  "PROJECT_VIOLATION",
]);

// Every engineer-exception condition that MUST NEVER trigger an automatic
// rejection. The policy fails closed when any of them coexists with a nominal
// failure: the engineer exception wins.
export const AUTO_REJECT_INELIGIBLE_EXCEPTION_CODES = Object.freeze([
  "INSUFFICIENT_EVIDENCE",
  "INSUFFICIENT_AUTHORITY",
  "AMBIGUOUS",
  "UNKNOWN_APPLICABILITY",
  "MISSING_ENGINEERING_INPUT",
  "MISSING_COMPATIBILITY_EVIDENCE",
  "MISSING_ARCHITECTURE_EVIDENCE",
  "REGULATORY_OR_AHJ_CLARIFICATION",
  "CONFLICTING_AUTHORITATIVE_EVIDENCE",
  "CERTIFICATION_SCOPE_AMBIGUITY",
  "MANUAL_CANDIDATE_REVIEW",
  "APPROVED_DEVIATION_REQUIRED",
  "TECHNICAL_SUBSTITUTION_REVIEW",
  "PROJECT_SPECIFIC_EXCEPTION",
  "UNRESOLVED_SYSTEM_CONSTRAINT",
]);

// Envelope results that represent an absence of evidence, never a failure.
const MISSING_EVIDENCE_RESULTS = new Set(["MISSING_EVIDENCE", "INSUFFICIENT_AUTHORITY", "AMBIGUOUS", "UNKNOWN", "SUPERSEDED"]);

// Map a deterministic Stage 4D-3 failure to the governed reason_code written
// on the review row. Labeling only -- the failure facts were proven by the
// decision module; this never re-evaluates engineering.
export const reasonCodeForAutoReject = (failures) => {
  const failure = Array.isArray(failures) ? failures[0] : null;
  if (!failure) return null;
  switch (failure.type) {
    case "ENVELOPE_MANDATORY_MISMATCH": {
      const dimension = String(failure.dimension || "");
      if (/protocol/i.test(dimension)) return "PROTOCOL_MISMATCH";
      if (/compatib/i.test(dimension)) return "INCOMPATIBLE_RELATION";
      if (/certification|listing|standard/i.test(dimension)) return "CERTIFICATION_CONTRADICTION";
      return "MANDATORY_ATTRIBUTE_MISMATCH";
    }
    case "CALCULATED_FAIL":
      return "CALCULATED_FAIL";
    case "PROHIBITED_MANUFACTURER":
      return "PROHIBITED_MANUFACTURER";
    case "NOT_APPROVED_MANUFACTURER":
      return "NOT_APPROVED_MANUFACTURER";
    case "PROJECT_VIOLATION":
      return "PROJECT_VIOLATION";
    default:
      return "TECHNICAL_REJECTION";
  }
};

// Sanitized, deterministic projection of a failure for output.
const sanitizeFailure = (failure) => {
  const entry = { type: failure?.type ?? null, reason: failure?.reason ?? null };
  if (failure?.dimension) entry.dimension = failure.dimension;
  if (failure?.calculationType) entry.calculationType = failure.calculationType;
  if (failure?.violationType) entry.violationType = failure.violationType;
  return entry;
};

// Deterministic identity of the proven decision, recorded on the review row
// and used by the write path for idempotency / audit.
const decisionFingerprintOf = (decision, failures, reasons) => {
  if (!decision || typeof decision !== "object") return null;
  return JSON.stringify({
    decisionVersion: decision.versionFingerprints?.decisionVersion ?? null,
    state: decision.state,
    technicalFailures: failures.map(sanitizeFailure),
    mandatoryDimensions: decision.mandatoryDimensions ?? null,
    evidenceRefs: decision.evidenceRefs ?? null,
    calculationRefs: decision.calculationRefs ?? null,
    reasons: reasons || [],
  });
};

// ---------------------------------------------------------------------------
// PRIMARY GATE.
// ---------------------------------------------------------------------------
//
// Conditions (all must hold; the gate fails closed on any violation):
//   A.  a technicalDecision exists,
//   B.  state === TECHNICALLY_UNACCEPTABLE,
//   C.  authority === SYSTEM_DETERMINISTIC_EVALUATION,
//   D.  deterministic === true,
//   E/F. the decision and governing basis are current (explicitly asserted
//       by the caller; stale decisions are STALE, never UNACCEPTABLE),
//   G.  at least one explicit deterministic technical failure is proven,
//   H.  the failure is attributable to THIS candidate (project violations
//       must appear in the decision's own attributable list),
//   I.  no engineer-exception reason is mixed into the same decision,
//   J.  no unresolved authority conflict exists,
//   K.  no missing evidence is being interpreted as failure,
//   L.  no approved-deviation / substitution / manual judgment is required.
export const canAutoRejectTechnicalCandidate = (decision, context = {}) => {
  const contextFlags = {
    manualCandidate: context?.manualCandidate ?? null,
    approvedDeviationRequired: context?.approvedDeviationRequired === true,
    technicalSubstitutionReview: context?.technicalSubstitutionReview === true,
  };

  const verdict = (outcome, blockReason, { failures = [], reasons = [], reasonCode = null } = {}) => {
    if (outcome === BLOCKED) {
      return {
        eligible: false,
        policyVersion: AUTO_REJECT_POLICY_VERSION,
        blockReason,
        reasonCode: null,
        decisionFingerprint: null,
        technicalFailures: [],
        failureTypes: [],
        reasons: [],
      };
    }
    return {
      eligible: true,
      policyVersion: AUTO_REJECT_POLICY_VERSION,
      blockReason: null,
      reasonCode,
      decisionFingerprint: decisionFingerprintOf(decision, failures, reasons),
      technicalFailures: failures.map(sanitizeFailure),
      failureTypes: failures.map((failure) => failure.type),
      reasons,
    };
  };

  // A. A decision must exist and be a plain object with the closed shape.
  if (!decision || typeof decision !== "object" || Array.isArray(decision) || decision.state == null) {
    return verdict(BLOCKED, "MISSING_DECISION");
  }
  // B. Only a proven TECHNICALLY_UNACCEPTABLE decision may be acted on.
  if (decision.state !== "TECHNICALLY_UNACCEPTABLE") {
    return verdict(BLOCKED, "NOT_TECHNICALLY_UNACCEPTABLE");
  }
  // C/D. Only the deterministic system evaluation may act.
  if (decision.authority !== "SYSTEM_DETERMINISTIC_EVALUATION" || decision.deterministic !== true) {
    return verdict(BLOCKED, "NON_DETERMINISTIC_AUTHORITY");
  }
  // E/F. Currency is explicit and required; absence fails closed.
  if (context?.governingBasisCurrent !== true) {
    return verdict(BLOCKED, "GOVERNING_BASIS_NOT_CURRENT");
  }
  // Defense-in-depth against a malformed decision that is UNACCEPTABLE yet
  // carries stale markers.
  if (Array.isArray(decision.exceptionReasons) && decision.exceptionReasons.includes("STALE_GOVERNING_BASIS")) {
    return verdict(BLOCKED, "STALE_GOVERNING_BASIS");
  }
  // I. No engineer-exception reason may be mixed into the same decision.
  if (!Array.isArray(decision.exceptionReasons) || decision.exceptionReasons.length > 0) {
    return verdict(BLOCKED, "ENGINEER_EXCEPTION_MIXED_IN");
  }
  // J. No unresolved authority conflict may remain.
  if (!decision.mandatoryDimensions || typeof decision.mandatoryDimensions !== "object" || (decision.mandatoryDimensions.unresolved ?? 0) > 0) {
    return verdict(BLOCKED, "UNRESOLVED_AUTHORITY_CONFLICT");
  }
  // K. Missing evidence must never be staged as a failure. Any blocking
  // evidence-ref row that is an absence outcome blocks automatic rejection.
  if (!Array.isArray(decision.evidenceRefs)) {
    return verdict(BLOCKED, "INCOMPLETE_DECISION");
  }
  if (decision.evidenceRefs.some((entry) => Boolean(entry.blocking) && MISSING_EVIDENCE_RESULTS.has(entry.result))) {
    return verdict(BLOCKED, "MISSING_EVIDENCE_INTERPRETED_AS_FAILURE");
  }
  // L. No deviation / substitution / manual judgment may be required.
  if (contextFlags.manualCandidate && contextFlags.manualCandidate.decisionRequired === true && contextFlags.manualCandidate.fullyReviewable !== true) {
    return verdict(BLOCKED, "MANUAL_CANDIDATE_JUDGMENT_REQUIRED");
  }
  if (contextFlags.approvedDeviationRequired) {
    return verdict(BLOCKED, "APPROVED_DEVIATION_REQUIRED");
  }
  if (contextFlags.technicalSubstitutionReview) {
    return verdict(BLOCKED, "TECHNICAL_SUBSTITUTION_REQUIRED");
  }
  // G. At least one explicit deterministic failure must be proven, and every
  // proven failure type must be on the eligible list (an unknown or
  // ineligible type fails closed -- the engineer exception wins).
  const failures = Array.isArray(decision.technicalFailures) ? decision.technicalFailures : [];
  if (!failures.length) {
    return verdict(BLOCKED, "NO_DETERMINISTIC_FAILURE");
  }
  const unknownFailure = failures.find((failure) => !AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes(failure?.type));
  if (unknownFailure) {
    return verdict(BLOCKED, unknownFailure?.type ? "INELIGIBLE_FAILURE_TYPE" : "MALFORMED_DECISION");
  }
  // H. Every proven project violation must already be candidate-attributable
  // in the decision's own project-check trace (4D-3 only records attributable
  // violations as deterministic failures; this re-verifies the attribution).
  const attributableTypes = (decision.projectCheckSummary?.attributable || []).map((entry) => entry.type);
  const unattributableViolation = failures.find(
    (failure) => failure.type === "PROJECT_VIOLATION" && !attributableTypes.includes(failure.violationType),
  );
  if (unattributableViolation) {
    return verdict(BLOCKED, "PROJECT_VIOLATION_NOT_ATTRIBUTABLE");
  }

  const failuresSubset = failures.map(sanitizeFailure);
  return verdict(ELIGIBLE, null, {
    failures: failures.map(sanitizeFailure),
    failureTypes: failuresSubset.map((failure) => failure.type),
    reasons: Array.isArray(decision.reasons) ? decision.reasons : [],
    reasonCode: reasonCodeForAutoReject(failures.map(sanitizeFailure)),
  });
};

// ---------------------------------------------------------------------------
// Attach-oriented dry-run.
// ---------------------------------------------------------------------------
// During a fresh matching run the decision is current by construction (the
// decision module itself resolves staleness to STALE). This convenience
// wrapper is the deterministic, in-memory, dry-run representation the engine
// attaches to every candidate; it never writes.
export const evaluateAutoRejectEligibility = (decision) =>
  canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });