-- PROFILE APPLICABILITY SOURCE AUTHORITY (polymorphic by evidence class).
--
-- Why this migration exists
-- -------------------------
-- profile_requirement_applicability stored ONE reference, `requirement_id`,
-- with a foreign key to technical_requirements(id). That is correct for a
-- SPECIFICATION-sourced requirement, and it stayed correct.
--
-- It is not correct for a DRAWING-sourced requirement. buildDrawingRequirementEntries
-- (app/domain/drawing-requirement-evidence-engine.mjs) mints an id in its own
-- namespace, `drawing-requirement:{recognitionVersionId}:{definitionKey}:{boqItemId}`,
-- for a device-identity entry read off APPROVED drawing evidence. That entry is
-- an OBSERVATION about the item, not a clause of the specification, and it has
-- no technical_requirements row and never should have one.
--
-- The two were being written into the same column, so the drawing row violated
-- the technical_requirements foreign key and aborted the entire save batch.
-- Drawing entries are only produced when an item has an APPROVED AI
-- understanding review (worker/technical-requirement-api.mjs: `drawingEntries =
-- approved ? buildDrawingRequirementEntries(...) : { requirements: [], links: [] }`),
-- so in any project where no item had ever been approved this path had never
-- executed and the defect was latent. The first governed system auto-approval
-- exposed it: profile regeneration became impossible for exactly those items.
--
-- What this migration does
-- -----------------------
-- It does NOT drop the technical_requirements foreign key. Specification
-- applicability keeps full referential integrity.
-- It does NOT create technical_requirements rows for drawing evidence.
-- It does NOT weaken drawing evidence.
--
-- It makes the authority explicit and machine-checked: each applicability row
-- declares which evidence class it came from, and carries exactly ONE governed
-- reference of that class.
--
--   requirement_source = 'Specification' -> requirement_id        (FK-enforced)
--   requirement_source = 'Drawing'       -> drawing_requirement_ref
--
-- A row cannot claim both, and cannot claim neither. That is enforced by CHECK
-- constraints, so the database -- not application code -- is what guarantees a
-- drawing observation can never be read as a technical requirement.
--
-- Why `requirement_source` is stored rather than inferred by the reader
-- ---------------------------------------------------------------
-- The two references are mutually exclusive by CHECK, so a reader could infer
-- it. It is stored anyway because "where did this come from" is a governance
-- question consumers ask directly (a reviewer triaging applicability must be
-- able to see that a row is drawing-sourced without first joining a string
-- namespace convention), and because inference would spread the namespace
-- convention into every consumer instead of keeping it in one place.
--
-- Uniqueness
-- ----------
-- profile_applicability_requirement_idx is UNIQUE(profile_version_id,
-- requirement_id). SQLite permits unlimited NULLs in a unique index, so making
-- requirement_id nullable would have opened a duplicate-admission hole for
-- drawing rows. Two indexes close it per authority class:
--
--   * specification rows keep the existing unique index (requirement_id is NOT
--     NULL for them, by CHECK), so duplicate specification applicability is
--     still impossible;
--   * a new PARTIAL unique index covers drawing rows, which the existing index
--     cannot see because their requirement_id is NULL.
--
-- Drawing reference currency
-- -------------------------
-- The reference embeds recognitionVersionId, so superseding a recognition
-- version produces a different reference rather than a collision. The profile
-- input fingerprint already includes the merged requirement set, so a changed
-- drawing reference changes the fingerprint and the prior applicability is
-- superseded by version, never silently reused.
-->
--> statement-breakpoint
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `profile_requirement_applicability__authority` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_source` text NOT NULL DEFAULT 'Specification',
	`requirement_id` text,
	`drawing_requirement_ref` text,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence` text NOT NULL,
	`priority` text NOT NULL,
	`review_status` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `profile_applicability_authority_class_ck` CHECK (`requirement_source` IN ('Specification', 'Drawing')),
	CONSTRAINT `profile_applicability_exactly_one_source_ck` CHECK (
		(`requirement_source` = 'Specification' AND `requirement_id` IS NOT NULL AND `drawing_requirement_ref` IS NULL)
		OR
		(`requirement_source` = 'Drawing' AND `requirement_id` IS NULL AND `drawing_requirement_ref` IS NOT NULL)
	)
);
--> statement-breakpoint
INSERT INTO `profile_requirement_applicability__authority` (
	`id`, `profile_version_id`, `requirement_source`, `requirement_id`, `drawing_requirement_ref`,
	`status`, `method`, `confidence`, `evidence`, `priority`, `review_status`,
	`reviewed_by`, `reviewed_at`, `review_reason`, `created_at`
)
SELECT
	`id`, `profile_version_id`, 'Specification', `requirement_id`, NULL,
	`status`, `method`, `confidence`, `evidence`, `priority`, `review_status`,
	`reviewed_by`, `reviewed_at`, `review_reason`, `created_at`
FROM `profile_requirement_applicability`;
--> statement-breakpoint
DROP TABLE `profile_requirement_applicability`;
--> statement-breakpoint
ALTER TABLE `profile_requirement_applicability__authority` RENAME TO `profile_requirement_applicability`;
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_requirement_idx` ON `profile_requirement_applicability` (`profile_version_id`,`requirement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_drawing_ref_idx` ON `profile_requirement_applicability` (`profile_version_id`,`drawing_requirement_ref`) WHERE `drawing_requirement_ref` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `profile_applicability_status_idx` ON `profile_requirement_applicability` (`profile_version_id`,`status`);
