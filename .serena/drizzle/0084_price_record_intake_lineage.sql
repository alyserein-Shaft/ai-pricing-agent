-- DOC-R2A.4.2 — PRICE RECORD SUPPLIER INTAKE LINEAGE
-- Add FK from price_records to supplier_quote_intake_rows for exact supplier intake row lineage
-- This enables exact traceability from price record back to the specific intake row that sourced it

-- SQLite doesn't support adding FK constraints to existing columns directly.
-- We must recreate the table with the new column and FK constraint.

-- 1. Create new table with new column and FK constraint
CREATE TABLE `price_records_new` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source_id` text NOT NULL,
	`supplier_id` text,
	`project_id` text,
	`source_intake_row_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`price_type` text NOT NULL,
	`unit` text DEFAULT 'EA' NOT NULL,
	`minimum_quantity` integer,
	`discount_basis_points` integer,
	`effective_from` text,
	`valid_until` text,
	`validity_state` text NOT NULL,
	`approval_status` text DEFAULT 'Needs Review' NOT NULL,
	`downstream_use` text DEFAULT 'Discovery Only' NOT NULL,
	`terms` text DEFAULT '{}' NOT NULL,
	`source_location` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_intake_row_id`) REFERENCES `supplier_quote_intake_rows`(`id`) ON UPDATE no action ON DELETE no action
);

-- 2. Copy existing data (source_intake_row_id will be NULL for existing records)
INSERT INTO `price_records_new`
SELECT 
  `id`, `product_id`, `source_id`, `supplier_id`, `project_id`,
  NULL as `source_intake_row_id`,
  `amount_minor`, `currency`, `price_type`, `unit`, `minimum_quantity`,
  `discount_basis_points`, `effective_from`, `valid_until`, `validity_state`,
  `approval_status`, `downstream_use`, `terms`, `source_location`,
  `reviewed_by`, `reviewed_at`, `created_at`
FROM `price_records`;

-- 3. Drop old table and rename
DROP TABLE `price_records`;

ALTER TABLE `price_records_new` RENAME TO `price_records`;

-- 4. Recreate indexes
CREATE UNIQUE INDEX `price_records_source_product_location_idx` ON `price_records` (`source_id`,`product_id`,`source_location`);
CREATE INDEX `price_records_product_validity_idx` ON `price_records` (`product_id`,`approval_status`,`valid_until`);
CREATE INDEX `price_records_project_idx` ON `price_records` (`project_id`,`approval_status`);
CREATE INDEX `price_records_source_intake_row_idx` ON `price_records` (`source_intake_row_id`);
