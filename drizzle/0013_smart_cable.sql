CREATE TABLE `dashboard_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dashboard_audit_project_idx` ON `dashboard_audit_log` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dashboard_audit_action_idx` ON `dashboard_audit_log` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `dashboard_metric_definitions` (
	`id` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`scope` text NOT NULL,
	`data_source` text NOT NULL,
	`formula` text NOT NULL,
	`filters` text NOT NULL,
	`exclusions` text NOT NULL,
	`refresh_strategy` text NOT NULL,
	`permission` text NOT NULL,
	`drill_down_route` text NOT NULL,
	`owner` text NOT NULL,
	`test_cases` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_metric_definition_version_idx` ON `dashboard_metric_definitions` (`id`,`version`);--> statement-breakpoint
CREATE TABLE `dashboard_metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`metric_id` text NOT NULL,
	`metric_version` text NOT NULL,
	`project_id` text,
	`scope_key` text NOT NULL,
	`value` text NOT NULL,
	`source_version` text NOT NULL,
	`calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_metric_snapshot_source_idx` ON `dashboard_metric_snapshots` (`metric_id`,`scope_key`,`source_version`);--> statement-breakpoint
CREATE INDEX `dashboard_metric_snapshot_scope_idx` ON `dashboard_metric_snapshots` (`scope_key`,`calculated_at`);--> statement-breakpoint
CREATE TABLE `project_dashboard_profiles` (
	`project_id` text PRIMARY KEY NOT NULL,
	`client` text,
	`consultant` text,
	`contractor` text,
	`location` text,
	`tender_number` text,
	`package_name` text,
	`due_date` text,
	`currency` text DEFAULT 'SAR' NOT NULL,
	`manual_status` text,
	`status_reason` text,
	`status_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_dashboard_due_idx` ON `project_dashboard_profiles` (`due_date`,`manual_status`);--> statement-breakpoint
CREATE INDEX `project_dashboard_tender_idx` ON `project_dashboard_profiles` (`tender_number`);--> statement-breakpoint
CREATE TABLE `project_progress_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model_version` text NOT NULL,
	`progress` integer NOT NULL,
	`derived_status` text NOT NULL,
	`ready_for_quotation` integer DEFAULT false NOT NULL,
	`facts` text NOT NULL,
	`source_version` text NOT NULL,
	`calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_progress_source_idx` ON `project_progress_snapshots` (`project_id`,`source_version`);--> statement-breakpoint
CREATE INDEX `project_progress_status_idx` ON `project_progress_snapshots` (`derived_status`,`calculated_at`);--> statement-breakpoint
CREATE TABLE `project_risks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`risk_type` text NOT NULL,
	`severity` text NOT NULL,
	`trigger` text NOT NULL,
	`impact` text NOT NULL,
	`affected_module` text NOT NULL,
	`recommended_action` text NOT NULL,
	`owner` text NOT NULL,
	`due_date` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`source_version` text NOT NULL,
	`acknowledged_by` text,
	`acknowledged_at` text,
	`calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_risk_source_idx` ON `project_risks` (`project_id`,`risk_type`,`source_version`);--> statement-breakpoint
CREATE INDEX `project_risk_status_idx` ON `project_risks` (`project_id`,`status`,`severity`);--> statement-breakpoint
CREATE TABLE `project_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous_status` text,
	`next_status` text NOT NULL,
	`status_type` text NOT NULL,
	`reason` text NOT NULL,
	`model_version` text NOT NULL,
	`source_version` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_status_history_idx` ON `project_status_history` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_stage_states` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`model_version` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer NOT NULL,
	`blocking_issue_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`owner_role` text NOT NULL,
	`next_action` text,
	`drill_down_route` text NOT NULL,
	`source_version` text NOT NULL,
	`calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_stage_project_version_idx` ON `workflow_stage_states` (`project_id`,`stage_id`,`source_version`);--> statement-breakpoint
CREATE INDEX `workflow_stage_project_status_idx` ON `workflow_stage_states` (`project_id`,`status`,`calculated_at`);