CREATE TABLE `organizations` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Disabled')),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `organization_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `user_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Revoked')),
  `granted_by` text NOT NULL,
  `granted_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
);
CREATE UNIQUE INDEX `organization_memberships_org_user_idx` ON `organization_memberships` (`organization_id`,`user_id`);
CREATE INDEX `organization_memberships_user_status_idx` ON `organization_memberships` (`user_id`,`status`);

ALTER TABLE `projects` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `product_sources` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `library_products` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `library_products` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `library_products` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `product_conflicts` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `product_conflicts` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `product_conflicts` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);

ALTER TABLE `identity_resolution_runs` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_resolution_runs` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_resolution_runs` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `identity_resolution_cases` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_resolution_cases` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_resolution_cases` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `identity_resolution_candidates` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_resolution_candidates` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_resolution_candidates` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `identity_resolution_proposals` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_resolution_proposals` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_resolution_proposals` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `identity_proposal_reviews` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_proposal_reviews` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_proposal_reviews` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `governed_identity_decisions` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `governed_identity_decisions` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `governed_identity_decisions` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `manufacturer_order_code_observations` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `manufacturer_order_code_observations` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `manufacturer_order_code_observations` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `identity_reference_moves` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_reference_moves` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_reference_moves` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);
ALTER TABLE `identity_decision_audit` ADD COLUMN `library_scope` text NOT NULL DEFAULT 'Global Library';
ALTER TABLE `identity_decision_audit` ADD COLUMN `organization_id` text REFERENCES `organizations`(`id`);
ALTER TABLE `identity_decision_audit` ADD COLUMN `library_project_id` text REFERENCES `projects`(`id`);

CREATE TABLE `library_scope_backfill_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `organization_id` text,
  `project_id` text,
  `reason` text NOT NULL,
  `evidence_json` text NOT NULL,
  `product_count` integer NOT NULL,
  `decided_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO `library_scope_backfill_decisions` (`id`,`scope`,`reason`,`evidence_json`,`product_count`,`decided_by`)
SELECT 'scopebackfill_honeywell_phase1_global','Global Library',
  'The canonical Honeywell/Farenhyt pilot library was imported from manufacturer sources explicitly recorded as Global with no project ownership. The B501-BL punctuation identity retains the same Global source provenance in its governed move manifests.',
  '{"sourceScope":"Global","sourceProjectId":null,"manufacturer":"Honeywell","decision":"Explicit Global Library backfill"}',
  COUNT(*),'migration-0019'
FROM `library_products`;

UPDATE `library_products` SET `library_scope`='Global Library',`organization_id`=NULL,`library_project_id`=NULL;
UPDATE `product_conflicts` SET `library_scope`='Global Library',`organization_id`=NULL,`library_project_id`=NULL;

CREATE INDEX `library_products_scope_idx` ON `library_products` (`library_scope`,`organization_id`,`library_project_id`,`identity_status`);
CREATE INDEX `product_conflicts_scope_status_idx` ON `product_conflicts` (`library_scope`,`organization_id`,`library_project_id`,`status`,`created_at`);
CREATE INDEX `identity_runs_scope_idx` ON `identity_resolution_runs` (`library_scope`,`organization_id`,`library_project_id`,`started_at`);
CREATE INDEX `identity_cases_scope_idx` ON `identity_resolution_cases` (`library_scope`,`organization_id`,`library_project_id`,`created_at`);
CREATE INDEX `identity_proposals_scope_idx` ON `identity_resolution_proposals` (`library_scope`,`organization_id`,`library_project_id`,`status`);
CREATE INDEX `identity_reviews_scope_idx` ON `identity_proposal_reviews` (`library_scope`,`organization_id`,`library_project_id`,`created_at`);
CREATE INDEX `identity_decisions_scope_idx` ON `governed_identity_decisions` (`library_scope`,`organization_id`,`library_project_id`,`created_at`);
