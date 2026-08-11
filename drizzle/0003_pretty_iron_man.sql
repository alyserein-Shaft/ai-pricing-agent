CREATE TABLE `boq_extraction_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`item_id` text,
	`field_name` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_location` text NOT NULL,
	`raw_value` text,
	`normalized_value` text,
	`confidence` integer NOT NULL,
	`method` text NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boq_evidence_item_idx` ON `boq_extraction_evidence` (`item_id`,`field_name`);--> statement-breakpoint
CREATE TABLE `boq_extraction_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`label` text NOT NULL,
	`sheet_name` text,
	`page_number` integer,
	`classification` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`header_rows` text,
	`column_mapping` text,
	`merged_ranges` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boq_sources_version_idx` ON `boq_extraction_sources` (`extraction_version_id`,`source_kind`);--> statement-breakpoint
CREATE TABLE `boq_extraction_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`document_version_id` text NOT NULL,
	`classification_id` text,
	`processing_run_id` text,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`parser_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
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
CREATE UNIQUE INDEX `boq_extraction_version_number_idx` ON `boq_extraction_versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `boq_extraction_document_idx` ON `boq_extraction_versions` (`document_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `boq_extraction_status_idx` ON `boq_extraction_versions` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `boq_extraction_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`item_id` text,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`source_location` text,
	`resolved_at` text,
	`resolved_by` text,
	`resolution` text,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boq_warnings_version_idx` ON `boq_extraction_warnings` (`extraction_version_id`,`code`);--> statement-breakpoint
CREATE INDEX `boq_warnings_item_idx` ON `boq_extraction_warnings` (`item_id`);--> statement-breakpoint
CREATE TABLE `boq_items` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`section_id` text,
	`duplicate_of_item_id` text,
	`sequence` integer NOT NULL,
	`item_number` text,
	`parent_item_number` text,
	`section` text,
	`subsection` text,
	`hierarchy_depth` integer DEFAULT 0 NOT NULL,
	`section_path` text NOT NULL,
	`system_value` text,
	`system_source_type` text,
	`system_confidence` integer,
	`category` text,
	`subcategory` text,
	`description` text,
	`normalized_description` text,
	`original_unit` text,
	`normalized_unit` text,
	`unit_rule` text,
	`unit_confidence` integer,
	`original_quantity` text,
	`numeric_quantity` text,
	`quantity_type` text,
	`quantity_formula` text,
	`quantity_confidence` integer,
	`manufacturer` text,
	`brand` text,
	`model` text,
	`part_number` text,
	`specification_reference` text,
	`drawing_reference` text,
	`notes` text,
	`alternates` text,
	`included_accessories` text,
	`excluded_scope` text,
	`row_type` text NOT NULL,
	`extraction_confidence` integer NOT NULL,
	`confidence_state` text NOT NULL,
	`review_status` text NOT NULL,
	`source_location` text NOT NULL,
	`original_raw_values` text NOT NULL,
	`current_values` text NOT NULL,
	`approved_for_downstream` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`section_id`) REFERENCES `boq_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_items_version_sequence_idx` ON `boq_items` (`extraction_version_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `boq_items_project_review_idx` ON `boq_items` (`project_id`,`review_status`);--> statement-breakpoint
CREATE INDEX `boq_items_downstream_idx` ON `boq_items` (`project_id`,`approved_for_downstream`,`row_type`);--> statement-breakpoint
CREATE TABLE `boq_review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`item_id` text,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boq_decisions_item_idx` ON `boq_review_decisions` (`item_id`,`decided_at`);--> statement-breakpoint
CREATE INDEX `boq_decisions_version_idx` ON `boq_review_decisions` (`extraction_version_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `boq_revision_comparisons` (
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
	FOREIGN KEY (`previous_extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_revision_pair_idx` ON `boq_revision_comparisons` (`previous_extraction_version_id`,`current_extraction_version_id`);--> statement-breakpoint
CREATE TABLE `boq_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`extraction_version_id` text NOT NULL,
	`parent_section_id` text,
	`item_number` text,
	`title` text NOT NULL,
	`depth` integer NOT NULL,
	`path` text NOT NULL,
	`sequence` integer NOT NULL,
	`source_location` text NOT NULL,
	FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boq_sections_version_idx` ON `boq_sections` (`extraction_version_id`,`sequence`);