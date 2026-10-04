import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { handleProductIdentityApi } from "../worker/product-identity-api.mjs";

// R2 — PRODUCT IDENTITIES: TOTAL / PAGINATION / PROVENANCE.
// The GET /api/product-identities endpoint must:
//   1. Return a truthful `total` (COUNT of matching identities), never the
//      fetched-page length — killing the silent default-100 truncation.
//   2. Support `limit`/`offset` pagination with `hasMore` transitions.
//   3. Attach real source provenance (`source_file`) per row so the UI never
//      has to fall back to fabricated "Unnamed source".
//   4. Keep the existing row columns and perform zero mutations.
//   5. Respect limit bounds (1..200) and offset >= 0.

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
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE knowledge_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  review_status TEXT NOT NULL DEFAULT 'Learned',
  source_location TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_identities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  manufacturer TEXT,
  brand TEXT,
  family TEXT,
  series TEXT,
  model TEXT,
  official_product_code TEXT NOT NULL,
  normalized_product_code TEXT NOT NULL,
  description TEXT,
  category TEXT,
  sub_category TEXT,
  system TEXT,
  unit TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'Unknown',
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  UNIQUE(organization_id, identity_key)
);

CREATE TABLE product_identity_observations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL,
  observation_key TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}',
  source_location TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL,
  observed_date TEXT,
  region TEXT,
  source_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_identity_aliases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_identity_prices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL,
  price_amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  region TEXT,
  effective_date TEXT,
  validity TEXT,
  price_type TEXT NOT NULL DEFAULT 'Historical Catalogue Price',
  discovery_status TEXT NOT NULL DEFAULT 'Discovery Only',
  costing_eligible INTEGER NOT NULL DEFAULT 0,
  source_location TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_identity_relationships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  source_identity_id TEXT NOT NULL,
  target_identity_id TEXT,
  target_code TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);

  raw.exec(`
    INSERT INTO organizations (id, name, status) VALUES ('org-a', 'Fixture Org', 'Active');
    INSERT INTO organization_memberships (id, organization_id, user_id, status, granted_by) VALUES
      ('mem-a', 'org-a', 'user-a', 'Active', 'seed');
    INSERT INTO knowledge_files (id, organization_id, file_name, sha256, detected_type, processing_status, extraction_version) VALUES
      ('file-a', 'org-a', 'catalog-a.xlsx', 'sha-a', 'Product Catalogue', 'Completed', 'test-v1'),
      ('file-b', 'org-a', 'catalog-b.xlsx', 'sha-b', 'Product Catalogue', 'Completed', 'test-v1'),
      ('file-c', 'org-a', 'price-list-c.xlsx', 'sha-c', 'Price List', 'Completed', 'test-v1');
    INSERT INTO knowledge_facts (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value, normalized_value, confidence, review_status) VALUES
      ('fact-a-1', 'org-a', 'file-a', 'Part Number', 'part-number', 'CODE-A', 'code-a', 90, 'Learned'),
      ('fact-a-2', 'org-a', 'file-a', 'Part Number', 'part-number', 'CODE-B', 'code-b', 90, 'Learned'),
      ('fact-c-1', 'org-a', 'file-c', 'Price', 'price', 'USD 12', 'usd 12', 85, 'Learned');
  `);

  // 5 active identities (one superseded must never appear).
  raw.exec(`
    INSERT INTO product_identities (id, organization_id, identity_key, manufacturer, official_product_code, normalized_product_code, description, confidence, review_status, lifecycle_status, created_by, created_at) VALUES
      ('id-1', 'org-a', 'key-1', 'Honeywell', 'CODE-A', 'code-a', 'Detector head', 95, 'Needs Review', 'Unknown', 'user-a', '2026-01-01T00:00:00Z'),
      ('id-2', 'org-a', 'key-2', NULL, 'CODE-B', 'code-b', 'Base', 88, 'Needs Review', 'Unknown', 'user-a', '2026-01-02T00:00:00Z'),
      ('id-3', 'org-a', 'key-3', 'Gent', 'CODE-C', 'code-c', 'Panel', 91, 'Needs Review', 'Unknown', 'user-a', '2026-01-03T00:00:00Z'),
      ('id-4', 'org-a', 'key-4', 'Notifier', 'CODE-D', 'code-d', 'Sounders', 84, 'Needs Review', 'Unknown', 'user-a', '2026-01-04T00:00:00Z'),
      ('id-5', 'org-a', 'key-5', 'Apollo', 'CODE-E', 'code-e', 'Detector', 92, 'Needs Review', 'Unknown', 'user-a', '2026-01-05T00:00:00Z');
    INSERT INTO product_identities (id, organization_id, identity_key, manufacturer, official_product_code, normalized_product_code, description, confidence, review_status, lifecycle_status, created_by, created_at, superseded_at) VALUES
      ('id-superseded', 'org-a', 'key-sup', 'Old Co', 'CODE-OLD', 'code-old', 'Old', 60, 'Needs Review', 'Unknown', 'user-a', '2026-01-06T00:00:00Z', '2026-02-01T00:00:00Z');
  `);

  // Provenance: id-1 observed in file-a and file-b; id-2 only in file-b;
  // id-3 in file-a; id-4 and id-5 in file-c.
  raw.exec(`
    INSERT INTO product_identity_observations (id, organization_id, product_identity_id, knowledge_file_id, knowledge_fact_id, observation_key, observation_type, original_value, normalized_value, confidence, source_type, created_at) VALUES
      ('obs-1a', 'org-a', 'id-1', 'file-a', 'fact-a-1', 'k-1a', 'Part Number', 'CODE-A', 'code-a', 95, 'Catalog', '2026-01-01T00:00:00Z'),
      ('obs-1b', 'org-a', 'id-1', 'file-b', 'fact-a-2', 'k-1b', 'Part Number', 'CODE-A', 'code-a', 95, 'Catalog', '2026-01-02T00:00:00Z'),
      ('obs-2',  'org-a', 'id-2', 'file-b', 'fact-a-2', 'k-2',  'Part Number', 'CODE-B', 'code-b', 88, 'Catalog', '2026-01-02T00:00:00Z'),
      ('obs-3',  'org-a', 'id-3', 'file-a', 'fact-a-1', 'k-3',  'Part Number', 'CODE-C', 'code-c', 91, 'Catalog', '2026-01-03T00:00:00Z'),
      ('obs-4',  'org-a', 'id-4', 'file-c', 'fact-c-1', 'k-4',  'Part Number', 'CODE-D', 'code-d', 84, 'Price List', '2026-01-04T00:00:00Z'),
      ('obs-5',  'org-a', 'id-5', 'file-c', 'fact-c-1', 'k-5',  'Part Number', 'CODE-E', 'code-e', 92, 'Price List', '2026-01-05T00:00:00Z');
  `);

  return {
    raw,
    env: {
      DB: d1(raw),
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "user-a",
      APP_ORGANIZATION_ID: "org-a",
      APP_USER_EMAIL: "user@test.invalid",
      APP_USER_NAME: "Single User",
    },
  };
};

