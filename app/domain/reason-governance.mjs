// Consolidation Fix Sprint 1, item 5 (originally worker/reason-governance.mjs);
// relocated to app/domain in the Backend & Codebase Consolidation Sprint,
// item 2, because two pure domain engines (confidence-safety-engine.mjs,
// estimator-understanding-review.mjs) needed the same canonical constant
// and app/domain/*.mjs files must never import from worker/*.mjs (the
// established dependency direction throughout this codebase is worker ->
// domain, never the reverse). worker/reason-governance.mjs now re-exports
// this module unchanged, so none of its existing importers needed to move.
//
// The single canonical minimum length for a governed approval/override
// reason. Previously varied 3, 5, or 10 characters across different
// endpoints for what is meant to be the same governance rule ("a
// substantive reason is required for this decision"). 5 was chosen because
// it is stronger than a trivial 3-character reason without over-
// constraining normal engineer actions the way a 10-character minimum did.
// This does not remove or loosen any other governance requirement -- a
// high-risk action that needs more than a length check (e.g.
// confidence-state gating, a domain-specific validator, or a genuinely
// stricter named constant such as MIN_SAFETY_OVERRIDE_REASON_LENGTH below)
// keeps that extra check unchanged; only the shared base length gate is
// unified here.
export const MIN_GOVERNED_REASON_LENGTH = 5;

// Backend & Codebase Consolidation Sprint, item 2: an intentionally
// stricter, named, domain-specific exception -- not a magic number.
// Overriding a mandatory technical/compliance safety block
// (confidence-safety-engine.mjs's validateOverride) is a materially
// higher-risk action than a routine review decision: it lets a candidate
// bypass a blocking eligibility rule. The base MIN_GOVERNED_REASON_LENGTH
// gate applies everywhere else this rule's basic length check is used;
// this constant exists only for the one place that genuinely needs more.
export const MIN_SAFETY_OVERRIDE_REASON_LENGTH = 10;
