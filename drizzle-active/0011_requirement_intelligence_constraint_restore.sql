-- REQUIREMENT INTELLIGENCE FACTS -- restore the two constraints 0010's rebuild lost.
--
-- Why this migration exists
-- -------------------------
-- 0010 rebuilt requirement_intelligence_facts to split the Specification /
-- DrawingDeviceIdentity / BOQDeviceIdentity authority classes (the same split
-- 0009 gave profile_requirement_applicability). During that rebuild two column
-- contracts from the previous table definition were dropped:
--
--   1. `evidence_snippet` lost NOT NULL            (allowed NULLs to be written)
--   2. `review_status`   lost DEFAULT 'Needs Review' (no longer self-seeding)
--
-- db/schema.ts declares both intended contracts (evidenceSnippet is notNull;
-- reviewStatus is notNull with default "Needs Review"), the manifest carries
-- them, and the 0010 snapshot (derived from db/schema.ts) already describes
-- them. Only the applied chain SQL and the live database drifted. Every
-- production write path supplies evidence_snippet and review_status explicitly
-- (worker/technical-requirement-api.mjs lines ~346 and ~492), so this repair
-- is a fidelity restore, not a behavior change.
--
-- This table has NO inbound foreign keys (no table references
-- requirement_intelligence_facts), so the rebuild is safe under
-- foreign_keys=ON. Every column, constraint, index and row is preserved; the
-- only differences from post-0010 state are the two restored column
-- contracts.
--
-- Uniqueness / indexes are rebuilt exactly as 0010 left them:
--   requirement_intelligence_profile_key_idx (unique) and
--   requirement_intelligence_review_idx. No new objects are created.
-->
--> statement-breakpoint
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `requirement_intelligence_facts__constraint` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_source` text NOT NULL DEFAULT 'Specification',
	`requirement_id` text,
	`device_identity_ref` text,
	`fact_key` text NOT NULL,
	`fact_type` text NOT NULL,
	`original_value` text NOT NULL,
	`current_value` text NOT NULL,
	`modality` text NOT NULL,
	`confidence` integer NOT NULL,
	`source_page` integer,
	`source_page_to` integer,
	`source_clause` text,
	`source_section` text,
	`evidence_snippet` text NOT NULL,
	`extraction_basis` text NOT NULL,
	`engine_version` text NOT NULL,
	`review_status` text NOT NULL DEFAULT 'Needs Review',
	`reviewed_by` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `requirement_intelligence_authority_class_ck` CHECK (`requirement_source` IN ('Specification', 'DrawingDeviceIdentity', 'BOQDeviceIdentity')),
	CONSTRAINT `requirement_intelligence_exactly_one_source_ck` CHECK (
		(`requirement_source` = 'Specification' AND `requirement_id` IS NOT NULL AND `device_identity_ref` IS NULL)
		OR
		(`requirement_source` IN ('DrawingDeviceIdentity', 'BOQDeviceIdentity') AND `requirement_id` IS NULL AND `device_identity_ref` IS NOT NULL)
	)
);
--> statement-breakpoint
INSERT INTO `requirement_intelligence_facts__constraint` (
	`id`, `profile_version_id`, `requirement_source`, `requirement_id`, `device_identity_ref`,
	`fact_key`, `fact_type`, `original_value`, `current_value`, `modality`, `confidence`,
	`source_page`, `source_page_to`, `source_clause`, `source_section`, `evidence_snippet`,
	`extraction_basis`, `engine_version`, `review_status`, `reviewed_by`, `reviewed_at`,
	`review_reason`, `created_at`
)
SELECT
	`id`, `profile_version_id`, `requirement_source`, `requirement_id`, `device_identity_ref`,
	`fact_key`, `fact_type`, `original_value`, `current_value`, `modality`, `confidence`,
	`source_page`, `source_page_to`, `source_clause`, `source_section`, `evidence_snippet`,
	`extraction_basis`, `engine_version`, `review_status`, `reviewed_by`, `reviewed_at`,
	`review_reason`, `created_at`
FROM `requirement_intelligence_facts`;
--> statement-breakpoint
DROP TABLE `requirement_intelligence_facts`;
--> statement-breakpoint
ALTER TABLE `requirement_intelligence_facts__constraint` RENAME TO `requirement_intelligence_facts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_intelligence_profile_key_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`fact_key`);
--> statement-breakpoint
CREATE INDEX `requirement_intelligence_review_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`review_status`,`fact_type`);