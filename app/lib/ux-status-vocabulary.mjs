// Common user-facing status vocabulary (Phase 1: status + action clarity).
//
// Backend state machines are NOT changed by this module. It maps the many
// backend/review/readiness states onto one user-facing vocabulary so the
// engineer sees the same words on every page:
//
//   Ready / Needs review / Blocked / Failed / Not started / Stale / Complete
//
// Rules enforced here:
// - Rejected NEVER maps to Needs review (it is a settled adverse decision).
// - Merged NEVER maps to Verified/Done (it is a closed duplicate, not done work).
// - Empty/loading must never read as Complete (callers must pass isLoading).
// Raw backend states stay available via `rawStatus` for Advanced/Diagnostics.

export const UX_STATUS = Object.freeze({
  READY: "Ready",
  NEEDS_REVIEW: "Needs review",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  NOT_STARTED: "Not started",
  STALE: "Stale",
  COMPLETE: "Complete",
  REJECTED: "Rejected",
  CLOSED: "Closed",
});

export const UX_TONE = Object.freeze({
  READY: "review-ready",
  NEEDS_REVIEW: "review-pending",
  BLOCKED: "review-blocked",
  FAILED: "review-blocked",
  NOT_STARTED: "review-neutral",
  STALE: "review-stale",
  COMPLETE: "review-ready",
  REJECTED: "review-blocked",
  CLOSED: "review-neutral",
});

// Backend review_status values -> UX status. Unknown values fail closed to
// Needs review (visible work) rather than Complete.
const REVIEW_STATUS_MAP = Object.freeze({
  Approved: "COMPLETE",
  Accepted: "COMPLETE",
  "Auto Verified": "COMPLETE",
  Verified: "COMPLETE",
  Confirmed: "COMPLETE",
  Completed: "COMPLETE",
  Rejected: "REJECTED",
  Merged: "CLOSED",
  Failed: "FAILED",
  Blocked: "BLOCKED",
  Stale: "STALE",
  RevalidationRequired: "STALE",
});

export function uxStatusForReview(reviewStatus, { isLoading = false, isEmpty = false } = {}) {
  if (isLoading) return "NOT_STARTED";
  const mapped = REVIEW_STATUS_MAP[String(reviewStatus || "")];
  if (mapped) return mapped;
  // Empty with no rows is Not started, never Complete (false-complete guard).
  if (isEmpty) return "NOT_STARTED";
  return "NEEDS_REVIEW";
}

export function uxTone(uxStatus) {
  return UX_TONE[uxStatus] || "review-pending";
}

export function uxLabel(uxStatus) {
  return UX_STATUS[uxStatus] || uxStatus;
}

// Verified/Done buckets must exclude terminal-negative rows.
export function isDoneBucket(reviewStatus) {
  const mapped = REVIEW_STATUS_MAP[String(reviewStatus || "")];
  return mapped === "COMPLETE";
}

export function isClosedNegative(reviewStatus) {
  const mapped = REVIEW_STATUS_MAP[String(reviewStatus || "")];
  return mapped === "REJECTED" || mapped === "CLOSED";
}
