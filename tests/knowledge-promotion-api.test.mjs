import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { handleKnowledgeLibraryApi } from "../worker/knowledge-library-api.mjs";

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

const schema = `
PRAGMA foreign_keys=ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL
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

CREATE TABLE knowledge_file_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  knowledge_file_id TEXT,
  event_type TEXT,
  details TEXT,
  actor_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  "utf8",
);

const concurrencyMigration = await readFile(
  new URL("../drizzle/0076_knowledge_promotion_concurrency_guard.sql", import.meta.url),
  "utf8",
);

const fixture = ({ applyPromotionMigrations = true } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  if (applyPromotionMigrations) {
    raw.exec(migration);
    raw.exec(concurrencyMigration);
  }

  raw.exec(`
    INSERT INTO organizations VALUES ('org-a','BD-Shaft','Active');

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
    }),
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
    }),
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part','org-a','fact-part','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  return {
    raw,
    env: {
      DB: d1(raw),
      APP_ACCESS_MODE: "single-user",
      // KN-HUMAN-1: a human Knowledge promotion quotes a configured human
      // identity, exactly as the other human-authority routes do.
      APP_HUMAN_ID: "op-test-human-1",
      APP_HUMAN_NAME: "Test Knowledge Reviewer",
      APP_HUMAN_EMAIL: "test-knowledge-reviewer@development.invalid",
      APP_USER_ID: "user-a",
      APP_ORGANIZATION_ID: "org-a",
      APP_USER_EMAIL: "user@test.invalid",
      APP_USER_NAME: "Single User",
    },
  };
};

test("single-user Knowledge API promotes one reviewed fact into canonical Product Knowledge", async () => {
  const { raw, env } = fixture();

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Promote reviewed protocol into canonical Product Knowledge.",
          idempotencyKey: "api-promotion-key-1",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "PROMOTED");
  assert.equal(body.factId, "fact-protocol");
  assert.equal(body.canonicalProductId, "product-a");
  assert.equal(body.attributeName, "protocol");
  assert.equal(body.normalizedValue, "SLC");
  assert.equal(body.idempotent, false);

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    1,
  );

  const promotion = raw.prepare("SELECT * FROM knowledge_promotions").get();
  // KN-HUMAN-1: a human promotion is attributed to the configured HUMAN,
  // never to the synthetic single-user identity.
  assert.equal(promotion.decided_by, "op-test-human-1");
  assert.notEqual(promotion.decided_by, "user-a");

  raw.close();
});

