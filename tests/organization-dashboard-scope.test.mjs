import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { handleDashboardApi } from "../worker/dashboard-api.mjs";

const authMigration = await readFile(new URL("../drizzle/0018_verified_library_authorization.sql", import.meta.url), "utf8");
const orgMigration = await readFile(new URL("../drizzle/0024_organization_membership_governance.sql", import.meta.url), "utf8");
const fixture = () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(authMigration);
  raw.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Active',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE organization_memberships (id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,status TEXT DEFAULT 'Active',granted_by TEXT,granted_at TEXT DEFAULT CURRENT_TIMESTAMP,revoked_at TEXT,UNIQUE(organization_id,user_id));
    CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_user_id TEXT NOT NULL,organization_id TEXT,system_domain TEXT NOT NULL DEFAULT 'Unspecified',initial_status TEXT NOT NULL DEFAULT 'Draft',archived_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE project_members (id TEXT PRIMARY KEY,project_id TEXT,user_id TEXT,role TEXT,status TEXT DEFAULT 'Active',granted_by TEXT,granted_at TEXT DEFAULT CURRENT_TIMESTAMP,revoked_at TEXT,UNIQUE(project_id,user_id));
    CREATE TABLE project_dashboard_profiles (project_id TEXT PRIMARY KEY,client TEXT,consultant TEXT,contractor TEXT,location TEXT,tender_number TEXT,package_name TEXT,due_date TEXT,currency TEXT DEFAULT 'SAR',manual_status TEXT,status_reason TEXT,status_version INTEGER DEFAULT 1,updated_by TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
    CREATE TABLE workflow_stage_states (id TEXT PRIMARY KEY,project_id TEXT,stage_id TEXT,model_version TEXT,status TEXT,progress INTEGER,blocking_issue_count INTEGER DEFAULT 0,warning_count INTEGER DEFAULT 0,owner_role TEXT,next_action TEXT,drill_down_route TEXT,source_version TEXT,calculated_at TEXT,started_at TEXT,completed_at TEXT,UNIQUE(project_id,stage_id,source_version));
    CREATE TABLE project_progress_snapshots (id TEXT PRIMARY KEY,project_id TEXT,model_version TEXT,progress INTEGER,derived_status TEXT,ready_for_quotation INTEGER,facts TEXT,source_version TEXT,calculated_at TEXT,UNIQUE(project_id,source_version));
    CREATE TABLE dashboard_metric_definitions (id TEXT,version TEXT,name TEXT,description TEXT,scope TEXT,data_source TEXT,formula TEXT,filters TEXT,exclusions TEXT,refresh_strategy TEXT,permission TEXT,drill_down_route TEXT,owner TEXT,test_cases TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(id,version));
    CREATE TABLE project_risks (id TEXT PRIMARY KEY,project_id TEXT,risk_type TEXT,severity TEXT,trigger TEXT,impact TEXT,affected_module TEXT,recommended_action TEXT,owner TEXT,due_date TEXT,source TEXT,status TEXT DEFAULT 'Open',source_version TEXT,acknowledged_by TEXT,acknowledged_at TEXT,calculated_at TEXT,UNIQUE(project_id,risk_type,source_version));
    CREATE TABLE project_status_history (id TEXT PRIMARY KEY,project_id TEXT,previous_status TEXT,next_status TEXT,status_type TEXT,reason TEXT,model_version TEXT,source_version TEXT,actor_user_id TEXT,actor_role TEXT,created_at TEXT);
    CREATE TABLE dashboard_audit_log (id TEXT PRIMARY KEY,project_id TEXT,action TEXT,previous_value TEXT,new_value TEXT,reason TEXT,actor_user_id TEXT,actor_role TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE pricing_approvals (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE review_decisions (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE identity_resolution_proposals (id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE export_templates (id TEXT PRIMARY KEY,payload TEXT);
  `); raw.exec(orgMigration);
  raw.exec(`
    INSERT INTO organizations (id,name,status,owner_user_id) VALUES ('org-a','Organization A','Active','user-a'),('org-b','Organization B','Active','user-b');
    INSERT INTO organization_memberships (id,organization_id,user_id,status,granted_by) VALUES ('membership-a','org-a','user-a','Active','fixture'),('membership-b','org-b','user-b','Active','fixture'),('membership-c','org-a','user-c','Active','fixture');
    INSERT INTO organization_membership_roles (id,membership_id,role,status,granted_by) VALUES ('role-a-owner','membership-a','Organization Owner','Active','fixture'),('role-a-admin','membership-a','Organization Administrator','Active','fixture'),('role-b-owner','membership-b','Organization Owner','Active','fixture'),('role-c-member','membership-c','Organization Member','Active','fixture');
    INSERT INTO library_security_principals (user_id,email,account_status,session_status) VALUES ('user-a','a@example.test','Active','Active'),('user-b','b@example.test','Active','Active'),('user-c','c@example.test','Active','Active');
    INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by) VALUES ('grant-a','user-a','Library Manager','Active','fixture'),('grant-b','user-b','Library Manager','Active','fixture'),('grant-c','user-c','Library Manager','Active','fixture');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('project-a','Alpha Fire Upgrade','user-a','org-a'),('project-b','Beta Secure Site','user-b','org-b'),('legacy-unassigned','Technical Intake Test','user-a',NULL);
    INSERT INTO project_dashboard_profiles (project_id,client,tender_number,currency,updated_by) VALUES ('project-a','Acme Client','TND-42','SAR','fixture'),('project-b','Other Client','B-200','SAR','fixture'),('legacy-unassigned','Legacy Client','LEG-1','SAR','fixture');
    INSERT INTO project_members (id,project_id,user_id,role,status,granted_by) VALUES ('cross-membership','project-b','user-a','Estimator','Active','fixture'),('estimator-membership','project-a','user-c','Estimator','Active','fixture');
    INSERT INTO product_match_candidates VALUES ('sentinel','unchanged'); INSERT INTO safety_decisions VALUES ('sentinel','unchanged'); INSERT INTO pricing_approvals VALUES ('sentinel','unchanged'); INSERT INTO review_decisions VALUES ('sentinel','unchanged'); INSERT INTO identity_resolution_proposals VALUES ('sentinel','unchanged'); INSERT INTO export_templates VALUES ('sentinel','unchanged');
  `);
  const operation = (sql, args = []) => ({ first: async () => raw.prepare(sql).get(...args), all: async () => ({ results: raw.prepare(sql).all(...args) }), run: async () => raw.prepare(sql).run(...args) });
  const DB = { prepare(sql) { return { ...operation(sql), bind: (...args) => operation(sql, args) }; }, async batch(statements) { raw.exec("BEGIN"); try { const results=[]; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch(error) { raw.exec("ROLLBACK"); throw error; } } };
  return { raw, env: { DB, IDENTITY_AUTH_MODE: "sites" } };
};
const request = (path, user="user-a", method="GET", body) => new Request(`https://app.example${path}`, { method, headers: { "oai-authenticated-user-id":user, "oai-authenticated-user-email":`${user}@example.test`, ...(body ? { "content-type":"application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
const getJson = async (env, path, user="user-a") => { const response=await handleDashboardApi(request(path,user),env); return { response, body:await response.json() }; };

test("dashboard, metrics and actions are strictly scoped to the active organization", async () => {
  const { raw, env } = fixture();
  const { response, body } = await getJson(env,"/api/dashboard/organization");
  assert.equal(response.status,200); assert.equal(body.organization.id,"org-a"); assert.deepEqual(body.projects.map((entry)=>entry.project.id),["project-a"]);
  assert.equal(body.metrics.activeProjects,1); assert.ok(body.actionQueue.every((action)=>action.projectId==="project-a")); assert.equal(body.unassignedLegacyProjects.count,1); assert.equal(body.unassignedLegacyProjects.includedInMetrics,false);
  assert.equal(body.projects.some((entry)=>entry.project.id==="project-b"),false); assert.equal(body.projects.some((entry)=>entry.project.id==="legacy-unassigned"),false);
  assert.equal(body.projects[0].commercialRestricted,false);
  const estimator=await getJson(env,"/api/dashboard/organization","user-c"); assert.equal(estimator.body.projects[0].commercialRestricted,true); assert.equal(estimator.body.projects[0].totals,undefined);
  for (const table of ["product_match_candidates","safety_decisions","pricing_approvals","review_decisions","identity_resolution_proposals","export_templates"]) assert.equal(raw.prepare(`SELECT payload FROM ${table} WHERE id='sentinel'`).get().payload,"unchanged");
  raw.close();
});

test("organization project search is server-side for name, client and reference with a zero-result state", async () => {
  const { raw, env } = fixture();
  await handleDashboardApi(request("/api/dashboard/organization"),env);
  for (const query of ["Alpha","Acme","TND-42"]) { const { body }=await getJson(env,`/api/dashboard/organization?q=${encodeURIComponent(query)}`); assert.deepEqual(body.projects.map((entry)=>entry.project.id),["project-a"],query); }
  const { body }=await getJson(env,"/api/dashboard/organization?q=unknown-value"); assert.equal(body.state,"No Search Results"); assert.equal(body.projects.length,0); assert.equal(body.metrics.activeProjects,1);
  const list=await getJson(env,"/api/projects?q=Acme"); assert.deepEqual(list.body.projects.map((entry)=>entry.project.id),["project-a"]);
  raw.close();
});

test("forged scope and removed membership fail immediately", async () => {
  const { raw, env } = fixture();
  let result=await getJson(env,"/api/dashboard/organization?organizationId=org-b"); assert.equal(result.response.status,403); assert.equal(result.body.error.code,"ORGANIZATION_ACCESS_DENIED");
  raw.prepare("UPDATE organization_memberships SET status='Revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='membership-a'").run();
  result=await getJson(env,"/api/dashboard/organization"); assert.equal(result.response.status,409); assert.equal(result.body.error.code,"NO_ACTIVE_ORGANIZATION");
  raw.close();
});

test("new project organization assignment is server-derived", async () => {
  const { raw, env } = fixture(); await handleDashboardApi(request("/api/dashboard/organization"),env);
  const response=await handleDashboardApi(request("/api/projects","user-a","POST",{name:"Server Bound Project",client:"Pilot Client",reference:"REF-900",system:"Fire Detection & Alarm",status:"Draft",organizationId:"org-b"}),env), body=await response.json();
  assert.equal(response.status,201); assert.equal(body.project.organizationId,"org-a"); assert.equal(raw.prepare("SELECT organization_id FROM projects WHERE id=?").get(body.project.id).organization_id,"org-a");
  const stored=raw.prepare("SELECT system_domain,initial_status FROM projects WHERE id=?").get(body.project.id); assert.equal(stored.system_domain,"Fire Alarm"); assert.equal(stored.initial_status,"Draft");
  assert.equal(raw.prepare("SELECT organization_id FROM projects WHERE id='legacy-unassigned'").get().organization_id,null);
  raw.close();
});

test("dashboard router passes valid project document routes to document management", async () => {
  const { raw, env } = fixture();
  assert.equal(await handleDashboardApi(request("/api/projects/project-a/documents?includeArchived=true"),env),null);
  raw.close();
});
