-- DOC-R3A.1 — DOCUMENT REVISION/ADDENDUM SCHEMA
-- Add effective-time columns to document_versions
-- Add document_family_id to documents
-- Create document_supersessions table for partial supersession
-- Create document_families table for revision grouping

-- 1. Add effective-time columns to document_versions
-- SQLite doesn't support adding columns with DEFAULT to existing tables easily in all cases,
-- but ALTER TABLE ADD COLUMN works for nullable columns.
ALTER TABLE `document_versions` ADD COLUMN `effective_from` TEXT;
ALTER TABLE `document_versions` ADD COLUMN `effective_to` TEXT;

-- 2. Add document_family_id to documents
ALTER TABLE `documents` ADD COLUMN `document_family_id` TEXT;

-- 3. Create document_families table (lazy creation - families created when first addendum added)
CREATE TABLE `document_families` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`base_document_id` text NOT NULL,
	`name` text,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);

-- 4. Create document_supersessions table for partial supersession tracking
-- This tracks when a document version supersedes another, with scope granularity
CREATE TABLE `document_supersessions` (
	`id` text PRIMARY KEY NOT NULL,
	`superseding_version_id` text NOT NULL,
	`superseded_version_id` text NOT NULL,
	`scope_type` text NOT NULL CHECK (`scope_type` IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),
	`scope_id` text,
	`supersession_type` text NOT NULL CHECK (`supersession_type` IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),
	`effective_from` TEXT,
	`effective_to` TEXT,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`superseding_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`superseded_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);

-- Index for efficient lookup of supersessions
CREATE INDEX `document_supersessions_superseding_idx` ON `document_supersessions` (`superseding_version_id`);
CREATE INDEX `document_supersessions_superseded_idx` ON `document_supersessions` (`superseded_version_id`);
CREATE INDEX `document_supersessions_scope_idx` ON `document_supersessions` (`scope_type`, `scope_id`);

-- 5. Add document_family_id foreign key to documents (nullable - created lazily)
-- SQLite doesn't support adding FK constraints to existing columns directly
-- We add the column as nullable, FK will be enforced at application layer
-- The FK constraint would be:
-- FOREIGN KEY (`document_family_id`) REFERENCES `document_families`(`id`) ON UPDATE no action ON DELETE no action

-- Index for document family lookups
CREATE INDEX `documents_family_idx` ON `documents` (`document_family_id`);

-- 6. Backfill: existing documents get self-referencing family (each is its own family)
-- This is done at application layer, not in migration