test("single-user Knowledge Promotion API replay returns 200 and creates no duplicate canonical records", async () => {
  const { raw, env } = fixture();

  const makeRequest = () =>
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Promote reviewed protocol into canonical Product Knowledge.",
          idempotencyKey: "api-promotion-key-replay",
        }),
      },
    );

  const first = await handleKnowledgeLibraryApi(makeRequest(), env);
  const firstBody = await first.json();

  const second = await handleKnowledgeLibraryApi(makeRequest(), env);
  const secondBody = await second.json();

  assert.equal(first.status, 201, JSON.stringify(firstBody));
  assert.equal(firstBody.status, "PROMOTED");
  assert.equal(firstBody.idempotent, false);

  assert.equal(second.status, 200, JSON.stringify(secondBody));
  assert.equal(secondBody.status, "PROMOTED");
  assert.equal(secondBody.idempotent, true);

  assert.equal(
    secondBody.canonicalEntityId,
    firstBody.canonicalEntityId,
  );
  assert.equal(
    secondBody.productSourceId,
    firstBody.productSourceId,
  );

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    1,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns success for Evidence Only corroboration", async () => {
  const { raw, env } = fixture();

  const first = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Promote the first reviewed protocol source.",
          idempotencyKey: "api-first-source",
        }),
      },
    ),
    env,
  );

  assert.equal(first.status, 201);

  raw.exec(`
    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-b','org-a','catalog-b.xlsx','sha-b','Product Catalogue','Completed','knowledge-library-v1.1');
  `);

  const observationKey = "Products:33:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-b",
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
      sheet: "Products",
      row: 33,
      cell: "A33",
      fileName: "catalog-b.xlsx",
    }),
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol-b",
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
    93,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 33,
      cell: "D33",
      descriptionCell: "B33",
      fileName: "catalog-b.xlsx",
    }),
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part-b','org-a','fact-part-b','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  const second = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol-b",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Preserve a second reviewed source confirming the same protocol.",
          idempotencyKey: "api-second-source",
        }),
      },
    ),
    env,
  );

  const body = await second.json();

  assert.equal(second.status, 201, JSON.stringify(body));
  assert.equal(body.status, "EVIDENCE_ONLY");
  assert.equal(body.idempotent, false);

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    2,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    2,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    2,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 409 and writes nothing for conflicting canonical protocol", async () => {
  const { raw, env } = fixture();

  const first = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Promote the reviewed canonical protocol.",
          idempotencyKey: "api-conflict-base",
        }),
      },
    ),
    env,
  );

  assert.equal(first.status, 201);

  raw.exec(`
    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-conflict','org-a','conflict.xlsx','sha-conflict','Product Catalogue','Completed','knowledge-library-v1.1');
  `);

  const observationKey = "Products:44:PART-100";

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
      row: 44,
      cell: "A44",
      fileName: "conflict.xlsx",
    }),
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
    "modbus",
    "Modbus",
    "modbus",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    95,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 44,
      cell: "D44",
      descriptionCell: "B44",
      fileName: "conflict.xlsx",
    }),
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

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol-conflict",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion of a conflicting reviewed protocol.",
          idempotencyKey: "api-conflict-new",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "CONFLICT");
  assert.equal(body.result.status, "CONFLICT");
  assert.equal(body.result.existingValue, "SLC");
  assert.equal(body.result.proposedValue, "Modbus");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 409 when one idempotency key is reused for another fact", async () => {
  const { raw, env } = fixture();

  const first = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Promote the reviewed canonical protocol.",
          idempotencyKey: "shared-api-idempotency-key",
        }),
      },
    ),
    env,
  );

  assert.equal(first.status, 201);

  raw.exec(`
    INSERT INTO knowledge_files
      (id,organization_id,file_name,sha256,detected_type,processing_status,extraction_version)
    VALUES
      ('file-idem','org-a','idem.xlsx','sha-idem','Product Catalogue','Completed','knowledge-library-v1.1');
  `);

  const observationKey = "Products:55:PART-100";

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-idem",
    "org-a",
    "file-idem",
    "Part Number",
    "part-100",
    "PART-100",
    "part-100",
    JSON.stringify({ observationKey }),
    99,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 55,
      cell: "A55",
      fileName: "idem.xlsx",
    }),
  );

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-protocol-idem",
    "org-a",
    "file-idem",
    "Protocol",
    "slc",
    "SLC",
    "slc",
    JSON.stringify({
      observationKey,
      partNumber: "PART-100",
    }),
    94,
    "Reviewed",
    JSON.stringify({
      sheet: "Products",
      row: 55,
      cell: "D55",
      descriptionCell: "B55",
      fileName: "idem.xlsx",
    }),
  );

  raw.exec(`
    INSERT INTO knowledge_product_links
      (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information)
    VALUES
      ('link-part-idem','org-a','fact-part-idem','PART-100','product-a','Existing Product — Additive Learning Only','{}');
  `);

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol-idem",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt another promotion with the same idempotency key.",
          idempotencyKey: "shared-api-idempotency-key",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(body.result.status, "IDEMPOTENCY_KEY_CONFLICT");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 404 when the fact does not exist", async () => {
  const { raw, env } = fixture();

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/missing-fact",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion of a missing reviewed fact.",
          idempotencyKey: "api-missing-fact",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "FACT_NOT_FOUND");
  assert.equal(body.result.status, "FACT_NOT_FOUND");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 and writes nothing when the fact is not Reviewed", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE knowledge_facts
    SET review_status='Learned'
    WHERE id='fact-protocol'
  `).run();

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion before the fact has been reviewed.",
          idempotencyKey: "api-not-approved",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "NOT_APPROVED");
  assert.equal(body.result.status, "NOT_APPROVED");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 and writes nothing when the source file is not fully processed", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE knowledge_files
    SET processing_status='Processing'
    WHERE id='file-a'
  `).run();

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion before source processing is complete.",
          idempotencyKey: "api-source-not-processed",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "SOURCE_NOT_PROCESSED");
  assert.equal(body.result.status, "SOURCE_NOT_PROCESSED");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 and writes nothing when the canonical target cannot be resolved", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE knowledge_facts
    SET attributes=?
    WHERE id='fact-protocol'
  `).run(JSON.stringify({}));

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion without enough target identity evidence.",
          idempotencyKey: "api-missing-target",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "MISSING_TARGET");
  assert.equal(body.result.status, "MISSING_TARGET");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 and writes nothing when target resolution is ambiguous", async () => {
  const { raw, env } = fixture();

  const sourcePartFact = raw.prepare(`
    SELECT *
    FROM knowledge_facts
    WHERE id='fact-part'
  `).get();

  raw.prepare(`
    INSERT INTO knowledge_facts
    (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "fact-part-duplicate",
    sourcePartFact.organization_id,
    sourcePartFact.knowledge_file_id,
    sourcePartFact.fact_type,
    "part-100-duplicate",
    sourcePartFact.original_value,
    sourcePartFact.normalized_value,
    sourcePartFact.attributes,
    sourcePartFact.confidence,
    sourcePartFact.review_status,
    sourcePartFact.source_location,
  );

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion when product target evidence is ambiguous.",
          idempotencyKey: "api-ambiguous-target",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "AMBIGUOUS_TARGET");
  assert.equal(body.result.status, "AMBIGUOUS_TARGET");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

