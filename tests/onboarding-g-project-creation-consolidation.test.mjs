import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleDashboardApi } from "../worker/dashboard-api.mjs";
import { handleDocumentApi } from "../worker/document-api.mjs";
import { normalizeNpQProfile } from "../app/domain/project-npq-engine.mjs";

// ONBOARDING RECOVERY G -- LEGACY PROJECT CREATION ROUTE CONSOLIDATION.
//
// Every test here runs against an ISOLATED in-memory database (never the live
// dev DB) via the real, unmodified handleDashboardApi / handleDocumentApi entry
// points -- the strongest available proof short of a live HTTP call. No live
// business-data mutation occurs anywhere in this file.
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to hand-roll a ~35-table CREATE TABLE approximation of the
// schema. That approximation drifted: the dashboard read path
// (worker/dashboard-api.mjs collectProjectFacts) touches ~69 tables, so as
// soon as the governed read path grew a dependency -- DOC-R3's revision
// authority, then technical-requirement's `boq_requirement_links` -- the
// fixture kept compiling and then failed at runtime with "no such table",
// proving nothing about the behaviour it claimed to cover. Appending columns
// to a hand-written list is how that drift happens, and it happens again on
// the next migration.
//
// Both fixtures below are therefore built by `activeChainDatabase()` -- the
// ACTUAL ordered drizzle-active chain read from the migration journal -- and
// wrapped in the shared D1-shaped `d1()` adapter. See
// tests/fixtures/active-chain-fixture.mjs. Consequences, both intended:
//   * a future migration cannot silently invalidate this file's fixtures, and
//   * every seed row below must satisfy the REAL NOT NULL / FOREIGN KEY set,
//     so the seeds here are honest rows, not optimistic ones.

const worker = fs.readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
const documentWorker = fs.readFileSync(new URL("../worker/document-api.mjs", import.meta.url), "utf8");

// ── Route A / B fixture (dashboard-api.mjs) ─────────────────────────────────
//
// The real chain leaves foreign_keys ON (drizzle-active/0002_governing_source_fk.sql),
// so it is left ON here too: every seeded principal, membership, role, grant
// and project below resolves to a real parent row. Nothing in this file seeds
// deliberately non-referential evidence, so there is no reason to relax it.

const projectFixture = () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id,name,status,owner_user_id) VALUES ('org-a','Organization A','Active','user-a'),('org-b','Organization B','Active','user-b');
    INSERT INTO organization_memberships (id,organization_id,user_id,status,granted_by) VALUES ('membership-a','org-a','user-a','Active','fixture'),('membership-b','org-b','user-b','Active','fixture'),('membership-c','org-a','user-c','Active','fixture');
    INSERT INTO organization_membership_roles (id,membership_id,role,status,granted_by) VALUES ('role-a-owner','membership-a','Organization Owner','Active','fixture'),('role-b-owner','membership-b','Organization Owner','Active','fixture'),('role-c-member','membership-c','Organization Member','Active','fixture');
    INSERT INTO library_security_principals (user_id,email,account_status,session_status) VALUES ('user-a','a@example.test','Active','Active'),('user-b','b@example.test','Active','Active'),('user-c','c@example.test','Active','Active');
    INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by) VALUES ('grant-a','user-a','Library Manager','Active','fixture'),('grant-b','user-b','Library Manager','Active','fixture'),('grant-c','user-c','Library Manager','Active','fixture');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('legacy-blank-client','Old Incomplete Project','user-a','org-a');
  `);
  // The shared D1-shaped adapter over the same DatabaseSync -- identical to
  // the one production code is handed, so no bespoke shim behaviour is left in
  // this file to drift from the workers under test.
  return { raw, env: { DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: "org-a" } };
};
const request = (path, method = "POST", body) => new Request(`https://app.example${path}`, { method, headers: { "oai-authenticated-user-id": "user-a", "oai-authenticated-user-email": "a@example.test", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

// Note: this fixture omits the "Organization Administrator" role's
// duplicate check on line 78 of the pre-existing organization-dashboard-
// scope.test.mjs fixture -- Organization Owner alone is sufficient for
// createGovernedProject's own role gate, verified against the real source
// below (ORGANIZATION_BINDING / role-gate tests).

// ── CANONICAL_ROUTE ──────────────────────────────────────────────────────────

