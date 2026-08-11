CREATE TABLE `canonical_evidence_integrity` (
  `evidence_id` text PRIMARY KEY NOT NULL,
  `row_checksum` text NOT NULL,
  `source_checksum` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `sealed_by` text NOT NULL,
  `sealed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`evidence_id`) REFERENCES `product_source_evidence`(`id`)
);
CREATE UNIQUE INDEX `canonical_evidence_fingerprint_idx` ON `canonical_evidence_integrity` (`evidence_fingerprint`);
CREATE TRIGGER `canonical_evidence_immutable_update`
BEFORE UPDATE OF `source_id`,`sheet`,`row_number`,`page`,`cells`,`original_text`,`parser_version` ON `product_source_evidence`
BEGIN SELECT RAISE(ABORT,'IDENTITY_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER `canonical_evidence_immutable_delete`
BEFORE DELETE ON `product_source_evidence`
WHEN EXISTS (SELECT 1 FROM canonical_evidence_integrity i WHERE i.evidence_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'IDENTITY_EVIDENCE_IMMUTABLE'); END;

CREATE TABLE `product_reference_versions` (
  `table_name` text NOT NULL,
  `record_id` text NOT NULL,
  `version_number` integer NOT NULL DEFAULT 1,
  PRIMARY KEY (`table_name`,`record_id`)
);
INSERT INTO `product_reference_versions` SELECT 'product_source_evidence',id,1 FROM product_source_evidence;
INSERT INTO `product_reference_versions` SELECT 'price_records',id,1 FROM price_records;
CREATE TRIGGER `product_source_evidence_reference_version_insert` AFTER INSERT ON `product_source_evidence`
BEGIN INSERT OR IGNORE INTO product_reference_versions(table_name,record_id,version_number) VALUES ('product_source_evidence',NEW.id,1); END;
CREATE TRIGGER `price_records_reference_version_insert` AFTER INSERT ON `price_records`
BEGIN INSERT OR IGNORE INTO product_reference_versions(table_name,record_id,version_number) VALUES ('price_records',NEW.id,1); END;
CREATE TRIGGER `product_source_evidence_reference_version_update` AFTER UPDATE ON `product_source_evidence`
BEGIN UPDATE product_reference_versions SET version_number=version_number+1 WHERE table_name='product_source_evidence' AND record_id=NEW.id; END;
CREATE TRIGGER `price_records_reference_version_update` AFTER UPDATE ON `price_records`
BEGIN UPDATE product_reference_versions SET version_number=version_number+1 WHERE table_name='price_records' AND record_id=NEW.id; END;
CREATE TRIGGER `price_records_reference_version_delete` BEFORE DELETE ON `price_records`
BEGIN UPDATE product_reference_versions SET version_number=version_number+1 WHERE table_name='price_records' AND record_id=OLD.id; END;

CREATE TABLE `identity_reference_guards` (
  `guard_id` text NOT NULL,
  `table_name` text NOT NULL,
  `record_id` text NOT NULL,
  `expected_owner_product_id` text NOT NULL,
  `expected_version` integer NOT NULL,
  PRIMARY KEY (`guard_id`,`table_name`,`record_id`)
);
CREATE TRIGGER `identity_reference_guard_validate` BEFORE INSERT ON `identity_reference_guards`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM product_reference_versions v WHERE v.table_name=NEW.table_name AND v.record_id=NEW.record_id AND v.version_number=NEW.expected_version)
    THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NEW.table_name='product_source_evidence' AND NOT EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.id=NEW.record_id AND e.product_id=NEW.expected_owner_product_id)
    THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NEW.table_name='price_records' AND NOT EXISTS (SELECT 1 FROM price_records p WHERE p.id=NEW.record_id AND p.product_id=NEW.expected_owner_product_id)
    THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
  SELECT CASE WHEN NEW.table_name NOT IN ('product_source_evidence','price_records') THEN RAISE(ABORT,'IDENTITY_REFERENCE_REGISTRY_INCOMPLETE') END;
END;

CREATE TABLE `product_reference_registry` (
  `table_name` text PRIMARY KEY NOT NULL,
  `product_column` text NOT NULL,
  `strategy` text NOT NULL CHECK (`strategy` IN ('MOVE','RESOLVE','BLOCK','KEEP')),
  `module_name` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `registry_version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO `product_reference_registry` (`table_name`,`product_column`,`strategy`,`module_name`) VALUES
 ('product_source_evidence','product_id','MOVE','Product Library'),
 ('price_records','product_id','MOVE','Pricing Sources'),
 ('product_versions','product_id','KEEP','Product Library'),
 ('product_variants','base_product_id','BLOCK','Product Library'),
 ('product_aliases','product_id','BLOCK','Product Library'),
 ('regional_part_numbers','product_id','BLOCK','Product Library'),
 ('product_attributes','product_id','BLOCK','Product Library'),
 ('product_certifications','product_id','BLOCK','Product Library'),
 ('product_compatibility','source_product_id','BLOCK','Product Library'),
 ('product_accessories','product_id','BLOCK','Product Library'),
 ('product_packages','product_id','BLOCK','Product Library'),
 ('product_documents','product_id','BLOCK','Product Library'),
 ('supplier_products','product_id','BLOCK','Supplier Library'),
 ('supplier_quote_lines','product_id','BLOCK','Supplier Library'),
 ('product_match_candidates','product_id','RESOLVE','Matching'),
 ('pricing_lines','product_id','RESOLVE','Pricing');

CREATE TABLE `identity_dependency_providers` (
  `provider_id` text PRIMARY KEY NOT NULL,
  `module_name` text NOT NULL,
  `table_name` text NOT NULL,
  `product_column` text,
  `candidate_table` text,
  `candidate_column` text,
  `strategy` text NOT NULL CHECK (`strategy` IN ('DIRECT','VIA_CANDIDATE','VIA_PRICING_LINE')),
  `enabled` integer NOT NULL DEFAULT 1,
  `registry_version` integer NOT NULL DEFAULT 1
);
INSERT INTO `identity_dependency_providers` VALUES
 ('matching','Matching','product_match_candidates','product_id',NULL,NULL,'DIRECT',1,1),
 ('pricing','Pricing','pricing_lines','product_id',NULL,NULL,'DIRECT',1,1),
 ('safety','Safety','safety_decisions',NULL,'product_match_candidates','candidate_id','VIA_CANDIDATE',1,1),
 ('review','Review','review_decisions',NULL,'product_match_candidates','candidate_id','VIA_CANDIDATE',1,1),
 ('export','Export','excel_export_jobs',NULL,'pricing_lines','pricing_line_id','VIA_PRICING_LINE',1,1),
 ('workflow','Workflow','review_queue_items',NULL,'product_match_candidates','candidate_id','VIA_CANDIDATE',1,1);

ALTER TABLE `governed_identity_decisions` ADD COLUMN `manifest_checksum` text;
ALTER TABLE `governed_identity_decisions` ADD COLUMN `manifest_row_count` integer;
ALTER TABLE `governed_identity_decisions` ADD COLUMN `manifest_ownership_checksum` text;
ALTER TABLE `governed_identity_decisions` ADD COLUMN `manifest_table_checksum` text;
ALTER TABLE `identity_ruleset_versions` ADD COLUMN `behavior_version` text;
ALTER TABLE `identity_ruleset_versions` ADD COLUMN `executable_checksum` text;
ALTER TABLE `identity_resolution_proposals` ADD COLUMN `executable_ruleset_checksum` text;

CREATE TABLE `identity_schema_compatibility` (
  `component` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL,
  `minimum_worker_version` integer NOT NULL,
  `maximum_worker_version` integer NOT NULL,
  `environment` text NOT NULL DEFAULT 'Any',
  `migration_checksum` text NOT NULL,
  `rollback_verification` text NOT NULL,
  `installed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO `identity_schema_compatibility` VALUES
 ('Identity Resolution',21,21,21,'Any','migration-0021-identity-production-governance','Additive rollback requires restoring the pre-migration backup; no historical rows are deleted',CURRENT_TIMESTAMP);

CREATE TABLE `canonical_product_resolution_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `requested_product_id` text NOT NULL,
  `canonical_product_id` text NOT NULL,
  `resolution_path_json` text NOT NULL,
  `resolved_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW `canonical_library_products` AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.* FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';
