-- Infrastructure prerequisite only. This is reviewed Product Library evidence;
-- it does not create any project, BOQ, match, price, approval, or quotation state.
INSERT INTO product_manufacturers (id,name,normalized_name,status,created_by)
VALUES ('golden-manufacturer','Golden Manufacturer','golden manufacturer','Reviewed','golden-e2e-setup');

INSERT INTO product_brands (id,manufacturer_id,name,normalized_name,status)
VALUES ('golden-brand','golden-manufacturer','Golden Fire','golden fire','Reviewed');

INSERT INTO product_families (id,brand_id,name,normalized_name,engineering_domain,review_status)
VALUES ('golden-family','golden-brand','Golden Addressable','golden addressable','Fire Alarm','Reviewed');

INSERT INTO product_sources (id,checksum,source_type,authority,scope_type,file_name,release_version,validity_state,review_status,downstream_use,metadata,created_by)
VALUES ('golden-product-source','golden-product-source-v1','Technical Datasheet','Manufacturer','Global','golden-product-datasheet-v1','1','Current','Reviewed','Discovery','{"fixture":true,"purpose":"Golden E2E prerequisite"}','golden-e2e-setup');

INSERT INTO library_products (id,manufacturer_id,brand_id,family_id,part_number,normalized_part_number,description,lifecycle_status,attributes,standards,review_status,approved_for_discovery,created_by)
VALUES ('golden-product-fa-001','golden-manufacturer','golden-brand','golden-family','GOLDEN-FA-001','GOLDEN-FA-001','Golden addressable detector, 24 V DC','Active','[{"name":"Voltage","originalValue":"24 V DC","normalizedValue":24,"normalizedUnit":"V","evidence":{"sourceId":"golden-product-source","page":1}}]','[{"body":"UL","number":"268","part":null,"evidence":{"sourceId":"golden-product-source","page":1}}]','Reviewed',1,'golden-e2e-setup');

INSERT INTO product_source_evidence (id,product_id,source_id,page,cells,original_text,parser_version)
VALUES ('golden-product-evidence','golden-product-fa-001','golden-product-source',1,'[]','Golden addressable detector, model GOLDEN-FA-001, 24 V DC, UL 268, compatible with Golden Fire Addressable Control Panel GF-CP-001 and supplied with detector base.','golden-fixture-v1');

INSERT INTO engineering_relationships (
  id,
  project_id,
  left_entity_type,
  left_entity_id,
  relationship_type,
  right_entity_type,
  right_entity_id,
  conditions,
  exceptions,
  fact_type,
  scope_type,
  scope_id,
  confidence,
  status,
  reviewed_by,
  reviewed_at,
  created_by
)
VALUES
(
  'golden-product-compatibility',
  NULL,
  'Product',
  'golden-product-fa-001',
  'Compatible With',
  'Equipment',
  'Golden Fire Addressable Control Panel GF-CP-001',
  '[]',
  '[]',
  'Manufacturer Rule',
  'Product',
  'golden-product-fa-001',
  100,
  'Approved',
  'golden-e2e-setup',
  CURRENT_TIMESTAMP,
  'golden-e2e-setup'
),
(
  'golden-product-detector-base',
  NULL,
  'Product',
  'golden-product-fa-001',
  'Requires',
  'Accessory',
  'detector base',
  '[]',
  '[]',
  'Manufacturer Rule',
  'Product',
  'golden-product-fa-001',
  100,
  'Approved',
  'golden-e2e-setup',
  CURRENT_TIMESTAMP,
  'golden-e2e-setup'
);
