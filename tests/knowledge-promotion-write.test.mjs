import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  promoteKnowledgeFact,
} from "../worker/knowledge-promotion.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const op = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    });
    return { ...op(), bind: (...values) => op(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const baseSchema = `
PRAGMA foreign_keys=ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY
);

CREATE TABLE knowledge_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  extraction_version TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}');

CREATE TABLE knowledge_facts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL,
  source_location TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE knowledge_product_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL,
  part_number TEXT NOT NULL,
  existing_product_id TEXT,
  link_state TEXT NOT NULL,
  new_information TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE library_products (
  id TEXT PRIMARY KEY,
  part_number TEXT NOT NULL,
  normalized_part_number TEXT NOT NULL,
  identity_status TEXT NOT NULL,
  superseded_by_product_id TEXT,
  library_scope TEXT NOT NULL,
  organization_id TEXT,
  library_project_id TEXT
);

CREATE VIEW canonical_library_products AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain
  JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded'
    AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32
    AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.*
FROM product_chain chain
JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';

CREATE TABLE product_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  document_id TEXT,
  document_version_id TEXT,
  checksum TEXT NOT NULL,
  source_type TEXT NOT NULL,
  authority TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  release_version TEXT,
  effective_from TEXT,
  valid_until TEXT,
  currency TEXT,
  validity_state TEXT NOT NULL,
  review_status TEXT NOT NULL,
  downstream_use TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_by TEXT NOT NULL,
  organization_id TEXT
);

CREATE TABLE product_source_evidence (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  sheet TEXT,
  row_number INTEGER,
  page INTEGER,
  cells TEXT NOT NULL DEFAULT '[]',
  original_text TEXT,
  parser_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id,source_id,sheet,row_number)
);

CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  attribute_definition_id TEXT,
  attribute_name TEXT NOT NULL,
  value_json TEXT,
  original_value TEXT,
  normalized_value TEXT,
  unit TEXT,
  source_id TEXT,
  evidence_json TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  version_number INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  deleted_at TEXT
);
`;

const migration = await readFile(
  new URL("../drizzle/0075_knowledge_canonical_promotion.sql", import.meta.url),
  "utf8"
);

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(baseSchema);
  raw.exec(migration);

  raw.exec(`
    INSERT INTO organizations VALUES ('org-a');

    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-a','org-a','catalog.xlsx','sha-real','Product Catalogue','Completed','knowledge-library-v1.1');

    INSERT INTO library_products
      (id,part_number,normalized_part_number,identity_status,superseded_by_product_id,library_scope,organization_id,library_project_id)
    VALUES
      ('product-a','PART-100','PART100','Active',NULL,'Organization Library','org-a',NULL);
  `);

  const observationKey = "Products:12:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part",
    "org-a",
    "file-a",
    "Part Number",
    "part-100",
    "PART-100",
    "part-100",
    JSON.stringify({ observationKey }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 12,
      cell: "A12",
      fileName: "catalog.xlsx",
    })
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol",
    "org-a",
    "file-a",
    "Protocol",
    "slc",
    "SLC",
    "slc",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    88,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 12,
      cell: "D12",
      descriptionCell: "B12",
      fileName: "catalog.xlsx",
    })
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part','org-a','fact-part','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  return { raw, DB: d1(raw) };
};

