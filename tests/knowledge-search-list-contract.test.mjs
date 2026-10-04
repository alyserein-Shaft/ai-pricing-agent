import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { handleKnowledgeLibraryApi } from "../worker/knowledge-library-api.mjs";

// R1 — SEARCH DEFAULT + COUNT TRUTH.
// The /api/knowledge/search endpoint must:
//   1. Support an explicit bounded `list-all=1` default listing that returns
//      real knowledge (never a false empty) with a truthful `total` that is
//      NOT the fetched-page length.
//   2. Keep typed search (q >= 2) working, now also with a truthful `total`.
//   3. Return a neutral `mode:"empty"` state for too-short queries without
//      list-all (never claim knowledge is absent).
//   4. Respect limit/offset bounds and perform zero mutations.

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
  organization_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);

  raw.exec(`
    INSERT INTO organizations (id, name, status) VALUES ('org-a', 'Fixture Org', 'Active');
    INSERT INTO knowledge_files (id, organization_id, file_name, sha256, detected_type, processing_status, extraction_version, uploaded_at) VALUES
      ('file-a', 'org-a', 'catalog-a.xlsx', 'sha-a', 'Product Catalogue', 'Completed', 'test-v1', '2026-01-01T00:00:00Z'),
      ('file-b', 'org-a', 'catalog-b.xlsx', 'sha-b', 'Product Catalogue', 'Completed', 'test-v1', '2026-01-02T00:00:00Z'),
      ('file-c', 'org-a', 'spec-c.pdf', 'sha-c', 'Specification', 'Completed', 'test-v1', '2026-01-03T00:00:00Z');
  `);

  raw.exec(`
    INSERT INTO knowledge_facts (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value, normalized_value, confidence, review_status) VALUES
      -- Manufacturer: honeywell appears in two files (one distinct entity).
      ('fact-m1', 'org-a', 'file-a', 'Manufacturer', 'manufacturer', 'Honeywell', 'honeywell', 90, 'Learned'),
      ('fact-m2', 'org-a', 'file-b', 'Manufacturer', 'manufacturer', 'HONEYWELL', 'honeywell', 95, 'Learned'),
      ('fact-m3', 'org-a', 'file-a', 'Manufacturer', 'manufacturer', 'Gent', 'gent', 80, 'Learned'),
      -- Standard: two distinct values, three rows (duplicate of one value).
      ('fact-s1', 'org-a', 'file-a', 'Standard', 'standard', 'EN 54', 'en 54', 88, 'Learned'),
      ('fact-s2', 'org-a', 'file-b', 'Standard', 'standard', 'EN54', 'en 54', 92, 'Learned'),
      ('fact-s3', 'org-a', 'file-c', 'Standard', 'standard', 'BS 1363', 'bs 1363', 85, 'Learned'),
      -- Part Number: two rows, two distinct values.
      ('fact-p1', 'org-a', 'file-a', 'Part Number', 'part-number', 'PN-100', 'pn-100', 93, 'Learned'),
      ('fact-p2', 'org-a', 'file-b', 'Part Number', 'part-number', 'PN-200', 'pn-200', 91, 'Needs Review');
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

const totals = (raw) => ({
  files: raw.prepare("SELECT COUNT(*) count FROM knowledge_files").get().count,
  facts: raw.prepare("SELECT COUNT(*) count FROM knowledge_facts").get().count,
});

const search = (params, env) =>
  handleKnowledgeLibraryApi(
    new Request(`http://localhost/api/knowledge/search?${params}`, {
      method: "GET",
    }),
    env,
  ).then((response) => response.json());

