-- OPERATIONAL POLICY FOUNDATION -- STAGE 1 (2026-09-02).
--
-- Pure DDL, additive only -- matches every prior migration in this schema
-- (no migration performs JS-logic-driven data backfill). Both new columns
-- are nullable-safe defaults so every existing row remains valid without
-- any retroactive classification:
--   * projects.project_type is left NULL (UNSET) for every existing
--     project -- Section 1 explicitly forbids assuming Tender for a
--     project whose type was never recorded.
--   * document_versions.drawing_status defaults to 'UNKNOWN' for every
--     existing document version -- Section 3/9 explicitly forbid guessing
--     a maturity/status that cannot be safely determined from a value that
--     was never normalized.
--
-- Project-type changes are audited through the existing, general-purpose
-- document_audit_events table (see worker/dashboard-api.mjs's "project-type"
-- control operation) -- no separate audit table is introduced here.
ALTER TABLE `projects` ADD `project_type` text;
--> statement-breakpoint
ALTER TABLE `document_versions` ADD `drawing_status` text DEFAULT 'UNKNOWN' NOT NULL;
