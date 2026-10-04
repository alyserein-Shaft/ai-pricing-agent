import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { handleKnowledgeLibraryApi } from "../worker/knowledge-library-api.mjs";
import {
  requireLibraryCapability,
} from "../worker/library-auth.mjs";
import {
  KNOWLEDGE_DETERMINISTIC_PROMOTION_ACTOR,
  KNOWLEDGE_DETERMINISTIC_PROMOTION_REASON,
} from "../worker/knowledge-promotion.mjs";
import {
  KNOWLEDGE_PROMOTION_POLICY_VERSION,
} from "../app/domain/knowledge-promotion-policy.mjs";

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

const counts = (raw) => ({
  attributes: raw.prepare("SELECT COUNT(*) count FROM product_attributes").get().count,
  sources: raw.prepare("SELECT COUNT(*) count FROM product_sources").get().count,
  evidence: raw.prepare("SELECT COUNT(*) count FROM product_source_evidence").get().count,
  promotions: raw.prepare("SELECT COUNT(*) count FROM knowledge_promotions").get().count,
});

// The deterministic fixture mirrors the human-path promotion fixture except
// that the protocol fact is auto-learned (review_status='Learned'), which is
// the exact state the deterministic bridge must reach.
const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(migration);
  raw.exec(concurrencyMigration);

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
    "Learned",
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

const setFactState = (raw, reviewStatus, attributes) => {
  raw.prepare(`
    UPDATE knowledge_facts
    SET review_status=?, attributes=?
    WHERE id='fact-protocol'
  `).run(reviewStatus, JSON.stringify(attributes));
};

const deterministicRequest = (idempotencyKey, extra = {}) =>
  new Request(
    "http://localhost/api/knowledge/promote/fact/fact-protocol",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authorization: "deterministic",
        idempotencyKey,
        ...extra,
      }),
    },
  );

const humanRequest = (idempotencyKey, reason) =>
  new Request(
    "http://localhost/api/knowledge/promote/fact/fact-protocol",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason,
        idempotencyKey,
      }),
    },
  );

test("KNP-1 eligible Learned protocol fact promotes deterministically under the explicit system actor", async () => {
  const { raw, env } = fixture();

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-eligible"),
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
  assert.equal(body.policyVersion, KNOWLEDGE_PROMOTION_POLICY_VERSION);

  assert.deepEqual(counts(raw), { attributes: 1, sources: 1, evidence: 1, promotions: 1 });

  // The machine-learned fact state stays 'Learned': the deterministic path
  // must NOT pretend a human reviewed it.
  const fact = raw.prepare("SELECT review_status FROM knowledge_facts WHERE id='fact-protocol'").get();
  assert.equal(fact.review_status, "Learned");

  const attribute = raw.prepare("SELECT * FROM product_attributes").get();
  assert.equal(attribute.attribute_name, "protocol");
  assert.equal(attribute.normalized_value, "SLC");
  assert.equal(attribute.review_status, "Reviewed");
  assert.equal(attribute.created_by, KNOWLEDGE_DETERMINISTIC_PROMOTION_ACTOR);

  // Downstream evidence stays governed: the promoted product source is NOT
  // auto-approved, only recorded as discovery evidence.
  const source = raw.prepare("SELECT * FROM product_sources").get();
  assert.equal(source.review_status, "Needs Review");
  assert.equal(source.downstream_use, "Discovery Only");
  assert.equal(source.validity_state, "Validity Review Required");
  assert.equal(source.created_by, KNOWLEDGE_DETERMINISTIC_PROMOTION_ACTOR);

  const promotion = raw.prepare("SELECT * FROM knowledge_promotions").get();
  assert.equal(promotion.decided_by, KNOWLEDGE_DETERMINISTIC_PROMOTION_ACTOR);
  assert.equal(promotion.decided_role, "System");
  assert.equal(promotion.reason, KNOWLEDGE_DETERMINISTIC_PROMOTION_REASON);
  assert.equal(promotion.policy_version, KNOWLEDGE_PROMOTION_POLICY_VERSION);
  assert.equal(promotion.action, "Promoted");

  raw.close();
});

test("KNP-1 deterministic promotion ignores caller-supplied reason (audit is not spoofable)", async () => {
  const { raw, env } = fixture();

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-reason", { reason: "caller supplied arbitrary text" }),
    env,
  );

  assert.equal(response.status, 201, JSON.stringify(await response.json()));

  const promotion = raw.prepare("SELECT reason FROM knowledge_promotions").get();
  assert.equal(promotion.reason, KNOWLEDGE_DETERMINISTIC_PROMOTION_REASON);

  raw.close();
});

