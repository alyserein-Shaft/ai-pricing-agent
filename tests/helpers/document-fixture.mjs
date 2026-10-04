// Integration fixture for the document API that runs against the *real* governed
// schema.
//
// The hand-rolled fixtures in `document-duplicate-revision.integration.test.mjs`
// and `document-management-actions.integration.test.mjs` carry their own copies of
// the document DDL. That is how the R3 runtime defects survived: the copies had no
// foreign keys, no triggers and no uniqueness, so a missing family row, a
// non-atomic supersession and a copied effective window all still "passed". This
// fixture applies the actual `drizzle-active` chain instead, so an integration
// failure means the shipped schema disagrees with the handler.
import { DatabaseSync } from "node:sqlite";

import { handleDocumentApi } from "../../worker/document-api.mjs";
import { applyActiveChain, openEmptyDatabase } from "./active-chain.mjs";

// Fill every NOT NULL column that has no default, so a future migration adding a
// required column does not turn this into a column-name test. Callers override the
// columns they care about; everything else gets a typed placeholder.
export const insertRow = (db, table, overrides = {}) => {
  const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
  const names = [];
  const values = [];
  for (const column of columns) {
    if (Object.hasOwn(overrides, column.name)) {
      names.push(column.name);
      values.push(overrides[column.name]);
      continue;
    }
    if (!column.notnull || column.dflt_value !== null) continue;
    names.push(column.name);
    if (column.pk) values.push(`${table}_seed`);
    else if (/INT/i.test(column.type)) values.push(1);
    else values.push(`${column.name}_seed`);
  }
  if (names.length === 0) return false;
  db.prepare(
    `INSERT INTO ${JSON.stringify(table)} (${names.map((name) => JSON.stringify(name)).join(", ")}) `
    + `VALUES (${names.map(() => "?").join(", ")})`,
  ).run(...values);
  return true;
};

// Minimal D1-shaped adapter over node:sqlite. `batch` is a real transaction, so a
// partially-applied batch throws exactly as D1 would, and foreign keys are on.
const wrapDatabase = (raw) => {
  const operation = (sql, args) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });
  return {
    prepare(sql) {
      const bound = operation(sql, []);
      return { ...bound, bind: (...args) => operation(sql, args) };
    },
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        try { raw.exec("ROLLBACK"); } catch { /* already unwound */ }
        throw error;
      }
    },
  };
};

export const createDocumentFixture = ({ ownerUserId = "user-a", organizationId = "org-a", projectId = "p1" } = {}) => {
  const opened = openEmptyDatabase();
  applyActiveChain(opened.db);
  const { db: raw } = opened;

  insertRow(raw, "organizations", { id: organizationId, name: "Org A" });
  insertRow(raw, "projects", {
    id: projectId,
    name: "Document Revision Test",
    owner_user_id: ownerUserId,
    organization_id: organizationId,
  });

  const objects = new Map();
  const FILES = {
    async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        body: bytes,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
    async delete(key) { objects.delete(key); },
  };

  const env = {
    DB: wrapDatabase(raw),
    FILES,
    APP_ACCESS_MODE: "single-user",
    APP_USER_ID: ownerUserId,
    APP_ORGANIZATION_ID: organizationId,
  };

  return {
    raw,
    env,
    objects,
    projectId,
    ownerUserId,
    close: () => opened.close(),
  };
};

// Post a document upload through the real handler. Detached classification work is
// captured rather than awaited: classification is a separate governed concern and
// must not make an upload test fail or pass.
export const postUpload = async (env, projectId, fields = {}, { fileName = "Tender-BOQ.csv", contents = "item,description,qty\n1,Detector,10\n", type = "text/csv" } = {}) => {
  const form = new FormData();
  form.set("file", new File([contents], fileName, { type }));
  form.set("projectName", "Document Revision Test");
  form.set("documentType", fields.documentType ?? "Auto Detection");
  form.set("reason", fields.reason ?? "Document revision integration test");
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "documentType" || key === "reason") continue;
    form.set(key, String(value));
  }

  const detached = [];
  const response = await handleDocumentApi(
    new Request(`https://app.example/api/projects/${projectId}/documents`, { method: "POST", body: form }),
    env,
    {
      waitUntil(promise) { detached.push(Promise.resolve(promise).catch((error) => error)); },
    },
  );
  const body = await response.json().catch(() => ({}));
  // D1 runs detached work to completion before the next statement batch reaches
  // the database. Awaiting here reproduces that ordering; without it, a still
  // running classification batch overlaps the next governed write and the test
  // fails on a transaction collision that production cannot hit. Classification
  // errors are recorded rather than thrown, because classification is a separate
  // concern and must not decide an upload test's outcome.
  const detachedResults = await Promise.all(detached);
  return { response, body, detached: detachedResults };
};

export const postJson = async (env, path, body, method = "POST") => {
  const init = { method };
  if (method !== "GET" && method !== "HEAD") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  // Mirror D1's `waitUntil` ordering: detached work runs to completion before the
  // next governed write reaches the database. Restore schedules classification the
  // same way upload does, so this is what makes its effects observable.
  const detached = [];
  const response = await handleDocumentApi(
    new Request(`https://app.example${path}`, init),
    env,
    { waitUntil(promise) { detached.push(Promise.resolve(promise).catch((error) => error)); } },
  );
  const parsed = await response.json().catch(() => ({}));
  await Promise.all(detached);
  return { response, body: parsed };
};

export { DatabaseSync, handleDocumentApi };
