ALTER TABLE `library_products` ADD COLUMN `identity_status` text NOT NULL DEFAULT 'Active';
ALTER TABLE `library_products` ADD COLUMN `superseded_by_product_id` text;
ALTER TABLE `library_products` ADD COLUMN `identity_version` integer NOT NULL DEFAULT 1;
ALTER TABLE `product_conflicts` ADD COLUMN `conflict_version` integer NOT NULL DEFAULT 1;
ALTER TABLE `identity_resolution_proposals` ADD COLUMN `version_number` integer NOT NULL DEFAULT 1;

CREATE TABLE `identity_proposal_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text NOT NULL,
  `decision` text NOT NULL CHECK (`decision` IN ('Approve for Application','Reject','Request Evidence')),
  `reason` text NOT NULL,
  `proposal_version` integer NOT NULL,
  `proposal_fingerprint` text NOT NULL,
  `ruleset_version_id` text NOT NULL,
  `ruleset_checksum` text NOT NULL,
  `conflict_id` text NOT NULL,
  `conflict_version` integer NOT NULL,
  `product_versions_json` text NOT NULL,
  `canonical_product_id` text NOT NULL,
  `revalidation_fingerprint` text NOT NULL,
  `reviewed_by` text NOT NULL,
  `reviewed_role` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`),
  FOREIGN KEY (`ruleset_version_id`) REFERENCES `identity_ruleset_versions`(`id`),
  FOREIGN KEY (`conflict_id`) REFERENCES `product_conflicts`(`id`)
);
CREATE UNIQUE INDEX `identity_proposal_review_idempotency_idx` ON `identity_proposal_reviews` (`proposal_id`,`idempotency_key`);
CREATE INDEX `identity_proposal_review_latest_idx` ON `identity_proposal_reviews` (`proposal_id`,`created_at`,`id`);

CREATE TABLE `manufacturer_order_code_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `canonical_product_id` text NOT NULL,
  `original_product_id` text NOT NULL,
  `manufacturer_id` text NOT NULL,
  `original_order_code` text NOT NULL,
  `source_id` text,
  `source_row` integer,
  `observation_fingerprint` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Reviewed',
  `decision_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Reversed')),
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reversed_at` text,
  FOREIGN KEY (`canonical_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`original_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`)
);
CREATE UNIQUE INDEX `manufacturer_order_code_observation_fingerprint_idx` ON `manufacturer_order_code_observations` (`observation_fingerprint`);
CREATE INDEX `manufacturer_order_code_observation_product_idx` ON `manufacturer_order_code_observations` (`canonical_product_id`,`status`);

CREATE TABLE `governed_identity_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `decision_type` text NOT NULL CHECK (`decision_type` IN ('Apply','Reverse')),
  `proposal_id` text NOT NULL,
  `review_id` text,
  `conflict_id` text NOT NULL,
  `canonical_product_id` text NOT NULL,
  `non_target_product_id` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('Applied','Reversed')),
  `reversal_of_id` text,
  `ruleset_version_id` text NOT NULL,
  `ruleset_checksum` text NOT NULL,
  `proposal_fingerprint` text NOT NULL,
  `proposal_version` integer NOT NULL,
  `conflict_version_before` integer NOT NULL,
  `target_version_before` integer NOT NULL,
  `non_target_version_before` integer NOT NULL,
  `previous_snapshot_json` text NOT NULL,
  `new_snapshot_json` text NOT NULL,
  `reference_move_manifest_json` text NOT NULL,
  `reason` text NOT NULL,
  `actor_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`),
  FOREIGN KEY (`review_id`) REFERENCES `identity_proposal_reviews`(`id`),
  FOREIGN KEY (`conflict_id`) REFERENCES `product_conflicts`(`id`),
  FOREIGN KEY (`canonical_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`non_target_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`reversal_of_id`) REFERENCES `governed_identity_decisions`(`id`)
);
CREATE UNIQUE INDEX `governed_identity_apply_once_idx` ON `governed_identity_decisions` (`proposal_id`,`decision_type`);
CREATE UNIQUE INDEX `governed_identity_idempotency_idx` ON `governed_identity_decisions` (`decision_type`,`idempotency_key`);
CREATE UNIQUE INDEX `governed_identity_reversal_once_idx` ON `governed_identity_decisions` (`reversal_of_id`) WHERE `reversal_of_id` IS NOT NULL;
CREATE INDEX `governed_identity_products_idx` ON `governed_identity_decisions` (`canonical_product_id`,`non_target_product_id`,`created_at`);

CREATE TABLE `identity_reference_moves` (
  `id` text PRIMARY KEY NOT NULL,
  `decision_id` text NOT NULL,
  `table_name` text NOT NULL CHECK (`table_name` IN ('product_source_evidence','price_records')),
  `record_id` text NOT NULL,
  `from_product_id` text NOT NULL,
  `to_product_id` text NOT NULL,
  `record_snapshot_json` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`decision_id`) REFERENCES `governed_identity_decisions`(`id`)
);
CREATE UNIQUE INDEX `identity_reference_move_record_idx` ON `identity_reference_moves` (`decision_id`,`table_name`,`record_id`);

CREATE TABLE `identity_decision_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `actor_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `reason` text NOT NULL,
  `previous_snapshot_json` text NOT NULL,
  `new_snapshot_json` text NOT NULL,
  `ruleset_checksum` text,
  `proposal_fingerprint` text,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX `identity_decision_audit_idempotency_idx` ON `identity_decision_audit` (`action`,`idempotency_key`);
CREATE INDEX `identity_decision_audit_entity_idx` ON `identity_decision_audit` (`entity_type`,`entity_id`,`created_at`);
