-- MVP-CLOSE-16 -- governed review and promotion of requirement candidates.
--
-- Why this migration exists
-- -----------------------
-- MVP-CLOSE-11 made every discarded specification clause observable.
-- MVP-CLOSE-12 measured that 64 of the discarded units were genuine technical
-- requirements. MVP-CLOSE-13 recovered 58 clause units as a THIRD admission
-- state, REQUIREMENT_CANDIDATE, so an engineer can find them.
--
-- What was missing is the decision. A candidate could be seen and never acted
-- on, and there was no governed way to turn one into a technical requirement or
-- to record that a reviewer deliberately declined it. This migration adds the
-- decision record. It admits nothing by itself.
--
-- Design
-- ------
-- * A DEDICATED TABLE, not new columns on specification_clauses. Column state
--   on the clause would have been a single mutable value and therefore NOT an
--   audit trail: it could not record who decided, when, why, or that a second
--   reviewer later reversed an earlier decision. admission_status stays exactly
--   as CLOSE-11/13 defined it -- a factual outcome of extraction -- and is never
--   written by this workflow, so extraction re-runs remain reproducible.
--
-- * APPEND-ONLY, enforced by triggers, matching the requirement_review_decisions
--   convention already in this schema. A decision is a historical fact; correcting
--   it is a new decision, not an edit. UPDATE and DELETE are refused outright.
--
-- * CANDIDATE IDENTITY is the (clause_id, extraction_version_id) pair, never raw
--   text, page number or sequence. clause_id alone is a primary key but says
--   nothing about WHICH extraction produced it, so the version is carried
--   explicitly and both are foreign keys. A decision taken against a superseded
--   extraction therefore cannot silently apply to a later re-extraction, which
--   is the failure the brief calls out by name.
--
-- * SOURCE FINGERPRINT and CANDIDATE MECHANISM are recorded as provenance, not
--   as authority. They let a later reviewer tell "the same evidence re-extracted"
--   from "different evidence at the same position", without ever being used to
--   match one decision onto another.
--
-- * EXACTLY-ONCE PROMOTION is enforced in the schema, not only in application
--   code. Two partial unique indexes make a second promotion of the same clause
--   physically impossible, so two concurrent Promote requests cannot produce two
--   technical requirements even if both pass their read checks first. A second
--   rejection of the same clause is likewise a no-op rather than a duplicate
--   history row. These are the DB-level backstops; the route still checks and
--   reports a conflict deterministically.
--
-- * ONE REQUIREMENT PER PROMOTION is enforced by a partial unique index on
--   requirement_id, so a single technical requirement can never be attributed to
--   two different candidate clauses.
--
-- What this migration explicitly does NOT do
-- -----------------------------------------
-- It does not admit any clause as a technical requirement, does not change the
-- requirement-admission predicate, the candidate mechanisms, segmentation,
-- addressing, page spans, clause_id resolution, or any downstream authority
-- rule. A promoted requirement still starts non-authoritative and must cross
-- the ordinary governed approval boundary separately. Downstream authority is
-- defined in worker/current-evidence-scope.mjs and is untouched here.
--
-- NOTE ON deleted_at: a decision survives deletion of nothing. There is no soft
-- delete on any of these tables, and a rejected candidate must remain visible
-- historically, so this table is deliberately never cascaded or purged.
CREATE TABLE `specification_clause_candidate_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `clause_id` text NOT NULL,
  `extraction_version_id` text NOT NULL,
  `project_id` text NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `decision` text NOT NULL CHECK (`decision` IN ('Promoted','Rejected')),
  `candidate_mechanism` text,
  `non_admission_reason` text,
  `source_fingerprint` text,
  `requirement_id` text,
  `reason` text NOT NULL,
  `evidence` text,
  `decided_by` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`clause_id`) REFERENCES `specification_clauses`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `spec_candidate_decisions_clause_idx` ON `specification_clause_candidate_decisions` (`clause_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `spec_candidate_decisions_project_idx` ON `specification_clause_candidate_decisions` (`project_id`,`decision`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `spec_candidate_decisions_requirement_idx` ON `specification_clause_candidate_decisions` (`requirement_id`);
--> statement-breakpoint
-- Exactly one promotion per candidate clause. This is the schema-level
-- guarantee behind "parallel Promote requests produce exactly one requirement".
CREATE UNIQUE INDEX `spec_candidate_decisions_one_promotion_per_clause_idx` ON `specification_clause_candidate_decisions` (`clause_id`) WHERE `decision` = 'Promoted';
--> statement-breakpoint
-- Exactly one candidate clause per promoted requirement.
CREATE UNIQUE INDEX `spec_candidate_decisions_one_requirement_per_promotion_idx` ON `specification_clause_candidate_decisions` (`requirement_id`) WHERE `decision` = 'Promoted' AND `requirement_id` IS NOT NULL;
--> statement-breakpoint
-- Repeating the same decision on the same clause is a no-op, not a duplicate
-- history row. Cross-decision conflicts (Promote then Reject) are deliberately
-- NOT blocked here; they are refused by the route with an explicit, honest
-- conflict rather than by a silent constraint violation.
CREATE UNIQUE INDEX `spec_candidate_decisions_one_decision_per_clause_idx` ON `specification_clause_candidate_decisions` (`clause_id`,`decision`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS specification_clause_candidate_decisions_immutable_delete
BEFORE DELETE ON specification_clause_candidate_decisions
BEGIN
  SELECT RAISE(ABORT, 'specification clause candidate decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS specification_clause_candidate_decisions_immutable_update
BEFORE UPDATE ON specification_clause_candidate_decisions
BEGIN
  SELECT RAISE(ABORT, 'specification clause candidate decisions are immutable');
END;
