-- REQUIREMENT INTELLIGENCE FACTS -- same source-authority split as 0009.
--
-- Why this migration exists
-- -------------------------
-- 0009 gave profile_requirement_applicability an explicit authority class, so a
-- device-identity OBSERVATION (drawing-requirement:* or boq-requirement:*) is
-- no longer written into a column foreign-keyed to technical_requirements.
--
-- requirement_intelligence_facts has the identical shape and the identical
-- defect, and it is written on the same pass: persistProfile emits one row per
-- profile intelligence fact, and a device-identity entry produces facts whose
-- requirementId is that same synthetic id. Its requirement_id was NOT NULL with
-- an FK to technical_requirements(id), so the save batch aborted on exactly the
-- same constraint 0009 had just fixed one table earlier.
--
-- The two tables are repaired with the SAME vocabulary and the SAME exported
-- classifier (requirementAuthorityClass in
-- app/domain/drawing-requirement-evidence-engine.mjs). Introducing a second,
-- different notion of "is this a device identity" would be duplicate authority
-- -- precisely the defect class this pair of migrations exists to remove.
--
--   requirement_source = 'Specification'          -> requirement_id       (FK technical_requirements)
--   requirement_source = 'DrawingDeviceIdentity'  -> device_identity_ref
--   requirement_source = 'BOQDeviceIdentity'      -> device_identity_ref
--
-- A device-identity intelligence fact is still RECORDED, still reviewable
-- (review_status, reviewed_by, review_reason all still apply), and still
-- reachable by its own reference. Nothing is dropped and nothing is fabricated:
-- this does not create a technical_requirements row, and it does not turn a
-- drawing observation into a specification requirement.
--
-- Uniqueness
-- ----------
-- The existing unique index is (profile_version_id, fact_key) and does NOT
-- include requirement_id, so nullability here opens no duplicate-admission hole
-- -- unlike 0008/0009's applicability index, which is why that one needed a
-- partial index and this one does not. No index change is required beyond
-- recreating the two that exist.
-->
--> statement-breakpoint
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `requirement_intelligence_facts__authority` (
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
	`evidence_snippet` text,
	`extraction_basis` text NOT NULL,
	`engine_version` text NOT NULL,
	`review_status` text NOT NULL,
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
INSERT INTO `requirement_intelligence_facts__authority` (
	`id`, `profile_version_id`, `requirement_source`, `requirement_id`, `device_identity_ref`,
	`fact_key`, `fact_type`, `original_value`, `current_value`, `modality`, `confidence`,
	`source_page`, `source_page_to`, `source_clause`, `source_section`, `evidence_snippet`,
	`extraction_basis`, `engine_version`, `review_status`, `reviewed_by`, `reviewed_at`,
	`review_reason`, `created_at`
)
SELECT
	`id`, `profile_version_id`, 'Specification', `requirement_id`, NULL,
	`fact_key`, `fact_type`, `original_value`, `current_value`, `modality`, `confidence`,
	`source_page`, `source_page_to`, `source_clause`, `source_section`, `evidence_snippet`,
	`extraction_basis`, `engine_version`, `review_status`, `reviewed_by`, `reviewed_at`,
	`review_reason`, `created_at`
FROM `requirement_intelligence_facts`;
--> statement-breakpoint
DROP TABLE `requirement_intelligence_facts`;
--> statement-breakpoint
ALTER TABLE `requirement_intelligence_facts__authority` RENAME TO `requirement_intelligence_facts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_intelligence_profile_key_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`fact_key`);
--> statement-breakpoint
CREATE INDEX `requirement_intelligence_review_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`review_status`,`fact_type`);
