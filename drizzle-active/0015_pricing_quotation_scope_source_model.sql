PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `pricing_lines_new` (
  `id` text PRIMARY KEY NOT NULL,
  `pricing_run_id` text NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text,
  `candidate_id` text,
  `product_id` text NOT NULL,
  `safety_decision_id` text,
  `selected_price_record_id` text,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `quantity` text NOT NULL,
  `unit` text NOT NULL,
  `source_currency` text,
  `project_currency` text NOT NULL,
  `original_list_price_minor` integer,
  `net_material_unit_minor` integer,
  `material_total_minor` integer,
  `direct_cost_minor` integer,
  `total_cost_minor` integer,
  `gross_selling_minor` integer,
  `customer_discount_minor` integer,
  `net_selling_minor` integer,
  `vat_minor` integer,
  `final_value_minor` integer,
  `margin_basis_points` integer,
  `markup_basis_points` integer,
  `output` text NOT NULL,
  `explanation` text NOT NULL,
  `approval_ready` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `source_type` text NOT NULL,
  `engineering_scope_kind` text,
  `system` text,
  `source_role` text,
  `source_snapshot_id` text,
  `source_fingerprint` text,
  `source_product_id` text NOT NULL,
  FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`selected_price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (
    (source_type = 'PRODUCT' AND boq_item_id IS NOT NULL AND candidate_id IS NOT NULL AND safety_decision_id IS NOT NULL
     AND engineering_scope_kind IS NULL AND system IS NULL AND source_role IS NULL AND source_snapshot_id IS NULL AND source_fingerprint IS NULL
     AND source_product_id = product_id)
    OR
    (source_type = 'SCOPE' AND boq_item_id IS NULL AND candidate_id IS NULL AND safety_decision_id IS NULL
     AND engineering_scope_kind IS NOT NULL AND system IS NOT NULL AND source_role IS NOT NULL AND source_snapshot_id IS NOT NULL AND source_fingerprint IS NOT NULL
     AND source_product_id = product_id)
  )
);
--> statement-breakpoint
INSERT INTO `pricing_lines_new` (
  `id`,`pricing_run_id`,`project_id`,`boq_item_id`,`candidate_id`,`product_id`,`safety_decision_id`,`selected_price_record_id`,
  `version_number`,`status`,`quantity`,`unit`,`source_currency`,`project_currency`,`original_list_price_minor`,
  `net_material_unit_minor`,`material_total_minor`,`direct_cost_minor`,`total_cost_minor`,`gross_selling_minor`,
  `customer_discount_minor`,`net_selling_minor`,`vat_minor`,`final_value_minor`,`margin_basis_points`,`markup_basis_points`,
  `output`,`explanation`,`approval_ready`,`created_at`,
  `source_type`,`engineering_scope_kind`,`system`,`source_role`,`source_snapshot_id`,`source_fingerprint`,`source_product_id`
)
SELECT
  `id`,`pricing_run_id`,`project_id`,`boq_item_id`,`candidate_id`,`product_id`,`safety_decision_id`,`selected_price_record_id`,
  `version_number`,`status`,`quantity`,`unit`,`source_currency`,`project_currency`,`original_list_price_minor`,
  `net_material_unit_minor`,`material_total_minor`,`direct_cost_minor`,`total_cost_minor`,`gross_selling_minor`,
  `customer_discount_minor`,`net_selling_minor`,`vat_minor`,`final_value_minor`,`margin_basis_points`,`markup_basis_points`,
  `output`,`explanation`,`approval_ready`,`created_at`,
  'PRODUCT',NULL,NULL,NULL,NULL,NULL,`product_id`
FROM `pricing_lines`;
--> statement-breakpoint
DELETE FROM `pricing_lines`;
--> statement-breakpoint
DROP TABLE `pricing_lines`;
--> statement-breakpoint
ALTER TABLE `pricing_lines_new` RENAME TO `pricing_lines`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pricing_lines_candidate_idx` ON `pricing_lines` (`candidate_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pricing_lines_project_status_idx` ON `pricing_lines` (`project_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pricing_lines_run_item_idx` ON `pricing_lines` (`pricing_run_id`,`boq_item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pricing_lines_scope_uniq` ON `pricing_lines` (`pricing_run_id`,`engineering_scope_kind`,`system`,`source_product_id`,`source_role`) WHERE `boq_item_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `project_quotation_lines_new` (
  `id` text PRIMARY KEY NOT NULL,
  `quotation_revision_id` text NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text,
  `sequence` integer NOT NULL,
  `item_number` text,
  `description` text,
  `unit` text NOT NULL,
  `quantity` text NOT NULL,
  `candidate_id` text,
  `product_id` text NOT NULL,
  `manufacturer_name` text NOT NULL,
  `part_number` text NOT NULL,
  `product_description` text NOT NULL,
  `pricing_run_id` text NOT NULL,
  `pricing_run_version` integer NOT NULL,
  `pricing_line_id` text NOT NULL,
  `pricing_line_version` integer NOT NULL,
  `pricing_input_fingerprint` text NOT NULL,
  `commercial_approval_id` text NOT NULL,
  `commercial_approval_version` integer NOT NULL,
  `currency` text NOT NULL,
  `total_cost_minor` integer NOT NULL,
  `net_selling_minor` integer NOT NULL,
  `source_snapshot_json` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source_type` text NOT NULL,
  `engineering_scope_kind` text,
  `system` text,
  `source_role` text,
  `source_snapshot_id` text,
  `source_fingerprint` text,
  `source_product_id` text NOT NULL,
  UNIQUE(`quotation_revision_id`,`boq_item_id`),
  FOREIGN KEY (`quotation_revision_id`) REFERENCES `project_quotation_revisions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`commercial_approval_id`) REFERENCES `pricing_approvals`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (
    (source_type = 'PRODUCT' AND boq_item_id IS NOT NULL AND candidate_id IS NOT NULL
     AND engineering_scope_kind IS NULL AND system IS NULL AND source_role IS NULL AND source_snapshot_id IS NULL AND source_fingerprint IS NULL
     AND source_product_id = product_id)
    OR
    (source_type = 'SCOPE' AND boq_item_id IS NULL AND candidate_id IS NULL
     AND engineering_scope_kind IS NOT NULL AND system IS NOT NULL AND source_role IS NOT NULL AND source_snapshot_id IS NOT NULL AND source_fingerprint IS NOT NULL
     AND source_product_id = product_id)
  )
);
--> statement-breakpoint
INSERT INTO `project_quotation_lines_new` (
  `id`,`quotation_revision_id`,`project_id`,`boq_item_id`,`sequence`,`item_number`,`description`,`unit`,`quantity`,
  `candidate_id`,`product_id`,`manufacturer_name`,`part_number`,`product_description`,
  `pricing_run_id`,`pricing_run_version`,`pricing_line_id`,`pricing_line_version`,`pricing_input_fingerprint`,
  `commercial_approval_id`,`commercial_approval_version`,`currency`,`total_cost_minor`,`net_selling_minor`,
  `source_snapshot_json`,`created_at`,
  `source_type`,`engineering_scope_kind`,`system`,`source_role`,`source_snapshot_id`,`source_fingerprint`,`source_product_id`
)
SELECT
  `id`,`quotation_revision_id`,`project_id`,`boq_item_id`,`sequence`,`item_number`,`description`,`unit`,`quantity`,
  `candidate_id`,`product_id`,`manufacturer_name`,`part_number`,`product_description`,
  `pricing_run_id`,`pricing_run_version`,`pricing_line_id`,`pricing_line_version`,`pricing_input_fingerprint`,
  `commercial_approval_id`,`commercial_approval_version`,`currency`,`total_cost_minor`,`net_selling_minor`,
  `source_snapshot_json`,`created_at`,
  'PRODUCT',NULL,NULL,NULL,NULL,NULL,`product_id`
FROM `project_quotation_lines`;
--> statement-breakpoint
-- The immutability guards would otherwise abort the DELETE that precedes the
-- rebuild; drop them before the rebuild and recreate after the RENAME.
DROP TRIGGER IF EXISTS `quotation_line_snapshot_delete_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `quotation_line_snapshot_update_guard`;
--> statement-breakpoint
DELETE FROM `project_quotation_lines`;
--> statement-breakpoint
DROP TABLE `project_quotation_lines`;
--> statement-breakpoint
ALTER TABLE `project_quotation_lines_new` RENAME TO `project_quotation_lines`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quotation_lines_pricing_idx` ON `project_quotation_lines` (`pricing_run_id`,`pricing_line_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quotation_lines_product_idx` ON `project_quotation_lines` (`product_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quotation_lines_project_idx` ON `project_quotation_lines` (`project_id`,`quotation_revision_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quotation_lines_revision_idx` ON `project_quotation_lines` (`quotation_revision_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `quotation_lines_scope_uniq` ON `project_quotation_lines` (`quotation_revision_id`,`engineering_scope_kind`,`system`,`source_product_id`,`source_role`) WHERE `boq_item_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `quotation_line_snapshot_delete_guard` BEFORE DELETE ON `project_quotation_lines` BEGIN SELECT RAISE(ABORT, 'QUOTATION_LINE_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `quotation_line_snapshot_update_guard` BEFORE UPDATE ON `project_quotation_lines` BEGIN SELECT RAISE(ABORT, 'QUOTATION_LINE_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;