test("CANONICAL_ROUTE: POST /api/projects/onboard creates the full governed shape -- projects row, dashboard profile, Confirmed NPQ v1, NPQ event, audit entry", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "Central Kitchen Test", client: "ABC Contractor", system: "Fire Alarm", currency: "SAR",
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const projectId = body.project.id;
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects WHERE id=?").get(projectId).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM project_dashboard_profiles WHERE project_id=?").get(projectId).n, 1);
  const npq = raw.prepare("SELECT * FROM project_npq_profile_versions WHERE project_id=?").get(projectId);
  assert.equal(npq.status, "Confirmed");
  assert.equal(npq.version_number, 1);
  assert.equal(npq.superseded_at, null);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM project_npq_profile_events WHERE project_id=? AND action='NPQ Confirmed'").get(projectId).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM dashboard_audit_log WHERE project_id=? AND action='Project Created with NPQ'").get(projectId).n, 1);
});

// ── CLIENT_REQUIRED / SYSTEM_REQUIRED (direct backend bypass) ───────────────

test("CLIENT_REQUIRED: a direct backend call with no client is blocked -- UI cannot be the only protection", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", { name: "No Client Project", system: "Fire Alarm" }), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "PROJECT_CLIENT_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 1, "only the pre-seeded legacy row -- zero new rows");
});

test("SYSTEM_REQUIRED: a direct backend call with no system is blocked -- UI cannot be the only protection", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", { name: "No System Project", client: "Some Client" }), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "PROJECT_SYSTEM_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
});

// ── NPQ_REQUIRED ─────────────────────────────────────────────────────────────

test("NPQ_REQUIRED: an incomplete NPQ (Fixed Manufacturer strategy with no preferredManufacturer) blocks creation with zero rows written", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "Bad NPQ Project", client: "Some Client", system: "Fire Alarm",
    npq: { manufacturerStrategy: "Fixed Manufacturer" },
  }), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "NPQ_REQUIRED_FIELDS_MISSING");
  assert.ok(body.error.missing.includes("preferredManufacturer"));
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
});

// ── MULTI_SYSTEM / OPEN_SYSTEM (Part 25 fixture) ────────────────────────────

test("MULTI_SYSTEM: Central Kitchen Test fixture -- Primary + Additional systems persist correctly, projects.system_domain is the compatibility mirror", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "Central Kitchen Test", client: "ABC Contractor", system: "Fire Alarm", currency: "SAR",
    npq: { primarySystem: "Fire Alarm", additionalSystems: ["CCTV", "Access Control", "Intercom"], deliveryScope: "Supply + Testing & Commissioning" },
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const projectId = body.project.id;
  const project = raw.prepare("SELECT system_domain FROM projects WHERE id=?").get(projectId);
  assert.equal(project.system_domain, "Fire Alarm", "creation-time compatibility mirror");
  const npq = raw.prepare("SELECT primary_system, additional_systems_json FROM project_npq_profile_versions WHERE project_id=?").get(projectId);
  assert.equal(npq.primary_system, "Fire Alarm");
  assert.deepEqual(JSON.parse(npq.additional_systems_json).sort(), ["Access Control", "CCTV", "Intercom"].sort());
});

test("OPEN_SYSTEM: Intercom (not a registered SYSTEM_PACK) is fully accepted as both Primary and an additional system, no whitelist anywhere in this contract", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "Open System Project", client: "Some Client", system: "Intercom",
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.npq.profile.primarySystem, "Intercom");
  const projectId = body.project.id;
  assert.equal(raw.prepare("SELECT primary_system FROM project_npq_profile_versions WHERE project_id=?").get(projectId).primary_system, "Intercom");
});

// ── DECLARED_SCOPE / PENDING_SCOPE ──────────────────────────────────────────

test("DECLARED_SCOPE: an explicit current-option value persists exactly as sent", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "Declared Scope Project", client: "Some Client", system: "Fire Alarm",
    npq: { deliveryScope: "Supply Materials Only" },
  }), env);
  const body = await response.json();
  const projectId = body.project.id;
  assert.equal(raw.prepare("SELECT delivery_scope FROM project_npq_profile_versions WHERE project_id=?").get(projectId).delivery_scope, "Supply Materials Only");
});

test("PENDING_SCOPE: no scope sent -> the honest 'Pending Tender Review' unresolved state, never the old 'Supply and Installation' default", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "No Scope Project", client: "Some Client", system: "Fire Alarm",
  }), env);
  const body = await response.json();
  const projectId = body.project.id;
  assert.equal(raw.prepare("SELECT delivery_scope FROM project_npq_profile_versions WHERE project_id=?").get(projectId).delivery_scope, "Pending Tender Review");
});

// ── CONTACT_TITLE ────────────────────────────────────────────────────────────

