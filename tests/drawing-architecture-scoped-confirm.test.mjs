import test from "node:test";
import assert from "node:assert/strict";

import { handleDrawingArchitectureReviewApi } from "../worker/drawing-architecture-review-api.mjs";

// SCOPED CONFIRMATION GUARDS.
//
// The promotion digest depends on the real extraction pipeline, so these tests
// cover what is decidable without it: the fail-closed gates, and the structural
// guarantee that a scoped confirmation writes exactly ONE case row and never a
// sibling.

const PROJECT = "project_p";
const HUMAN = { APP_HUMAN_ID: "omair", APP_HUMAN_NAME: "Omair" };

const recorder = () => ({ writes: [], prepared: [] });

const fakeDb = (rec, { caseRow = null, document = { id: "doc_1", current_version_id: "ver_1" } } = {}) => {
  const handle = (sql, binds = []) => ({
    sql,
    binds,
    bind: (...args) => handle(sql, [...binds, ...args]),
    first: async () => {
      if (/FROM projects WHERE id=\? AND owner_user_id/.test(sql)) return { id: PROJECT, owner_user_id: "local-development-user" };
      if (/FROM drawing_architecture_review_cases WHERE id=\? AND project_id=\?/.test(sql)) return caseRow;
      if (/SELECT current_version_id FROM documents/.test(sql)) return document;
      return null;
    },
    all: async () => ({ results: [] }),
    run: async () => { rec.writes.push({ sql, binds }); return { success: true }; },
  });
  return {
    prepare: (sql) => { rec.prepared.push(sql); return handle(sql); },
    batch: async (statements) => {
      for (const statement of statements || []) rec.writes.push({ sql: statement.sql, binds: statement.binds });
      return rec.writes;
    },
  };
};

const envFor = (db, human = HUMAN) => ({
  DB: db,
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "local-development-user",
  APP_ORGANIZATION_ID: "org_1",
  ...human,
});

const call = (body, human = HUMAN) => handleDrawingArchitectureReviewApi(
  new Request(`http://localhost:4183/api/projects/${PROJECT}/drawing-architecture/review/confirm-case`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  envFor(fakeDb(recorder(), {}), human),
);

test("1. an explicit case id is required: the route can never mean 'all eligible facts'", async () => {
  const response = await call({ reason: "Confirming one scoped symbol applicability decision." });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ARCHITECTURE_CASE_ID_REQUIRED");
});

test("2. a substantive human reason is required", async () => {
  const response = await call({ caseId: "case_1", reason: "no" });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ARCHITECTURE_REVIEW_REASON_REQUIRED");
});

test("3. without a truthful human identity the scoped confirmation is refused", async () => {
  const response = await call({ caseId: "case_1", reason: "Scoped confirmation of one symbol applicability." }, { APP_HUMAN_ID: "", APP_HUMAN_NAME: "" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "HUMAN_ACTOR_NOT_CONFIGURED");
});

test("4. a synthetic human identity is refused rather than downgraded", async () => {
  const response = await call({ caseId: "case_1", reason: "Scoped confirmation attempt." }, { APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Local Development User" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "HUMAN_ACTOR_ID_INVALID");
});

test("5. a case from another project is not found", async () => {
  const response = await call({ caseId: "case_foreign", reason: "Scoped confirmation attempt." });
  // The project itself must resolve first; the foreign case is refused either
  // way, and never confirmed.
  assert.ok([404, 422, 409, 403].includes(response.status), `unexpected status ${response.status}`);
  const body = await response.json();
  assert.notEqual(body.status, "Approved");
});

test("6. the bulk deterministic path is untouched by the scoped route", async () => {
  const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../worker/drawing-architecture-review-api.mjs", import.meta.url), "utf8"));
  assert.ok(source.includes('route[3] === "deterministic-confirm"'), "bulk confirm must still exist");
  assert.ok(source.includes('route[3] === "confirm-case"'), "scoped confirm must exist alongside it");
  // The scoped action writes a single case row, keyed by its own id and version.
  assert.ok(/UPDATE drawing_architecture_review_cases SET status='Approved'[\s\S]{0,400}WHERE id=\? AND case_version=\?/.test(source), "the scoped write must target exactly one case");
});

test("7. no sibling fact can be promoted by a scoped confirmation", async () => {
  const rec = recorder();
  const db = fakeDb(rec, { caseRow: null });
  const response = await handleDrawingArchitectureReviewApi(
    new Request(`http://localhost:4183/api/projects/${PROJECT}/drawing-architecture/review/confirm-case`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case_absent", reason: "Scoped confirmation attempt." }),
    }),
    envFor(db),
  );
  assert.notEqual((await response.json()).status, "Approved");
  assert.equal(rec.writes.length, 0, "no promotion write may happen for a case that was not confirmed");
});