const list = (params, env) =>
  handleProductIdentityApi(
    new Request(`http://localhost/api/product-identities?${params}`, {
      method: "GET",
    }),
    env,
  ).then((response) => response.json());

test("R2 identity list returns a truthful total (not page length) with provenance", async () => {
  const { raw, env } = fixture();

  const body = await list("limit=200&offset=0", env);
  assert.equal(body.total, 5, "total must be the count of matching identities (excludes superseded)");
  assert.ok(Array.isArray(body.identities), "identities must be an array");
  assert.equal(body.identities.length, 5, "all 5 fit within limit 200");
  assert.equal(body.hasMore, false, "no more pages when total fits the limit");
  assert.equal(body.limit, 200);
  assert.equal(body.offset, 0);
  for (const row of body.identities) {
    assert.ok(row.id, "each row must carry its id");
    assert.ok(row.official_product_code, "each row must carry its product code");
    assert.ok(row.source_file, "each row must carry real source provenance");
    assert.ok(
      row.source_file === "catalog-a.xlsx" ||
        row.source_file === "catalog-b.xlsx" ||
        row.source_file === "price-list-c.xlsx",
      "source_file must be a real knowledge file name",
    );
  }
  // Truthful pagination fields exist; on a bounded page the total must exceed
  // the fetched-page length (the silent-truncation defect this slice kills).
  const bounded = await list("limit=3&offset=0", env);
  assert.equal(bounded.total, 5, "bounded page still reports the full total");
  assert.equal(bounded.identities.length, 3, "the page itself is bounded");
  assert.equal(bounded.hasMore, true, "hasMore true while identities remain");
  assert.notEqual(bounded.total, bounded.identities.length, "total must never equal the page length on a bounded page");

  // Zero mutation.
  const identityCount = raw.prepare("SELECT COUNT(*) count FROM product_identities").get().count;
  const observationCount = raw.prepare("SELECT COUNT(*) count FROM product_identity_observations").get().count;
  assert.equal(identityCount, 6, "list must not mutate identities");
  assert.equal(observationCount, 6, "list must not mutate observations");
});

