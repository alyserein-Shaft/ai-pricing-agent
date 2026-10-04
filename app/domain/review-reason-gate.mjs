// Agent 8 -- governed review-reason gate for engineer review decisions.
//
// Why this module exists
// ----------------------
// An accidental validation click once recorded a real REJECT_INTERPRETATION
// against the Golden project because the UI passed a hard-coded reason string
// straight into the mutation call, so the operator never saw or confirmed a
// reason and the client-side gate was bypassed entirely.
//
// The gate therefore lives here, as a pure domain model, instead of inside a
// React component, so that:
//
//   1. it is testable without a browser or a running server,
//   2. it cannot be weakened by a component edit, and
//   3. it has exactly one definition of "which decisions need a reason".
//
// This module is presentation/governance-gate logic only. It performs no
// database access, no approval of technical content, and no mutation. The
// backend remains the authority: `validateUnderstandingReviewCommand` in
// app/domain/estimator-understanding-review.mjs independently rejects a
// short/blank reason for EDIT_AND_APPROVE, REJECT_INTERPRETATION and
// RETURN_TO_REVIEW with UNDERSTANDING_REVIEW_REASON_REQUIRED. This gate is a
// strictly additive UI-side control, not a replacement for that validation.
//
// Note on the asymmetry (deliberate, not silently "fixed"):
// the backend validator requires a reason for three of the four decisions
// and does NOT require one for APPROVE_INTERPRETATION. The operator
// instruction is that all four human decisions go through the governed reason
// flow, so the client gate covers all four. Tightening the shared backend
// validator would change a governed contract consumed by other lanes and by
// the system auto-approval path, so it is reported rather than changed here.

export { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";

// Maximum reason length accepted by the backend validator, which truncates
// with .slice(0, 500). Mirrored here so the UI never sends a longer value and
// then displays a reason different from the one that was persisted.
export const MAX_GOVERNED_REASON_LENGTH = 500;

export const REASON_GATED_REVIEW_DECISIONS = Object.freeze([
  "APPROVE_INTERPRETATION",
  "EDIT_AND_APPROVE",
  "REJECT_INTERPRETATION",
  "RETURN_TO_REVIEW",
]);

export const REVIEW_DECISION_LABELS = Object.freeze({
  APPROVE_INTERPRETATION: "Approve interpretation",
  EDIT_AND_APPROVE: "Edit and approve",
  REJECT_INTERPRETATION: "Reject interpretation",
  RETURN_TO_REVIEW: "Return to review",
});

export const reviewDecisionLabel = (decision) =>
  REVIEW_DECISION_LABELS[String(decision || "")] || String(decision || "Unknown decision");

// True when this decision must not mutate anything before the engineer has
// confirmed a substantive reason.
export const requiresGovernedReason = (decision) =>
  REASON_GATED_REVIEW_DECISIONS.includes(String(decision || ""));

// Joins the required reason with the optional source/evidence context. An
// absent source never adds dangling punctuation, and a blank reason yields ""
// rather than a separator.
export const composeGovernedReason = (reason, source) => {
  const text = String(reason ?? "").trim();
  const context = String(source ?? "").trim();
  if (!text) return "";
  return context ? `${text} — ${context}` : text;
};

// Single decision point used by the component before any mutation is issued.
//
// Returns either { ok: true, gated, reason } with a trimmed, length-capped
// reason, or { ok: false, gated: true, code, message } -- in which case the
// caller must not call the API. A caller that ignores this result and calls
// the API anyway is still refused by the backend for the three decisions the
// backend gates.
export const evaluateReasonGate = ({ decision, reason, source } = {}) => {
  const composed = composeGovernedReason(reason, source);
  if (!requiresGovernedReason(decision)) {
    return { ok: true, gated: false, decision: String(decision || ""), reason: composed ? composed.slice(0, MAX_GOVERNED_REASON_LENGTH) : null };
  }
  if (composed.length < MIN_GOVERNED_REASON_LENGTH) {
    return {
      ok: false,
      gated: true,
      decision: String(decision || ""),
      code: "REVIEW_REASON_REQUIRED",
      message: `A substantive reason of at least ${MIN_GOVERNED_REASON_LENGTH} characters is required for "${reviewDecisionLabel(decision)}". No decision was recorded.`,
      reason: null,
    };
  }
  return { ok: true, gated: true, decision: String(decision || ""), reason: composed.slice(0, MAX_GOVERNED_REASON_LENGTH) };
};
