CREATE TABLE `product_match_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`match_run_id` text NOT NULL,
	`product_id` text NOT NULL,
	`rank` integer NOT NULL,
	`search_stage` text NOT NULL,
	`score` integer NOT NULL,
	`score_components` text NOT NULL,
	`technical_status` text NOT NULL,
	`recommendation_tier` text NOT NULL,
	`confidence_state` text NOT NULL,
	`confidence_score` integer NOT NULL,
	`matching_basis` text NOT NULL,
	`commercial_availability` text NOT NULL,
	`explanation` text NOT NULL,
	`mandatory_failures` text NOT NULL,
	`lifecycle_result` text NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`manually_added` integer DEFAULT false NOT NULL,
	`added_reason` text,
	`added_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`match_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_candidate_product_idx` ON `product_match_candidates` (`match_run_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_candidate_rank_idx` ON `product_match_candidates` (`match_run_id`,`rank`);--> statement-breakpoint
CREATE INDEX `product_match_candidate_status_idx` ON `product_match_candidates` (`match_run_id`,`technical_status`,`review_status`);--> statement-breakpoint
CREATE TABLE `product_match_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`comparison_type` text NOT NULL,
	`requirement_id` text,
	`requirement_type` text,
	`requirement_text` text,
	`required_value` text,
	`product_value` text,
	`result` text NOT NULL,
	`severity` text NOT NULL,
	`blocking` integer DEFAULT false NOT NULL,
	`source_evidence` text,
	`conversion` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_match_comparisons_candidate_idx` ON `product_match_comparisons` (`candidate_id`,`comparison_type`,`result`);--> statement-breakpoint
CREATE TABLE `product_match_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`match_run_id` text NOT NULL,
	`candidate_id` text,
	`action` text NOT NULL,
	`reason_code` text NOT NULL,
	`notes` text NOT NULL,
	`evidence` text,
	`decided_by` text NOT NULL,
	`decided_role` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_match_reviews_run_idx` ON `product_match_reviews` (`match_run_id`,`decided_at`);--> statement-breakpoint
CREATE INDEX `product_match_reviews_candidate_idx` ON `product_match_reviews` (`candidate_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `product_match_run_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous_run_id` text NOT NULL,
	`current_run_id` text NOT NULL,
	`changes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_run_comparison_pair_idx` ON `product_match_run_comparisons` (`previous_run_id`,`current_run_id`);--> statement-breakpoint
CREATE TABLE `product_match_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`requirement_profile_version_id` text NOT NULL,
	`processing_run_id` text,
	`version_number` integer NOT NULL,
	`status` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`engine_version` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`search_version` text NOT NULL,
	`model_version` text NOT NULL,
	`search_scope` text NOT NULL,
	`summary` text NOT NULL,
	`no_match` text,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`superseded_at` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_runs_item_version_idx` ON `product_match_runs` (`boq_item_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `product_match_runs_project_status_idx` ON `product_match_runs` (`project_id`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `product_match_runs_fingerprint_idx` ON `product_match_runs` (`boq_item_id`,`input_fingerprint`);