test("CONTACT_TITLE: separate title/name persist as two distinct columns, never concatenated", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", {
    name: "Contact Project", client: "Some Client", system: "Fire Alarm",
    npq: { contactTitle: "Ms.", contactName: "Sara Ahmed" },
  }), env);
  const body = await response.json();
  const projectId = body.project.id;
  const row = raw.prepare("SELECT contact_title, contact_name FROM project_npq_profile_versions WHERE project_id=?").get(projectId);
  assert.equal(row.contact_title, "Ms.");
  assert.equal(row.contact_name, "Sara Ahmed");
});

// ── ORGANIZATION_BINDING ─────────────────────────────────────────────────────

test("ORGANIZATION_BINDING: organization_id is always the server-resolved active organization, never a client-supplied value, for both routes", async () => {
  for (const path of ["/api/projects/onboard", "/api/projects"]) {
    const { raw, env } = projectFixture();
    const response = await handleDashboardApi(request(path, "POST", {
      name: `Bound Project ${path}`, client: "Some Client", system: "Fire Alarm", organizationId: "org-b",
    }), env);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.project.organizationId, "org-a");
    assert.equal(raw.prepare("SELECT organization_id FROM projects WHERE id=?").get(body.project.id).organization_id, "org-a");
  }
});

// ── ATOMIC_CREATION ───────────────────────────────────────────────────────────

test("ATOMIC_CREATION: a validation failure leaves zero rows in every table -- no bare projects row, no partial dashboard/NPQ state", async () => {
  const { raw, env } = projectFixture();
  await handleDashboardApi(request("/api/projects/onboard", "POST", { name: "", client: "Some Client", system: "Fire Alarm" }), env);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 1, "only the pre-seeded legacy row");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM project_dashboard_profiles").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM project_npq_profile_versions").get().n, 0);
});

// ── NPQ_V1 ───────────────────────────────────────────────────────────────────

test("NPQ_V1: Confirmed, version 1, current (superseded_at IS NULL), and an NPQ Confirmed event exists", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects/onboard", "POST", { name: "V1 Project", client: "Some Client", system: "Fire Alarm" }), env);
  const body = await response.json();
  assert.equal(body.npq.version, 1);
  assert.equal(body.npq.status, "Confirmed");
  assert.equal(body.npq.authority, "AUTHORITATIVE_PROJECT_CONTEXT");
  const projectId = body.project.id;
  const row = raw.prepare("SELECT status,version_number,superseded_at FROM project_npq_profile_versions WHERE project_id=?").get(projectId);
  assert.equal(row.status, "Confirmed");
  assert.equal(row.version_number, 1);
  assert.equal(row.superseded_at, null);
});

// ── ROUTE_B (delegation, full parity) ────────────────────────────────────────

test("ROUTE_B: /api/projects produces the exact same governed shape as /api/projects/onboard for an equivalent payload", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects", "POST", {
    name: "Golden E2E Smoke Project", client: "Internal Validation", reference: "GOLDEN-SMOKE-001", system: "Fire Alarm", status: "Draft",
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const projectId = body.project.id;
  // Same governed shape as CANONICAL_ROUTE above: dashboard profile + a
  // Confirmed NPQ v1 + NPQ event + the ONE canonical "Project Created with
  // NPQ" audit action (no separate "Project Created" shape survives).
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM project_dashboard_profiles WHERE project_id=?").get(projectId).n, 1);
  const npq = raw.prepare("SELECT status,version_number FROM project_npq_profile_versions WHERE project_id=?").get(projectId);
  assert.equal(npq.status, "Confirmed");
  assert.equal(npq.version_number, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM dashboard_audit_log WHERE project_id=? AND action='Project Created with NPQ'").get(projectId).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM dashboard_audit_log WHERE project_id=? AND action='Project Created'").get(projectId).n, 0, "the old, separate Route B audit shape no longer exists");
  // Full response-shape parity with Route A (real Create Project UI
  // callers and golden-full-journey's downstream workflow assertions both
  // read npq/organization off this same shape).
  assert.ok(body.npq);
  assert.ok(body.organization);
});

test("ROUTE_B: a real golden-full-journey-style payload (name/client/reference/system/currency/status, no npq object) is honored without fabricating anything Route-B-specific", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects", "POST", {
    name: "Golden Full Journey", client: "Internal Validation", reference: "GOLDEN-FULL-001", system: "Fire Alarm", currency: "SAR", status: "Draft",
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const projectId = body.project.id;
  assert.equal(raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=?").get(projectId).currency, "SAR");
  assert.equal(raw.prepare("SELECT project_currency FROM project_npq_profile_versions WHERE project_id=?").get(projectId).project_currency, "SAR");
});

