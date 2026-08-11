CREATE TABLE IF NOT EXISTS `engineering_knowledge_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`conflict_type` text NOT NULL,
	`left_entity_type` text NOT NULL,
	`left_entity_id` text NOT NULL,
	`right_entity_type` text NOT NULL,
	`right_entity_id` text NOT NULL,
	`left_value` text,
	`right_value` text,
	`severity` text NOT NULL,
	`impact` text NOT NULL,
	`blocking` integer DEFAULT true NOT NULL,
	`resolution_status` text DEFAULT 'Open' NOT NULL,
	`resolution_decision_id` text,
	`evidence` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolution_decision_id`) REFERENCES `engineering_knowledge_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_conflicts_project_status_idx` ON `engineering_knowledge_conflicts` (`project_id`,`resolution_status`,`blocking`);