test("KNP-1 Needs Review fact is blocked on the deterministic path", async () => {
  const { raw, env } = fixture();
  setFactState(raw, "Needs Review", { observationKey: "Products:12:PART-100", partNumber: "PART-100" });
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-needs-review"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "NOT_APPROVED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 Rejected fact is blocked on the deterministic path", async () => {
  const { raw, env } = fixture();
  setFactState(raw, "Rejected", { observationKey: "Products:12:PART-100", partNumber: "PART-100" });
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-rejected"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "NOT_APPROVED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 human-Reviewed fact is blocked on the deterministic path (state paths stay distinct)", async () => {
  const { raw, env } = fixture();
  setFactState(raw, "Reviewed", { observationKey: "Products:12:PART-100", partNumber: "PART-100" });
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-reviewed-system"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "NOT_APPROVED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 existing human review path remains intact for Reviewed facts", async () => {
  const { raw, env } = fixture();
  setFactState(raw, "Reviewed", { observationKey: "Products:12:PART-100", partNumber: "PART-100" });

  const response = await handleKnowledgeLibraryApi(
    humanRequest("knp1-human-intact", "Human engineer promotes the reviewed protocol."),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "PROMOTED");

  const promotion = raw.prepare("SELECT decided_by, decided_role FROM knowledge_promotions").get();
  // KN-HUMAN-1: a human promotion is attributed to the configured HUMAN,
  // never to the synthetic single-user identity.
  assert.equal(promotion.decided_by, "op-test-human-1");
  assert.notEqual(promotion.decided_by, "user-a");
  assert.equal(promotion.decided_role, "Administrator");

  raw.close();
});

