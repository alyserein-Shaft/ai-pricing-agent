import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  eligibleBaselineSet, baselineStatus, baselineSetFingerprint,
} from "../app/domain/drawing-baseline.mjs";
import { handleDrawingBaselineApi } from "../worker/drawing-baseline-api.mjs";

const doc = (over = {}) => ({
  id: "doc1", project_id: "p1", logical_name: "a.pdf", current_version_id: "dv1", ...over,
});
const intake = (over = {}) => ({
  id: "iv1", project_id: "p1", status: "Completed", document_version_id: "dv1", ...over,
});

test("1. drawing with no intake is NOT reported as indexed/eligible", () => {
  const r = eligibleBaselineSet({ documents: [doc()], intakesByDocument: {}, heads: { doc1: "dv1" } });
  assert.equal(r.members.length, 0);
  assert.deepEqual(r.problems, [{ documentId: "doc1", reason: "NO_CURRENT_INTAKE" }, { documentId: null, reason: "ZERO_ELIGIBLE_DRAWINGS" }]);
});

test("2. canonical intake creates eligibility with exact identity", () => {
  const r = eligibleBaselineSet({ documents: [doc()], intakesByDocument: { doc1: intake() }, heads: { doc1: "dv1" } });
  assert.equal(r.members.length, 1);
  assert.deepEqual(r.members[0], { documentId: "doc1", documentVersionId: "dv1", intakeVersionId: "iv1", logicalName: "a.pdf" });
  assert.equal(r.problems.length, 0);
});

test("3. foreign-project intake refused; stale intake refused", () => {
  const foreign = eligibleBaselineSet({ documents: [doc()], intakesByDocument: { doc1: intake({ project_id: "p2" }) }, heads: { doc1: "dv1" } });
  assert.equal(foreign.members.length, 0);
  assert.equal(foreign.problems[0].reason, "FOREIGN_PROJECT_INTAKE");
  const stale = eligibleBaselineSet({ documents: [doc()], intakesByDocument: { doc1: intake({ document_version_id: "dv0" }) }, heads: { doc1: "dv1" } });
  assert.equal(stale.problems[0].reason, "STALE_INTAKE_VERSION");
});

test("4. baseline cannot confirm while any intake missing/failed; zero drawings fail closed", () => {
  const r = eligibleBaselineSet({
    documents: [doc(), doc({ id: "doc2" })],
    intakesByDocument: { doc1: intake(), doc2: intake({ id: "iv2", status: "Failed" }) },
    heads: { doc1: "dv1", doc2: "dv1" },
  });
  assert.equal(r.members.length, 1);
  assert.equal(r.problems.length, 1);
  const empty = eligibleBaselineSet({ documents: [], intakesByDocument: {}, heads: {} });
  assert.ok(empty.problems.some((p) => p.reason === "ZERO_ELIGIBLE_DRAWINGS"));
});

test("5. fingerprint is order-independent and sensitive to identity", () => {
  const a = baselineSetFingerprint([
    { documentId: "d1", documentVersionId: "v1", intakeVersionId: "i1" },
    { documentId: "d2", documentVersionId: "v1", intakeVersionId: "i2" },
  ]);
  const b = baselineSetFingerprint([
    { documentId: "d2", documentVersionId: "v1", intakeVersionId: "i2" },
    { documentId: "d1", documentVersionId: "v1", intakeVersionId: "i1" },
  ]);
  assert.equal(a, b);
  const c = baselineSetFingerprint([{ documentId: "d1", documentVersionId: "v2", intakeVersionId: "i1" }]);
  assert.notEqual(a, c);
});

