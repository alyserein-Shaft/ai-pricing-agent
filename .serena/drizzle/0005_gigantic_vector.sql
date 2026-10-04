CREATE TABLE `boq_requirement_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`boq_item_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`link_method` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`scope_type` text DEFAULT 'BOQ Item' NOT NULL,
	`scope_id` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_reason` text,
	`version_number` integer DEFAULT 1 NOT NULL,
	`previous_version_id` text,
	`superseded_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_requirement_link_version_idx` ON `boq_requirement_links` (`boq_item_id`,`requirement_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `boq_requirement_link_project_status_idx` ON `boq_requirement_links` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `engineering_attribute_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`taxonomy_term_id` text,
	`canonical_name` text NOT NULL,
	`display_name` text NOT NULL,
	`engineering_domain` text,
	`applicable_categories` text DEFAULT '[]' NOT NULL,
	`data_type` text NOT NULL,
	`unit_family` text,
	`allowed_units` text DEFAULT '[]' NOT NULL,
	`allowed_values` text DEFAULT '[]' NOT NULL,
	`comparison_method` text NOT NULL,
	`normalization_rules` text DEFAULT '{}' NOT NULL,
	`synonyms` text DEFAULT '[]' NOT NULL,
	`validation_rules` text DEFAULT '{}' NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`taxonomy_term_id`) REFERENCES `engineering_taxonomy_terms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_attributes_name_version_idx` ON `engineering_attribute_definitions` (`canonical_name`,`version_number`);--> statement-breakpoint
CREATE INDEX `engineering_attributes_domain_idx` ON `engineering_attribute_definitions` (`engineering_domain`,`status`);--> statement-breakpoint
CREATE TABLE `engineering_fact_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`fact_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`evidence_id` text,
	`document_id` text,
	`document_version_id` text,
	`extraction_version_id` text,
	`page` integer,
	`page_to` integer,
	`sheet` text,
	`section` text,
	`clause` text,
	`row_number` integer,
	`cell` text,
	`bounding_box` text,
	`original_text` text,
	`extraction_method` text,
	`parser_version` text,
	`model_version` text,
	`prompt_version` text,
	`rule_version` text,
	`confidence` integer NOT NULL,
	`user_id` text,
	`user_role` text,
	`human_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`fact_id`) REFERENCES `engineering_facts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engineering_provenance_fact_idx` ON `engineering_fact_provenance` (`fact_id`,`source_type`);--> statement-breakpoint
CREATE INDEX `engineering_provenance_document_idx` ON `engineering_fact_provenance` (`document_id`,`document_version_id`);--> statement-breakpoint
CREATE TABLE `engineering_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`predicate` text NOT NULL,
	`value` text NOT NULL,
	`data_type` text NOT NULL,
	`operator` text NOT NULL,
	`fact_type` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`source_fact_id` text,
	`derivation` text,
	`status` text NOT NULL,
	`confidence` integer NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`effective_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`effective_to` text,
	`previous_version_id` text,
	`superseded_by_id` text,
	`change_reason` text,
	`changed_by` text,
	`model_version` text NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engineering_facts_entity_idx` ON `engineering_facts` (`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE INDEX `engineering_facts_project_scope_idx` ON `engineering_facts` (`project_id`,`scope_type`,`scope_id`);--> statement-breakpoint
CREATE INDEX `engineering_facts_predicate_idx` ON `engineering_facts` (`predicate`,`fact_type`);--> statement-breakpoint
CREATE TABLE `engineering_knowledge_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`conflict_type` text NOT NULL,
	`left_entity_type` text NOT NULL,
	`left_entity_id` text NOT NULL,
	`right_entity_type` text NOT NULL,
	`right_entity_id` text NOT NULL,
	`left_value` text,
	`right_value` text,
	`severity` text NOT NULL,
	`impact` text NOT NULL,
	`blocking` integer DEFAULT true NOT NULL,
	`resolution_status` text DEFAULT 'Open' NOT NULL,
	`resolution_decision_id` text,
	`evidence` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolution_decision_id`) REFERENCES `engineering_knowledge_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engineering_conflicts_project_status_idx` ON `engineering_knowledge_conflicts` (`project_id`,`resolution_status`,`blocking`);--> statement-breakpoint
