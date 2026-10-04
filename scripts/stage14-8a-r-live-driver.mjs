// STEP 14.8 -- LIVE PHASE DRIVER (read/write against the real miniflare D1).
// Drives the actual worker handler against the live sqlite file so the live
// dry-run / apply / promote / readiness / idempotency evidence is authoritative.
import { DatabaseSync } from "node:sqlite";
import { handleDrawingArchitectureReviewApi } from "../worker/drawing-architecture-review-api.mjs";

export const LIVE_DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
export const LIVE_PROJECT = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";

// D1-compatible adapter over the live sqlite (mirrors the fixture makeArchDb).
export const openLiveDb = (path = LIVE_DB, { readOnly = false, track = false } = {}) => {
  const raw = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  const trackedWrites = [];
  const operation = (sql, args = []) => {
    const statement = raw.prepare(sql);
    return {
      first: async () => {
        const row = statement.get(...args);
        return row === undefined ? null : row;
      },
      all: async () => ({ results: statement.all(...args) }),
      run: async () => {
        if (track && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
          const table = (sql.match(/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i) || [])[1];
          if (table && !trackedWrites.includes(table)) trackedWrites.push(table);
        }
        return { meta: statement.run(...args) };
      },
    };
  };
  const db = {
    prepare: (sql) => ({ bind: (...args) => operation(sql, args) }),
    batch: async (statements) => {
      raw.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    trackedWrites,
  };
  return { raw, db };
};

export const liveRequest = (path, projectId = LIVE_PROJECT, { method = "POST", body } = {}) => {
  const fullPath = path.includes(":projectId") ? path.replace(":projectId", projectId) : path;
  const request = new Request(`http://127.0.0.1:4183${fullPath}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return async (env) => {
    const response = await handleDrawingArchitectureReviewApi(request, env);
    if (!response) return { status: 404, body: { error: { code: "NOT_HANDLED" } } };
    return { status: response.status, body: await response.json() };
  };
};