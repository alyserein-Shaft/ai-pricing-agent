-- Stage 9 (2026-09-01): DRAWING -> REQUIREMENT -> KNOWLEDGE HANDOFF.
--
-- Drawing quantity is evidence (Stage 6A) and must never silently overwrite
-- BOQ/tender quantity. When a discrepancy is meaningful, the engineer makes
-- ONE explicit Quantity Source Decision -- Use BOQ Qty / Use Drawing Qty /
-- Enter Reviewed Qty -- and that decision, not either raw number, becomes
-- the quantity downstream BOM/Costing/Quotation actually consumes.
--
-- Append-only, like every other governed decision table in this schema: a
-- new decision INSERTs a new row rather than mutating the previous one in
-- place, so historical quantity decisions are preserved. The CURRENT
-- decision for a BOQ item is its latest row. boq_items.numeric_quantity
-- itself is NEVER mutated by this table -- the original BOQ-extracted
-- quantity remains intact and inspectable regardless of what an engineer
-- later selects.
CREATE TABLE IF NOT EXISTS `boq_quantity_source_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `source` text NOT NULL,
  `selected_quantity` real NOT NULL,
  `boq_quantity` real,
  `drawing_quantity` real,
  `recognition_version_id` text,
  `definition_key` text,
  `reason` text NOT NULL,
  `decided_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`)
);
CREATE INDEX IF NOT EXISTS `boq_quantity_source_decisions_item_idx` ON `boq_quantity_source_decisions` (`boq_item_id`,`created_at`);