const memDb = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, logical_name TEXT, document_type TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT);
    CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE project_members(project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
    CREATE TABLE drawing_baseline_confirmations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, generation INTEGER NOT NULL, member_count INTEGER NOT NULL, members_json TEXT NOT NULL, set_fingerprint TEXT NOT NULL, confirmed_by TEXT NOT NULL, confirmed_by_name TEXT, confirmed_at TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX drawing_baseline_generation_idx ON drawing_baseline_confirmations(project_id, generation);
    INSERT INTO projects VALUES ('p1','u1','org1');
    INSERT INTO documents VALUES ('doc1','p1','a.pdf','Drawing','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1');
    INSERT INTO drawing_intake_versions VALUES ('iv1','p1','doc1','dv1',1,'Completed',NULL);
  `);
  const d1 = (rawDb) => ({
    prepare(sql) {
      const op = (args = []) => ({
        first: async () => rawDb.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: rawDb.prepare(sql).all(...args) }),
        run: async () => { const r = rawDb.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
      });
      return { ...op(), bind: (...args) => op(args) };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  });
  return d1(raw);
};

const apiEnv = (db, human = { id: "omair", name: "Omair" }) => ({
  DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "u1", APP_ORGANIZATION_ID: "org1",
  APP_HUMAN_ID: human.id, APP_HUMAN_NAME: human.name,
});
const get = (path) => new Request(`https://app.example${path}`);
const post = (path) => new Request(`https://app.example${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

test("6. confirm persists exact identity with named actor; repeat is idempotent", async () => {
  const env = apiEnv(memDb());
  const first = await handleDrawingBaselineApi(post("/api/projects/p1/drawing-baseline/confirm"), env);
  assert.equal(first.status, 201);
  const f = await first.json();
  assert.equal(f.state, "CONFIRMED");
  assert.equal(f.baseline.confirmed_by, "omair");
  assert.equal(f.baseline.confirmed_by_name, "Omair");
  assert.equal(f.baseline.member_count, 1);
  assert.deepEqual(JSON.parse(f.baseline.members_json), [{ documentId: "doc1", documentVersionId: "dv1", intakeVersionId: "iv1", logicalName: "a.pdf" }]);
  const second = await handleDrawingBaselineApi(post("/api/projects/p1/drawing-baseline/confirm"), env);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
});

test("7. refresh reads confirmed state; changed set requires new baseline", async () => {
  const db = memDb();
  const env = apiEnv(db);
  let r = await handleDrawingBaselineApi(get("/api/projects/p1/drawing-baseline"), env);
  assert.equal((await r.json()).state, "UNCONFIRMED");
  await handleDrawingBaselineApi(post("/api/projects/p1/drawing-baseline/confirm"), env);
  r = await handleDrawingBaselineApi(get("/api/projects/p1/drawing-baseline"), env);
  assert.equal((await r.json()).state, "CONFIRMED");
  await db.prepare("INSERT INTO documents VALUES ('doc2','p1','b.pdf','Drawing','dv2',NULL,NULL)").run();
  await db.prepare("INSERT INTO document_versions VALUES ('dv2','doc2')").run();
  await db.prepare("INSERT INTO drawing_intake_versions VALUES ('iv2','p1','doc2','dv2',1,'Completed',NULL)").run();
  r = await handleDrawingBaselineApi(get("/api/projects/p1/drawing-baseline"), env);
  const j = await r.json();
  assert.equal(j.state, "UPDATE_REQUIRED");
  assert.equal(j.eligibleCount, 2);
});

test("8. baselineStatus unit transitions", () => {
  assert.equal(baselineStatus({ confirmed: null }).state, "UNCONFIRMED");
  assert.equal(baselineStatus({ confirmed: { set_fingerprint: "a" }, currentFingerprint: "b" }).state, "UPDATE_REQUIRED");
  assert.equal(baselineStatus({ confirmed: { set_fingerprint: "a" }, currentFingerprint: "a" }).state, "CONFIRMED");
});

test("9. synthetic development identity cannot become governed decision actor", async () => {
  const env = apiEnv(memDb(), { id: "local-development-user", name: "Local Development User" });
  const r = await handleDrawingBaselineApi(post("/api/projects/p1/drawing-baseline/confirm"), env);
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.ok(j.error.code);
});

test("10. same-set reconfirmation by a different human supersedes history, never rewrites it", async () => {
  const db = memDb();
  const first = await handleDrawingBaselineApi(
    post("/api/projects/p1/drawing-baseline/confirm"), apiEnv(db, { id: "omair", name: "Omair" }));
  assert.equal((await first.json()).generation, 1);
  const second = await handleDrawingBaselineApi(
    post("/api/projects/p1/drawing-baseline/confirm"), apiEnv(db, { id: "omair", name: "Omair" }));
  assert.equal((await second.json()).idempotent, true);
  // A different human actor reconfirming the identical set creates generation 2;
  // generation 1 remains as audit history.
  const third = await handleDrawingBaselineApi(
    post("/api/projects/p1/drawing-baseline/confirm"), apiEnv(db, { id: "omair-2", name: "Omair Two" }));
  const t = await third.json();
  assert.equal(t.idempotent, false);
  assert.equal(t.generation, 2);
  assert.equal(t.baseline.confirmed_by, "omair-2");
  const rows = await db.prepare("SELECT generation, confirmed_by, superseded_at FROM drawing_baseline_confirmations WHERE project_id='p1' ORDER BY generation").all();
  assert.equal(rows.results.length, 2);
  assert.ok(rows.results[0].superseded_at);
  assert.equal(rows.results[0].confirmed_by, "omair");
});
