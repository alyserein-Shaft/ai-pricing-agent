CREATE TABLE `review_approval_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_item_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`description` text NOT NULL,
	`risk` text NOT NULL,
	`owner_id` text NOT NULL,
	`due_date` text NOT NULL,
	`verification_method` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`closed_by` text,
	`closed_at` text,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_conditions_item_status_idx` ON `review_approval_conditions` (`review_item_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `review_approval_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`review_item_id` text NOT NULL,
	`group_key` text NOT NULL,
	`step_order` integer NOT NULL,
	`mode` text NOT NULL,
	`required_role` text NOT NULL,
	`required_approvals` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`expires_at` text,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_approval_step_order_idx` ON `review_approval_steps` (`review_item_id`,`group_key`,`step_order`);--> statement-breakpoint
CREATE INDEX `review_approval_step_status_idx` ON `review_approval_steps` (`review_item_id`,`status`);--> statement-breakpoint
CREATE TABLE `review_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`review_item_id` text NOT NULL,
	`assignee_id` text NOT NULL,
	`role` text NOT NULL,
	`assignment_type` text NOT NULL,
	`team` text,
	`due_date` text,
	`sla_hours` integer,
	`assigned_by` text NOT NULL,
	`assigned_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_assignments_item_active_idx` ON `review_assignments` (`review_item_id`,`ended_at`);--> statement-breakpoint
CREATE TABLE `review_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`review_item_id` text NOT NULL,
	`decision_id` text,
	`document_id` text,
	`attachment_type` text NOT NULL,
	`label` text NOT NULL,
	`access_level` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_attachments_item_idx` ON `review_attachments` (`review_item_id`,`added_at`);--> statement-breakpoint
CREATE TABLE `review_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`review_item_id` text,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`request_id` text NOT NULL,
	`entity_version` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_audit_project_idx` ON `review_audit_log` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_audit_item_idx` ON `review_audit_log` (`review_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_clarifications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`review_item_id` text NOT NULL,
	`question` text NOT NULL,
	`recipient` text,
	`priority` text NOT NULL,
	`due_date` text,
	`status` text NOT NULL,
	`response` text,
	`affected_entities` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text,
	`resolved_by` text,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_clarifications_project_status_idx` ON `review_clarifications` (`project_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`review_item_id` text NOT NULL,
	`parent_comment_id` text,
	`body` text NOT NULL,
	`mentions` text NOT NULL,
	`visibility` text NOT NULL,
	`resolution_status` text DEFAULT 'Open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`edited_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_comments_item_idx` ON `review_comments` (`review_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_conflict_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`review_item_id` text NOT NULL,
	`conflict_type` text NOT NULL,
	`source_a` text NOT NULL,
	`source_b` text NOT NULL,
	`resolution` text NOT NULL,
	`reason` text NOT NULL,
	`exception_scope` text,
	`resolved_by` text NOT NULL,
	`resolved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_conflicts_item_idx` ON `review_conflict_resolutions` (`review_item_id`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_item_id` text NOT NULL,
	`project_id` text NOT NULL,
	`decision_type` text NOT NULL,
	`outcome` text NOT NULL,
	`previous_state` text NOT NULL,
	`new_state` text NOT NULL,
	`entity_version` integer NOT NULL,
	`review_version` integer NOT NULL,
	`safety_state` text NOT NULL,
	`reason` text NOT NULL,
	`notes` text,
	`evidence` text NOT NULL,
	`scope` text NOT NULL,
	`conditions` text NOT NULL,
	`expires_at` text,
	`approval_level` integer NOT NULL,
	`decided_by` text NOT NULL,
	`decided_role` text NOT NULL,
	`request_id` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_decisions_item_idx` ON `review_decisions` (`review_item_id`,`decided_at`);--> statement-breakpoint
CREATE INDEX `review_decisions_project_idx` ON `review_decisions` (`project_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `review_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`review_item_id` text NOT NULL,
	`dependency_type` text NOT NULL,
	`dependent_entity_id` text NOT NULL,
	`blocking` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_dependencies_item_status_idx` ON `review_dependencies` (`review_item_id`,`status`);--> statement-breakpoint
CREATE TABLE `review_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`review_item_id` text NOT NULL,
	`event_type` text NOT NULL,
	`recipient_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`delivered_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_notifications_recipient_idx` ON `review_notifications` (`recipient_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text,
	`review_type` text NOT NULL,
	`priority` text NOT NULL,
	`priority_score` integer NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`assigned_reviewer_id` text,
	`required_role` text NOT NULL,
	`due_date` text,
	`blocking` integer DEFAULT false NOT NULL,
	`source_module` text NOT NULL,
	`reason_for_review` text NOT NULL,
	`required_decision` text NOT NULL,
	`approval_level` integer DEFAULT 1 NOT NULL,
	`safety_state` text NOT NULL,
	`entity_version` integer NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`escalation_status` text DEFAULT 'None' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_queue_project_status_idx` ON `review_queue_items` (`project_id`,`status`,`priority`);--> statement-breakpoint
CREATE INDEX `review_queue_assignee_due_idx` ON `review_queue_items` (`assigned_reviewer_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `review_queue_boq_idx` ON `review_queue_items` (`boq_item_id`,`review_type`);