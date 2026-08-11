import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { handleAuthContextApi } from "../worker/auth-context-api.mjs";

const authorizationMigration = await readFile(new URL("../drizzle/0018_verified_library_authorization.sql", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(authorizationMigration);
  raw.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY,name TEXT,status TEXT,owner_user_id TEXT);
    CREATE TABLE organization_memberships (id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,status TEXT,revoked_at TEXT);
    CREATE TABLE organization_membership_roles (id TEXT PRIMARY KEY,membership_id TEXT,role TEXT,status TEXT,revoked_at TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT,organization_id TEXT,owner_user_id TEXT,archived_at TEXT);
    CREATE TABLE project_members (id TEXT PRIMARY KEY,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT);
    INSERT INTO library_security_principals (user_id,email,account_status,session_status) VALUES ('verified-user','verified@example.test','Active','Active');
    INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by) VALUES ('grant-1','verified-user','Library Reviewer','Active','fixture');
    INSERT INTO organizations VALUES ('org-1','Verified Organization','Active','verified-user');
    INSERT INTO organization_memberships VALUES ('membership-1','org-1','verified-user','Active',NULL);
    INSERT INTO organization_membership_roles VALUES ('role-1','membership-1','Organization Owner','Active',NULL);
    INSERT INTO projects VALUES ('project-1','Verified Project','org-1','another-user',NULL);
    INSERT INTO project_members VALUES ('project-member-1','project-1','verified-user','Estimator','Active',NULL);
  `);
  const DB = { prepare(sql) { const operation = (args = []) => ({ first: async () => raw.prepare(sql).get(...args), all: async () => ({ results: raw.prepare(sql).all(...args) }), run: async () => raw.prepare(sql).run(...args) }); return { ...operation(), bind: (...args) => operation(args) }; } };
  return { raw, env: {
    DB,
    APP_ACCESS_MODE: "single-user",
    APP_USER_ID: "verified-user",
    APP_USER_EMAIL: "verified@example.test",
    APP_USER_NAME: "Verified User",
    APP_ORGANIZATION_ID: "org-1",
  } };
};

test("session context uses the server-configured MVP identity and durable memberships", async () => {
  const { raw, env } = fixture();
  const request = new Request("https://app.example/api/auth/session", { headers: {
    "oai-authenticated-user-id": "verified-user",
    "oai-authenticated-user-email": "verified@example.test",
    "oai-authenticated-user-full-name": "Verified%20User",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    "x-user-id": "forged-user",
    "x-user-role": "Administrator",
  } });
  const response = await handleAuthContextApi(request, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.user.id, "verified-user");
  assert.equal(body.user.displayName, "Verified User");
  assert.equal(body.effectiveLibraryPermission, "Administrator");
  assert.equal(body.authenticationSource, "Server-configured Single User");
  assert.equal(body.organizations[0].name, "Verified Organization");
  assert.deepEqual(body.organizations[0].roles, ["Organization Owner"]);
  assert.equal(body.projectMemberships[0].role, "Estimator");
  raw.close();
});

test("session API fails closed when production server context is unavailable", async () => {
  const { raw, env } = fixture();
  const response = await handleAuthContextApi(new Request("https://app.example/api/auth/session"), { DB: env.DB });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
  raw.close();
});

test("frontend contains no role switcher or browser role persistence", () => {
  for (const removed of ["Local working role", "Working role selector", "Reset local workspace", "setWorkingRole", "workingRoles", "roleHandoffNote"]) assert.doesNotMatch(pageSource, new RegExp(removed));
  assert.match(pageSource, /fetch\("\/api\/auth\/session"/);
  assert.match(pageSource, /authSession\.effectiveLibraryPermission/);
  assert.match(pageSource, /authSession\.organizations/);
  assert.match(pageSource, /authSession\?\.projectMemberships/);
});
