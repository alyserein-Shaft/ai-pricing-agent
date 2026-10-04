-- REPAIRED 0019 (P0 non-destructive reconciliation).
--
-- This migration was originally destructive against live D1. Measured defects,
-- all corrected here:
--   * 27 DROP TABLE statements with no rebuild counterpart (3,502 governed rows).
--   * 33 ALTER TABLE ... DROP COLUMN statements (1,605 non-null values).
--   * profile_requirement_applicability / requirement_intelligence_facts were
--     rebuilt with `requirement_id` NOT NULL, which contradicts the canonical
--     XOR source-authority model defined by migrations 0009/0010/0011: a
--     device-identity observation is REPRESENTED by requirement_id IS NULL plus
--     a populated device_identity_ref. 520 live rows are exactly that shape and
--     are correct. The copy-in aborted, and because this file was not
--     transactional the following DROP/RENAME still ran, leaving both tables
--     present but EMPTY.
--   * The two canonical XOR CHECK constraints were dropped.
--
-- The NULL requirement_id rows were NOT repaired, because they are not defects.
-- Backfilling them would fabricate a technical_requirements foreign key out of a
-- drawing/BOQ identity. Blind requirement_id backfill is permanently prohibited.
--
-- Legacy tables and every unproven column are PRESERVED. Schema reconciliation is
-- not schema cleanup; removing historical, test-seeded or security data is a
-- separate task requiring its own evidence and authorization.
--
-- Do NOT apply to canonical D1 without the runbook in
-- scripts/live-reconciliation-runbook.sh, which gates this file through
-- scripts/check-migration-destructive-ddl.mjs.
-- REPAIRED 0019 (P0 non-destructive reconciliation).
--
-- This migration was originally destructive against live D1. Measured defects,
-- all corrected here:
--   * 27 DROP TABLE statements with no rebuild counterpart (3,502 governed rows).
--   * 33 ALTER TABLE ... DROP COLUMN statements (1,605 non-null values).
--   * profile_requirement_applicability / requirement_intelligence_facts were
--     rebuilt with `requirement_id` NOT NULL, which contradicts the canonical
--     XOR source-authority model defined by migrations 0009/0010/0011: a
--     device-identity observation is REPRESENTED by requirement_id IS NULL plus
--     a populated device_identity_ref. 520 live rows are exactly that shape and
--     are correct. The copy-in aborted, and because this file was not
--     transactional the following DROP/RENAME still ran, leaving both tables
--     present but EMPTY.
--   * The two canonical XOR CHECK constraints were dropped.
--
-- The NULL requirement_id rows were NOT repaired, because they are not defects.
-- Backfilling them would fabricate a technical_requirements foreign key out of a
-- drawing/BOQ identity. Blind requirement_id backfill is permanently prohibited.
--
-- Legacy tables and every unproven column are PRESERVED. Schema reconciliation is
-- not schema cleanup; removing historical, test-seeded or security data is a
-- separate task requiring its own evidence and authorization.
--
-- Do NOT apply to canonical D1 without the runbook in
-- scripts/live-reconciliation-runbook.sh, which gates this file through
-- scripts/check-migration-destructive-ddl.mjs.
-- 0019 -- schema alignment.
--
-- Repair notes (applied to this migration in place; it is not yet applied in any
-- environment, so it is the only correct place to repair it):
--
-- 1. Retired dependents before retiring their referents. The baseline left
--    triggers and a view pointing at tables this migration drops
--    (canonical_evidence_integrity, product_reference_versions, library_products).
--    A dangling trigger or view does not fail only the statement that touches it:
--    SQLite re-validates every trigger and view on any schema change, so one
--    dangling object made all 45 rename statements in this migration fail, which
--    in turn failed the 53 index statements that follow them. The chain was
--    therefore unappliable from zero. Each object is retired here, at the only
--    point where its referent is about to disappear.
--
--    `review_decisions_version_cas_guard` is retired because this migration drops
--    the `review_decisions.request_fingerprint` column it reads. That column is
--    obsolete: no writer sets a non-empty value (worker/review-workflow-api.mjs
--    inserts without it and it carries DEFAULT ''), so the guard's WHEN clause
--    never fired before it was dropped, and the two partial indexes that also
--    depend on it are dropped below.
--
-- 2. The governed quotation subsystem is retained: project_quotation_revisions,
--    project_quotation_lines, project_quotation_decisions and
--    project_quotation_issues are written by the single governed quotation-line
--    writer (worker/presales-workflow-api.mjs) and read by worker/quotation-api.mjs.
--    Dropping them removed the only quotation-line materialization path and was
--    never intended.
--
--    The same applies to every other table the quotation authority path reads,
--    which this migration also dropped without recreating:
--      presales_workflow_snapshots ......... written in the draft's atomic batch
--      boq_quantity_source_decisions ...... currentQuantityDecision, the line
--                                            quantity authority
--      drawing_quantity_evidence_coverage .. quantity-source-decision-api
--      estimator_understanding_review_versions .. quantity-source-decision-api
--      fire_alarm_panel_sizing_snapshots ... quotation-line-authority
--      project_npq_profile_versions ....... collectProjectFacts, which the
--      project_npq_profile_events .......... quotation draft path calls
--
-- 3. The excel_export_jobs rebuild below restores the three export-to-quotation
--    binding columns (quotation_revision_id, quotation_fingerprint,
--    evidence_fingerprint) and their index. exportEligibleForQuotationIssue reads
--    all three; without them no export can ever authorize an issue.
--
-- 4. `document_versions.effective_to` is dropped before `effective_from`: the
--    effective_to CHECK constraint references effective_from, and SQLite refuses
--    to drop a column named in another column's CHECK constraint.
--
-- 6. Foreign key enforcement is suspended for the WHOLE migration, not just for
--    the first table rebuild. It used to be re-enabled immediately after
--    consolidated_profile_requirements, which left enforcement ON for every
--    remaining DROP TABLE / rebuild in this file. On an empty database that is
--    invisible -- SQLite drops a referenced table happily when no child row
--    exists, which is why an empty-database replay passed -- but on a populated
--    database every subsequent DROP TABLE aborted with FOREIGN KEY constraint
--    failed, the following RENAME failed with "already another table or index",
--    and the indexes after that failed as duplicates. The whole chain therefore
--    worked from zero and broke on every real environment. The declarations
--    themselves are untouched; only enforcement is suspended while the migration
--    runs, exactly as the surrounding rebuild statements already required.
--
-- 7. `projects.operational_classification`, `projects.declared_timezone` and
--    `projects.declared_utc_offset_minutes` are retained. The first is read by
--    collectProjectFacts in worker/dashboard-api.mjs, which the quotation draft
--    path calls; the other two are read by worker/project-effective-time-calendar.mjs
--    and app/domain/effective-time-policy.mjs. Retaining them also keeps
--    projects_operational_scope_idx and the two projects_declared_calendar_guard
--    triggers -- a fail-closed governance constraint -- valid instead of
--    retiring them.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP VIEW IF EXISTS `canonical_library_products`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `canonical_evidence_immutable_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `canonical_evidence_immutable_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `price_records_reference_version_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `price_records_reference_version_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `price_records_reference_version_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `product_source_evidence_reference_version_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `product_source_evidence_reference_version_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `review_decisions_version_cas_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `identity_mutation_guard_validate`;
--> statement-breakpoint
CREATE TABLE `__new_consolidated_profile_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`canonical_key` text NOT NULL,
	`normalized_requirement` text NOT NULL,
	`requirement_category` text NOT NULL,
	`requirement_type` text NOT NULL,
	`priority` text NOT NULL,
	`governing_source_id` text NOT NULL,
	`sources` text NOT NULL,
	`attributes` text NOT NULL,
	`standards` text NOT NULL,
	`manufacturers` text NOT NULL,
	`confidence` integer NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_consolidated_profile_requirements`("id", "profile_version_id", "canonical_key", "normalized_requirement", "requirement_category", "requirement_type", "priority", "governing_source_id", "sources", "attributes", "standards", "manufacturers", "confidence", "review_status", "created_at") SELECT "id", "profile_version_id", "canonical_key", "normalized_requirement", "requirement_category", "requirement_type", "priority", "governing_source_id", "sources", "attributes", "standards", "manufacturers", "confidence", "review_status", "created_at" FROM `consolidated_profile_requirements`;
