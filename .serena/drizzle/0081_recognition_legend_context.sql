-- Phase 2 -- GOVERNED CROSS-DOCUMENT LEGEND CONTEXTS.
--
-- The governed relationship that lets symbol recognition for one document
-- (the target, e.g. a WLC schematic) consume approved legend geometry from
-- ANOTHER document in the same project (the legend source, e.g. the T-00
-- legend sheet). Recognition may use a cross-document source ONLY through an
-- explicit, reason-governed, append-only context row that pins the source's
-- approved geometry version -- there is deliberately no implicit or
-- project-wide geometry lookup. "WHY is document X allowed to define symbols
-- for document Y?" is answered by a real row here (actor, reason, source
-- document/version, approved geometry version).
--
-- Same-document recognition needs no context: it keeps consuming the target
-- document's own approved geometry, exactly as before.

CREATE TABLE IF NOT EXISTS `drawing_recognition_legend_contexts` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `target_document_id` text NOT NULL REFERENCES `documents`(`id`),
  `source_document_id` text NOT NULL REFERENCES `documents`(`id`),
  `source_document_version_id` text,
  `approved_geometry_version_id` text NOT NULL REFERENCES `drawing_legend_geometry_approved_versions`(`id`),
  `reason` text NOT NULL,
  `created_by` text NOT NULL,
  `superseded_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS `drawing_legend_context_current_idx` ON `drawing_recognition_legend_contexts` (`target_document_id`, `superseded_at`);

-- Recognition-run provenance: which document supplied the legend
-- definitions (the target itself for same-document runs, the governed legend
-- source otherwise) and which approved geometry version was consumed. Both
-- nullable-free in spirit but added as plain nullable columns so existing
-- rows (all same-document) keep their historical meaning; new runs always
-- write them.
ALTER TABLE `drawing_symbol_recognition_versions` ADD COLUMN `source_document_id` text;
ALTER TABLE `drawing_symbol_recognition_versions` ADD COLUMN `source_legend_geometry_version_id` text;

-- Per-definition provenance: the document each legend definition came FROM.
ALTER TABLE `drawing_symbol_definitions` ADD COLUMN `source_document_id` text;
