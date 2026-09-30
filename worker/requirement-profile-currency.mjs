// Shared by product-matching-api.mjs and confidence-safety-api.mjs so both
// derive "is this match run / safety decision still current" from the exact
// same authoritative relationship -- a match run's (and, transitively, a
// safety decision's) requirement_profile_version_id against the boq item's
// current, non-superseded requirement profile version -- without importing
// across each other (product-matching-api.mjs already imports
// confidence-safety-api.mjs to trigger safety evaluation on match completion).
// Backend & Codebase Consolidation Sprint, item 1: the canonical "current
// requirement profile version" selector -- previously re-typed identically
// (or as a narrower column subset of the same query) in 7 different files.
// Returns the full row; callers that only needed one or two columns
// (id-only, or id/version_number/input_fingerprint) get a strict superset,
// not a different shape, so no caller's existing field access changes.
export const currentRequirementProfile = async (db, boqItemId) => db
  .prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1")
  .bind(boqItemId)
  .first();

export const currentRequirementProfileId = async (db, boqItemId) => {
  const row = await currentRequirementProfile(db, boqItemId);
  return row?.id || null;
};

export const STALE_REQUIREMENT_PROFILE_REASON = "Requirements changed since this product match was run. Re-run product matching to reflect the current requirement profile.";
