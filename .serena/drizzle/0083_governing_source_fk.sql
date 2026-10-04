-- DOC-R2A.4.1 — PROFILE GOVERNING SOURCE FK
-- Add FK constraint from consolidated_profile_requirements.governing_source_id to technical_requirements.id
-- All current governing_source_id values already resolve to technical_requirements.id (verified: 228/228 valid)

-- SQLite doesn't support adding FK constraints to existing columns directly.
-- We must recreate the table with the FK constraint.

-- 1. Create new table with FK constraint
CREATE TABLE `consolidated_profile_requirements_new` (
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

-- 2. Copy data
INSERT INTO `consolidated_profile_requirements_new`
SELECT * FROM `consolidated_profile_requirements`;

-- 3. Drop old table and rename
DROP TABLE `consolidated_profile_requirements`;

ALTER TABLE `consolidated_profile_requirements_new` RENAME TO `consolidated_profile_requirements`;

-- 4. Recreate index
CREATE UNIQUE INDEX `profile_consolidated_key_idx` ON `consolidated_profile_requirements` (`profile_version_id`,`canonical_key`);