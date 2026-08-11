ALTER TABLE `canonical_evidence_integrity` ADD COLUMN `original_product_id` text;
CREATE INDEX `canonical_evidence_original_owner_idx` ON `canonical_evidence_integrity` (`original_product_id`);
INSERT INTO `product_reference_registry_v2` (`table_name`,`product_column`,`strategy`,`module_name`) VALUES ('canonical_evidence_integrity','original_product_id','KEEP','Canonical Evidence');
UPDATE `identity_schema_compatibility` SET schema_version=23,minimum_worker_version=23,maximum_worker_version=23,migration_checksum='migration-0023-canonical-evidence-original-ownership' WHERE component='Identity Resolution';
