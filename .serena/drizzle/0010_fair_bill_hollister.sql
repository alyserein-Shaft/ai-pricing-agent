CREATE TABLE `pricing_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`pricing_run_id` text NOT NULL,
	`pricing_line_id` text,
	`approval_type` text NOT NULL,
	`status` text NOT NULL,
	`entity_version` integer NOT NULL,
	`request_reason` text NOT NULL,
	`evidence` text NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`decided_role` text,
	`decision_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_approvals_project_status_idx` ON `pricing_approvals` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pricing_approvals_run_idx` ON `pricing_approvals` (`pricing_run_id`,`status`);--> statement-breakpoint
CREATE TABLE `pricing_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`pricing_run_id` text,
	`pricing_line_id` text,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_audit_project_idx` ON `pricing_audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pricing_audit_run_idx` ON `pricing_audit_events` (`pricing_run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pricing_cost_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`shared_cost_id` text NOT NULL,
	`pricing_line_id` text NOT NULL,
	`weight` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`method` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`shared_cost_id`) REFERENCES `pricing_shared_costs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_allocations_shared_line_idx` ON `pricing_cost_allocations` (`shared_cost_id`,`pricing_line_id`);--> statement-breakpoint
CREATE TABLE `pricing_cost_components` (
	`id` text PRIMARY KEY NOT NULL,
	`pricing_line_id` text NOT NULL,
	`component_type` text NOT NULL,
	`description` text NOT NULL,
	`method` text NOT NULL,
	`formula` text NOT NULL,
	`rate` text,
	`quantity` text,
	`amount_minor` integer NOT NULL,
	`source` text NOT NULL,
	`scope` text NOT NULL,
	`assumptions` text NOT NULL,
	`approval_status` text NOT NULL,
	`rule_version` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_components_line_type_idx` ON `pricing_cost_components` (`pricing_line_id`,`component_type`);--> statement-breakpoint
CREATE TABLE `pricing_discount_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`pricing_line_id` text NOT NULL,
	`discount_type` text NOT NULL,
	`mode` text NOT NULL,
	`order_number` integer NOT NULL,
	`percentage_basis_points` integer NOT NULL,
	`calculation_base_minor` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`balance_minor` integer NOT NULL,
	`source` text NOT NULL,
	`scope` text NOT NULL,
	`valid_until` text NOT NULL,
	`approved_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_discounts_line_order_idx` ON `pricing_discount_applications` (`pricing_line_id`,`order_number`);--> statement-breakpoint
CREATE TABLE `pricing_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`pricing_line_id` text,
	`exception_type` text NOT NULL,
	`reason` text NOT NULL,
	`evidence` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`decided_role` text,
	`decision_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_exceptions_project_status_idx` ON `pricing_exceptions` (`project_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `pricing_exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_currency` text NOT NULL,
	`to_currency` text NOT NULL,
	`rate` text NOT NULL,
	`rate_type` text NOT NULL,
	`source` text NOT NULL,
	`effective_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`version_number` integer NOT NULL,
	`approval_status` text NOT NULL,
	`approved_by` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_rates_project_pair_version_idx` ON `pricing_exchange_rates` (`project_id`,`from_currency`,`to_currency`,`version_number`);--> statement-breakpoint
CREATE INDEX `pricing_rates_project_validity_idx` ON `pricing_exchange_rates` (`project_id`,`approval_status`,`valid_until`);--> statement-breakpoint
CREATE TABLE `pricing_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`pricing_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`product_id` text NOT NULL,
	`safety_decision_id` text NOT NULL,
	`selected_price_record_id` text,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text NOT NULL,
	`source_currency` text,
	`project_currency` text NOT NULL,
	`original_list_price_minor` integer,
	`net_material_unit_minor` integer,
	`material_total_minor` integer,
	`direct_cost_minor` integer,
	`total_cost_minor` integer,
	`gross_selling_minor` integer,
	`customer_discount_minor` integer,
	`net_selling_minor` integer,
	`vat_minor` integer,
	`final_value_minor` integer,
	`margin_basis_points` integer,
	`markup_basis_points` integer,
	`output` text NOT NULL,
	`explanation` text NOT NULL,
	`approval_ready` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selected_price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_lines_run_item_idx` ON `pricing_lines` (`pricing_run_id`,`boq_item_id`);--> statement-breakpoint
CREATE INDEX `pricing_lines_project_status_idx` ON `pricing_lines` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `pricing_lines_candidate_idx` ON `pricing_lines` (`candidate_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pricing_run_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous_run_id` text NOT NULL,
	`current_run_id` text NOT NULL,
	`changes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_run_comparisons_pair_idx` ON `pricing_run_comparisons` (`previous_run_id`,`current_run_id`);--> statement-breakpoint
CREATE TABLE `pricing_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`engine_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`reason` text NOT NULL,
	`locked_versions` text NOT NULL,
	`summary` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`superseded_at` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scenario_id`) REFERENCES `pricing_scenarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_runs_scenario_version_idx` ON `pricing_runs` (`scenario_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `pricing_runs_project_status_idx` ON `pricing_runs` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pricing_runs_fingerprint_idx` ON `pricing_runs` (`project_id`,`input_fingerprint`);--> statement-breakpoint
CREATE TABLE `pricing_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`version_number` integer NOT NULL,
	`project_currency` text NOT NULL,
	`status` text NOT NULL,
	`assumptions` text NOT NULL,
	`settings` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_scenarios_project_name_version_idx` ON `pricing_scenarios` (`project_id`,`name`,`version_number`);--> statement-breakpoint
CREATE INDEX `pricing_scenarios_project_status_idx` ON `pricing_scenarios` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `pricing_shared_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`pricing_run_id` text NOT NULL,
	`component_type` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`allocation_method` text NOT NULL,
	`source` text NOT NULL,
	`approval_status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_shared_costs_run_idx` ON `pricing_shared_costs` (`pricing_run_id`,`component_type`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user_idx` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_status_idx` ON `project_members` (`user_id`,`status`);