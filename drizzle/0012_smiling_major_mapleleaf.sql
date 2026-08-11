CREATE TABLE `excel_export_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`export_job_id` text,
	`action` text NOT NULL,
	`stage` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`export_job_id`) REFERENCES `excel_export_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `excel_export_audit_project_idx` ON `excel_export_audit_log` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `excel_export_audit_job_idx` ON `excel_export_audit_log` (`export_job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `excel_export_files` (
	`id` text PRIMARY KEY NOT NULL,
	`export_job_id` text NOT NULL,
	`project_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_downloaded_at` text,
	`deleted_at` text,
	FOREIGN KEY (`export_job_id`) REFERENCES `excel_export_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_file_job_idx` ON `excel_export_files` (`export_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_file_object_idx` ON `excel_export_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `excel_export_file_project_idx` ON `excel_export_files` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `excel_export_jobs` (
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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `export_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_idempotency_idx` ON `excel_export_jobs` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_revision_idx` ON `excel_export_jobs` (`project_id`,`revision`);--> statement-breakpoint
CREATE INDEX `excel_export_project_status_idx` ON `excel_export_jobs` (`project_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `excel_export_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`export_job_id` text NOT NULL,
	`server_totals` text NOT NULL,
	`workbook_totals` text NOT NULL,
	`differences` text NOT NULL,
	`tolerance` text NOT NULL,
	`status` text NOT NULL,
	`failed_fields` text NOT NULL,
	`reconciled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`export_job_id`) REFERENCES `excel_export_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_reconciliation_job_idx` ON `excel_export_reconciliations` (`export_job_id`);--> statement-breakpoint
CREATE TABLE `export_template_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`sheet_name` text NOT NULL,
	`target` text NOT NULL,
	`canonical_field` text NOT NULL,
	`format` text,
	`formula` text,
	`required` integer DEFAULT false NOT NULL,
	`default_value` text,
	`visibility_rule` text,
	`export_modes` text NOT NULL,
	`validation` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `export_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `export_template_mapping_target_idx` ON `export_template_mappings` (`template_id`,`sheet_name`,`target`);--> statement-breakpoint
CREATE INDEX `export_template_mapping_field_idx` ON `export_template_mappings` (`canonical_field`,`template_id`);--> statement-breakpoint
CREATE TABLE `export_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`supported_modes` text NOT NULL,
	`sheet_configuration` text NOT NULL,
	`branding` text NOT NULL,
	`formula_strategy` text NOT NULL,
	`mapping_version` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `export_templates_name_version_idx` ON `export_templates` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `export_templates_status_idx` ON `export_templates` (`status`,`created_at`);