test("R2 identity list paginates with limit/offset and honest hasMore", async () => {
  const { env } = fixture();

  const pageOne = await list("limit=2&offset=0", env);
  assert.equal(pageOne.total, 5);
  assert.equal(pageOne.identities.length, 2);
  assert.equal(pageOne.hasMore, true, "more identities exist beyond page one");

  const pageTwo = await list("limit=2&offset=2", env);
  assert.equal(pageTwo.total, 5);
  assert.equal(pageTwo.identities.length, 2);
  assert.equal(pageTwo.hasMore, true);

  const pageThree = await list("limit=2&offset=4", env);
  assert.equal(pageThree.identities.length, 1);
  assert.equal(pageThree.hasMore, false, "last page has no more");

  const beyond = await list("limit=2&offset=10", env);
  assert.equal(beyond.identities.length, 0, "offset beyond total returns an empty page");
  assert.equal(beyond.hasMore, false, "no hasMore when nothing remains");

  // No overlapping ids across pages.
  const ids = [...pageOne.identities, ...pageTwo.identities, ...pageThree.identities].map(
    (row) => row.id,
  );
  assert.equal(new Set(ids).size, 5, "pagination must not duplicate or skip identities");
});

test("R2 identity list scopes total to the q filter", async () => {
  const { env } = fixture();

  const filtered = await list("q=honeywell&limit=200&offset=0", env);
  assert.equal(filtered.total, 1, "only the Honeywell identity matches");
  assert.equal(filtered.identities.length, 1);
  assert.equal(filtered.identities[0].id, "id-1");

  const byCode = await list("q=code-b&limit=200&offset=0", env);
  assert.equal(byCode.total, 1, "search matches normalized product code");
  assert.equal(byCode.identities[0].id, "id-2");

  const none = await list("q=zzzznope&limit=200&offset=0", env);
  assert.equal(none.total, 0, "no-match filter yields total 0, not a lied page length");
  assert.equal(none.identities.length, 0);
});

test("R2 identity list bound-checks limit and offset", async () => {
  const { env } = fixture();

  const clampedUp = await list("limit=500&offset=0", env);
  assert.equal(clampedUp.limit, 200, "limit clamps down to the maximum of 200");
  assert.equal(clampedUp.identities.length, 5);

  const clampedDown = await list("limit=0&offset=0", env);
  assert.equal(clampedDown.limit, 1, "limit clamps up to the minimum of 1");
  assert.equal(clampedDown.identities.length, 1);

  const negativeOffset = await list("limit=200&offset=-5", env);
  assert.equal(negativeOffset.offset, 0, "negative offset clamps to zero");
  assert.equal(negativeOffset.identities.length, 5);
});

test("R2 identity list keeps source_file provenance aligned with real observations", async () => {
  const { env } = fixture();

  const body = await list("limit=200&offset=0", env);
  const first = body.identities.find((row) => row.id === "id-1");
  // id-1 has observations in file-a and file-b; the earliest (created_at) is catalog-a.xlsx.
  assert.equal(first.source_file, "catalog-a.xlsx");
  assert.equal(first.observation_count, 2, "observation_count must remain truthful");
  assert.equal(first.document_count, 2, "document_count counts distinct files");
  const second = body.identities.find((row) => row.id === "id-2");
  assert.equal(second.source_file, "catalog-b.xlsx");
  assert.equal(second.manufacturer, null, "identity without manufacturer keeps null (UI must not fabricate a name)");
});