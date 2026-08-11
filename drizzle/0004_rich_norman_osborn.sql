CREATE TABLE `requirement_accessories` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`accessory` text NOT NULL,
	`source_type` text NOT NULL,
	`quantity_rule` text,
	`confidence` integer NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_accessories_idx` ON `requirement_accessories` (`requirement_id`,`accessory`);--> statement-breakpoint
CREATE TABLE `requirement_ambiguities` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`requirement_id` text,
	`original_text` text NOT NULL,
	`reason` text NOT NULL,
	`technical_impact` text NOT NULL,
	`commercial_impact` text NOT NULL,
	`clarification_question` text NOT NULL,
	`blocking` integer NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_ambiguities_version_idx` ON `requirement_ambiguities` (`extraction_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `requirement_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`name` text NOT NULL,
	`operator` text NOT NULL,
	`original_value` text NOT NULL,
	`parsed_value` text,
	`original_unit` text,
	`normalized_value` text,
	`normalized_unit` text,
	`confidence` integer NOT NULL,
	`source_location` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_attributes_name_idx` ON `requirement_attributes` (`requirement_id`,`name`);--> statement-breakpoint
CREATE TABLE `requirement_compatibility` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`source_item` text NOT NULL,
	`target_item` text NOT NULL,
	`relationship_type` text NOT NULL,
	`conditions` text,
	`exceptions` text,
	`mandatory` integer NOT NULL,
	`confidence` integer NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_compatibility_idx` ON `requirement_compatibility` (`requirement_id`,`relationship_type`);--> statement-breakpoint
CREATE TABLE `requirement_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`left_requirement_id` text,
	`right_requirement_id` text,
	`conflict_type` text NOT NULL,
	`attribute` text,
	`left_value` text,
	`right_value` text,
	`severity` text NOT NULL,
	`impact` text NOT NULL,
	`blocking` integer DEFAULT true NOT NULL,
	`recommended_resolution` text NOT NULL,
	`resolution_status` text DEFAULT 'Open' NOT NULL,
	`resolution_decision` text,
	`resolved_by` text,
	`resolved_at` text,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`left_requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`right_requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_conflicts_version_idx` ON `requirement_conflicts` (`extraction_version_id`,`resolution_status`);--> statement-breakpoint
CREATE TABLE `requirement_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`requirement_id` text,
	`evidence_type` text NOT NULL,
	`source_location` text NOT NULL,
	`original_text` text NOT NULL,
	`extraction_method` text NOT NULL,
	`confidence` integer NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_evidence_idx` ON `requirement_evidence` (`requirement_id`,`evidence_type`);--> statement-breakpoint
CREATE TABLE `requirement_manufacturers` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`manufacturer` text NOT NULL,
	`status` text NOT NULL,
	`scope` text,
	`conditions` text,
	`product_family` text,
	`confidence` integer NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_manufacturers_idx` ON `requirement_manufacturers` (`requirement_id`,`manufacturer`);--> statement-breakpoint
CREATE TABLE `requirement_missing_information` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`requirement_id` text,
	`field` text NOT NULL,
	`reason_required` text NOT NULL,
	`technical_impact` text NOT NULL,
	`commercial_impact` text NOT NULL,
	`blocking` integer NOT NULL,
	`clarification_question` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_missing_version_idx` ON `requirement_missing_information` (`extraction_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `requirement_review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`requirement_id` text,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`evidence` text,
	`decided_by` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_review_decisions_idx` ON `requirement_review_decisions` (`requirement_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `requirement_standards` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`body` text NOT NULL,
	`number` text,
	`part` text,
	`year` text,
	`original_text` text NOT NULL,
	`status` text NOT NULL,
	`confidence` integer NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requirement_standards_body_idx` ON `requirement_standards` (`body`,`number`);--> statement-breakpoint
CREATE INDEX `requirement_standards_requirement_idx` ON `requirement_standards` (`requirement_id`);--> statement-breakpoint
CREATE TABLE `specification_clauses` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`number` text,
	`title` text,
	`page_from` integer,
	`page_to` integer,
	`path` text NOT NULL,
	`original_text` text NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_clauses_sequence_idx` ON `specification_clauses` (`extraction_version_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `spec_clauses_number_idx` ON `specification_clauses` (`extraction_version_id`,`number`);--> statement-breakpoint
CREATE TABLE `specification_extraction_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`document_version_id` text NOT NULL,
	`classification_id` text,
	`processing_run_id` text,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`parser_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`ocr_version` text NOT NULL,
	`extraction_method` text,
	`summary` text DEFAULT '{}' NOT NULL,
	`error_code` text,
	`error_message` text,
	`technical_details` text,
	`suggested_action` text,
	`superseded_at` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_extraction_version_number_idx` ON `specification_extraction_versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `spec_extraction_document_idx` ON `specification_extraction_versions` (`document_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `specification_revision_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous_extraction_version_id` text NOT NULL,
	`current_extraction_version_id` text NOT NULL,
	`added_count` integer NOT NULL,
	`removed_count` integer NOT NULL,
	`changed_count` integer NOT NULL,
	`changes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_revision_pair_idx` ON `specification_revision_comparisons` (`previous_extraction_version_id`,`current_extraction_version_id`);--> statement-breakpoint
CREATE TABLE `specification_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`number` text,
	`title` text NOT NULL,
	`level` integer NOT NULL,
	`page` integer,
	`path` text NOT NULL,
	`source_text` text NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_sections_sequence_idx` ON `specification_sections` (`extraction_version_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `technical_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`clause_id` text,
	`sequence` integer NOT NULL,
	`source_revision` text,
	`original_text` text NOT NULL,
	`normalized_requirement` text NOT NULL,
	`engineering_domain` text NOT NULL,
	`domain_source_type` text NOT NULL,
	`system` text,
	`category` text,
	`subcategory` text,
	`requirement_type` text NOT NULL,
	`requirement_category` text NOT NULL,
	`condition` text,
	`exception` text,
	`confidence` integer NOT NULL,
	`confidence_state` text NOT NULL,
	`review_status` text NOT NULL,
	`extraction_method` text NOT NULL,
	`parser_version` text NOT NULL,
	`model_version` text NOT NULL,
	`source_location` text NOT NULL,
	`original_values` text NOT NULL,
	`current_values` text NOT NULL,
	`approved_for_downstream` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clause_id`) REFERENCES `specification_clauses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `technical_requirements_sequence_idx` ON `technical_requirements` (`extraction_version_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `technical_requirements_project_review_idx` ON `technical_requirements` (`project_id`,`review_status`);--> statement-breakpoint
CREATE INDEX `technical_requirements_downstream_idx` ON `technical_requirements` (`project_id`,`approved_for_downstream`);