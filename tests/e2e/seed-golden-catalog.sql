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

-- =============================================================================
-- DETECTOR-BASE ACCESSORY RELATIONSHIP (the governed product-side evidence)
-- =============================================================================
--
-- ROOT CAUSE of the Golden E2E `MANDATORY_REQUIREMENT_FAILED` / `Missing
-- Accessory` block. The engineering_relationships row above is REAL and correct
-- evidence, but it feeds worker/product-matching-api.mjs's `compatibility`
-- subquery -- NOT the `accessories` subquery. `product.accessories` is read
-- exclusively from the `product_accessories` table, joined to a real
-- `library_products` row for the accessory itself:
--
--   ... FROM product_accessories pa JOIN library_products ap ON ap.id=pa.accessory_product_id
--        LEFT JOIN product_families af ON af.id=ap.family_id
--        WHERE pa.product_id=p.id AND pa.deleted_at IS NULL
--          AND pa.superseded_at IS NULL
--          AND pa.review_status NOT IN ('Rejected','Needs Review')
--
-- The projection is `COALESCE(af.name, ap.description)`, i.e. the accessory's
-- own catalog NAME. With no product_accessories row, `product.accessories` was
-- an empty array, so app/domain/product-matching-engine.mjs's
-- evaluateAccessories could offer nothing and correctly reported
-- `Missing Accessory`. At this commit `evaluateAccessories` is
-- `blocking: !offered`, so that correct verdict blocked approval.
--
-- This is a SEED GAP, not a matcher defect, and is fixed as seed data only.
-- NOTHING in the matcher, the schema, the review-status filter, or the blocking
-- rule is changed. The rows below are exactly the evidence a real compliant
-- addressable detector carries in a real catalog:
--
--   1. a "Detector Base" family, so the accessory's projected name is
--      "Detector Base" -- which normalises to exactly the "detector base" the
--      extracted specification requirement names, satisfying the governed
--      NAME-match path in evaluateAccessories;
--   2. a real detector-base library product with its own part number and
--      description, so product_accessories.accessory_product_id resolves to a
--      genuine product (its FK target) rather than a dangling string;
--   3. the product_accessories relationship itself, `Compatible Base`, approved.
--      `Compatible Base` is the relationship_type the engine's own documented
--      rule for `accessory.detector-base` recognises as proof
--      (product-matching-engine.mjs), so BOTH production-sanctioned paths are
--      satisfied by the same governed evidence: the name match for the
--      specification-extracted "detector base" requirement, and the
--      relationship_type match for the derived `accessory.detector-base` rule.
--
-- `included = 1` and `separately_priced = 0` are the honest statements for a
-- base supplied with the detector. `approved_for_discovery = 0` on the base
-- states that a base is not a drop-in substitute for a detector; the accessory
-- join applies no discovery predicate, so this cannot affect the relationship
-- being read. A detector that genuinely has no base evidence still gets
-- `Missing Accessory` and still blocks -- proved by the negative case in
-- tests/golden-detector-base-accessory-fixture.test.mjs.
--
-- Every id is fixed and every statement is INSERT OR IGNORE, so re-running this
-- seed over an already-seeded database is a no-op and can never create a
-- duplicate relationship (idempotency gate, section 5).
INSERT OR IGNORE INTO product_families (id,brand_id,name,normalized_name,engineering_domain,review_status)
VALUES ('golden-detector-base-family','golden-brand','Detector Base','detector base','Fire Alarm','Reviewed');

INSERT OR IGNORE INTO library_products (id,manufacturer_id,brand_id,family_id,part_number,normalized_part_number,description,lifecycle_status,attributes,standards,review_status,approved_for_discovery,created_by)
VALUES ('golden-detector-base-001','golden-manufacturer','golden-brand','golden-detector-base-family','GOLDEN-FA-BASE-001','GOLDEN-FA-BASE-001','Golden detector base for GOLDEN-FA-001 addressable detector','Active','[]','[]','Reviewed',0,'golden-e2e-setup');

INSERT OR IGNORE INTO product_source_evidence (id,product_id,source_id,page,cells,original_text,parser_version)
VALUES ('golden-detector-base-evidence','golden-detector-base-001','golden-product-source',1,'[]','Golden detector base GOLDEN-FA-BASE-001, the mounting base supplied with GOLDEN-FA-001 addressable detector.','golden-fixture-v1');

INSERT OR IGNORE INTO product_accessories (
  id,
  product_id,
  accessory_product_id,
  relationship_type,
  quantity_rule,
  quantity_parameter,
  condition_json,
  included,
  separately_priced,
  evidence_json,
  confidence,
  review_status,
  version_number,
  created_by,
  source_id
)
VALUES (
  'golden-product-fa-001-detector-base',
  'golden-product-fa-001',
  'golden-detector-base-001',
  'Compatible Base',
  'One per detector',
  1,
  '[]',
  1,
  0,
  '[{"sourceId":"golden-product-source","page":1,"citation":"Golden addressable detector, model GOLDEN-FA-001, 24 V DC, UL 268, compatible with Golden Fire Addressable Control Panel GF-CP-001 and supplied with detector base."}]',
  100,
  'Approved',
  1,
  'golden-e2e-setup',
  'golden-product-source'
);