CREATE TABLE `engineering_knowledge_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`reason` text NOT NULL,
	`evidence` text,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`reversible` integer DEFAULT true NOT NULL,
	`reverses_decision_id` text,
	`decided_by` text NOT NULL,
	`decided_role` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engineering_decisions_entity_idx` ON `engineering_knowledge_decisions` (`entity_type`,`entity_id`,`decided_at`);--> statement-breakpoint
CREATE INDEX `engineering_decisions_project_idx` ON `engineering_knowledge_decisions` (`project_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `engineering_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`left_entity_type` text NOT NULL,
	`left_entity_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`right_entity_type` text NOT NULL,
	`right_entity_id` text NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`exceptions` text DEFAULT '[]' NOT NULL,
	`quantity_rule` text,
	`fact_type` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`provenance_fact_id` text,
	`confidence` integer NOT NULL,
	`status` text NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`effective_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`effective_to` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provenance_fact_id`) REFERENCES `engineering_facts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `engineering_relationship_left_idx` ON `engineering_relationships` (`left_entity_type`,`left_entity_id`,`relationship_type`);--> statement-breakpoint
CREATE INDEX `engineering_relationship_right_idx` ON `engineering_relationships` (`right_entity_type`,`right_entity_id`,`relationship_type`);--> statement-breakpoint
CREATE INDEX `engineering_relationship_project_idx` ON `engineering_relationships` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `engineering_standard_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`standard_id` text NOT NULL,
	`edition` text,
	`year` text,
	`effective_from` text,
	`effective_to` text,
	`previous_version_id` text,
	`status` text DEFAULT 'Active' NOT NULL,
	`source_evidence_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`standard_id`) REFERENCES `engineering_standards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_standard_version_idx` ON `engineering_standard_versions` (`standard_id`,`edition`,`year`);--> statement-breakpoint
CREATE TABLE `engineering_standards` (
	`id` text PRIMARY KEY NOT NULL,
	`body_id` text NOT NULL,
	`number` text NOT NULL,
	`title` text,
	`current_version_id` text,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`body_id`) REFERENCES `standards_bodies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_standards_body_number_idx` ON `engineering_standards` (`body_id`,`number`);--> statement-breakpoint
CREATE TABLE `engineering_taxonomy_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`term_type` text NOT NULL,
	`canonical_name` text NOT NULL,
	`display_name` text NOT NULL,
	`code` text,
	`synonyms` text DEFAULT '[]' NOT NULL,
	`scope_type` text DEFAULT 'Global' NOT NULL,
	`scope_id` text,
	`version_number` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`effective_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`effective_to` text,
	`previous_version_id` text,
	`superseded_by_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_taxonomy_scope_name_idx` ON `engineering_taxonomy_terms` (`term_type`,`canonical_name`,`scope_type`,`scope_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `engineering_taxonomy_parent_idx` ON `engineering_taxonomy_terms` (`parent_id`,`term_type`);--> statement-breakpoint
CREATE TABLE `engineering_unit_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`display_name` text NOT NULL,
	`family` text NOT NULL,
	`canonical_unit_id` text,
	`conversion_factor` text DEFAULT '1' NOT NULL,
	`conversion_offset` text DEFAULT '0' NOT NULL,
	`precision` integer DEFAULT 6 NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_units_code_version_idx` ON `engineering_unit_definitions` (`code`,`version_number`);--> statement-breakpoint
CREATE INDEX `engineering_units_family_idx` ON `engineering_unit_definitions` (`family`,`status`);--> statement-breakpoint
CREATE TABLE `standards_bodies` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`authority_type` text DEFAULT 'Standards Body' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standards_bodies_code_unique` ON `standards_bodies` (`code`);