test("promotes a Reviewed Protocol fact into one governed Approved canonical product attribute (human path carries approval)", async () => {
  const { raw, DB } = fixture();

  const result = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote reviewed protocol evidence into canonical Product Knowledge.",
    idempotencyKey: "promotion-key-1",
  });

  assert.equal(result.status, "PROMOTED");
  assert.equal(result.factId, "fact-protocol");
  assert.equal(result.canonicalProductId, "product-a");
  assert.equal(result.attributeName, "protocol");
  assert.equal(result.normalizedValue, "SLC");

  const source = raw.prepare("SELECT * FROM product_sources").get();
  assert.equal(source.organization_id, "org-a");
  assert.equal(source.project_id, null);
  assert.equal(source.checksum, "sha-real");
  assert.equal(source.source_type, "Product Catalogue");
  assert.equal(source.authority, "Source Document — Review Required");
  assert.equal(source.scope_type, "Organization");
  assert.equal(source.file_name, "catalog.xlsx");
  assert.equal(source.validity_state, "Validity Review Required");
  assert.equal(source.review_status, "Needs Review");
  assert.equal(source.downstream_use, "Discovery Only");

  const evidence = raw.prepare("SELECT * FROM product_source_evidence").get();
  assert.equal(evidence.product_id, "product-a");
  assert.equal(evidence.source_id, source.id);
  assert.equal(evidence.sheet, "Products");
  assert.equal(evidence.row_number, 12);
  assert.equal(evidence.original_text, "SLC");

  const attribute = raw.prepare("SELECT * FROM product_attributes").get();
  assert.equal(attribute.product_id, "product-a");
  assert.equal(attribute.attribute_name, "protocol");
  assert.equal(attribute.original_value, "SLC");
  assert.equal(attribute.normalized_value, "SLC");
  assert.equal(attribute.unit, null);
  assert.equal(attribute.source_id, source.id);
  assert.equal(attribute.confidence, 88);
  assert.equal(attribute.review_status, "Approved");
  assert.equal(attribute.version_number, 1);
  assert.equal(attribute.created_by, "user-a");

  const attributeEvidence = JSON.parse(attribute.evidence_json);
  assert.equal(attributeEvidence.knowledgeFactId, "fact-protocol");
  assert.equal(attributeEvidence.knowledgeFileId, "file-a");
  assert.equal(attributeEvidence.sourceChecksum, "sha-real");
  assert.equal(attributeEvidence.sourceLocation.sheet, "Products");
  assert.equal(attributeEvidence.sourceLocation.row, 12);

  const promotion = raw.prepare("SELECT * FROM knowledge_promotions").get();
  assert.equal(promotion.organization_id, "org-a");
  assert.equal(promotion.knowledge_fact_id, "fact-protocol");
  assert.equal(promotion.knowledge_file_id, "file-a");
  assert.equal(promotion.canonical_product_id, "product-a");
  assert.equal(promotion.canonical_entity_type, "Product Attribute");
  assert.equal(promotion.canonical_entity_id, attribute.id);
  assert.equal(promotion.product_source_id, source.id);
  assert.equal(promotion.action, "Promoted");
  assert.equal(promotion.policy_version, "knowledge-promotion-policy-v2");
  assert.equal(promotion.source_checksum, "sha-real");
  assert.equal(promotion.idempotency_key, "promotion-key-1");

  assert.equal(raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count, 1);

  raw.close();
});

test("replaying the same fact with the same idempotency key is idempotent and creates no duplicate canonical records", async () => {
  const { raw, DB } = fixture();

  const request = {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote reviewed protocol evidence into canonical Product Knowledge.",
    idempotencyKey: "promotion-key-1",
  };

  const first = await promoteKnowledgeFact(DB, request);
  const second = await promoteKnowledgeFact(DB, request);

  assert.equal(first.status, "PROMOTED");
  assert.equal(second.status, "PROMOTED");
  assert.equal(second.idempotent, true);

  assert.equal(second.canonicalProductId, first.canonicalProductId);
  assert.equal(second.canonicalEntityId, first.canonicalEntityId);
  assert.equal(second.productSourceId, first.productSourceId);

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    1
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    1
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    1
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    1
  );

  raw.close();
});

test("replaying the same already-promoted fact with a different idempotency key returns the existing promotion without duplicate writes", async () => {
  const { raw, DB } = fixture();

  const first = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote reviewed protocol evidence into canonical Product Knowledge.",
    idempotencyKey: "promotion-key-1",
  });

  const second = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Retry the same governed promotion request with a new request key.",
    idempotencyKey: "promotion-key-2",
  });

  assert.equal(first.status, "PROMOTED");
  assert.equal(second.status, "PROMOTED");
  assert.equal(second.idempotent, true);

  assert.equal(second.canonicalProductId, first.canonicalProductId);
  assert.equal(second.canonicalEntityId, first.canonicalEntityId);
  assert.equal(second.productSourceId, first.productSourceId);

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    1
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    1
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    1
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    1
  );

  raw.close();
});

