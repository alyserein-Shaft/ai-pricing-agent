import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { handleOrganizationApi } from "../worker/organization-api.mjs";
import { handleAuthContextApi } from "../worker/auth-context-api.mjs";

const authorizationMigration = await readFile(new URL("../drizzle/0018_verified_library_authorization.sql", import.meta.url), "utf8");
const governanceMigration = await readFile(new URL("../drizzle/0024_organization_membership_governance.sql", import.meta.url), "utf8");

const fixture = () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(authorizationMigration);
  raw.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE organization_memberships (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Active',granted_by TEXT NOT NULL,granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,revoked_at TEXT,UNIQUE(organization_id,user_id));
    CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT,organization_id TEXT,owner_user_id TEXT,archived_at TEXT);
    CREATE TABLE project_members (id TEXT PRIMARY KEY,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE pricing_lines (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE review_decisions (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE dashboard_audit_log (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE excel_export_jobs (id TEXT PRIMARY KEY,payload TEXT);
  `);
  raw.exec(governanceMigration);
  raw.prepare("INSERT INTO library_security_principals (user_id,email,account_status,session_status) VALUES ('outsider','outsider@example.test','Active','Active')").run();
  raw.prepare("INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by) VALUES ('outsider-grant','outsider','Library Viewer','Active','fixture')").run();
  for (const table of ["product_match_candidates","safety_decisions","pricing_lines","review_decisions","dashboard_audit_log","excel_export_jobs"]) raw.prepare(`INSERT INTO ${table} VALUES ('sentinel','unchanged')`).run();
  const operation = (sql, args = []) => ({ first: async () => raw.prepare(sql).get(...args), all: async () => ({ results: raw.prepare(sql).all(...args) }), run: async () => raw.prepare(sql).run(...args) });
  const DB = { prepare(sql) { return { ...operation(sql), bind: (...args) => operation(sql, args) }; }, async batch(statements) { raw.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  const env = { DB, IDENTITY_AUTH_MODE: "local", IDENTITY_LOCAL_DEVELOPMENT: "true", LOCAL_DEVELOPMENT_USER_ID: "local-development-user", LOCAL_DEVELOPMENT_USER_EMAIL: "local@development.invalid", LOCAL_DEVELOPMENT_USER_NAME: "Local Development User", ORGANIZATION_BOOTSTRAP_ENABLED: "true" };
  return { raw, env };
};
const localRequest = (path, method = "GET", headers = {}) => new Request(`http://localhost${path}`, { method, headers });

test("controlled bootstrap persists owner and administrator roles without changing library permission", async () => {
  const { raw, env } = fixture();
  const before = raw.prepare("SELECT permission FROM library_permission_grants WHERE user_id='local-development-user'").get().permission;
  let response = await handleOrganizationApi(localRequest("/api/organizations/internal-pilot-bootstrap", "POST"), env);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.organization.name, "BD-Shaft Internal Pilot");
  assert.deepEqual(created.organization.roles.sort(), ["Organization Administrator", "Organization Owner"]);
  assert.equal(created.organization.isOwner, true);
  response = await handleAuthContextApi(localRequest("/api/auth/session"), env);
  const firstSession = await response.json();
  response = await handleAuthContextApi(localRequest("/api/auth/session"), env);
  const refreshedSession = await response.json();
  assert.equal(refreshedSession.organizations[0].id, firstSession.organizations[0].id);
  assert.equal(refreshedSession.defaultOrganizationId, created.organization.id);
  assert.equal(refreshedSession.effectiveLibraryPermission, "Library Manager");
  assert.equal(raw.prepare("SELECT permission FROM library_permission_grants WHERE user_id='local-development-user'").get().permission, before);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM organization_audit_events").get().count, 2);
  response = await handleOrganizationApi(localRequest("/api/organizations/default"), env);
  assert.equal(response.status, 200);
  response = await handleOrganizationApi(localRequest("/api/organizations/internal-pilot-bootstrap", "POST"), env);
  assert.equal((await response.json()).idempotent, true);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM organizations").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM organization_audit_events").get().count, 2);
  for (const table of ["product_match_candidates","safety_decisions","pricing_lines","review_decisions","dashboard_audit_log","excel_export_jobs"]) assert.equal(JSON.stringify(raw.prepare(`SELECT * FROM ${table}`).all()), JSON.stringify([{ id: "sentinel", payload: "unchanged" }]));
  raw.close();
});

test("organization access is membership-bound and ignores client-forged scope", async () => {
  const { raw, env } = fixture();
  const creation = await handleOrganizationApi(localRequest("/api/organizations/internal-pilot-bootstrap", "POST", { "x-organization-id": "forged-org" }), env);
  const organizationId = (await creation.json()).organization.id;
  let response = await handleOrganizationApi(new Request("https://app.example/api/organizations/default"), { ...env, IDENTITY_AUTH_MODE: "sites" });
  assert.equal(response.status, 401);
  response = await handleOrganizationApi(new Request(`https://app.example/api/organizations/${organizationId}`, { headers: { "oai-authenticated-user-id": "outsider", "oai-authenticated-user-email": "outsider@example.test", "x-organization-id": organizationId, "x-user-role": "Organization Administrator" } }), { ...env, IDENTITY_AUTH_MODE: "sites" });
  assert.equal(response.status, 403);
  response = await handleOrganizationApi(localRequest("/api/organizations/forged-org"), env);
  assert.equal(response.status, 403);
  assert.equal(raw.prepare("SELECT owner_user_id FROM organizations WHERE id=?").get(organizationId).owner_user_id, "local-development-user");
  raw.close();
});

test("organization audit records are immutable", async () => {
  const { raw, env } = fixture();
  await handleOrganizationApi(localRequest("/api/organizations/internal-pilot-bootstrap", "POST"), env);
  assert.throws(() => raw.prepare("UPDATE organization_audit_events SET reason='tampered'").run(), /ORGANIZATION_AUDIT_IMMUTABLE/);
  assert.throws(() => raw.prepare("DELETE FROM organization_audit_events").run(), /ORGANIZATION_AUDIT_IMMUTABLE/);
  raw.close();
});
