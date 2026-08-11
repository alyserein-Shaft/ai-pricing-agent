CREATE TABLE IF NOT EXISTS `requirement_intelligence_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL,
  `requirement_id` text NOT NULL,
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
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`),
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `requirement_intelligence_profile_key_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`fact_key`);
CREATE INDEX IF NOT EXISTS `requirement_intelligence_review_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`review_status`,`fact_type`);

CREATE TRIGGER IF NOT EXISTS `requirement_profile_decisions_immutable_update`
BEFORE UPDATE ON `requirement_profile_decisions`
BEGIN SELECT RAISE(ABORT, 'requirement profile decisions are immutable'); END;

CREATE TRIGGER IF NOT EXISTS `requirement_profile_decisions_immutable_delete`
BEFORE DELETE ON `requirement_profile_decisions`
BEGIN SELECT RAISE(ABORT, 'requirement profile decisions are immutable'); END;
