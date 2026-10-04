/**
 * KN-SOURCES-REGISTER — backend read-model contract.
 *
 * The defect this suite exists to pin: `GET /api/knowledge/files` served
 * per-source metrics from `knowledge_files.summary`, which is written ONCE on
 * insert and never recomputed (the only UPDATE knowledge_files in the
 * repository sets classification_status). Every metric on the Sources page was
 * therefore an upload-time snapshot that could not fall as review debt was
 * resolved, and two of the labels overstated what was counted.
 *
 * These tests assert the repaired contract:
 *   1. per-source aggregates are LIVE, not snapshot;
 *   2. `attention` uses EXACTLY the Review queue's predicate, so a count shown
 *      on Sources and the queue it links to can never disagree;
 *   3. `permittedUse` is derived from governed promotion data, never invented;
 *   4. the frozen snapshot is still returned (it is truthful as "what the
 *      extraction run found") and is clearly separated from the live block;
 *   5. server-side filtering, sorting and pagination are supported so the UI
 *      never has to download every source to count or page them;
 *   6. the aggregates are computed in SQL, not per row in JS (no N+1).
 *
 * Fixtures are built on the ACTUAL active migration chain. :memory: only. No
 * Golden, no canonical D1, no configured migration target is touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { handleKnowledgeLibraryApi } from "../worker/knowledge-library-api.mjs";

const OWNER = "local-development-user";

const d1 = (raw, counter) => ({
  prepare(sql) {
    counter?.statements.push(sql.replace(/\s+/g, " ").trim().slice(0, 80));
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { ...result, meta: { changes: Number(result.changes || 0) } };
      },
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      raw.exec("COMMIT");
      return out;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const activeDatabase = () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of readdirSync(directory).filter((n) => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}${migration}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

const FILES = [
  "id", "organization_id", "file_name", "extension", "mime_type", "byte_size", "sha256",
  "object_key", "detected_type", "secondary_types", "classification_confidence",
  "classification_status", "processing_status", "extraction_method", "extraction_version",
  "summary", "uploaded_by", "uploaded_at", "processed_at",
].join(",");

const seed = () => {
  const raw = activeDatabase();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);
  run("INSERT INTO organizations (id, name, status) VALUES ('org1', 'Org', 'Active')");

  const file = (id, name, type, classification, summary, uploadedAt) =>
    run(
      `INSERT INTO knowledge_files (${FILES}) VALUES (?, 'org1', ?, 'xlsx', 'application/vnd.openxmlformats-officatedocument.spreadsheetml.sheet', 10, ?, ?, ?, '[]', 90, ?, 'Completed', 'Deterministic', 'knowledge-library-v1.1', ?, ?, ?, ?)`,
      id, name, `sha-${id}`, `obj/${id}`, type, classification, summary, OWNER, uploadedAt, uploadedAt,
    );

  file("kf-1", "Honeywell-2024.xlsx", "Price List", "Reviewed",
    JSON.stringify({ filesProcessed: 1, productsLearned: 99, pricesDiscovered: 99, itemsRequiringReview: 99 }),
    "2026-09-01T00:00:00.000Z");
  file("kf-2", "Notifer-Catalogue.xlsx", "Product Catalogue", "Classified",
    JSON.stringify({ filesProcessed: 1, productsLearned: 0, pricesDiscovered: 0, itemsRequiringReview: 0 }),
    "2026-09-02T00:00:00.000Z");
  file("kf-3", "Pending-BOQ.xlsx", "BOQ", "Needs Review",
    JSON.stringify({ filesProcessed: 1, productsLearned: 4, pricesDiscovered: 0, itemsRequiringReview: 7 }),
    "2026-09-03T00:00:00.000Z");

  // knowledge_facts carries UNIQUE(knowledge_file_id, fact_type, fact_key,
  // normalized_value) in the real chain, so each row needs a distinct value.
  const fact = (id, fileId, factType, reviewStatus, confidence, value) =>
    run("INSERT INTO knowledge_facts (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value, normalized_value, confidence, review_status) VALUES (?, 'org1', ?, ?, 'k', ?, ?, ?, ?)",
      id, fileId, factType, value, value, confidence, reviewStatus);

  fact("f-1", "kf-1", "Part Number", "Reviewed", 95, "HD-100");
  fact("f-2", "kf-1", "Part Number", "Reviewed", 95, "HD-200");
  fact("f-3", "kf-1", "Price", "Rejected", 70, "SAR 12.50");
  fact("f-4", "kf-2", "Part Number", "Learned", 92, "NP-300");
  fact("f-5", "kf-2", "Price", "Needs Review", 55, "SAR 99.00");
  fact("f-6", "kf-2", "Manufacturer", "Learned", 88, "Notifier");
  fact("f-7", "kf-3", "BOQ Item", "Needs Review", 50, "Smoke Detector");
  fact("f-8", "kf-3", "BOQ Item", "Needs Review", 50, "Heat Detector");
  fact("f-9", "kf-3", "Standard", "Learned", 91, "NFPA 72");
  return raw;
};

const env = (raw, counter) => ({
  DB: d1(raw, counter),
  FILES: { put: async () => ({}), get: async () => null, delete: async () => undefined },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
});

const get = (raw, query = "", counter) =>
  handleKnowledgeLibraryApi(
    new Request(`https://app.example/api/knowledge/files${query}`),
    env(raw, counter),
    { waitUntil: () => undefined },
  );

const list = async (raw, query = "") => (await (await get(raw, query)).json()).files;
const byId = async (raw, id, query = "") => (await list(raw, query)).find((f) => f.id === id);

test("per-source aggregates are LIVE: resolving every review debt moves the count, unlike the frozen snapshot", async () => {
  const raw = seed();
  const before = await byId(raw, "kf-2");
  // The upload-time snapshot claimed 0 items requiring review. The governed
  // truth is one Price fact sitting at 'Needs Review'.
  assert.equal(before.register.attention.factReview, 1, "live count reflects the real queue");
  assert.equal(before.register.attention.total, 1);
  assert.equal(before.summary.itemsRequiringReview, 0, "the frozen snapshot is returned unchanged and separately");

  // Resolve the debt the way the review route does.
  raw.prepare("UPDATE knowledge_facts SET review_status='Reviewed' WHERE id='f-5'").run();
  const after = await byId(raw, "kf-2");
  assert.equal(after.register.attention.factReview, 0, "the count follows the governed state, not the snapshot");
  assert.equal(after.summary.itemsRequiringReview, 0, "the snapshot is still frozen -- which is exactly why it is not the register's metric");
  raw.close();
});

test("attention mirrors the Review queue's own predicate exactly, so the two can never disagree", async () => {
  const raw = seed();
  const queue = await (
    await handleKnowledgeLibraryApi(new Request("https://app.example/api/knowledge/review-queue"), env(raw), { waitUntil: () => undefined })
  ).json();
  const queueFileIds = new Set(queue.items.filter((i) => i.item_kind === "File").map((i) => i.id));
  const queueFactDebt = queue.items.filter((i) => i.item_kind === "Fact").length;

  const files = await list(raw);
  const registerFileDebt = files.filter((f) => f.register.attention.fileReview > 0).length;
  const registerFactDebt = files.reduce((sum, f) => sum + f.register.attention.factReview, 0);

  assert.equal(registerFileDebt, queueFileIds.size, "file debt matches the queue's file branch");
  assert.equal(registerFactDebt, queueFactDebt, "fact debt matches the queue's fact branch");
  raw.close();
});

test("rejected facts are excluded from learned counts for review purposes but the register never claims otherwise", async () => {
  const raw = seed();
  const source = await byId(raw, "kf-1");
  // 3 Part/Price facts exist; one Price fact is Rejected.
  assert.equal(source.register.learned.facts, 3, "learned.facts is the honest total of extracted facts");
  assert.equal(source.register.learned.prices, 1, "prices are counted as price OBSERVATIONS, not distinct prices");
  assert.equal(source.register.attention.factReview, 0, "a Rejected fact is settled, not debt");
  raw.close();
});

test("permittedUse is derived from governed promotion, and defaults honestly to Discovery Only", async () => {
  const raw = seed();
  assert.equal((await byId(raw, "kf-1")).register.permittedUse, "Discovery Only");
  assert.equal((await byId(raw, "kf-2")).register.permittedUse, "Discovery Only");

  // Supporting rows the promotion table's foreign keys require, inserted
  // before the promotion itself.
  raw.prepare("INSERT OR IGNORE INTO product_manufacturers (id, name, normalized_name, created_by) VALUES ('m-1', 'Honeywell', 'honeywell', ?)").run(OWNER);
  raw.prepare("INSERT OR IGNORE INTO library_products (id, manufacturer_id, part_number, normalized_part_number, description, identity_status, identity_version, created_by) VALUES ('lp-1','m-1','HD-100','hd 100','Honeywell detector','Active',1,?)").run(OWNER);
  raw
    .prepare("INSERT OR IGNORE INTO product_sources (id, organization_id, source_type, authority, scope_type, file_name, checksum, validity_state, created_by) VALUES ('ps-1','org1','Price List','Manufacturer Document','Organization','Honeywell-2024.xlsx','sha-kf-1','Active',?)")
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO knowledge_promotions (id, organization_id, knowledge_fact_id, knowledge_file_id, canonical_product_id, canonical_entity_type, canonical_entity_id, product_source_id, action, policy_version, source_checksum, previous_snapshot_json, new_snapshot_json, reason, decided_by, decided_role, idempotency_key) VALUES ('kp-1','org1','f-1','kf-1','lp-1','Product','lp-1','ps-1','Promoted','v1','sum','{}','{}','Reviewed and promoted.',?,'Library Reviewer','idem-1')",
    )
    .run(OWNER);

  assert.equal((await byId(raw, "kf-1")).register.permittedUse, "Reusable Knowledge", "a source that actually promoted a fact is reusable");
  assert.equal((await byId(raw, "kf-1")).register.learned.promoted, 1);
  raw.close();
});

test("the frozen summary is preserved and never presented as the live metric", async () => {
  const raw = seed();
  const source = await byId(raw, "kf-1");
  assert.equal(source.summary.productsLearned, 99, "the upload-time extraction snapshot is still available");
  assert.equal(source.register.learned.partNumbers, 2, "the live count is the real number");
  assert.notEqual(source.summary.productsLearned, source.register.learned.partNumbers, "the two must not be conflated");
  raw.close();
});

test("server-side view filtering keeps attention and permitted-use views off the client", async () => {
  const raw = seed();
  const all = await list(raw);
  assert.equal(all.length, 3, "no view");
  const attention = await list(raw, "?view=attention");
  assert.deepEqual(attention.map((f) => f.id).sort(), ["kf-2", "kf-3"], "only sources with live debt");
  assert.ok(attention.every((f) => f.register.attention.total > 0));
  const discovery = await list(raw, "?view=discovery");
  assert.equal(discovery.length, 3, "nothing is promoted, so everything is honestly Discovery Only");
  raw.close();
});

test("sorting is server-side and supports name, attention and learned", async () => {
  const raw = seed();
  const byName = await list(raw, "?sort=name");
  assert.deepEqual(byName.map((f) => f.file_name), ["Honeywell-2024.xlsx", "Notifer-Catalogue.xlsx", "Pending-BOQ.xlsx"]);
  const byAttention = await list(raw, "?sort=attention");
  assert.equal(byAttention[0].id, "kf-3", "kf-3 has 2 fact debts + 1 file debt = 3, the highest");
  raw.close();
});

test("pagination reports a real total rather than a page length", async () => {
  const raw = seed();
  const page = await (await get(raw, "?limit=2&offset=0")).json();
  assert.equal(page.files.length, 2);
  assert.equal(page.total, 3, "the real population, not min(actual, limit)");
  assert.equal(page.matched, 3);
  assert.equal(page.hasMore, true);
  const second = await (await get(raw, "?limit=2&offset=2")).json();
  assert.equal(second.files.length, 1);
  assert.equal(second.hasMore, false);
  raw.close();
});

test("search and type filter still work server-side", async () => {
  const raw = seed();
  assert.deepEqual((await list(raw, "?q=Honeywell")).map((f) => f.id), ["kf-1"]);
  assert.deepEqual((await list(raw, "?section=BOQ")).map((f) => f.id), ["kf-3"]);
  raw.close();
});

test("the aggregates are computed in SQL, not one query per source (no N+1)", async () => {
  const raw = seed();
  const counter = { statements: [] };
  await get(raw, "", counter);
  // One statement per logical aggregate, independent of how many sources
  // exist. A per-row implementation would scale with the register size.
  const aggregateStatements = counter.statements.filter((s) => s.includes("knowledge_facts") || s.includes("knowledge_promotions"));
  assert.ok(aggregateStatements.length <= 2, `expected at most 2 aggregate statements, saw ${aggregateStatements.length}`);
  assert.ok(
    aggregateStatements.every((s) => s.includes("GROUP BY knowledge_file_id")),
    "aggregates are grouped in SQL, never looped per row in JS",
  );
  raw.close();
});

test("the read is pure: listing sources writes nothing", async () => {
  const raw = seed();
  const before = raw.prepare("SELECT COUNT(*) c FROM knowledge_facts").get().c;
  await get(raw, "?view=attention&sort=attention");
  await get(raw, "?limit=1");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_facts").get().c, before, "GET /files performs no writes");
  raw.close();
});