test("KNP-1 default human path still rejects Learned facts (no silent auto-trust)", async () => {
  const { raw, env } = fixture();
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    humanRequest("knp1-human-learned", "Attempt human promotion of a Learned fact."),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "NOT_APPROVED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 Learned fact carrying a human-judgment signal is blocked on the deterministic path", async () => {
  const { raw, env } = fixture();
  setFactState(raw, "Learned", {
    observationKey: "Products:12:PART-100",
    partNumber: "PART-100",
    reviewRequired: true,
  });
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-review-required"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "NOT_APPROVED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 deterministic path blocks facts whose source is not fully processed", async () => {
  const { raw, env } = fixture();
  raw.prepare("UPDATE knowledge_files SET processing_status='Processing' WHERE id='file-a'").run();
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-not-processed"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "SOURCE_NOT_PROCESSED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 deterministic path blocks unsupported fact types", async () => {
  const { raw, env } = fixture();
  raw.prepare(`
    UPDATE knowledge_facts
    SET fact_type='Voltage', original_value='24 VDC', normalized_value='24 VDC'
    WHERE id='fact-protocol'
  `).run();
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-unsupported-type"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "UNSUPPORTED_FACT_TYPE");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 deterministic path blocks facts without a resolvable canonical target", async () => {
  const { raw, env } = fixture();
  setFactState(raw, "Learned", {});
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-missing-target"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "MISSING_TARGET");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 deterministic path blocks ambiguous canonical targets", async () => {
  const { raw, env } = fixture();
  const sourcePartFact = raw.prepare("SELECT * FROM knowledge_facts WHERE id='fact-part'").get();
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
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-ambiguous"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "AMBIGUOUS_TARGET");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 same existing value returns Evidence Only and never duplicates the canonical attribute", async () => {
  const { raw, env } = fixture();
  raw.exec(`
    INSERT INTO product_attributes
      (id,product_id,variant_id,attribute_definition_id,attribute_name,value_json,original_value,normalized_value,unit,source_id,evidence_json,confidence,review_status,version_number,created_by)
    VALUES
      ('existing-protocol','product-a',NULL,NULL,'protocol','{}','SLC','SLC',NULL,NULL,'{}',90,'Reviewed',1,'user-a');
  `);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-same-value"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "EVIDENCE_ONLY");
  assert.equal(body.canonicalEntityId, "existing-protocol");
  assert.equal(body.idempotent, false);

  assert.deepEqual(counts(raw), { attributes: 1, sources: 1, evidence: 1, promotions: 1 });

  const promotion = raw.prepare("SELECT action FROM knowledge_promotions").get();
  assert.equal(promotion.action, "Evidence Only");

  raw.close();
});

test("KNP-1 conflicting active value returns CONFLICT and writes nothing", async () => {
  const { raw, env } = fixture();
  raw.exec(`
    INSERT INTO product_attributes
      (id,product_id,variant_id,attribute_definition_id,attribute_name,value_json,original_value,normalized_value,unit,source_id,evidence_json,confidence,review_status,version_number,created_by)
    VALUES
      ('active-modbus','product-a',NULL,NULL,'protocol','{}','Modbus','Modbus',NULL,NULL,'{}',90,'Reviewed',1,'user-a');
  `);

  const response = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-conflict"),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error.code, "CONFLICT");
  assert.equal(body.result.status, "CONFLICT");
  assert.equal(body.result.existingValue, "Modbus");
  assert.equal(body.result.proposedValue, "SLC");

  assert.deepEqual(counts(raw), { attributes: 1, sources: 0, evidence: 0, promotions: 0 });

  const active = raw.prepare(`
    SELECT normalized_value
    FROM product_attributes
    WHERE product_id='product-a'
      AND attribute_name='protocol'
      AND deleted_at IS NULL
      AND superseded_at IS NULL
      AND review_status<>'Rejected'
  `).all();
  assert.deepEqual(active.map((row) => row.normalized_value), ["Modbus"]);

  raw.close();
});

test("KNP-1 repeat deterministic promotion with the same key is idempotent", async () => {
  const { raw, env } = fixture();

  const first = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-replay"),
    env,
  );
  const firstBody = await first.json();

  const second = await handleKnowledgeLibraryApi(
    deterministicRequest("knp1-replay"),
    env,
  );
  const secondBody = await second.json();

  assert.equal(first.status, 201, JSON.stringify(firstBody));
  assert.equal(firstBody.status, "PROMOTED");
  assert.equal(firstBody.idempotent, false);

  assert.equal(second.status, 200, JSON.stringify(secondBody));
  assert.equal(secondBody.status, "PROMOTED");
  assert.equal(secondBody.idempotent, true);

  assert.deepEqual(counts(raw), { attributes: 1, sources: 1, evidence: 1, promotions: 1 });

  raw.close();
});

test("KNP-1 deterministic path still requires an idempotency key", async () => {
  const { raw, env } = fixture();
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/fact-protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authorization: "deterministic",
        reason: "ignored by the system path",
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 deterministic path returns 404 for a missing fact", async () => {
  const { raw, env } = fixture();
  const before = counts(raw);

  const response = await handleKnowledgeLibraryApi(
    new Request("http://localhost/api/knowledge/promote/fact/missing-fact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authorization: "deterministic",
        idempotencyKey: "knp1-missing-fact",
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "FACT_NOT_FOUND");
  assert.deepEqual(counts(raw), before);

  raw.close();
});

test("KNP-1 capability floor: promotion requires at least Library Reviewer", () => {
  const denied = requireLibraryCapability(
    { permission: "Library Viewer", fullAccess: false },
    "review",
  );
  assert.ok(denied);
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "LIBRARY_PERMISSION_DENIED");

  const allowedReviewer = requireLibraryCapability(
    { permission: "Library Reviewer", fullAccess: false },
    "review",
  );
  assert.equal(allowedReviewer, null);

  // AUTH-001 (corrected root cause). This case previously asserted that a bare
  // `{ fullAccess: true }` actor -- with NO role and NO permission -- was
  // granted Library Reviewer authority. That is exactly the shortcut the
  // corrected semantics forbid: fullAccess may only be true as an explicit
  // authoritative Administrator grant, never as a flag that bypasses the
  // capability model on its own. Such an actor now proves nothing, so it is
  // REFUSED, and authority must come from the role.
  const fullAccessWithoutRole = requireLibraryCapability(
    { fullAccess: true },
    "review",
  );
  assert.ok(
    fullAccessWithoutRole,
    "fullAccess with no role is not an authority grant and must be refused",
  );
  assert.equal(fullAccessWithoutRole.status, 403);

  // The real explicit Administrator grant still passes, without relying on the
  // flag at all: Administrator satisfies every capability on its own rank.
  const allowedAdministrator = requireLibraryCapability(
    { permission: "Administrator", role: "Administrator", fullAccess: false },
    "review",
  );
  assert.equal(allowedAdministrator, null);
});