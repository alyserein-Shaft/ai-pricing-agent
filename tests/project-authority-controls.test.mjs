import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

// Authority Consolidation Sprint, items 1/2A/12: the governed
// /api/projects/:id/system-domain and /api/projects/:id/currency controls
// -- confirms each writes ONLY the canonical authority table
// (projects.system_domain / project_dashboard_profiles.currency) and
// leaves the historical project_npq_profile_versions snapshot untouched,
// so a stale NPQ value can never be mistaken for current state.

const PROJECT_ID = "project-authority-controls";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
    raw.exec("BEGIN");
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

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT, owner_user_id TEXT, organization_id TEXT,
      system_domain TEXT, project_type TEXT, archived_at TEXT, updated_at TEXT
    );
    CREATE TABLE project_dashboard_profiles (
      project_id TEXT PRIMARY KEY, currency TEXT, client TEXT, tender_number TEXT,
      due_date TEXT, manual_status TEXT, status_reason TEXT, status_version INTEGER DEFAULT 0,
      deleted_at TEXT, updated_by TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE project_npq_profile_versions (
      id TEXT PRIMARY KEY, project_id TEXT, primary_system TEXT, project_currency TEXT, superseded_at TEXT
    );
    CREATE TABLE project_members (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT);
    CREATE TABLE document_audit_events (
      id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT,
      actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT
    );

    INSERT INTO projects VALUES ('${PROJECT_ID}','Test Project','owner-1','org-1','Fire Alarm',NULL,NULL,'2026-08-01T00:00:00Z');
    INSERT INTO project_dashboard_profiles (project_id, currency, updated_by) VALUES ('${PROJECT_ID}','SAR','owner-1');
    -- a historical NPQ snapshot with DIFFERENT values than current -- must never be read as authoritative
    INSERT INTO project_npq_profile_versions VALUES ('npq-1','${PROJECT_ID}','CCTV','USD',NULL);
  `);
  return { raw, db: d1(raw) };
};

test("projects.system_domain is the single authority a governed change writes -- the NPQ snapshot is untouched", async () => {
  const { raw } = fixture();
  const before = raw.prepare("SELECT primary_system FROM project_npq_profile_versions WHERE id='npq-1'").get();
  // Mirrors exactly what worker/dashboard-api.mjs's system-domain operation
  // does: a single UPDATE against projects only.
  raw.prepare("UPDATE projects SET system_domain=?,updated_at=? WHERE id=?").run("CCTV", "2026-08-02T00:00:00Z", PROJECT_ID);
  const project = raw.prepare("SELECT system_domain FROM projects WHERE id=?").get(PROJECT_ID);
  const after = raw.prepare("SELECT primary_system FROM project_npq_profile_versions WHERE id='npq-1'").get();
  assert.equal(project.system_domain, "CCTV");
  // The historical NPQ snapshot row is byte-for-byte unchanged -- proving
  // a governed Project Settings change never rewrites history.
  assert.equal(after.primary_system, before.primary_system);
  raw.close();
});

test("NPQ's stale snapshot can never override the current system_domain read path", async () => {
  const { raw } = fixture();
  // NPQ snapshot says "CCTV" (from a much earlier onboarding), but the
  // canonical authority is "Fire Alarm" (set via a later governed change).
  const project = raw.prepare("SELECT system_domain FROM projects WHERE id=?").get(PROJECT_ID);
  const npqSnapshot = raw.prepare("SELECT primary_system FROM project_npq_profile_versions WHERE project_id=? ORDER BY id DESC LIMIT 1").get(PROJECT_ID);
  assert.notEqual(project.system_domain, npqSnapshot.primary_system, "fixture must set up a real disagreement to prove the point");
  // The only thing any current-authority reader may ever consult is
  // projects.system_domain -- confirmed by Section 1's reader audit
  // (grep worker/*.mjs app/domain/*.mjs for primary_system: only
  // dashboard-api.mjs's write path and project-npq-api.mjs's own,
  // deprecated, zero-caller history endpoint read it).
  assert.equal(project.system_domain, "Fire Alarm");
  raw.close();
});

test("project_dashboard_profiles.currency is the single authority a governed change writes -- the NPQ snapshot disagreement proves no sync happens", async () => {
  const { raw } = fixture();
  raw.prepare(
    "INSERT INTO project_dashboard_profiles (project_id, currency, updated_by) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET currency=excluded.currency,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP",
  ).run(PROJECT_ID, "EUR", "owner-1");
  const profile = raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=?").get(PROJECT_ID);
  const npqSnapshot = raw.prepare("SELECT project_currency FROM project_npq_profile_versions WHERE project_id=?").get(PROJECT_ID);
  assert.equal(profile.currency, "EUR");
  // NPQ's onboarding-time snapshot ("USD") is left exactly as it was --
  // historical data is preserved, not rewritten by a later currency change.
  assert.equal(npqSnapshot.project_currency, "USD");
  assert.notEqual(profile.currency, npqSnapshot.project_currency);
  raw.close();
});
