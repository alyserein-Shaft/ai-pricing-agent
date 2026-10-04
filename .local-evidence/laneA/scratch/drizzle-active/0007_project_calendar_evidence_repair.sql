-- DOC-R3 CHECK A -- evidence repair for the 0006 calendar backfill.
--
-- Why this migration exists
-- -------------------------
-- The first revision of 0006 stamped `Asia/Riyadh` + 180 on EVERY project row
-- lacking a declaration. DOC-R3 CHECK A (docs/DOC-R3-checkA-timezone-backfill-audit.md)
-- proved that fabricated timezone meaning for 16 of 23 Golden projects: scratch
-- names ("dfg", "Test", "hh"), test journeys ("Golden Full Journey"), validation
-- fixtures, and intake tests, none carrying any jurisdiction evidence. A blanket
-- stamp is a universal legacy default no matter what comment sits above it.
--
-- 0006 itself is corrected to an evidence-scoped backfill (current, Confirmed
-- NPQ with country 'Saudi Arabia'). But databases on which the blanket revision
-- already ran still carry the fabricated rows, and editing 0006 cannot reach
-- back into them. This migration repairs them forward.
--
-- What it NULLs, exactly
-- -----------------------
-- Only the fabrication signature: rows declaring `Asia/Riyadh` + 180 that have
-- NO supporting evidence (no current Confirmed Saudi NPQ). Consequences:
--   * Human declarations WITH evidence are kept (EXISTS succeeds, row skipped).
--   * Deliberate non-Riyadh declarations are untouched (different signature).
--   * A deliberate Riyadh declaration WITHOUT evidence is nulled. That is
--     correct, not collateral: without evidence it is indistinguishable from
--     the fabrication, and the policy requires UNKNOWN to be undeclared.
--
-- Undeclared projects fail closed (PROJECT_CALENDAR_UNDECLARED) wherever a
-- timezone is required. That is the safe state: nothing in production resolves
-- a project calendar implicitly, so NULL rows change no current behavior; they
-- wait for project configuration instead of inheriting a neighbor's zone.
--
-- Apply safety: UPDATE only, no schema change, no deletes. The statement is
-- idempotent (re-running NULLs nothing further) and touches only rows matching
-- the fabrication signature.
--> statement-breakpoint
UPDATE `projects` SET `declared_timezone` = NULL, `declared_utc_offset_minutes` = NULL WHERE `declared_timezone` = 'Asia/Riyadh' AND `declared_utc_offset_minutes` = 180 AND NOT EXISTS (
  SELECT 1 FROM `project_npq_profile_versions` `npq`
   WHERE `npq`.`project_id` = `projects`.`id`
     AND `npq`.`superseded_at` IS NULL
     AND `npq`.`status` = 'Confirmed'
     AND `npq`.`country` = 'Saudi Arabia'
);