test("a different Reviewed fact with the same canonical protocol becomes Evidence Only without duplicating the active attribute", async () => {
  const { raw, DB } = fixture();

  const first = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote the first reviewed protocol observation.",
    idempotencyKey: "promotion-key-1",
  });

  raw.exec(`
    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-b','org-a','catalog-2.xlsx','sha-second','Product Catalogue','Completed','knowledge-library-v1.1');
  `);

  const observationKey = "Sheet2:44:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-2",
    "org-a",
    "file-b",
    "Part Number",
    "part-100",
    "PART-100",
    "part-100",
    JSON.stringify({ observationKey }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Sheet2",
      row: 44,
      cell: "A44",
      fileName: "catalog-2.xlsx",
    })
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol-2",
    "org-a",
    "file-b",
    "Protocol",
    "slc",
    "SLC",
    "slc",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    92,
    "Reviewed",
    JSON.stringify({
      sheet: "Sheet2",
      row: 44,
      cell: "D44",
      descriptionCell: "B44",
      fileName: "catalog-2.xlsx",
    })
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part-2','org-a','fact-part-2','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  const second = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol-2",
    organizationId: "org-a",
    actor: {
      id: "user-b",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Preserve a second reviewed source that confirms the same canonical protocol.",
    idempotencyKey: "promotion-key-2",
  });

  assert.equal(first.status, "PROMOTED");
  assert.equal(second.status, "EVIDENCE_ONLY");
  assert.equal(second.idempotent, false);

  assert.equal(second.canonicalProductId, "product-a");
  assert.equal(second.canonicalEntityId, first.canonicalEntityId);
  assert.equal(second.attributeName, "protocol");
  assert.equal(second.normalizedValue, "SLC");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    1
  );

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    2
  );

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    2
  );

  const promotions = raw.prepare(`
    SELECT *
    FROM knowledge_promotions
    ORDER BY created_at, id
  `).all();

  assert.equal(promotions.length, 2);

  const evidenceOnly = promotions.find(
    (row) => row.knowledge_fact_id === "fact-protocol-2"
  );

  assert.ok(evidenceOnly);
  assert.equal(evidenceOnly.action, "Evidence Only");
  assert.equal(evidenceOnly.canonical_entity_type, "Product Attribute");
  assert.equal(evidenceOnly.canonical_entity_id, first.canonicalEntityId);
  assert.equal(evidenceOnly.source_checksum, "sha-second");
  assert.equal(evidenceOnly.idempotency_key, "promotion-key-2");

  raw.close();
});

test("a different Reviewed protocol value for an existing active canonical protocol fails closed as CONFLICT with no writes", async () => {
  const { raw, DB } = fixture();

  const first = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote the reviewed SLC protocol observation.",
    idempotencyKey: "promotion-key-1",
  });

  assert.equal(first.status, "PROMOTED");

  raw.exec(`
    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-conflict','org-a','conflicting-catalog.xlsx','sha-conflict','Product Catalogue','Completed','knowledge-library-v1.1');
  `);

  const observationKey = "Products:77:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-conflict",
    "org-a",
    "file-conflict",
    "Part Number",
    "part-100",
    "PART-100",
    "part-100",
    JSON.stringify({ observationKey }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 77,
      cell: "A77",
      fileName: "conflicting-catalog.xlsx",
    })
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol-conflict",
    "org-a",
    "file-conflict",
    "Protocol",
    "bacnet",
    "BACnet",
    "bacnet",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    94,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 77,
      cell: "D77",
      descriptionCell: "B77",
      fileName: "conflicting-catalog.xlsx",
    })
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part-conflict','org-a','fact-part-conflict','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const result = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol-conflict",
    organizationId: "org-a",
    actor: {
      id: "user-b",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Attempt promotion of conflicting reviewed protocol evidence.",
    idempotencyKey: "promotion-key-conflict",
  });

  assert.equal(result.status, "CONFLICT");
  assert.equal(result.factId, "fact-protocol-conflict");
  assert.equal(result.canonicalProductId, "product-a");
  assert.equal(result.attributeName, "protocol");
  assert.equal(result.existingValue, "SLC");
  assert.equal(result.proposedValue, "BACnet");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions
  );

  const activeProtocol = raw.prepare(`
    SELECT *
    FROM product_attributes
    WHERE product_id='product-a'
      AND attribute_name='protocol'
      AND deleted_at IS NULL
      AND superseded_at IS NULL
  `).all();

  assert.equal(activeProtocol.length, 1);
  assert.equal(activeProtocol[0].normalized_value, "SLC");

  raw.close();
});

