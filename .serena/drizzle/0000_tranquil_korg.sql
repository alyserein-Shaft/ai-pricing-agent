CREATE TABLE `document_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`schema_version` integer NOT NULL,
	`object_key` text NOT NULL,
	`checksum` text NOT NULL,
	`page_from` integer,
	`page_to` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artifacts_run_idx` ON `document_artifacts` (`run_id`,`artifact_type`);--> statement-breakpoint
CREATE TABLE `document_assertions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`assertion_type` text NOT NULL,
	`normalized_value` text NOT NULL,
	`confidence_basis_points` integer NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`source_page` integer,
	`source_region` text,
	`source_text` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assertions_run_type_idx` ON `document_assertions` (`run_id`,`assertion_type`);--> statement-breakpoint
CREATE INDEX `assertions_review_idx` ON `document_assertions` (`review_status`);--> statement-breakpoint
CREATE TABLE `document_processing_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_version_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`error_code` text,
	`error_message` text,
	`processor_version` text,
	`started_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `processing_status_idx` ON `document_processing_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `processing_document_idx` ON `document_processing_runs` (`document_version_id`);--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`revision` text,
	`issue_date` text,
	`issue_purpose` text,
	`transmittal` text,
	`quarantine_status` text DEFAULT 'Pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_sha_idx` ON `document_versions` (`sha256`);--> statement-breakpoint
CREATE INDEX `document_versions_document_idx` ON `document_versions` (`document_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`logical_name` text NOT NULL,
	`corrected_type` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_project_idx` ON `documents` (`project_id`);--> statement-breakpoint
CREATE TABLE `processing_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`level` text NOT NULL,
	`stage` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `processing_logs_run_idx` ON `processing_logs` (`run_id`,`created_at`);