test("R1 list-all=1 returns a bounded real listing with a truthful total (not page length)", async () => {
  const { raw, env } = fixture();
  const body = await search("list-all=1&limit=200&offset=0", env);

  assert.equal(body.mode, "list-all");
  // 8 facts in the fixture → 6 distinct (fact_type, normalized_value) entities
  // (honeywell and en-54 each appear in two files).
  assert.equal(body.total, 6, "total must be the distinct-entity count");
  assert.ok(Array.isArray(body.results), "results must be an array");
  assert.equal(body.results.length, 6, "bounded listing returns all 6 distinct entities");
  assert.equal(body.hasMore, false, "no more pages when total fits the limit");
  for (const row of body.results) {
    assert.ok(row.fact_type, "each listed row must carry its fact_type");
    assert.ok(row.normalized_value, "each listed row must carry its normalized value");
    assert.ok(row.file_name, "each listed row must carry source provenance");
  }
  // The duplicate honeywell fact collapses into one entity row.
  const manufacturerValues = body.results
    .filter((row) => row.fact_type === "Manufacturer")
    .map((row) => row.normalized_value);
  assert.deepEqual([...manufacturerValues].sort(), ["gent", "honeywell"]);
  assert.equal(totals(raw).facts, 8, "list-all must not mutate facts");
  assert.equal(totals(raw).files, 3, "list-all must not mutate files");
});

test("R1 list-all=1 with a type filter returns only that type with a type-scoped total", async () => {
  const { env } = fixture();

  const manufacturers = await search("list-all=1&type=Manufacturer&limit=200&offset=0", env);
  assert.equal(manufacturers.mode, "list-all");
  assert.equal(manufacturers.total, 2, "two distinct manufacturers");
  assert.equal(manufacturers.results.length, 2);
  assert.ok(
    manufacturers.results.every((row) => row.fact_type === "Manufacturer"),
    "type filter must scope the listing",
  );

  const standards = await search("list-all=1&type=Standard&limit=200&offset=0", env);
  assert.equal(standards.total, 2, "two distinct standards despite three rows");
  assert.equal(standards.results.length, 2);
});

test("R1 list-all=1 respects limit and offset bounds with hasMore transitions", async () => {
  const { env } = fixture();

  const pageOne = await search("list-all=1&limit=3&offset=0", env);
  assert.equal(pageOne.total, 6);
  assert.equal(pageOne.results.length, 3);
  assert.equal(pageOne.hasMore, true, "more entities exist beyond the first page");

  const pageThree = await search("list-all=1&limit=3&offset=6", env);
  assert.equal(pageThree.results.length, 0, "offset 6 is past the last entity");
  assert.equal(pageThree.hasMore, false);
});

test("R1 typed search (q >= 2) still works and now reports a truthful total", async () => {
  const { env } = fixture();

  const body = await search("q=gen&type=Manufacturer", env);
  assert.equal(body.mode, "search");
  assert.equal(body.total, 1, "one manufacturer row matches 'gen'");
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].normalized_value, "gent");

  const broad = await search("q=pn&limit=200&offset=0", env);
  assert.equal(broad.mode, "search");
  assert.equal(broad.total, 2, "two Part Number rows match 'pn'");
  assert.equal(broad.results.length, 2);
});

test("R1 a too-short query without list-all returns a neutral empty state, never a data claim", async () => {
  const { env } = fixture();

  const body = await search("q=%20%20", env);
  assert.equal(body.mode, "empty");
  assert.equal(body.total, 0);
  assert.deepEqual(body.results, []);
  assert.equal(body.hasMore, false);
});

test("R1 original whitespace-query UI pattern is now a bounded truth (list-all=1), not an empty claim", async () => {
  // Regression guard for the UI change: the front end no longer sends q="  ";
  // it sends list-all=1. The old whitespace query must no longer be needed.
  const { raw, env } = fixture();
  const listed = await search("list-all=1&type=Manufacturer&limit=200&offset=0", env);
  assert.equal(listed.mode, "list-all");
  assert.ok(listed.results.length > 0, "manufacturer default view must not be false-empty");
  assert.equal(listed.total, 2);
  assert.equal(totals(raw).facts, 8, "listing must remain read-only");
});