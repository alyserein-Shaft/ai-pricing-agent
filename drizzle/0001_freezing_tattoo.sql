CREATE TABLE `document_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text,
	`version_id` text,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`reason` text DEFAULT '' NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_audit_project_idx` ON `document_audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `document_audit_document_idx` ON `document_audit_events` (`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `processing_history` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`progress` integer NOT NULL,
	`actor` text NOT NULL,
	`error_code` text,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `processing_history_run_idx` ON `processing_history` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_user_id`,`updated_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `projects` (`id`, `name`, `owner_user_id`)
SELECT DISTINCT `project_id`, `project_id`, 'legacy-local-user' FROM `documents`;--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`status` text NOT NULL,
	`file_count` integer DEFAULT 1 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `upload_sessions_project_idx` ON `upload_sessions` (`project_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`upload_session_id` text,
	`version_number` integer NOT NULL,
	`original_filename` text NOT NULL,
	`stored_filename` text NOT NULL,
	`extension` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`revision` text,
	`issue_date` text,
	`issue_purpose` text,
	`transmittal` text,
	`source` text DEFAULT 'User Upload' NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_modified` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`supersedes_version_id` text,
	`restored_from_version_id` text,
	`quarantine_status` text DEFAULT 'Pending Scan' NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`upload_session_id`) REFERENCES `upload_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_document_versions`("id", "document_id", "upload_session_id", "version_number", "original_filename", "stored_filename", "extension", "mime_type", "byte_size", "sha256", "object_key", "revision", "issue_date", "issue_purpose", "transmittal", "source", "uploaded_by", "uploaded_at", "last_modified", "supersedes_version_id", "restored_from_version_id", "quarantine_status")
SELECT "id", "document_id", NULL, 1, "file_name", "file_name",
  CASE WHEN instr("file_name", '.') > 0 THEN lower(substr("file_name", instr("file_name", '.') + 1)) ELSE 'bin' END,
  "mime_type", "byte_size", "sha256", "object_key", "revision", "issue_date", "issue_purpose", "transmittal", 'Legacy Import', 'legacy-local-user', "created_at", "created_at", NULL, NULL, "quarantine_status"
FROM `document_versions`;--> statement-breakpoint
DROP TABLE `document_versions`;--> statement-breakpoint
ALTER TABLE `__new_document_versions` RENAME TO `document_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_document_number_idx` ON `document_versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `document_versions_sha_idx` ON `document_versions` (`sha256`);--> statement-breakpoint
CREATE INDEX `document_versions_document_idx` ON `document_versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`logical_name` text NOT NULL,
	`document_type` text DEFAULT 'Auto Detection' NOT NULL,
	`classification_source` text DEFAULT 'Manual/Unclassified' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`current_version_id` text,
	`archived_at` text,
	`deleted_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "project_id", "logical_name", "document_type", "classification_source", "notes", "tags", "current_version_id", "archived_at", "deleted_at", "created_by", "created_at", "updated_at")
SELECT d."id", d."project_id", d."logical_name", COALESCE(d."corrected_type", 'Auto Detection'),
  CASE WHEN d."corrected_type" IS NULL THEN 'Legacy/Unclassified' ELSE 'Legacy Correction' END,
  '', '[]', (SELECT v."id" FROM `document_versions` v WHERE v."document_id" = d."id" ORDER BY v."uploaded_at" DESC LIMIT 1),
  NULL, NULL, 'legacy-local-user', d."created_at", d."created_at" FROM `documents` d;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `documents_project_idx` ON `documents` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `documents_project_type_idx` ON `documents` (`project_id`,`document_type`);--> statement-breakpoint
DROP INDEX `processing_status_idx`;--> statement-breakpoint
DROP INDEX `processing_document_idx`;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `priority` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `technical_details` text;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `suggested_action` text;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `available_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `document_processing_runs` ADD `last_retry_at` text;--> statement-breakpoint
CREATE INDEX `processing_status_idx` ON `document_processing_runs` (`status`,`available_at`,`priority`);--> statement-breakpoint
CREATE INDEX `processing_document_idx` ON `document_processing_runs` (`document_version_id`,`created_at`);
