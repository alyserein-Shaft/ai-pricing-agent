// PROJECT_OPERATIONAL_CLASSIFICATION_CONTROL -- governed operation tests.
//
// Drives handleDashboardApi against an isolated in-memory fixture DB.
// No live data is touched. Covers: authorized change both directions,
// invalid value, empty reason, unauthorized actor, same-value idempotency,
// single-column update scope, audit evidence, unchanged filter semantics.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleDashboardApi } from "../worker/dashboard-api.mjs";
import { OPERATIONAL_CLASSIFICATIONS, isGovernedOperationalClassification } from "../app/domain/dashboard-workflow-engine.mjs";

const OWNER = "local-development-user";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, owner_user_id TEXT, organization_id TEXT, system_domain TEXT, initial_status TEXT, operational_classification TEXT, project_type TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE project_dashboard_profiles (project_id TEXT PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE project_members (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT, granted_at TEXT);
    CREATE TABLE dashboard_audit_log (id TEXT, project_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, actor_user_id TEXT, actor_role TEXT, request_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE workflow_stage_states (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), stage_id TEXT NOT NULL, model_version TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL, blocking_issue_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0, owner_role TEXT NOT NULL, next_action TEXT, drill_down_route TEXT NOT NULL, source_version TEXT NOT NULL, calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TEXT, completed_at TEXT);
    CREATE TABLE project_progress_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), model_version TEXT NOT NULL, progress INTEGER NOT NULL, derived_status TEXT NOT NULL, ready_for_quotation INTEGER NOT NULL DEFAULT 0, facts TEXT NOT NULL, source_version TEXT NOT NULL, calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE dashboard_metric_definitions (id TEXT NOT NULL, version TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, scope TEXT NOT NULL, data_source TEXT NOT NULL, formula TEXT NOT NULL, filters TEXT NOT NULL, exclusions TEXT NOT NULL, refresh_strategy TEXT NOT NULL, permission TEXT NOT NULL, drill_down_route TEXT NOT NULL, owner TEXT NOT NULL, test_cases TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(id, version));
    CREATE TABLE project_risks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), risk_type TEXT NOT NULL, severity TEXT NOT NULL, trigger TEXT NOT NULL, impact TEXT NOT NULL, affected_module TEXT NOT NULL, recommended_action TEXT NOT NULL, owner TEXT NOT NULL, due_date TEXT, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open', source_version TEXT NOT NULL, acknowledged_by TEXT, acknowledged_at TEXT, calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, risk_type, source_version));
    CREATE TABLE project_status_history (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), previous_status TEXT, next_status TEXT NOT NULL, status_type TEXT NOT NULL, reason TEXT NOT NULL, model_version TEXT NOT NULL, source_version TEXT NOT NULL, actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  const operation = (sql, args = []) => {
    const statement = raw.prepare(sql);
    return {
      first: async () => { const row = statement.get(...args); return row === undefined ? null : row; },
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: statement.run(...args) }),
    };
  };
  const db = {
    prepare: (sql) => ({ bind: (...args) => operation(sql, args) }),
    batch: async (statements) => { raw.exec("BEGIN"); try { for (const s of statements) await s.run(); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; } },
  };
  raw.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("proj-1", "Fixture Project", OWNER, "org-1", "Fire Alarm", "Draft", "Operational", null, null, "2026-01-01", "2026-01-01");
  raw.prepare("INSERT INTO project_dashboard_profiles VALUES (?,NULL)").run("proj-1");
  return { raw, db };
};

