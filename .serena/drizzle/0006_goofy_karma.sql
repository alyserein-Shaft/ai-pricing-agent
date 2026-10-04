CREATE TABLE `consolidated_profile_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`canonical_key` text NOT NULL,
	`normalized_requirement` text NOT NULL,
	`requirement_category` text NOT NULL,
	`requirement_type` text NOT NULL,
	`priority` text NOT NULL,
	`governing_source_id` text NOT NULL,
	`sources` text NOT NULL,
	`attributes` text NOT NULL,
	`standards` text NOT NULL,
	`manufacturers` text NOT NULL,
	`confidence` integer NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_consolidated_key_idx` ON `consolidated_profile_requirements` (`profile_version_id`,`canonical_key`);--> statement-breakpoint
CREATE TABLE `profile_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`issue_type` text NOT NULL,
	`related_requirement_id` text,
	`related_field` text,
	`payload` text NOT NULL,
	`severity` text NOT NULL,
	`blocking` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`resolution_decision_id` text,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolution_decision_id`) REFERENCES `engineering_knowledge_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_issues_type_status_idx` ON `profile_issues` (`profile_version_id`,`issue_type`,`status`);--> statement-breakpoint
CREATE TABLE `profile_requirement_applicability` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence` text NOT NULL,
	`priority` text NOT NULL,
	`review_status` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_requirement_idx` ON `profile_requirement_applicability` (`profile_version_id`,`requirement_id`);--> statement-breakpoint
CREATE INDEX `profile_applicability_status_idx` ON `profile_requirement_applicability` (`profile_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `requirement_profile_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous_profile_version_id` text NOT NULL,
	`current_profile_version_id` text NOT NULL,
	`changes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_profile_comparison_pair_idx` ON `requirement_profile_comparisons` (`previous_profile_version_id`,`current_profile_version_id`);--> statement-breakpoint
CREATE TABLE `requirement_profile_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`evidence` text,
	`reversible` integer DEFAULT true NOT NULL,
	`reverses_decision_id` text,
	`decided_by` text NOT NULL,
	`decided_role` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_decisions_profile_idx` ON `requirement_profile_decisions` (`profile_version_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `requirement_profile_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`processing_run_id` text,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`engine_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`model_version` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`profile` text NOT NULL,
	`explanation` text NOT NULL,
	`readiness_status` text NOT NULL,
	`confidence_summary` text NOT NULL,
	`approved_for_matching` integer DEFAULT false NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`approval_reason` text,
	`superseded_at` text,
	`error_code` text,
	`error_message` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_profile_item_version_idx` ON `requirement_profile_versions` (`boq_item_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `requirement_profile_project_status_idx` ON `requirement_profile_versions` (`project_id`,`status`,`readiness_status`);--> statement-breakpoint
CREATE TABLE `requirement_rule_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_version` integer NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rule_execution_profile_idx` ON `requirement_rule_executions` (`profile_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `requirement_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`rule_type` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`condition` text NOT NULL,
	`action` text NOT NULL,
	`priority` integer NOT NULL,
	`version_number` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_fact_id` text,
	`approved_by` text,
	`status` text NOT NULL,
	`test_cases` text DEFAULT '[]' NOT NULL,
	`previous_version_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_fact_id`) REFERENCES `engineering_facts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_rule_version_idx` ON `requirement_rules` (`name`,`scope_type`,`scope_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `requirement_rule_scope_idx` ON `requirement_rules` (`rule_type`,`scope_type`,`scope_id`,`status`);