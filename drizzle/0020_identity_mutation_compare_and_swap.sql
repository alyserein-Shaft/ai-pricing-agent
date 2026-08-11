ALTER TABLE `identity_proposal_reviews` ADD COLUMN `request_fingerprint` text;
ALTER TABLE `governed_identity_decisions` ADD COLUMN `request_fingerprint` text;

CREATE TABLE `identity_mutation_guards` (
  `id` text PRIMARY KEY NOT NULL,
  `operation` text NOT NULL CHECK (`operation` IN ('Review','Apply','Reverse')),
  `proposal_id` text NOT NULL,
  `proposal_version` integer NOT NULL,
  `proposal_fingerprint` text NOT NULL,
  `ruleset_version_id` text NOT NULL,
  `ruleset_checksum` text NOT NULL,
  `review_id` text,
  `conflict_id` text NOT NULL,
  `conflict_version` integer NOT NULL,
  `conflict_status` text NOT NULL,
  `target_product_id` text NOT NULL,
  `target_version` integer NOT NULL,
  `target_status` text NOT NULL,
  `non_target_product_id` text NOT NULL,
  `non_target_version` integer NOT NULL,
  `non_target_status` text NOT NULL,
  `library_scope` text NOT NULL,
  `organization_id` text,
  `library_project_id` text,
  `reference_owner_product_id` text NOT NULL,
  `expected_evidence_count` integer NOT NULL,
  `expected_price_count` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER `identity_mutation_guard_validate`
BEFORE INSERT ON `identity_mutation_guards`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM identity_resolution_proposals p
    JOIN identity_resolution_cases c ON c.id=p.case_id
    JOIN identity_resolution_runs r ON r.id=c.run_id
    JOIN identity_ruleset_versions v ON v.id=r.ruleset_version_id
    WHERE p.id=NEW.proposal_id AND p.version_number=NEW.proposal_version
      AND p.proposal_fingerprint=NEW.proposal_fingerprint
      AND r.ruleset_version_id=NEW.ruleset_version_id AND v.checksum=NEW.ruleset_checksum
      AND p.library_scope=NEW.library_scope
      AND COALESCE(p.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(p.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM product_conflicts c WHERE c.id=NEW.conflict_id
      AND c.conflict_version=NEW.conflict_version AND c.status=NEW.conflict_status
      AND c.library_scope=NEW.library_scope
      AND COALESCE(c.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(c.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM library_products p WHERE p.id=NEW.target_product_id
      AND p.identity_version=NEW.target_version AND p.identity_status=NEW.target_status
      AND p.library_scope=NEW.library_scope
      AND COALESCE(p.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(p.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM library_products p WHERE p.id=NEW.non_target_product_id
      AND p.identity_version=NEW.non_target_version AND p.identity_status=NEW.non_target_status
      AND p.library_scope=NEW.library_scope
      AND COALESCE(p.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(p.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NEW.operation='Apply' AND NEW.review_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM identity_proposal_reviews r WHERE r.id=NEW.review_id
      AND r.proposal_id=NEW.proposal_id AND r.decision='Approve for Application'
      AND r.proposal_version=NEW.proposal_version AND r.proposal_fingerprint=NEW.proposal_fingerprint
      AND r.ruleset_version_id=NEW.ruleset_version_id AND r.ruleset_checksum=NEW.ruleset_checksum
      AND r.conflict_id=NEW.conflict_id AND r.conflict_version=NEW.conflict_version
      AND r.library_scope=NEW.library_scope
      AND COALESCE(r.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(r.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM product_source_evidence WHERE product_id=NEW.reference_owner_product_id)<>NEW.expected_evidence_count
    THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM price_records WHERE product_id=NEW.reference_owner_product_id)<>NEW.expected_price_count
    THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
END;

CREATE TABLE `identity_mutation_failures` (
  `id` text PRIMARY KEY NOT NULL,
  `operation` text NOT NULL,
  `entity_id` text NOT NULL,
  `error_code` text NOT NULL,
  `expected_lock_json` text NOT NULL,
  `actual_lock_json` text NOT NULL,
  `actor_id` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX `identity_mutation_failures_entity_idx` ON `identity_mutation_failures` (`operation`,`entity_id`,`created_at`);