const post = (projectId, body) => new Request(`http://localhost/api/projects/${projectId}/operational-classification`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const call = async (db, projectId, body) => {
  const response = await handleDashboardApi(post(projectId, body), { DB: db });
  return { status: response.status, body: await response.json() };
};
const REASON = "Owner-confirmed validation artifact; reclassified from Operational to Internal Validation.";

test("governed values are exactly the evidenced set", () => {
  assert.deepEqual([...OPERATIONAL_CLASSIFICATIONS], ["Operational", "Internal Validation"]);
  assert.equal(isGovernedOperationalClassification("Operational"), true);
  assert.equal(isGovernedOperationalClassification("Internal Validation"), true);
  assert.equal(isGovernedOperationalClassification("Archived"), false);
  assert.equal(isGovernedOperationalClassification(""), false);
  assert.equal(isGovernedOperationalClassification(null), false);
});

test("A: authorized Operational -> Internal Validation succeeds", async () => {
  const { raw, db } = fixture();
  const { status, body } = await call(db, "proj-1", { operationalClassification: "Internal Validation", reason: REASON });
  assert.equal(status, 200);
  assert.equal(body.projectId, "proj-1");
  assert.equal(body.operationalClassification, "Internal Validation");
  assert.equal(raw.prepare("SELECT operational_classification c FROM projects WHERE id='proj-1'").get().c, "Internal Validation");
});

test("B: reverse Internal Validation -> Operational succeeds", async () => {
  const { raw, db } = fixture();
  raw.prepare("UPDATE projects SET operational_classification='Internal Validation' WHERE id='proj-1'").run();
  const { status, body } = await call(db, "proj-1", { operationalClassification: "Operational", reason: "Returned to live pursuit after owner review." });
  assert.equal(status, 200);
  assert.equal(body.operationalClassification, "Operational");
  assert.equal(raw.prepare("SELECT operational_classification c FROM projects WHERE id='proj-1'").get().c, "Operational");
});

test("C: invalid classification rejected without mutation", async () => {
  const { raw, db } = fixture();
  const { status, body } = await call(db, "proj-1", { operationalClassification: "Sandbox", reason: REASON });
  assert.equal(status, 422);
  assert.match(body.error.code, /OPERATIONAL_CLASSIFICATION_INVALID/);
  assert.equal(raw.prepare("SELECT operational_classification c FROM projects WHERE id='proj-1'").get().c, "Operational");
});

test("D: empty reason rejected without mutation", async () => {
  const { raw, db } = fixture();
  for (const reason of ["", "   "]) {
    const { status } = await call(db, "proj-1", { operationalClassification: "Internal Validation", reason });
    assert.equal(status, 422);
  }
  assert.equal(raw.prepare("SELECT operational_classification c FROM projects WHERE id='proj-1'").get().c, "Operational");
});

test("E: unauthorized actor rejected without mutation", async () => {
  const { raw, db } = fixture();
  raw.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("proj-2", "Other Project", "someone-else", "org-1", "Fire Alarm", "Draft", "Operational", null, null, "2026-01-01", "2026-01-01");
  raw.prepare("INSERT INTO project_dashboard_profiles VALUES (?,NULL)").run("proj-2");
  raw.prepare("INSERT INTO project_members VALUES (?,?,?,?,?,?,?)").run("m-1", "proj-2", OWNER, "Estimator", "Active", null, "2026-01-01");
  const { status } = await call(db, "proj-2", { operationalClassification: "Internal Validation", reason: REASON });
  assert.equal(status, 403);
  assert.equal(raw.prepare("SELECT operational_classification c FROM projects WHERE id='proj-2'").get().c, "Operational");
});

test("F: same-value update succeeds idempotently following existing control semantics", async () => {
  const { raw, db } = fixture();
  const { status, body } = await call(db, "proj-1", { operationalClassification: "Operational", reason: "Reconfirmed operational standing." });
  assert.equal(status, 200);
  assert.equal(body.operationalClassification, "Operational");
});

test("G: only operational_classification changes", async () => {
  const { raw, db } = fixture();
  const before = raw.prepare("SELECT * FROM projects WHERE id='proj-1'").get();
  await call(db, "proj-1", { operationalClassification: "Internal Validation", reason: REASON });
  const after = raw.prepare("SELECT * FROM projects WHERE id='proj-1'").get();
  assert.equal(after.operational_classification, "Internal Validation");
  for (const key of Object.keys(before)) {
    if (key === "operational_classification" || key === "updated_at") continue;
    assert.deepEqual(after[key], before[key], `field ${key} must be preserved`);
  }
});

test("H: audit event records previous, next, reason, actor", async () => {
  const { raw, db } = fixture();
  await call(db, "proj-1", { operationalClassification: "Internal Validation", reason: REASON });
  const audit = raw.prepare("SELECT * FROM dashboard_audit_log WHERE project_id='proj-1'").get();
  assert.ok(audit, "an audit row must be written");
  assert.equal(audit.action, "Project Operational Classification Set");
  assert.deepEqual(JSON.parse(audit.previous_value), { operationalClassification: "Operational" });
  assert.deepEqual(JSON.parse(audit.new_value), { operationalClassification: "Internal Validation" });
  assert.equal(audit.reason, REASON);
  assert.equal(audit.actor_user_id, OWNER);
});

test("I: organization dashboard filtering semantics remain unchanged", async () => {
  const api = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8"));
  assert.match(api, /p\.operational_classification = 'Operational'/, "hideTest filter still keys on operational_classification");
});
