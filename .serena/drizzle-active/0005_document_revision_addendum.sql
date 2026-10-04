-- DOC-R3A.1 -- Document revision / addendum / supersession authority.
--
-- This is the only authority that materialises document revision, addendum and
-- supersession state. The legacy `drizzle/0085_document_revision_addendum.sql`
-- file remains immutable history and is never executed; this active migration
-- carries the same intended schema with the integrity and apply-safety gaps
-- closed.
--
-- Governance decisions applied here (DOC-R3 architecture study sections 6-17):
--   * Effective time is first-class and separate from recorded time, and the
--     database refuses an inverted effective window.
--   * Supersession is append-only history expressed as rows, never a mutable
--     "current" flag on a historical version.
--   * A supersession must name a real target: partial scope requires a scope id,
--     full-document scope forbids one, and a version can never supersede itself.
--   * Document families are real rows with typed foreign keys, and every
--     pre-existing document is assigned exactly one self-family by a
--     deterministic derivation rather than an invented grouping.
--
-- Apply safety: this migration never drops or renames a table. Every step is
-- additive, so it applies inside a transaction while foreign-key enforcement is
-- on. A parent-table rebuild cannot do that, and `documents` is a parent table
-- referenced throughout the baseline, which is why the family link is added as a
-- column rather than a foreign key (recorded as an R3A.1 residual).
-- --> statement-breakpoint
-- 1. Document families.
--    Created first so the family rows below have a real parent, and so a family
--    is anchored on exactly one base document.
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
--> statement-breakpoint
--    Two independent foreign keys cannot express "this family belongs to the
--    same project as its base document", and that is a real isolation rule: a
--    family row is what downstream consumers use to group a document, so a
--    cross-project family would be a cross-project evidence leak. A guard trigger
--    is the only additive way to close it.
CREATE TRIGGER `document_families_project_guard` BEFORE INSERT ON `document_families` FOR EACH ROW WHEN NEW.`project_id` <> (SELECT d.`project_id` FROM `documents` d WHERE d.`id` = NEW.`base_document_id`) BEGIN SELECT RAISE(ABORT, 'DOCUMENT_FAMILY_PROJECT_MISMATCH'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX `document_families_base_document_idx` ON `document_families` (`base_document_id`);
--> statement-breakpoint
CREATE INDEX `document_families_project_idx` ON `document_families` (`project_id`);
--> statement-breakpoint
-- 2. Effective time on document revisions.
--    The checks are attached to the added columns so an inverted or impossible
--    window is rejected by the database, not only by the intake form. Both a bare
--    calendar date and a full ISO-8601 timestamp are accepted, because recorded
--    time is an instant while effective time may be declared as a date. The
--    explicit `IS NOT NULL` matters: a CHECK that evaluates to NULL passes, so
--    relying on `date(...) = ...` alone would let `2026-02-31` through.
ALTER TABLE `document_versions` ADD COLUMN `effective_from` text CHECK (
	`effective_from` IS NULL OR (
		length(`effective_from`) >= 10
		AND substr(`effective_from`, 5, 1) = '-'
		AND substr(`effective_from`, 8, 1) = '-'
		AND date(substr(`effective_from`, 1, 10)) IS NOT NULL
		AND date(substr(`effective_from`, 1, 10)) = substr(`effective_from`, 1, 10)
	)
);
--> statement-breakpoint
ALTER TABLE `document_versions` ADD COLUMN `effective_to` text CHECK (
	(`effective_to` IS NULL OR (
		length(`effective_to`) >= 10
		AND substr(`effective_to`, 5, 1) = '-'
		AND substr(`effective_to`, 8, 1) = '-'
		AND date(substr(`effective_to`, 1, 10)) IS NOT NULL
		AND date(substr(`effective_to`, 1, 10)) = substr(`effective_to`, 1, 10)
	))
	AND (`effective_to` IS NULL OR `effective_from` IS NULL OR `effective_to` >= `effective_from`)
);
--> statement-breakpoint
-- 3. Append-only supersession history.
CREATE TABLE `document_supersessions` (
	`id` text PRIMARY KEY NOT NULL,
	`superseding_version_id` text NOT NULL,
	`superseded_version_id` text NOT NULL,
	`scope_type` text NOT NULL CHECK (`scope_type` IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),
	`scope_id` text,
	`supersession_type` text NOT NULL CHECK (`supersession_type` IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),
	`effective_from` text,
	`effective_to` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`superseding_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`superseded_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CHECK (`superseding_version_id` <> `superseded_version_id`),
	CHECK ((`scope_type` = 'FULL_DOCUMENT' AND `scope_id` IS NULL) OR (`scope_type` <> 'FULL_DOCUMENT' AND `scope_id` IS NOT NULL AND length(trim(`scope_id`)) > 0)),
	CHECK (`effective_from` IS NULL OR (
		length(`effective_from`) >= 10
		AND substr(`effective_from`, 5, 1) = '-'
		AND substr(`effective_from`, 8, 1) = '-'
		AND date(substr(`effective_from`, 1, 10)) IS NOT NULL
		AND date(substr(`effective_from`, 1, 10)) = substr(`effective_from`, 1, 10)
	)),
	CHECK (`effective_to` IS NULL OR (
		length(`effective_to`) >= 10
		AND substr(`effective_to`, 5, 1) = '-'
		AND substr(`effective_to`, 8, 1) = '-'
		AND date(substr(`effective_to`, 1, 10)) IS NOT NULL
		AND date(substr(`effective_to`, 1, 10)) = substr(`effective_to`, 1, 10)
	)),
	CHECK (`effective_to` IS NULL OR `effective_from` IS NULL OR `effective_to` >= `effective_from`)
);
--> statement-breakpoint
--    A supersession links two revisions of one document. Without this a caller
--    could point document A's version at document B's version and quietly fuse
--    two independent revision chains.
CREATE TRIGGER `document_supersessions_same_document_guard` BEFORE INSERT ON `document_supersessions` FOR EACH ROW WHEN (SELECT s.`document_id` FROM `document_versions` s WHERE s.`id` = NEW.`superseding_version_id`) <> (SELECT t.`document_id` FROM `document_versions` t WHERE t.`id` = NEW.`superseded_version_id`) BEGIN SELECT RAISE(ABORT, 'DOCUMENT_SUPERSESSION_CROSS_DOCUMENT'); END;
--> statement-breakpoint
--    Supersession is the authority that says which evidence is no longer in
--    force. Rewriting or deleting that record after the fact would let a
--    superseded claim be presented as never superseded, so the history is
--    append-only at the database, matching the review-decision precedent in
--    `0003_review_decision_immutability.sql`.
CREATE TRIGGER `document_supersessions_append_only_update` BEFORE UPDATE ON `document_supersessions` FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'DOCUMENT_SUPERSESSIONS_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `document_supersessions_append_only_delete` BEFORE DELETE ON `document_supersessions` FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'DOCUMENT_SUPERSESSIONS_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE INDEX `document_supersessions_superseding_idx` ON `document_supersessions` (`superseding_version_id`);
--> statement-breakpoint
CREATE INDEX `document_supersessions_superseded_idx` ON `document_supersessions` (`superseded_version_id`);
--> statement-breakpoint
CREATE INDEX `document_supersessions_scope_idx` ON `document_supersessions` (`scope_type`,`scope_id`);
--> statement-breakpoint
--    Two plain partial unique indexes rather than one expression index: a full
--    document supersession carries a NULL scope id, which a single unique index
--    would treat as always-distinct, and an expression index cannot be
--    regenerated faithfully by the schema tooling.
CREATE UNIQUE INDEX `document_supersessions_identity_idx` ON `document_supersessions` (`superseding_version_id`,`superseded_version_id`,`scope_type`,`scope_id`) WHERE "document_supersessions"."scope_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `document_supersessions_full_identity_idx` ON `document_supersessions` (`superseding_version_id`,`superseded_version_id`,`scope_type`) WHERE "document_supersessions"."scope_id" is null;
--> statement-breakpoint
-- 4. Governed family link on documents, plus family and effective-window indexes.
--    The column is added rather than rebuilt: `documents` is a parent table, and
--    rebuilding it would require dropping it, which cannot happen inside a
--    transaction with foreign keys enforced. The link is therefore nullable at
--    the column and owned by intake, while the family row itself stays fully
--    foreign-key constrained and uniquely anchored on its base document.
ALTER TABLE `documents` ADD COLUMN `document_family_id` text;
--> statement-breakpoint
CREATE INDEX `documents_family_idx` ON `documents` (`document_family_id`);
--> statement-breakpoint
CREATE INDEX `document_versions_effective_idx` ON `document_versions` (`document_id`,`effective_from`,`effective_to`);
--> statement-breakpoint
-- 5. Self-family backfill.
--    One family per existing document, keyed deterministically from the document
--    id, and the document is linked in the same step. This writes only the newly
--    introduced revision columns; no historical document evidence, version
--    metadata, approval, classification or audit row is read, rewritten or
--    discarded. A document that is already linked is left untouched.
INSERT INTO `document_families` (`id`, `project_id`, `base_document_id`, `name`, `created_at`)
SELECT 'docfam_' || `id`, `project_id`, `id`, `logical_name`, `created_at` FROM `documents` WHERE `id` NOT IN (SELECT `base_document_id` FROM `document_families`);
--> statement-breakpoint
UPDATE `documents` SET `document_family_id` = 'docfam_' || `id` WHERE `document_family_id` IS NULL;