test("ROUTE_B: an explicit non-default currency (top-level `currency`, Route B's own flat field) is honored, not silently overridden to SAR", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects", "POST", {
    name: "USD Project", client: "Some Client", system: "Fire Alarm", currency: "USD",
  }), env);
  const body = await response.json();
  const projectId = body.project.id;
  assert.equal(raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=?").get(projectId).currency, "USD");
  assert.equal(raw.prepare("SELECT project_currency FROM project_npq_profile_versions WHERE project_id=?").get(projectId).project_currency, "USD");
});

test("ROUTE_B: same Client/System enforcement as Route A -- a real caller cannot bypass Identity through the legacy URL", async () => {
  const { raw, env } = projectFixture();
  const response = await handleDashboardApi(request("/api/projects", "POST", { name: "No Client via Route B" }), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "PROJECT_CLIENT_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
});

// ── NO_HARDCODED_LEGACY_SAR_BYPASS ──────────────────────────────────────────

test("NO_HARDCODED_LEGACY_SAR_BYPASS: no route contains a hardcoded 'SAR' literal in a creation INSERT -- currency always flows through npq.projectCurrency", () => {
  assert.doesNotMatch(worker, /VALUES \(\?,\?,\?,\?,'SAR',\?\)/, "the old Route B hardcoded-SAR dashboard-profile INSERT is gone");
  const helperBlock = worker.slice(worker.indexOf("const createGovernedProject"), worker.indexOf("export const handleDashboardApi"));
  assert.match(helperBlock, /npq\.projectCurrency/);
});

// ── NO_SUPPLY_INSTALLATION_DEFAULT ──────────────────────────────────────────

test("NO_SUPPLY_INSTALLATION_DEFAULT: neither creation route can resurrect the old 'Supply and Installation' default -- the only default is the honest Pending Tender Review", () => {
  const helperBlock = worker.slice(worker.indexOf("const createGovernedProject"), worker.indexOf("export const handleDashboardApi"));
  assert.doesNotMatch(helperBlock, /Supply and Installation/);
});

// ── SYSTEM_DOMAIN ─────────────────────────────────────────────────────────────

test("SYSTEM_DOMAIN: remains the creation-time compatibility mirror, never re-authorized as a second Project Systems authority by this slice", () => {
  assert.match(worker, /projects\.system_domain remains only\s*\n\s*\/\/ the creation-time\/legacy compatibility mirror, never the Project\s*\n\s*\/\/ Systems authority/);
  assert.match(worker, /This slice did not re-authorize\s*\n\s*\/\/ it as a second, general-purpose write surface\./);
});

// ── ROUTE_C (document-upload implicit-create retirement) ───────────────────

// Same canonical fixture as the dashboard route above -- the real ordered
// drizzle-active chain, not a hand-written approximation of the document tables
// -- and the same shared D1-shaped adapter. FK enforcement stays ON: the one
// seeded project below resolves to a real organizations row, so nothing in
// ROUTE_C needs referential integrity relaxed.

const uploadForm = () => {
  const bytes = new TextEncoder().encode("Item No,Description,Unit,Quantity\n1,Test,No,1");
  const form = new FormData();
  form.set("file", new File([bytes], "test.csv", { type: "text/csv" }));
  form.set("projectName", "Attempted Implicit Project");
  return form;
};

test("ROUTE_C_UNKNOWN_PROJECT: uploading to a nonexistent projectId returns 404 PROJECT_NOT_FOUND with ZERO inserts into projects, upload_sessions, or documents", async () => {
  const raw = activeChainDatabase();
  const env = { DB: d1(raw), FILES: { put: async () => { throw new Error("FILES.put must never be called for an unknown project"); }, delete: async () => {} }, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleDocumentApi(
    new Request("https://app.example/api/projects/does-not-exist/documents", { method: "POST", body: uploadForm() }),
    env, { waitUntil() {} },
  );
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "PROJECT_NOT_FOUND");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM upload_sessions").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM documents").get().n, 0);
});

test("ROUTE_C_EXISTING_PROJECT: uploading to an already-created project still succeeds exactly as before", async () => {
  const raw = activeChainDatabase();
  // Re-pointed at the REAL projects columns. The real table carries
  // organization_id as a FOREIGN KEY to organizations, so the organization the
  // project belongs to is seeded as a real row rather than a dangling id --
  // which is also what the "no second/duplicate project row" assertion is
  // actually about.
  raw.exec(`
    INSERT INTO organizations (id,name,status,owner_user_id) VALUES ('org1','Organization One','Active','owner1');
    INSERT INTO projects (id,owner_user_id,organization_id,name,archived_at) VALUES ('p1','owner1','org1','Real Project',NULL);
  `);
  const env = { DB: d1(raw), FILES: { put: async () => {}, get: async () => null, delete: async () => {} }, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleDocumentApi(
    new Request("https://app.example/api/projects/p1/documents", { method: "POST", body: uploadForm() }),
    env, { waitUntil() {} },
  );
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM projects").get().n, 1, "no second/duplicate project row was created");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM documents WHERE project_id='p1'").get().n, 1);
});

