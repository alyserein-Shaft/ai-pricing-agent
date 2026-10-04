-- UNDERSTANDING FIELD-LEVEL GOVERNED CONFIRMATION (R11 Phase 6).
--
-- Why this migration exists
-- -----------------------
-- estimator_understanding_review_versions stores ONE review_status (CHECKed to
-- a single value) behind ONE canonical_interpretation JSON blob, so the current
-- authority model is structurally all-or-nothing. A row whose system/category/
-- productFamily are independently reproducible from its own text still cannot be
-- approved when ANY single attribute carries a value the deterministic policy
-- cannot re-derive (e.g. indoor_outdoor). The policy that enforces this
-- (app/domain/understanding-system-auto-approval.mjs gates 6/7) is intentional
-- and test-pinned and must NOT be weakened -- the missing capability is a place
-- to record a PARTIAL verdict, not a laxer policy.
--
-- Design
-- ------
-- * Granularity is per (interpretation_id, field_key). Pinning to
--   interpretation_id ties each decision to ONE interpretation version, so a
--   newer interpretation can never inherit a stale field confirmation -- the
--   same currentness rule the existing whole-blob approval already uses. No
--   superseded_at bookkeeping is invented.
-- * source_input_fingerprint binds the decision to the input it was made
--   against, so a fingerprint change invalidates it for the same reason it
--   invalidates a whole-blob approval.
-- * proposed_value and confirmed_value are stored separately so a decision can
--   confirm as-is, edit to a different value, or reject, with the audit trail
--   showing what was actually asserted.
-- * decision reuses existing repository review vocabulary.
--
-- The CHECK constraints below are carried in the CHAIN SQL only, exactly as the
-- 0000 baseline carries its own CHECKs: drizzle snapshots do not model them, so
-- they do not appear in 0012_snapshot.json and produce no schema drift. They
-- exist so a row can never assert CONFIRMED or EDITED with no confirmed value.
--
-- Purely additive: no existing table, column, constraint, index or row changes,
-- and no existing reader behaves differently until the canonical resolver is
-- deliberately widened.
-->
--> statement-breakpoint
CREATE TABLE `estimator_understanding_field_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`interpretation_id` text NOT NULL,
	`field_key` text NOT NULL,
	`decision` text NOT NULL,
	`proposed_value` text NOT NULL,
	`confirmed_value` text,
	`source_input_fingerprint` text NOT NULL,
	`review_reason` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interpretation_id`) REFERENCES `estimator_item_interpretations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `estimator_understanding_field_reviews_decision_check` CHECK (`decision` IN ('CONFIRMED','EDITED','REJECTED','UNRESOLVED')),
	CONSTRAINT `estimator_understanding_field_reviews_confirmed_value_check` CHECK (`decision` NOT IN ('CONFIRMED','EDITED') OR `confirmed_value` IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estimator_understanding_field_reviews_interpretation_field_idx` ON `estimator_understanding_field_reviews` (`interpretation_id`,`field_key`);--> statement-breakpoint
CREATE INDEX `estimator_understanding_field_reviews_item_idx` ON `estimator_understanding_field_reviews` (`project_id`,`boq_item_id`);--> statement-breakpoint
CREATE INDEX `estimator_understanding_field_reviews_decision_idx` ON `estimator_understanding_field_reviews` (`project_id`,`decision`);