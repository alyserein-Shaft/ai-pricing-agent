CREATE TABLE `safety_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`safety_decision_id` text NOT NULL,
	`approval_type` text NOT NULL,
	`approval_level` integer NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_role` text NOT NULL,
	`request_reason` text NOT NULL,
	`evidence` text NOT NULL,
	`entity_version` integer NOT NULL,
	`ruleset_version` text NOT NULL,
	`decided_by` text,
	`decided_role` text,
	`decision_reason` text,
	`decided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_approval_project_status_idx` ON `safety_approval_requests` (`project_id`,`status`,`approval_type`);--> statement-breakpoint
CREATE INDEX `safety_approval_decision_idx` ON `safety_approval_requests` (`safety_decision_id`,`status`);--> statement-breakpoint
CREATE TABLE `safety_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`safety_decision_id` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`scope` text NOT NULL,
	`user_message` text NOT NULL,
	`technical_message` text NOT NULL,
	`resolution_action` text NOT NULL,
	`owner` text NOT NULL,
	`source` text,
	`rule_version` text NOT NULL,
	`overridable` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`resolution_decision_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_blocks_decision_status_idx` ON `safety_blocks` (`safety_decision_id`,`status`,`severity`);--> statement-breakpoint
CREATE INDEX `safety_blocks_code_idx` ON `safety_blocks` (`code`,`status`);--> statement-breakpoint
CREATE TABLE `safety_decision_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous_decision_id` text NOT NULL,
	`current_decision_id` text NOT NULL,
	`changes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_decision_comparison_pair_idx` ON `safety_decision_comparisons` (`previous_decision_id`,`current_decision_id`);--> statement-breakpoint
CREATE TABLE `safety_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`candidate_id` text,
	`requirement_profile_version_id` text NOT NULL,
	`match_run_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`input_fingerprint` text NOT NULL,
	`safety_state` text NOT NULL,
	`compliance_state` text NOT NULL,
	`confidence_level` text NOT NULL,
	`overall_confidence` integer NOT NULL,
	`confidence_components` text NOT NULL,
	`technical_eligibility` text NOT NULL,
	`price_eligibility` text NOT NULL,
	`missing_information` text NOT NULL,
	`provenance_status` text NOT NULL,
	`explanation` text NOT NULL,
	`engine_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`model_version` text NOT NULL,
	`recalculation_reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_decisions_scope_version_idx` ON `safety_decisions` (`boq_item_id`,`candidate_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `safety_decisions_project_state_idx` ON `safety_decisions` (`project_id`,`safety_state`,`created_at`);--> statement-breakpoint
CREATE INDEX `safety_decisions_fingerprint_idx` ON `safety_decisions` (`boq_item_id`,`candidate_id`,`input_fingerprint`);--> statement-breakpoint
CREATE TABLE `safety_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`safety_decision_id` text NOT NULL,
	`approval_level` integer NOT NULL,
	`block_codes` text NOT NULL,
	`override_type` text NOT NULL,
	`reason` text NOT NULL,
	`technical_justification` text NOT NULL,
	`commercial_justification` text,
	`evidence` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_role` text NOT NULL,
	`decided_by` text,
	`decided_role` text,
	`decision_reason` text,
	`decided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_overrides_decision_status_idx` ON `safety_overrides` (`safety_decision_id`,`status`);--> statement-breakpoint
CREATE INDEX `safety_overrides_project_expiry_idx` ON `safety_overrides` (`project_id`,`expires_at`,`status`);--> statement-breakpoint
CREATE TABLE `safety_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`safety_decision_id` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`scope` text NOT NULL,
	`message` text NOT NULL,
	`resolution_action` text NOT NULL,
	`owner` text NOT NULL,
	`source` text,
	`rule_version` text NOT NULL,
	`acknowledgment_required` integer DEFAULT true NOT NULL,
	`acknowledged_by` text,
	`acknowledged_at` text,
	`acknowledgment_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_warnings_decision_idx` ON `safety_warnings` (`safety_decision_id`,`acknowledgment_required`,`acknowledged_at`);