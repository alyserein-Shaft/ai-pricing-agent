PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_consolidated_profile_requirements` (
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
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`governing_source_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_consolidated_profile_requirements`("id", "profile_version_id", "canonical_key", "normalized_requirement", "requirement_category", "requirement_type", "priority", "governing_source_id", "sources", "attributes", "standards", "manufacturers", "confidence", "review_status", "created_at") SELECT "id", "profile_version_id", "canonical_key", "normalized_requirement", "requirement_category", "requirement_type", "priority", "governing_source_id", "sources", "attributes", "standards", "manufacturers", "confidence", "review_status", "created_at" FROM `consolidated_profile_requirements`;--> statement-breakpoint
DROP TABLE `consolidated_profile_requirements`;--> statement-breakpoint
ALTER TABLE `__new_consolidated_profile_requirements` RENAME TO `consolidated_profile_requirements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_consolidated_key_idx` ON `consolidated_profile_requirements` (`profile_version_id`,`canonical_key`);