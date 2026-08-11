CREATE TABLE IF NOT EXISTS `engineering_graph_versions` (
 `id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL, `boq_item_id` text NOT NULL, `requirement_profile_version_id` text NOT NULL, `classification_version_id` text NOT NULL,
 `version_number` integer NOT NULL, `input_fingerprint` text NOT NULL, `output_fingerprint` text NOT NULL, `engine_version` text NOT NULL,
 `missing_relationships` text NOT NULL, `conflicts` text NOT NULL, `engineering_risks` text NOT NULL, `superseded_at` text, `created_by` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`), FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`), FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`), FOREIGN KEY (`classification_version_id`) REFERENCES `engineering_classification_versions`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_graph_item_version_idx` ON `engineering_graph_versions` (`boq_item_id`,`version_number`);
CREATE INDEX IF NOT EXISTS `engineering_graph_current_idx` ON `engineering_graph_versions` (`boq_item_id`,`superseded_at`);
CREATE TABLE IF NOT EXISTS `engineering_graph_nodes` (
 `id` text PRIMARY KEY NOT NULL, `graph_version_id` text NOT NULL, `node_key` text NOT NULL, `node_type` text NOT NULL, `label` text NOT NULL, `properties` text NOT NULL, `provenance` text NOT NULL, `review_status` text DEFAULT 'Needs Review' NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 FOREIGN KEY (`graph_version_id`) REFERENCES `engineering_graph_versions`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_graph_node_key_idx` ON `engineering_graph_nodes` (`graph_version_id`,`node_key`);
CREATE TABLE IF NOT EXISTS `engineering_graph_relationships` (
 `id` text PRIMARY KEY NOT NULL, `graph_version_id` text NOT NULL, `from_node_id` text NOT NULL, `to_node_id` text NOT NULL, `relationship_type` text NOT NULL, `confidence` integer NOT NULL, `provenance` text NOT NULL, `basis` text NOT NULL, `review_status` text DEFAULT 'Needs Review' NOT NULL, `reviewed_by` text, `reviewed_at` text, `review_reason` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 FOREIGN KEY (`graph_version_id`) REFERENCES `engineering_graph_versions`(`id`), FOREIGN KEY (`from_node_id`) REFERENCES `engineering_graph_nodes`(`id`), FOREIGN KEY (`to_node_id`) REFERENCES `engineering_graph_nodes`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_graph_relationship_key_idx` ON `engineering_graph_relationships` (`graph_version_id`,`from_node_id`,`relationship_type`,`to_node_id`);
CREATE INDEX IF NOT EXISTS `engineering_graph_relationship_review_idx` ON `engineering_graph_relationships` (`graph_version_id`,`review_status`,`relationship_type`);
CREATE TABLE IF NOT EXISTS `engineering_graph_audit_events` (
 `id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL, `graph_version_id` text NOT NULL, `entity_type` text NOT NULL, `entity_id` text NOT NULL, `action` text NOT NULL, `previous_value` text, `new_value` text NOT NULL, `reason` text NOT NULL, `evidence` text NOT NULL, `actor_user_id` text NOT NULL, `actor_role` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`), FOREIGN KEY (`graph_version_id`) REFERENCES `engineering_graph_versions`(`id`)
);
CREATE INDEX IF NOT EXISTS `engineering_graph_audit_entity_idx` ON `engineering_graph_audit_events` (`entity_type`,`entity_id`,`created_at`);
