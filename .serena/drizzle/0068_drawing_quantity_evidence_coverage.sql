-- Stage 6A (2026-08-31): coverage state is an explicit engineer judgement,
-- never inferred from a count -- a count of 2 approved occurrences means
-- nothing about completeness on its own (Stage 5.6: sheet-wide recall is
-- unknown). Append-only, like every other governed review table in this
-- schema: a new coverage decision INSERTs a new row rather than mutating
-- the previous one in place, so historical coverage state is preserved.
-- The CURRENT coverage state for a recognition version is its latest row.
CREATE TABLE IF NOT EXISTS `drawing_quantity_evidence_coverage` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `recognition_version_id` text NOT NULL,
  `coverage_state` text NOT NULL,
  `reason` text NOT NULL,
  `set_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`recognition_version_id`) REFERENCES `drawing_symbol_recognition_versions`(`id`)
);
CREATE INDEX IF NOT EXISTS `drawing_quantity_evidence_coverage_version_idx` ON `drawing_quantity_evidence_coverage` (`recognition_version_id`,`created_at`);