// KN-SCOPE-1: "incompatible scope" is now a PROJECT library product (or another
// organization's library), not a Global Library product. The live catalogue is
// 100% Global Library, and the previous rule refused every one of them, so the
// route answered 409 for the whole catalogue and Knowledge promotion could never
// run. The fail-closed guarantee is unchanged for genuinely incompatible scopes.
test("single-user Knowledge Promotion API returns 409 and writes nothing when the product is project-scoped", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE library_products
    SET library_scope='Project Library',
        organization_id=NULL,
        library_project_id='project-x'
    WHERE id='product-a'
  `).run();

  const before = {
    attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
  };

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion into a project-scoped product outside library scope.",
          idempotencyKey: "api-scope-conflict",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "SCOPE_CONFLICT");
  assert.equal(body.result.status, "SCOPE_CONFLICT");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
    before.attributes,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    before.sources,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    before.evidence,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    before.promotions,
  );

  raw.close();
});

test("single-user Knowledge Promotion API promotes into a Global Library product (KN-SCOPE-1)", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE library_products
    SET library_scope='Global Library',
        organization_id=NULL
    WHERE id='product-a'
  `).run();

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Promote reviewed protocol evidence into a Global Library catalogue product.",
          idempotencyKey: "api-global-library-ok",
        }),
      },
    ),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "PROMOTED");
  // The human promotion path writes the canonical attribute Approved.
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_attributes WHERE review_status='Approved'").get().count,
    1,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 for invalid provenance", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE knowledge_facts
    SET source_location='{}'
    WHERE id='fact-protocol'
  `).run();

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Attempt promotion without valid source provenance.",
        idempotencyKey: "api-invalid-provenance",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "INVALID_PROVENANCE");
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    0,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 for unsupported fact types", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE knowledge_facts
    SET fact_type='Voltage',
        original_value='24 VDC',
        normalized_value='24 VDC'
    WHERE id='fact-protocol'
  `).run();

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Attempt promotion of a fact type not supported by Phase 1.",
        idempotencyKey: "api-unsupported-fact",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "UNSUPPORTED_FACT_TYPE");
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    0,
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns 422 for unsupported protocol values", async () => {
  const { raw, env } = fixture();

  raw.prepare(`
    UPDATE knowledge_facts
    SET original_value='Unknown Proprietary Bus',
        normalized_value='unknown proprietary bus'
    WHERE id='fact-protocol'
  `).run();

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Attempt promotion of an unsupported protocol value.",
        idempotencyKey: "api-unsupported-value",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "UNSUPPORTED_ATTRIBUTE_VALUE");
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    0,
  );

  raw.close();
});

