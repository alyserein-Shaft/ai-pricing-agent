-- Stage 7.5 (2026-09-01): exception-based sheet-identity review. Only
-- fields the parser could not confidently resolve (status "Needs Review")
-- are ever reviewable here -- a high-confidence field never needs an
-- engineer action (Section 5/6). Append-only, like every other governed
-- review table in this schema: a correction INSERTs a new row rather than
-- mutating a prior one, so the review history is preserved. The CURRENT
-- value for a field is its latest row.
CREATE TABLE IF NOT EXISTS `drawing_title_block_field_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `structure_version_id` text NOT NULL,
  `page_number` integer NOT NULL,
  `field_key` text NOT NULL,
  `value` text,
  `status` text NOT NULL,
  `reason` text NOT NULL,
  `reviewed_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`structure_version_id`) REFERENCES `drawing_structure_versions`(`id`)
);
CREATE INDEX IF NOT EXISTS `drawing_title_block_field_review_idx` ON `drawing_title_block_field_reviews` (`structure_version_id`,`page_number`,`field_key`,`created_at`);