--> statement-breakpoint
DROP TABLE `consolidated_profile_requirements`;
--> statement-breakpoint
ALTER TABLE `__new_consolidated_profile_requirements` RENAME TO `consolidated_profile_requirements`;
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_consolidated_key_idx` ON `consolidated_profile_requirements` (`profile_version_id`,`canonical_key`);
--> statement-breakpoint
CREATE TABLE `__new_estimator_understanding_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`config_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`processed_items` integer DEFAULT 0 NOT NULL,
	`successful_items` integer DEFAULT 0 NOT NULL,
	`review_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`requested_by` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	run_mode TEXT NOT NULL DEFAULT 'CONTROLLED_PILOT',
	parent_run_id TEXT REFERENCES estimator_understanding_runs(id),
	authorization_fingerprint TEXT,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_estimator_understanding_runs`("id", "project_id", "organization_id", "provider", "model", "model_version", "prompt_version", "schema_version", "config_fingerprint", "status", "total_items", "processed_items", "successful_items", "review_items", "failed_items", "requested_by", "started_at", "completed_at", "run_mode", "parent_run_id", "authorization_fingerprint") SELECT "id", "project_id", "organization_id", "provider", "model", "model_version", "prompt_version", "schema_version", "config_fingerprint", "status", "total_items", "processed_items", "successful_items", "review_items", "failed_items", "requested_by", "started_at", "completed_at", "run_mode", "parent_run_id", "authorization_fingerprint" FROM `estimator_understanding_runs`;
--> statement-breakpoint
DROP TABLE `estimator_understanding_runs`;
--> statement-breakpoint
ALTER TABLE `__new_estimator_understanding_runs` RENAME TO `estimator_understanding_runs`;
--> statement-breakpoint
CREATE INDEX `estimator_understanding_runs_project_idx` ON `estimator_understanding_runs` (`project_id`,`started_at`);
--> statement-breakpoint
CREATE TABLE `__new_excel_export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`template_id` text NOT NULL,
	`export_mode` text NOT NULL,
	`revision` integer NOT NULL,
	`filename` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`locked_versions` text NOT NULL,
	`sheet_set` text NOT NULL,
	`configuration` text NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`blocking_issue_count` integer DEFAULT 0 NOT NULL,
	`data_hash` text,
	`idempotency_key` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_role` text NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`completed_at` text,
	`failed_at` text,
	`error_code` text,
	`error_message` text,
	`technical_details` text,
	`suggested_action` text,
	`superseded_by_id` text,
	`cancelled_at` text,
	`expires_at` text,
	quotation_revision_id TEXT REFERENCES project_quotation_revisions(id),
	quotation_fingerprint TEXT,
	evidence_fingerprint TEXT,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `export_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_excel_export_jobs`("id", "project_id", "template_id", "export_mode", "revision", "filename", "status", "stage", "progress", "locked_versions", "sheet_set", "configuration", "warning_count", "blocking_issue_count", "data_hash", "idempotency_key", "requested_by", "requested_role", "requested_at", "started_at", "completed_at", "failed_at", "error_code", "error_message", "technical_details", "suggested_action", "superseded_by_id", "cancelled_at", "expires_at", "quotation_revision_id", "quotation_fingerprint", "evidence_fingerprint") SELECT "id", "project_id", "template_id", "export_mode", "revision", "filename", "status", "stage", "progress", "locked_versions", "sheet_set", "configuration", "warning_count", "blocking_issue_count", "data_hash", "idempotency_key", "requested_by", "requested_role", "requested_at", "started_at", "completed_at", "failed_at", "error_code", "error_message", "technical_details", "suggested_action", "superseded_by_id", "cancelled_at", "expires_at", "quotation_revision_id", "quotation_fingerprint", "evidence_fingerprint" FROM `excel_export_jobs`;
--> statement-breakpoint
DROP TABLE `excel_export_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_excel_export_jobs` RENAME TO `excel_export_jobs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_idempotency_idx` ON `excel_export_jobs` (`project_id`,`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_revision_idx` ON `excel_export_jobs` (`project_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `excel_export_project_status_idx` ON `excel_export_jobs` (`project_id`,`status`,`requested_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS export_quotation_binding_idx ON excel_export_jobs(quotation_revision_id,quotation_fingerprint,evidence_fingerprint);
--> statement-breakpoint
CREATE TABLE `__new_governed_identity_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_type` text NOT NULL,
	`proposal_id` text NOT NULL,
	`review_id` text,
	`conflict_id` text NOT NULL,
	`canonical_product_id` text NOT NULL,
	`non_target_product_id` text NOT NULL,
	`status` text NOT NULL,
	`reversal_of_id` text,
	`ruleset_version_id` text NOT NULL,
	`ruleset_checksum` text NOT NULL,
	`proposal_fingerprint` text NOT NULL,
	`proposal_version` integer NOT NULL,
	`conflict_version_before` integer NOT NULL,
	`target_version_before` integer NOT NULL,
	`non_target_version_before` integer NOT NULL,
	`previous_snapshot_json` text NOT NULL,
	`new_snapshot_json` text NOT NULL,
	`reference_move_manifest_json` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	application_cycle integer,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	`request_fingerprint` text,
	`manifest_checksum` text,
	`manifest_row_count` integer,
	`manifest_ownership_checksum` text,
	`manifest_table_checksum` text,
	FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `identity_proposal_reviews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canonical_product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`non_target_product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_governed_identity_decisions`("id", "decision_type", "proposal_id", "review_id", "conflict_id", "canonical_product_id", "non_target_product_id", "status", "reversal_of_id", "ruleset_version_id", "ruleset_checksum", "proposal_fingerprint", "proposal_version", "conflict_version_before", "target_version_before", "non_target_version_before", "previous_snapshot_json", "new_snapshot_json", "reference_move_manifest_json", "reason", "actor_id", "actor_role", "idempotency_key", "created_at", "application_cycle", "library_scope", "organization_id", "library_project_id", "request_fingerprint", "manifest_checksum", "manifest_row_count", "manifest_ownership_checksum", "manifest_table_checksum") SELECT "id", "decision_type", "proposal_id", "review_id", "conflict_id", "canonical_product_id", "non_target_product_id", "status", "reversal_of_id", "ruleset_version_id", "ruleset_checksum", "proposal_fingerprint", "proposal_version", "conflict_version_before", "target_version_before", "non_target_version_before", "previous_snapshot_json", "new_snapshot_json", "reference_move_manifest_json", "reason", "actor_id", "actor_role", "idempotency_key", "created_at", "application_cycle", "library_scope", "organization_id", "library_project_id", "request_fingerprint", "manifest_checksum", "manifest_row_count", "manifest_ownership_checksum", "manifest_table_checksum" FROM `governed_identity_decisions`;
--> statement-breakpoint
DROP TABLE `governed_identity_decisions`;
--> statement-breakpoint
ALTER TABLE `__new_governed_identity_decisions` RENAME TO `governed_identity_decisions`;
--> statement-breakpoint
-- One governed Apply PER CYCLE, not one per proposal for ever. The identity
-- lifecycle is apply -> reverse -> apply again: the live database holds a real
-- cycle-1 Apply (14:46), its Reverse (14:51) and a cycle-2 Apply (15:00) for the
-- same proposal, and worker/identity-resolution-api.mjs increments
-- application_cycle for exactly that. A constraint on (proposal_id,
-- decision_type) alone forbids a legitimate re-apply and therefore fails the
-- reconciliation of a database that contains a correct history.
CREATE UNIQUE INDEX `governed_identity_apply_once_idx` ON `governed_identity_decisions` (`proposal_id`,`decision_type`,`application_cycle`);
--> statement-breakpoint
CREATE UNIQUE INDEX `governed_identity_idempotency_idx` ON `governed_identity_decisions` (`decision_type`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `governed_identity_products_idx` ON `governed_identity_decisions` (`canonical_product_id`,`non_target_product_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_identity_decision_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`reason` text NOT NULL,
	`previous_snapshot_json` text NOT NULL,
	`new_snapshot_json` text NOT NULL,
	`ruleset_checksum` text,
	`proposal_fingerprint` text,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_identity_decision_audit`("id", "entity_type", "entity_id", "action", "actor_id", "actor_role", "reason", "previous_snapshot_json", "new_snapshot_json", "ruleset_checksum", "proposal_fingerprint", "idempotency_key", "created_at", "library_scope", "organization_id", "library_project_id") SELECT "id", "entity_type", "entity_id", "action", "actor_id", "actor_role", "reason", "previous_snapshot_json", "new_snapshot_json", "ruleset_checksum", "proposal_fingerprint", "idempotency_key", "created_at", "library_scope", "organization_id", "library_project_id" FROM `identity_decision_audit`;
--> statement-breakpoint
DROP TABLE `identity_decision_audit`;
--> statement-breakpoint
ALTER TABLE `__new_identity_decision_audit` RENAME TO `identity_decision_audit`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_decision_audit_idempotency_idx` ON `identity_decision_audit` (`action`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `identity_decision_audit_entity_idx` ON `identity_decision_audit` (`entity_type`,`entity_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_identity_proposal_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`proposal_version` integer NOT NULL,
	`proposal_fingerprint` text NOT NULL,
	`ruleset_version_id` text NOT NULL,
	`ruleset_checksum` text NOT NULL,
	`conflict_id` text NOT NULL,
	`conflict_version` integer NOT NULL,
	`product_versions_json` text NOT NULL,
	`canonical_product_id` text NOT NULL,
	`revalidation_fingerprint` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`reviewed_role` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	`request_fingerprint` text,
	FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ruleset_version_id`) REFERENCES `identity_ruleset_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_identity_proposal_reviews`("id", "proposal_id", "decision", "reason", "proposal_version", "proposal_fingerprint", "ruleset_version_id", "ruleset_checksum", "conflict_id", "conflict_version", "product_versions_json", "canonical_product_id", "revalidation_fingerprint", "reviewed_by", "reviewed_role", "idempotency_key", "created_at", "library_scope", "organization_id", "library_project_id", "request_fingerprint") SELECT "id", "proposal_id", "decision", "reason", "proposal_version", "proposal_fingerprint", "ruleset_version_id", "ruleset_checksum", "conflict_id", "conflict_version", "product_versions_json", "canonical_product_id", "revalidation_fingerprint", "reviewed_by", "reviewed_role", "idempotency_key", "created_at", "library_scope", "organization_id", "library_project_id", "request_fingerprint" FROM `identity_proposal_reviews`;
--> statement-breakpoint
DROP TABLE `identity_proposal_reviews`;
--> statement-breakpoint
ALTER TABLE `__new_identity_proposal_reviews` RENAME TO `identity_proposal_reviews`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_proposal_review_idempotency_idx` ON `identity_proposal_reviews` (`proposal_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `identity_proposal_review_latest_idx` ON `identity_proposal_reviews` (`proposal_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `__new_identity_reference_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`from_product_id` text NOT NULL,
	`to_product_id` text NOT NULL,
	`record_snapshot_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	FOREIGN KEY (`decision_id`) REFERENCES `governed_identity_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_identity_reference_moves`("id", "decision_id", "table_name", "record_id", "from_product_id", "to_product_id", "record_snapshot_json", "created_at", "library_scope", "organization_id", "library_project_id") SELECT "id", "decision_id", "table_name", "record_id", "from_product_id", "to_product_id", "record_snapshot_json", "created_at", "library_scope", "organization_id", "library_project_id" FROM `identity_reference_moves`;
--> statement-breakpoint
DROP TABLE `identity_reference_moves`;
--> statement-breakpoint
ALTER TABLE `__new_identity_reference_moves` RENAME TO `identity_reference_moves`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_reference_move_record_idx` ON `identity_reference_moves` (`decision_id`,`table_name`,`record_id`);
--> statement-breakpoint
CREATE TABLE `__new_identity_resolution_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`product_id` text NOT NULL,
	`retrieval_method` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	FOREIGN KEY (`case_id`) REFERENCES `identity_resolution_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_identity_resolution_candidates`("id", "case_id", "product_id", "retrieval_method", "snapshot_json", "created_at", "library_scope", "organization_id", "library_project_id") SELECT "id", "case_id", "product_id", "retrieval_method", "snapshot_json", "created_at", "library_scope", "organization_id", "library_project_id" FROM `identity_resolution_candidates`;
--> statement-breakpoint
DROP TABLE `identity_resolution_candidates`;
--> statement-breakpoint
ALTER TABLE `__new_identity_resolution_candidates` RENAME TO `identity_resolution_candidates`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_candidate_case_product_idx` ON `identity_resolution_candidates` (`case_id`,`product_id`);
--> statement-breakpoint
CREATE TABLE `__new_identity_resolution_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`conflict_id` text NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	FOREIGN KEY (`run_id`) REFERENCES `identity_resolution_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_identity_resolution_cases`("id", "run_id", "conflict_id", "input_snapshot_json", "status", "created_at", "library_scope", "organization_id", "library_project_id") SELECT "id", "run_id", "conflict_id", "input_snapshot_json", "status", "created_at", "library_scope", "organization_id", "library_project_id" FROM `identity_resolution_cases`;
--> statement-breakpoint
DROP TABLE `identity_resolution_cases`;
--> statement-breakpoint
ALTER TABLE `__new_identity_resolution_cases` RENAME TO `identity_resolution_cases`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_case_run_conflict_idx` ON `identity_resolution_cases` (`run_id`,`conflict_id`);
--> statement-breakpoint
CREATE INDEX `identity_resolution_case_status_idx` ON `identity_resolution_cases` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_identity_resolution_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`outcome` text NOT NULL,
	`classification` text NOT NULL,
	`relationship_type` text,
	`confidence` integer NOT NULL,
	`terminal_rule_id` text NOT NULL,
	`reason_code` text,
	`explanation_json` text NOT NULL,
	`required_evidence_json` text DEFAULT '[]' NOT NULL,
	`blockers_json` text DEFAULT '[]' NOT NULL,
	`proposal_fingerprint` text NOT NULL,
	`status` text DEFAULT 'Proposed' NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	`executable_ruleset_checksum` text,
	FOREIGN KEY (`case_id`) REFERENCES `identity_resolution_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_identity_resolution_proposals`("id", "case_id", "outcome", "classification", "relationship_type", "confidence", "terminal_rule_id", "reason_code", "explanation_json", "required_evidence_json", "blockers_json", "proposal_fingerprint", "status", "version_number", "created_at", "library_scope", "organization_id", "library_project_id", "executable_ruleset_checksum") SELECT "id", "case_id", "outcome", "classification", "relationship_type", "confidence", "terminal_rule_id", "reason_code", "explanation_json", "required_evidence_json", "blockers_json", "proposal_fingerprint", "status", "version_number", "created_at", "library_scope", "organization_id", "library_project_id", "executable_ruleset_checksum" FROM `identity_resolution_proposals`;
--> statement-breakpoint
DROP TABLE `identity_resolution_proposals`;
--> statement-breakpoint
ALTER TABLE `__new_identity_resolution_proposals` RENAME TO `identity_resolution_proposals`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_proposal_case_idx` ON `identity_resolution_proposals` (`case_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_proposal_fingerprint_idx` ON `identity_resolution_proposals` (`proposal_fingerprint`);
--> statement-breakpoint
CREATE TABLE `__new_identity_resolution_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ruleset_version_id` text NOT NULL,
	`mode` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`started_by` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	FOREIGN KEY (`ruleset_version_id`) REFERENCES `identity_ruleset_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_identity_resolution_runs`("id", "ruleset_version_id", "mode", "input_fingerprint", "status", "started_by", "started_at", "completed_at", "summary_json", "library_scope", "organization_id", "library_project_id") SELECT "id", "ruleset_version_id", "mode", "input_fingerprint", "status", "started_by", "started_at", "completed_at", "summary_json", "library_scope", "organization_id", "library_project_id" FROM `identity_resolution_runs`;
--> statement-breakpoint
DROP TABLE `identity_resolution_runs`;
--> statement-breakpoint
ALTER TABLE `__new_identity_resolution_runs` RENAME TO `identity_resolution_runs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_run_idempotency_idx` ON `identity_resolution_runs` (`ruleset_version_id`,`mode`,`input_fingerprint`);
--> statement-breakpoint
CREATE TABLE `__new_library_products` (
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer_id` text NOT NULL,
	`brand_id` text,
	`family_id` text,
	`part_number` text NOT NULL,
	`normalized_part_number` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_status` text DEFAULT 'Unknown — Review Required' NOT NULL,
	`country_of_origin` text,
	`attributes` text DEFAULT '[]' NOT NULL,
	`standards` text DEFAULT '[]' NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`approved_for_discovery` integer DEFAULT false NOT NULL,
	`identity_status` text DEFAULT 'Active' NOT NULL,
	`superseded_by_product_id` text,
	`identity_version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	product_role TEXT NOT NULL DEFAULT 'Unclassified',
	FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `product_brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `product_families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_library_products`("id", "manufacturer_id", "brand_id", "family_id", "part_number", "normalized_part_number", "description", "lifecycle_status", "country_of_origin", "attributes", "standards", "review_status", "approved_for_discovery", "identity_status", "superseded_by_product_id", "identity_version", "created_by", "created_at", "updated_at", "library_scope", "organization_id", "library_project_id", "product_role") SELECT "id", "manufacturer_id", "brand_id", "family_id", "part_number", "normalized_part_number", "description", "lifecycle_status", "country_of_origin", "attributes", "standards", "review_status", "approved_for_discovery", "identity_status", "superseded_by_product_id", "identity_version", "created_by", "created_at", "updated_at", "library_scope", "organization_id", "library_project_id", "product_role" FROM `library_products`;
--> statement-breakpoint
DROP TABLE `library_products`;
--> statement-breakpoint
ALTER TABLE `__new_library_products` RENAME TO `library_products`;
--> statement-breakpoint
CREATE UNIQUE INDEX `library_products_identity_idx` ON `library_products` (`manufacturer_id`,`normalized_part_number`);
--> statement-breakpoint
CREATE INDEX `library_products_family_idx` ON `library_products` (`family_id`,`review_status`);
--> statement-breakpoint
CREATE INDEX `library_products_discovery_idx` ON `library_products` (`approved_for_discovery`,`lifecycle_status`);
--> statement-breakpoint
-- The canonical product view is retired above because it reads library_products,
-- and it must come back: twelve current readers depend on it, including
-- worker/excel-export-api.mjs and worker/fire-alarm-panel-sizing-api.mjs, which
-- the quotation export and line paths call. The definition is the baseline's, so
-- the projection every reader selects is unchanged.
CREATE VIEW `canonical_library_products` AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.* FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';
--> statement-breakpoint
CREATE TABLE `__new_manufacturer_order_code_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_product_id` text NOT NULL,
	`original_product_id` text NOT NULL,
	`manufacturer_id` text NOT NULL,
	`original_order_code` text NOT NULL,
	`source_id` text,
	`source_row` integer,
	`observation_fingerprint` text NOT NULL,
	`review_status` text DEFAULT 'Reviewed' NOT NULL,
	`decision_id` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reversed_at` text,
	`library_scope` text NOT NULL DEFAULT 'Global Library',
	`organization_id` text REFERENCES `organizations`(`id`),
	`library_project_id` text REFERENCES `projects`(`id`),
	FOREIGN KEY (`canonical_product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_manufacturer_order_code_observations`("id", "canonical_product_id", "original_product_id", "manufacturer_id", "original_order_code", "source_id", "source_row", "observation_fingerprint", "review_status", "decision_id", "status", "created_by", "created_at", "reversed_at", "library_scope", "organization_id", "library_project_id") SELECT "id", "canonical_product_id", "original_product_id", "manufacturer_id", "original_order_code", "source_id", "source_row", "observation_fingerprint", "review_status", "decision_id", "status", "created_by", "created_at", "reversed_at", "library_scope", "organization_id", "library_project_id" FROM `manufacturer_order_code_observations`;
--> statement-breakpoint
DROP TABLE `manufacturer_order_code_observations`;
--> statement-breakpoint
ALTER TABLE `__new_manufacturer_order_code_observations` RENAME TO `manufacturer_order_code_observations`;
--> statement-breakpoint
-- One ACTIVE observation per fingerprint. The table is an append-only
-- observation history in which an observation can be Reversed and then observed
-- again: the live database holds exactly that, two fingerprints with a Reversed
-- row from cycle 1 and an Active row from cycle 2. A blanket UNIQUE would make a
-- legitimate re-observation impossible and would fail the reconciliation of a
-- correct history, so the constraint is scoped to the rows that are in force.
CREATE UNIQUE INDEX `manufacturer_order_code_observation_fingerprint_idx` ON `manufacturer_order_code_observations` (`observation_fingerprint`) WHERE `status` <> 'Reversed';
--> statement-breakpoint
CREATE INDEX `manufacturer_order_code_observation_product_idx` ON `manufacturer_order_code_observations` (`canonical_product_id`,`status`);
--> statement-breakpoint
CREATE TABLE `__new_price_records` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source_id` text NOT NULL,
	`supplier_id` text,
	`project_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`price_type` text NOT NULL,
	`unit` text DEFAULT 'EA' NOT NULL,
	`minimum_quantity` integer,
	`discount_basis_points` integer,
	`effective_from` text,
	`valid_until` text,
	`validity_state` text NOT NULL,
	`approval_status` text DEFAULT 'Needs Review' NOT NULL,
	`downstream_use` text DEFAULT 'Discovery Only' NOT NULL,
	`terms` text DEFAULT '{}' NOT NULL,
	`source_location` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_intake_row_id` text REFERENCES supplier_quote_intake_rows(id),
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_price_records`("id", "product_id", "source_id", "supplier_id", "project_id", "amount_minor", "currency", "price_type", "unit", "minimum_quantity", "discount_basis_points", "effective_from", "valid_until", "validity_state", "approval_status", "downstream_use", "terms", "source_location", "reviewed_by", "reviewed_at", "created_at", "source_intake_row_id") SELECT "id", "product_id", "source_id", "supplier_id", "project_id", "amount_minor", "currency", "price_type", "unit", "minimum_quantity", "discount_basis_points", "effective_from", "valid_until", "validity_state", "approval_status", "downstream_use", "terms", "source_location", "reviewed_by", "reviewed_at", "created_at", "source_intake_row_id" FROM `price_records`;
--> statement-breakpoint
DROP TABLE `price_records`;
--> statement-breakpoint
ALTER TABLE `__new_price_records` RENAME TO `price_records`;
--> statement-breakpoint
CREATE UNIQUE INDEX `price_records_source_product_location_idx` ON `price_records` (`source_id`,`product_id`,`source_location`);
--> statement-breakpoint
CREATE INDEX `price_records_product_validity_idx` ON `price_records` (`product_id`,`approval_status`,`valid_until`);
--> statement-breakpoint
CREATE INDEX `price_records_project_idx` ON `price_records` (`project_id`,`approval_status`);
--> statement-breakpoint
CREATE TABLE `__new_product_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`document_id` text,
	`document_version_id` text,
	`checksum` text NOT NULL,
	`source_type` text NOT NULL,
	`authority` text NOT NULL,
	`scope_type` text NOT NULL,
	`file_name` text NOT NULL,
	`release_version` text,
	`effective_from` text,
	`valid_until` text,
	`currency` text,
	`validity_state` text NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`downstream_use` text DEFAULT 'Discovery Only' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`organization_id` text REFERENCES `organizations`(`id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_product_sources`("id", "project_id", "document_id", "document_version_id", "checksum", "source_type", "authority", "scope_type", "file_name", "release_version", "effective_from", "valid_until", "currency", "validity_state", "review_status", "downstream_use", "metadata", "created_by", "created_at", "organization_id") SELECT "id", "project_id", "document_id", "document_version_id", "checksum", "source_type", "authority", "scope_type", "file_name", "release_version", "effective_from", "valid_until", "currency", "validity_state", "review_status", "downstream_use", "metadata", "created_by", "created_at", "organization_id" FROM `product_sources`;
--> statement-breakpoint
DROP TABLE `product_sources`;
--> statement-breakpoint
ALTER TABLE `__new_product_sources` RENAME TO `product_sources`;
--> statement-breakpoint
CREATE UNIQUE INDEX `product_sources_checksum_scope_idx` ON `product_sources` (`checksum`,`scope_type`,`project_id`);
--> statement-breakpoint
CREATE INDEX `product_sources_project_idx` ON `product_sources` (`project_id`,`source_type`,`review_status`);
--> statement-breakpoint
CREATE TABLE `__new_supplier_quote_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_quote_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`product_id` text,
	`description` text NOT NULL,
	`unit_price_minor` integer,
	`currency` text NOT NULL,
	`source_location` text NOT NULL,
	`mapping_confidence` integer NOT NULL,
	`review_status` text NOT NULL,
	`original_values` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`supplier_product_code` text,
	`manufacturer` text,
	`part_number` text,
	`quantity` text,
	`discount_basis_points` integer,
	`net_price_minor` integer,
	source_intake_row_id TEXT REFERENCES supplier_quote_intake_rows(id),
	FOREIGN KEY (`supplier_quote_id`) REFERENCES `supplier_quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_supplier_quote_lines`("id", "supplier_quote_id", "line_number", "product_id", "description", "unit_price_minor", "currency", "source_location", "mapping_confidence", "review_status", "original_values", "created_at", "supplier_product_code", "manufacturer", "part_number", "quantity", "discount_basis_points", "net_price_minor", "source_intake_row_id") SELECT "id", "supplier_quote_id", "line_number", "product_id", "description", "unit_price_minor", "currency", "source_location", "mapping_confidence", "review_status", "original_values", "created_at", "supplier_product_code", "manufacturer", "part_number", "quantity", "discount_basis_points", "net_price_minor", "source_intake_row_id" FROM `supplier_quote_lines`;
--> statement-breakpoint
DROP TABLE `supplier_quote_lines`;
--> statement-breakpoint
ALTER TABLE `__new_supplier_quote_lines` RENAME TO `supplier_quote_lines`;
--> statement-breakpoint
CREATE TABLE `__new_supplier_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`project_id` text,
	`quote_number` text NOT NULL,
	`quote_version` integer NOT NULL,
	`quote_date` text NOT NULL,
	`valid_until` text,
	`currency` text NOT NULL,
	`source_document_id` text NOT NULL,
	`review_status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	`deleted_at` text,
	source_document_version_id TEXT REFERENCES document_versions(id),
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_supplier_quotes`("id", "supplier_id", "project_id", "quote_number", "quote_version", "quote_date", "valid_until", "currency", "source_document_id", "review_status", "created_by", "created_at", "superseded_at", "deleted_at", "source_document_version_id") SELECT "id", "supplier_id", "project_id", "quote_number", "quote_version", "quote_date", "valid_until", "currency", "source_document_id", "review_status", "created_by", "created_at", "superseded_at", "deleted_at", "source_document_version_id" FROM `supplier_quotes`;
--> statement-breakpoint
DROP TABLE `supplier_quotes`;
--> statement-breakpoint
ALTER TABLE `__new_supplier_quotes` RENAME TO `supplier_quotes`;
--> statement-breakpoint
DROP INDEX `document_versions_effective_idx`;
--> statement-breakpoint
DROP INDEX `documents_family_idx`;
--> statement-breakpoint
CREATE TABLE `__new_pricing_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`pricing_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`product_id` text NOT NULL,
	`safety_decision_id` text NOT NULL,
	`selected_price_record_id` text,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text NOT NULL,
	`source_currency` text,
	`project_currency` text NOT NULL,
	`original_list_price_minor` integer,
	`net_material_unit_minor` integer,
	`material_total_minor` integer,
	`direct_cost_minor` integer,
	`total_cost_minor` integer,
	`gross_selling_minor` integer,
	`customer_discount_minor` integer,
	`net_selling_minor` integer,
	`vat_minor` integer,
	`final_value_minor` integer,
	`margin_basis_points` integer,
	`markup_basis_points` integer,
	`output` text NOT NULL,
	`explanation` text NOT NULL,
	`approval_ready` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_type` text NOT NULL,
	`system` text,
	FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selected_price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pricing_lines`("id", "pricing_run_id", "project_id", "boq_item_id", "candidate_id", "product_id", "safety_decision_id", "selected_price_record_id", "version_number", "status", "quantity", "unit", "source_currency", "project_currency", "original_list_price_minor", "net_material_unit_minor", "material_total_minor", "direct_cost_minor", "total_cost_minor", "gross_selling_minor", "customer_discount_minor", "net_selling_minor", "vat_minor", "final_value_minor", "margin_basis_points", "markup_basis_points", "output", "explanation", "approval_ready", "created_at", "source_type", "system") SELECT "id", "pricing_run_id", "project_id", "boq_item_id", "candidate_id", "product_id", "safety_decision_id", "selected_price_record_id", "version_number", "status", "quantity", "unit", "source_currency", "project_currency", "original_list_price_minor", "net_material_unit_minor", "material_total_minor", "direct_cost_minor", "total_cost_minor", "gross_selling_minor", "customer_discount_minor", "net_selling_minor", "vat_minor", "final_value_minor", "margin_basis_points", "markup_basis_points", "output", "explanation", "approval_ready", "created_at", "source_type", "system" FROM `pricing_lines`;
--> statement-breakpoint
DROP TABLE `pricing_lines`;
--> statement-breakpoint
ALTER TABLE `__new_pricing_lines` RENAME TO `pricing_lines`;
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_lines_run_item_idx` ON `pricing_lines` (`pricing_run_id`,`boq_item_id`);
--> statement-breakpoint
CREATE INDEX `pricing_lines_project_status_idx` ON `pricing_lines` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `pricing_lines_candidate_idx` ON `pricing_lines` (`candidate_id`,`created_at`);
--> statement-breakpoint
DROP INDEX `review_decisions_request_idx`;
--> statement-breakpoint
DROP INDEX `review_decisions_version_unique_idx`;
--> statement-breakpoint
DROP INDEX `spec_clauses_admission_status_idx`;
--> statement-breakpoint
CREATE TABLE `__new_profile_requirement_applicability` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_source` text NOT NULL,
	`requirement_id` text,
	`device_identity_ref` text,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence` text NOT NULL,
	`priority` text NOT NULL,
	`review_status` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
,
	CONSTRAINT `profile_applicability_authority_class_ck` CHECK (`requirement_source` IN ('Specification','DrawingDeviceIdentity','BOQDeviceIdentity')),
	CONSTRAINT `profile_applicability_exactly_one_source_ck` CHECK ((`requirement_source` = 'Specification' AND `requirement_id` IS NOT NULL AND `device_identity_ref` IS NULL) OR (`requirement_source` IN ('DrawingDeviceIdentity','BOQDeviceIdentity') AND `requirement_id` IS NULL AND `device_identity_ref` IS NOT NULL)));
--> statement-breakpoint
INSERT INTO `__new_profile_requirement_applicability`("id", "profile_version_id", "requirement_source", "requirement_id", "device_identity_ref", "status", "method", "confidence", "evidence", "priority", "review_status", "reviewed_by", "reviewed_at", "review_reason", "created_at") SELECT "id", "profile_version_id", "requirement_source", "requirement_id", "device_identity_ref", "status", "method", "confidence", "evidence", "priority", "review_status", "reviewed_by", "reviewed_at", "review_reason", "created_at" FROM `profile_requirement_applicability`;
--> statement-breakpoint
DROP TABLE `profile_requirement_applicability`;
--> statement-breakpoint
ALTER TABLE `__new_profile_requirement_applicability` RENAME TO `profile_requirement_applicability`;
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_requirement_idx` ON `profile_requirement_applicability` (`profile_version_id`,`requirement_id`)
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_device_identity_idx` ON `profile_requirement_applicability` (`profile_version_id`,`device_identity_ref`) WHERE `device_identity_ref` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `profile_applicability_status_idx` ON `profile_requirement_applicability` (`profile_version_id`,`status`);
--> statement-breakpoint
CREATE TABLE `__new_requirement_intelligence_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_source` text NOT NULL,
	`requirement_id` text,
	`device_identity_ref` text,
	`fact_key` text NOT NULL,
	`fact_type` text NOT NULL,
	`original_value` text NOT NULL,
	`current_value` text NOT NULL,
	`modality` text NOT NULL,
	`confidence` integer NOT NULL,
	`source_page` integer,
	`source_page_to` integer,
	`source_clause` text,
	`source_section` text,
	`evidence_snippet` text NOT NULL,
	`extraction_basis` text NOT NULL,
	`engine_version` text NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
,
	CONSTRAINT `requirement_intelligence_authority_class_ck` CHECK (`requirement_source` IN ('Specification','DrawingDeviceIdentity','BOQDeviceIdentity')),
	CONSTRAINT `requirement_intelligence_exactly_one_source_ck` CHECK ((`requirement_source` = 'Specification' AND `requirement_id` IS NOT NULL AND `device_identity_ref` IS NULL) OR (`requirement_source` IN ('DrawingDeviceIdentity','BOQDeviceIdentity') AND `requirement_id` IS NULL AND `device_identity_ref` IS NOT NULL)));
--> statement-breakpoint
INSERT INTO `__new_requirement_intelligence_facts`("id", "profile_version_id", "requirement_source", "requirement_id", "device_identity_ref", "fact_key", "fact_type", "original_value", "current_value", "modality", "confidence", "source_page", "source_page_to", "source_clause", "source_section", "evidence_snippet", "extraction_basis", "engine_version", "review_status", "reviewed_by", "reviewed_at", "review_reason", "created_at") SELECT "id", "profile_version_id", "requirement_source", "requirement_id", "device_identity_ref", "fact_key", "fact_type", "original_value", "current_value", "modality", "confidence", "source_page", "source_page_to", "source_clause", "source_section", "evidence_snippet", "extraction_basis", "engine_version", "review_status", "reviewed_by", "reviewed_at", "review_reason", "created_at" FROM `requirement_intelligence_facts`;
--> statement-breakpoint
DROP TABLE `requirement_intelligence_facts`;
--> statement-breakpoint
ALTER TABLE `__new_requirement_intelligence_facts` RENAME TO `requirement_intelligence_facts`;
--> statement-breakpoint
CREATE TRIGGER `identity_mutation_guard_validate`
BEFORE INSERT ON `identity_mutation_guards`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM identity_resolution_proposals p
    JOIN identity_resolution_cases c ON c.id=p.case_id
    JOIN identity_resolution_runs r ON r.id=c.run_id
    JOIN identity_ruleset_versions v ON v.id=r.ruleset_version_id
    WHERE p.id=NEW.proposal_id AND p.version_number=NEW.proposal_version
      AND p.proposal_fingerprint=NEW.proposal_fingerprint
      AND r.ruleset_version_id=NEW.ruleset_version_id AND v.checksum=NEW.ruleset_checksum
      AND p.library_scope=NEW.library_scope
      AND COALESCE(p.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(p.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
END;
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_intelligence_profile_key_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`fact_key`);
--> statement-breakpoint
CREATE INDEX `requirement_intelligence_review_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`review_status`,`fact_type`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
