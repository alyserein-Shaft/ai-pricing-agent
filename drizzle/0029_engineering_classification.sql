CREATE TABLE IF NOT EXISTS `engineering_classification_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `requirement_profile_version_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `completeness` integer NOT NULL,
  `matching_readiness` text NOT NULL,
  `blocking_missing_information` text NOT NULL,
  `missing_evidence` text NOT NULL,
  `technical_risks` text NOT NULL,
  `engineering_questions` text NOT NULL,
  `required_human_decisions` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `approved_for_matching` integer DEFAULT 0 NOT NULL,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`),
  FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_classification_item_version_idx` ON `engineering_classification_versions` (`boq_item_id`,`version_number`);
CREATE INDEX IF NOT EXISTS `engineering_classification_current_idx` ON `engineering_classification_versions` (`boq_item_id`,`superseded_at`,`matching_readiness`);

CREATE TABLE IF NOT EXISTS `engineering_classification_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_version_id` text NOT NULL,
  `classification_type` text NOT NULL,
  `value` text,
  `classification_status` text NOT NULL,
  `supporting_fact_ids` text NOT NULL,
  `evidence` text NOT NULL,
  `basis` text NOT NULL,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_version_id`) REFERENCES `engineering_classification_versions`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_classification_decision_type_idx` ON `engineering_classification_decisions` (`classification_version_id`,`classification_type`);
CREATE INDEX IF NOT EXISTS `engineering_classification_decision_review_idx` ON `engineering_classification_decisions` (`classification_version_id`,`review_status`);