test("promotion requires a durable idempotency key and performs no writes when it is missing", async () => {
  const { raw, DB } = fixture();

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const result = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote reviewed protocol evidence.",
    idempotencyKey: "",
  });

  assert.equal(result.status, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(result.factId, "fact-protocol");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions
  );

  raw.close();
});

test("promotion requires a substantive governed reason and performs no writes when the reason is too short", async () => {
  const { raw, DB } = fixture();

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const result = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "ok",
    idempotencyKey: "promotion-short-reason",
  });

  assert.equal(result.status, "PROMOTION_REASON_REQUIRED");
  assert.equal(result.factId, "fact-protocol");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions
  );

  raw.close();
});

test("reusing an idempotency key for a different fact fails closed with no writes", async () => {
  const { raw, DB } = fixture();

  const first = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol",
    organizationId: "org-a",
    actor: {
      id: "user-a",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Promote the first reviewed protocol fact.",
    idempotencyKey: "shared-promotion-key",
  });

  assert.equal(first.status, "PROMOTED");

  raw.exec(`
    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-other','org-a','other-catalog.xlsx','sha-other','Product Catalogue','Completed','knowledge-library-v1.1');
  `);

  const observationKey = "Other:20:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-other",
    "org-a",
    "file-other",
    "Part Number",
    "part-100",
    "PART-100",
    "part-100",
    JSON.stringify({ observationKey }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Other",
      row: 20,
      cell: "A20",
      fileName: "other-catalog.xlsx",
    })
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol-other",
    "org-a",
    "file-other",
    "Protocol",
    "slc",
    "SLC",
    "slc",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    91,
    "Reviewed",
    JSON.stringify({
      sheet: "Other",
      row: 20,
      cell: "D20",
      fileName: "other-catalog.xlsx",
    })
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part-other','org-a','fact-part-other','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const second = await promoteKnowledgeFact(DB, {
    factId: "fact-protocol-other",
    organizationId: "org-a",
    actor: {
      id: "user-b",
      role: "Library Manager",
      permission: "Library Manager",
    },
    reason: "Attempt to reuse a key that belongs to another fact.",
    idempotencyKey: "shared-promotion-key",
  });

  assert.equal(second.status, "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(second.factId, "fact-protocol-other");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions
  );

  raw.close();
});

test("promotion is atomic: a mid-batch failure rolls back every canonical write", async () => {
  const { raw, DB } = fixture();

  const failingDB = {
    prepare: DB.prepare,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        if (statements.length > 0) {
          await statements[0].run();
        }

        throw new Error("INJECTED_PROMOTION_BATCH_FAILURE");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  await assert.rejects(
    () =>
      promoteKnowledgeFact(failingDB, {
        factId: "fact-protocol",
        organizationId: "org-a",
        actor: {
          id: "user-a",
          role: "Library Manager",
          permission: "Library Manager",
        },
        reason: "Verify atomic rollback for governed Knowledge Promotion.",
        idempotencyKey: "promotion-atomicity-key",
      }),
    /INJECTED_PROMOTION_BATCH_FAILURE/
  );

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions
  );

  raw.close();
});