test("single-user Knowledge Promotion API requires an idempotency key", async () => {
  const { raw, env } = fixture();

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Valid governed promotion reason.",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    0,
  );

  raw.close();
});

test("single-user Knowledge Promotion API requires a governed reason", async () => {
  const { raw, env } = fixture();

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "no",
        idempotencyKey: "api-short-reason",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "PROMOTION_REASON_REQUIRED");
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    0,
  );

  raw.close();
});

test("concurrent same-value protocol creation converges on one canonical attribute", async () => {
  const { raw, env } = fixture();
  const baseDB = env.DB;
  let injected = false;

  env.DB = {
    ...baseDB,
    async batch(statements) {
      if (!injected) {
        injected = true;
        raw.prepare(`
          INSERT INTO product_attributes (
            id,product_id,variant_id,attribute_definition_id,
            attribute_name,value_json,original_value,normalized_value,
            unit,source_id,evidence_json,confidence,review_status,
            version_number,created_by
          ) VALUES (
            'concurrent-protocol','product-a',NULL,NULL,
            'protocol','{}','SLC','SLC',
            NULL,NULL,'{}',90,'Reviewed',1,'concurrent-user'
          )
        `).run();
      }
      return baseDB.batch(statements);
    },
  };

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Promote while another request creates the same canonical protocol.",
        idempotencyKey: "race-same-value",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "EVIDENCE_ONLY");
  assert.equal(body.canonicalEntityId, "concurrent-protocol");

  assert.equal(
    raw.prepare(`
      SELECT COUNT(*) count
      FROM product_attributes
      WHERE product_id='product-a'
        AND attribute_name='protocol'
        AND deleted_at IS NULL
        AND superseded_at IS NULL
        AND review_status<>'Rejected'
    `).get().count,
    1,
  );

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    1,
  );

  raw.close();
});

test("concurrent different-value protocol creation fails closed with zero promotion writes", async () => {
  const { raw, env } = fixture();
  const baseDB = env.DB;
  let injected = false;

  env.DB = {
    ...baseDB,
    async batch(statements) {
      if (!injected) {
        injected = true;
        raw.prepare(`
          INSERT INTO product_attributes (
            id,product_id,variant_id,attribute_definition_id,
            attribute_name,value_json,original_value,normalized_value,
            unit,source_id,evidence_json,confidence,review_status,
            version_number,created_by
          ) VALUES (
            'concurrent-conflict','product-a',NULL,NULL,
            'protocol','{}','Modbus','Modbus',
            NULL,NULL,'{}',90,'Reviewed',1,'concurrent-user'
          )
        `).run();
      }
      return baseDB.batch(statements);
    },
  };

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Promote while another request creates a conflicting canonical protocol.",
        idempotencyKey: "race-different-value",
      }),
    }),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "CONFLICT");

  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
    0,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
    0,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
    0,
  );

  const active = raw.prepare(`
    SELECT normalized_value
    FROM product_attributes
    WHERE product_id='product-a'
      AND attribute_name='protocol'
      AND deleted_at IS NULL
      AND superseded_at IS NULL
      AND review_status<>'Rejected'
  `).all();

  assert.deepEqual(
    active.map((row) => row.normalized_value),
    ["Modbus"],
  );

  raw.close();
});

test("single-user Knowledge Promotion API returns a controlled schema error when promotion migration is missing", async () => {
  const { raw, env } = fixture({ applyPromotionMigrations: false });

  const response = await handleKnowledgeLibraryApi(
    new Request(
      "http://localhost/api/knowledge/promote/fact/fact-protocol",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Attempt promotion before required database migration is applied.",
          idempotencyKey: "api-schema-missing",
        }),
      },
    ),
    env,
  );

  const body = await response.json();

  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.error.code, "DATABASE_SCHEMA_MISSING");

  raw.close();
});
