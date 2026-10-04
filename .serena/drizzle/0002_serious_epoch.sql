CREATE TABLE `classification_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`classification_id` text NOT NULL,
	`document_type` text NOT NULL,
	`rank` integer NOT NULL,
	`confidence` integer NOT NULL,
	`score_basis_points` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classification_candidate_rank_idx` ON `classification_candidates` (`classification_id`,`rank`);--> statement-breakpoint
CREATE TABLE `classification_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`classification_id` text NOT NULL,
	`category` text NOT NULL,
	`evidence_kind` text NOT NULL,
	`label` text NOT NULL,
	`excerpt` text,
	`weight` integer NOT NULL,
	`method` text NOT NULL,
	`page_from` integer,
	`page_to` integer,
	`sheet_name` text,
	`section` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classification_evidence_idx` ON `classification_evidence` (`classification_id`,`category`);--> statement-breakpoint
CREATE TABLE `classification_model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`classifier_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`ai_model_version` text,
	`configuration` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classification_model_version_idx` ON `classification_model_versions` (`classifier_version`,`ruleset_version`,`prompt_version`);--> statement-breakpoint
CREATE TABLE `classification_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`classification_id` text NOT NULL,
	`document_id` text NOT NULL,
	`previous_type` text NOT NULL,
	`selected_type` text NOT NULL,
	`secondary_types` text NOT NULL,
	`reason` text,
	`overridden_by` text NOT NULL,
	`overridden_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classification_overrides_document_idx` ON `classification_overrides` (`document_id`,`overridden_at`);--> statement-breakpoint
CREATE TABLE `classification_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`classification_id` text NOT NULL,
	`segment_kind` text NOT NULL,
	`label` text NOT NULL,
	`page_from` integer,
	`page_to` integer,
	`sheet_name` text,
	`section` text,
	`primary_type` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence` text NOT NULL,
	`manually_set` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classification_segments_idx` ON `classification_segments` (`classification_id`,`segment_kind`);--> statement-breakpoint
CREATE TABLE `document_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`document_version_id` text NOT NULL,
	`processing_run_id` text,
	`model_version_id` text NOT NULL,
	`primary_type` text NOT NULL,
	`secondary_types` text NOT NULL,
	`confidence` integer NOT NULL,
	`confidence_state` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`extraction_method` text,
	`extraction_quality_basis_points` integer,
	`mixed` integer DEFAULT false NOT NULL,
	`manual_review_required` integer DEFAULT true NOT NULL,
	`downstream_route` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`technical_details` text,
	`suggested_action` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`classified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_version_id`) REFERENCES `classification_model_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classifications_document_idx` ON `document_classifications` (`document_id`,`classified_at`);--> statement-breakpoint
CREATE INDEX `classifications_version_idx` ON `document_classifications` (`document_version_id`,`classified_at`);--> statement-breakpoint
CREATE INDEX `classifications_status_idx` ON `document_classifications` (`status`,`classified_at`);--> statement-breakpoint
CREATE TABLE `downstream_routing_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`classification_id` text NOT NULL,
	`document_version_id` text NOT NULL,
	`route` text NOT NULL,
	`status` text DEFAULT 'Decision Only' NOT NULL,
	`eligible` integer DEFAULT false NOT NULL,
	`blocker` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `routing_handoffs_version_idx` ON `downstream_routing_handoffs` (`document_version_id`,`created_at`);