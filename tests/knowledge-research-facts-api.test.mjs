import test from "node:test";
import assert from "node:assert/strict";

import { handleKnowledgeLibraryApi } from "../worker/knowledge-library-api.mjs";

// Focused contract tests for POST /api/knowledge/research-facts: governed
// authoring of web-researched facts. Research expands evidence, never
// authority: accepted facts land as Learned/Needs Review and still require
// the existing review + promotion path. Uses a minimal in-memory fake DB
// (no drizzle fixture) implementing exactly the statements the route issues.

const makeDb = () => {
  const store = { files: new Map(), facts: new Map(), events: [] };
  const runStatement = (sql, args) => {
    if (sql.startsWith("SELECT name FROM sqlite_master")) return { results: [{ name: "knowledge_files" }, { name: "knowledge_facts" }, { name: "knowledge_product_links" }, { name: "knowledge_file_events" }] };
    if (sql.includes("FROM organization_memberships")) return { results: [{ id: "org1", name: "Org" }] };
    if (sql.includes("FROM knowledge_files WHERE organization_id=? AND sha256=?")) {
      const found = [...store.files.values()].find((row) => row.organization_id === args[0] && row.sha256 === args[1]);
      return found || null;
    }
    if (sql.includes("FROM knowledge_files WHERE id=?")) return store.files.get(args[0]) || null;
    if (sql.includes("INTO knowledge_files")) {
      const [id, organization_id, file_name, extension, mime_type, byte_size, sha256, object_key, detected_type, secondary_types, classification_confidence, classification_status, processing_status, extraction_method, extraction_version, summary, uploaded_by] = args;
      if ([...store.files.values()].some((row) => row.organization_id === organization_id && row.sha256 === sha256)) return { meta: { changes: 0 } };
      store.files.set(id, { id, organization_id, file_name, extension, mime_type, byte_size, sha256, object_key, detected_type, secondary_types, classification_confidence, classification_status, processing_status, extraction_method, extraction_version, summary, uploaded_by });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO knowledge_facts")) {
      const [id] = args;
      if (store.facts.has(id)) return { meta: { changes: 0 } };
      store.facts.set(id, { id, organization_id: args[1], knowledge_file_id: args[2], fact_type: args[3] });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO knowledge_file_events")) {
      store.events.push({ id: args[0], event_type: args[4] });
      return { meta: { changes: 1 } };
    }
    throw new Error(`unexpected statement: ${sql.slice(0, 80)}`);
  };
  const db = {
    store,
    prepare: (sql) => {
      const stmt = {
        bind: (...args) => ({
          first: async () => runStatement(sql, args),
          all: async () => runStatement(sql, args),
          run: async () => runStatement(sql, args),
        }),
      };
      stmt._sql = sql;
      return stmt;
    },
    batch: async (statements) => {
      const out = [];
      for (const stmt of statements) out.push(await stmt.run());
      return out;
    },
  };
  // executeChunks passes prepared statements; make run() work on them.
  const origPrepare = db.prepare;
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    const origBind = stmt.bind;
    stmt.bind = (...args) => {
      const bound = origBind(...args);
      bound._run = () => runStatement(sql, args);
      const origRun = bound.run;
      bound.run = async () => runStatement(sql, args);
      void origRun;
      return bound;
    };
    return stmt;
  };
  return db;
};

const envFor = (db) => ({
  DB: db,
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "tester",
  APP_ORGANIZATION_ID: "org1",
});

const postFacts = (env, body) => handleKnowledgeLibraryApi(
  new Request("http://127.0.0.1/api/knowledge/research-facts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  env,
);

const source = {
  url: "https://buildings.honeywell.com/ae/en/products/relay-module",
  title: "Farenhyt Addressable Dual Relay Module",
  publisher: "Honeywell",
  retrievedAt: "2026-10-03",
};

const factPayload = (overrides = {}) => ({
  factType: "Address Model",
  originalValue: "two relay outputs and two Class B monitor inputs, separately addressed",
  normalizedValue: "STANDALONE_ADDRESS",
  observationKey: "IDP-RELAYMON-2:datasheet-addressing",
  partNumber: "IDP-RELAYMON-2",
  confidence: 85,
  sourceLocation: { section: "Overview", quote: "two individual relay control modules and two Class B monitor modules", documentNumber: "hbt-fire-IDP-RELAYMON-2" },
  reason: "Address demand semantics for the combined monitor/relay BOQ rows.",
  ...overrides,
});

test("authors researched facts as observations under a Web Source file, never as canonical truth", async () => {
  const env = envFor(makeDb());
  const response = await postFacts(env, { source, facts: [factPayload(), factPayload({ observationKey: "IDP-RELAY:output-contacts", originalValue: "two isolated Form-C contact sets", normalizedValue: "STANDALONE_ADDRESS", partNumber: "IDP-RELAY", sourceLocation: { section: "Overview", quote: "two isolated sets of Form C contacts", documentNumber: "IDP-RELAY-Datasheet" } })] });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.accepted.length, 2);
  assert.equal(body.rejected.length, 0);
  assert.ok(body.accepted.every((entry) => entry.reviewStatus === "Learned"));
  assert.equal(env.DB.store.files.size, 1);
  const file = [...env.DB.store.files.values()][0];
  assert.equal(file.detected_type, "Web Source");
  assert.equal(file.object_key, source.url);
});

test("replay is idempotent and a second source stays a distinct record", async () => {
  const env = envFor(makeDb());
  const first = await (await postFacts(env, { source, facts: [factPayload()] })).json();
  const replay = await (await postFacts(env, { source, facts: [factPayload()] })).json();
  assert.equal(first.accepted[0].id, replay.accepted[0].id);
  assert.equal(env.DB.store.facts.size, 1);
  const other = await (await postFacts(env, { source: { ...source, url: `${source.url}-2` }, facts: [factPayload()] })).json();
  assert.notEqual(other.accepted[0].id, first.accepted[0].id);
  assert.equal(env.DB.store.files.size, 2);
});

test("refuses unprovenanced payloads without writing anything", async () => {
  const env = envFor(makeDb());
  const badUrl = await postFacts(env, { source: { ...source, url: "not-a-url" }, facts: [factPayload()] });
  assert.equal(badUrl.status, 422);
  const badFact = await postFacts(env, { source, facts: [{ ...factPayload(), sourceLocation: { section: "Overview" } }] });
  assert.equal(badFact.status, 422);
  const empty = await badFact.json();
  assert.ok(empty.error);
  assert.equal(env.DB.store.files.size, 0);
  assert.equal(env.DB.store.facts.size, 0);
});