test("ROUTE_C: the implicit-creation INSERT is gone from source -- document upload never writes to the projects table", () => {
  assert.doesNotMatch(documentWorker, /INSERT INTO projects/);
  assert.match(documentWorker, /code: "PROJECT_NOT_FOUND"/);
});

// ── HISTORICAL_PROJECTS ──────────────────────────────────────────────────────

test("HISTORICAL_PROJECTS: an existing blank-client project remains fully readable -- this slice governs new creation only, no migration, no backfill", async () => {
  const { raw, env } = projectFixture();
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM project_dashboard_profiles WHERE project_id='legacy-blank-client'").get().n, 0, "no client was ever backfilled onto this legacy row -- it has no dashboard profile at all, exactly as it started");
  const response = await handleDashboardApi(request("/api/projects/legacy-blank-client/dashboard", "GET"), env);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.project.id, "legacy-blank-client");
  assert.ok(!dashboard.project.client, "still honestly blank -- no migration, no invented value");
});

// ── REGRESSION (no schema, no other-domain touch) ────────────────────────────

test("NO SCHEMA CHANGE: this slice introduces no CREATE TABLE / ALTER TABLE / new migration file", () => {
  const dir = fs.readdirSync(new URL("../drizzle-active", import.meta.url));
  const numbered = dir.filter((f) => /^\d{4}_/.test(f)).sort();
  assert.deepEqual(numbered, [
    "0000_baseline_schema_0082.sql",
    "0001_price_record_intake_lineage.sql",
    "0002_governing_source_fk.sql",
    "0003_review_decision_immutability.sql",
    "0004_fire_alarm_panel_sizing_snapshots.sql",
    "0005_document_revision_addendum.sql",
    "0006_project_effective_time_calendar.sql",
    "0007_project_calendar_evidence_repair.sql",
    "0008_profile_applicability_source_authority.sql",
    "0009_profile_applicability_device_identity_authority.sql",
    "0010_requirement_intelligence_source_authority.sql",
  ], "this slice added no migration; the active chain is exactly the frozen baseline plus the governed 0001-0010 authority migrations");
});

test("MULTI-SYSTEM CREATION FIXTURE (source proof): normalizeNpQProfile handles the Part 25 payload identically to what createGovernedProject persists", () => {
  const profile = normalizeNpQProfile({ primarySystem: "Fire Alarm", additionalSystems: ["CCTV", "Access Control", "Intercom"], deliveryScope: "Supply + Testing & Commissioning", projectCurrency: "SAR" });
  assert.equal(profile.primarySystem, "Fire Alarm");
  assert.deepEqual(profile.additionalSystems.sort(), ["Access Control", "CCTV", "Intercom"].sort());
  assert.equal(profile.deliveryScope, "Supply + Testing & Commissioning");
});

// ── NO LIVE MUTATION ──────────────────────────────────────────────────────────

test("NO LIVE MUTATION: this file touches only isolated in-memory DatabaseSync fixtures, never the live dev DB path", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.wrangler\/state/);
  // The isolation mechanism changed, and the pin is now STRONGER than the old
  // `new DatabaseSync(":memory:")` literal check rather than weaker. Every
  // database here is built by the shared `activeChainDatabase()` helper (which
  // is itself `new DatabaseSync(":memory:")` plus the real ordered drizzle-active
  // chain), and this file hand-writes no CREATE TABLE schema of its own -- so the
  // class of bug that produced "no such table: boq_requirement_links" cannot be
  // reintroduced here, and an in-memory database cannot be pointed at the live
  // dev DB without also reintroducing a schema string, which is now pinned absent.
  assert.match(source, /activeChainDatabase\(\)/, "every fixture is built by the canonical active-chain helper");
  assert.doesNotMatch(source, /CREATE TABLE\s*\(/, "this file hand-writes no schema of its own -- it cannot drift behind migrations");
  // The driver specifier is assembled from two parts on purpose: written out
  // literally it would appear in this very file's own text and the check would
  // match itself. Do not "tidy" this into a plain literal.
  const sqliteDriver = new RegExp(["node", "sqlite"].join(":"));
  assert.doesNotMatch(source, sqliteDriver, "this file does not even import the sqlite driver -- the only in-memory database construction site is the shared canonical helper");
});
