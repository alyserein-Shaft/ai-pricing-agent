CREATE TABLE `library_products` (
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer_id` text NOT NULL,
	`brand_id` text,
	`family_id` text,
	`part_number` text NOT NULL,
	`normalized_part_number` text NOT NULL,
	`description` text NOT NULL,
	`lifecycle_status` text DEFAULT 'Unknown — Review Required' NOT NULL,
	`country_of_origin` text,
	`attributes` text DEFAULT '[]' NOT NULL,
	`standards` text DEFAULT '[]' NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`approved_for_discovery` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `product_brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `product_families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_products_identity_idx` ON `library_products` (`manufacturer_id`,`normalized_part_number`);--> statement-breakpoint
CREATE INDEX `library_products_family_idx` ON `library_products` (`family_id`,`review_status`);--> statement-breakpoint
CREATE INDEX `library_products_discovery_idx` ON `library_products` (`approved_for_discovery`,`lifecycle_status`);--> statement-breakpoint
CREATE TABLE `price_records` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source_id` text NOT NULL,
	`supplier_id` text,
	`project_id` text,
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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_records_source_product_location_idx` ON `price_records` (`source_id`,`product_id`,`source_location`);--> statement-breakpoint
CREATE INDEX `price_records_product_validity_idx` ON `price_records` (`product_id`,`approval_status`,`valid_until`);--> statement-breakpoint
CREATE INDEX `price_records_project_idx` ON `price_records` (`project_id`,`approval_status`);--> statement-breakpoint
CREATE TABLE `product_brands` (
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`status` text DEFAULT 'Needs Review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_brands_manufacturer_name_idx` ON `product_brands` (`manufacturer_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `product_families` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`parent_family_id` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`engineering_domain` text,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `product_brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_families_brand_idx` ON `product_families` (`brand_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `product_library_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_role` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_library_decisions_entity_idx` ON `product_library_decisions` (`entity_type`,`entity_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `product_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`product_id` text,
	`obsolete_part_number` text NOT NULL,
	`lifecycle_status` text NOT NULL,
	`replacement_candidates` text DEFAULT '[]' NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`source_location` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_lifecycle_part_idx` ON `product_lifecycle_events` (`obsolete_part_number`,`review_status`);--> statement-breakpoint
CREATE TABLE `product_manufacturers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`status` text DEFAULT 'Needs Review' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_manufacturers_name_idx` ON `product_manufacturers` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `product_source_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source_id` text NOT NULL,
	`sheet` text,
	`row_number` integer,
	`page` integer,
	`cells` text DEFAULT '[]' NOT NULL,
	`original_text` text,
	`parser_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_source_evidence_idx` ON `product_source_evidence` (`product_id`,`source_id`,`sheet`,`row_number`);--> statement-breakpoint
CREATE TABLE `product_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`document_id` text,
	`document_version_id` text,
	`checksum` text NOT NULL,
	`source_type` text NOT NULL,
	`authority` text NOT NULL,
	`scope_type` text NOT NULL,
	`file_name` text NOT NULL,
	`release_version` text,
	`effective_from` text,
	`valid_until` text,
	`currency` text,
	`validity_state` text NOT NULL,
	`review_status` text DEFAULT 'Needs Review' NOT NULL,
	`downstream_use` text DEFAULT 'Discovery Only' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_sources_checksum_scope_idx` ON `product_sources` (`checksum`,`scope_type`,`project_id`);--> statement-breakpoint
CREATE INDEX `product_sources_project_idx` ON `product_sources` (`project_id`,`source_type`,`review_status`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`country` text,
	`status` text DEFAULT 'Needs Review' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_name_idx` ON `suppliers` (`normalized_name`);