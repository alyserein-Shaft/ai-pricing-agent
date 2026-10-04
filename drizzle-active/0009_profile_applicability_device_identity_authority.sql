-- PROFILE APPLICABILITY SOURCE AUTHORITY -- widen to the full device-identity
-- vocabulary (follows 0008, which is already applied; 0008 is not edited).
--
-- Why 0008 was not sufficient
-- -------------------------
-- 0008 split applicability into "Specification" and "Drawing", routing only the
-- `drawing-requirement:` id namespace. That was incomplete.
--
-- The same evidence engine mints a SECOND synthetic namespace:
-- `boq-requirement:device-identity:{boqItemId}`, from
-- buildBoqDeviceIdentityRequirement. It is derived from the BOQ row itself
-- rather than from Drawing evidence, but it is the same kind of thing: a
-- device-identity entry that is NOT a clause of the specification and has no
-- technical_requirements row. Because 0008 did not recognise it, those entries
-- were classified "Specification", kept requirement_id populated, and aborted
-- the save batch on the technical_requirements foreign key -- the same failure,
-- one namespace over.
--
-- The fix is to name the vocabulary honestly rather than collapse it. Calling a
-- BOQ-derived observation "Drawing" would misstate where it came from, and a
-- reviewer triaging applicability is entitled to know that.
--
--   requirement_source = 'Specification'          -> requirement_id          (FK technical_requirements)
--   requirement_source = 'DrawingDeviceIdentity'  -> device_identity_ref
--   requirement_source = 'BOQDeviceIdentity'      -> device_identity_ref
--
-- The column is renamed drawing_requirement_ref -> device_identity_ref because
-- it now carries both synthetic namespaces; the old name would have been a lie
-- for the BOQ rows. Renaming inside a table rebuild keeps every column, default
-- and index, and re-asserts the FK.
--
-- The exactly-one-source CHECK is widened to the same three cases, so a row
-- still cannot claim two identities or none. Uniqueness is unaffected: the
-- partial unique index follows the renamed column, so drawing AND boq
-- device-identity duplicates are both still rejected per profile version, while
-- the same reference may legitimately reappear under a NEW profile version.
-->
--> statement-breakpoint
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `profile_requirement_applicability__authority2` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_source` text NOT NULL DEFAULT 'Specification',
	`requirement_id` text,
	`device_identity_ref` text,
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
	CONSTRAINT `profile_applicability_authority_class_ck` CHECK (`requirement_source` IN ('Specification', 'DrawingDeviceIdentity', 'BOQDeviceIdentity')),
	CONSTRAINT `profile_applicability_exactly_one_source_ck` CHECK (
		(`requirement_source` = 'Specification' AND `requirement_id` IS NOT NULL AND `device_identity_ref` IS NULL)
		OR
		(`requirement_source` IN ('DrawingDeviceIdentity', 'BOQDeviceIdentity') AND `requirement_id` IS NULL AND `device_identity_ref` IS NOT NULL)
	)
);
--> statement-breakpoint
INSERT INTO `profile_requirement_applicability__authority2` (
	`id`, `profile_version_id`, `requirement_source`, `requirement_id`, `device_identity_ref`,
	`status`, `method`, `confidence`, `evidence`, `priority`, `review_status`,
	`reviewed_by`, `reviewed_at`, `review_reason`, `created_at`
)
SELECT
	`id`, `profile_version_id`,
	CASE WHEN `requirement_source` = 'Drawing' THEN 'DrawingDeviceIdentity' ELSE `requirement_source` END,
	`requirement_id`,
	`drawing_requirement_ref`,
	`status`, `method`, `confidence`, `evidence`, `priority`, `review_status`,
	`reviewed_by`, `reviewed_at`, `review_reason`, `created_at`
FROM `profile_requirement_applicability`;
--> statement-breakpoint
DROP TABLE `profile_requirement_applicability`;
--> statement-breakpoint
ALTER TABLE `profile_requirement_applicability__authority2` RENAME TO `profile_requirement_applicability`;
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_requirement_idx` ON `profile_requirement_applicability` (`profile_version_id`,`requirement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_device_identity_idx` ON `profile_requirement_applicability` (`profile_version_id`,`device_identity_ref`) WHERE `device_identity_ref` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `profile_applicability_status_idx` ON `profile_requirement_applicability` (`profile_version_id`,`status`);
