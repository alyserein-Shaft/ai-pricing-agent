-- 0023_drawing_quantity_semantic_adjudications.sql
--
-- CANONICAL PERSISTENCE FOR DRAWING QUANTITY SEMANTIC ADJUDICATION
--
-- This is the system of record for the cross-document quantity reasoning
-- artifact produced by app/domain/quantity-reasoning.mjs. It is append-only and
-- version-scoped by an aggregate adjudication fingerprint; a stale row is
-- marked 'superseded', hour 'current' reflects only the latest.
--
-- It is deliberately NOT a quantity claim. An unresolved/ambiguous adjudication
-- stores quantity axes as NULL and is never copied into
-- drawing_quantity_claims without a later proven physical quantity.

CREATE TABLE IF NOT EXISTS `drawing_quantity_semantic_adjudications` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `subject_boq_item_id` text,
  `drawing_evidence_fingerprint` text,
  `boq_evidence_fingerprint` text,
  `spec_evidence_fingerprint` text,
  `manufacturer_evidence_fingerprint` text,
  `adjudication_fingerprint` text NOT NULL,
  `occurrence_count` real,
  `device_count` real,
  `zone_count` real,
  `module_count` real,
  `axes_json` text,
  `relation_results_json` text,
  `multiplier_referent_state` text,
  `boq_drawing_reconciliation` text,
  `reason` text,
  `evidence_ids_json` text,
  `ai_provider` text,
  `ai_model` text,
  `ai_is_authority` integer NOT NULL DEFAULT 0,
  `state` text NOT NULL DEFAULT 'current',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dqsa_project_fingerprint_idx` ON `drawing_quantity_semantic_adjudications` (`project_id`, `adjudication_fingerprint`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dqsa_subject_idx` ON `drawing_quantity_semantic_adjudications` (`subject_boq_item_id`, `created_at`);

--> statement-breakpoint
ALTER TABLE drawing_quantity_semantic_adjudications ADD COLUMN reconciliation_detail_json text;
