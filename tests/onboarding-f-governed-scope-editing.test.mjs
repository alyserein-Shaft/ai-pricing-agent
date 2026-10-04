import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  addSystemToScope,
  removeSystemFromScope,
  buildOnboardingSystemsPayload,
  isValidScope,
} from "../app/domain/project-system-scope.mjs";
import {
  resolveProjectSystems,
  isGoverningBoqSystemEvidence,
} from "../app/domain/system-knowledge-registry.mjs";
import {
  NPQ_DELIVERY_SCOPE_LEGACY_VALUES,
  NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS,
  NPQ_DELIVERY_SCOPE_UNRESOLVED,
  normalizeNpQProfile,
} from "../app/domain/project-npq-engine.mjs";

// ONBOARDING RECOVERY F -- Governed Post-Creation Systems + Declared Scope
// Editing. Every test here is read-only/fixture-based; no live DB writes.
// See the module-level comments in worker/project-npq-api.mjs,
// worker/dashboard-api.mjs (currentNpqSystems) and app/page.tsx
// (openProjectScopeEditor/saveProjectScope) for the real, live wiring this
// file proves.

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const dashboardApi = fs.readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
const npqApi = fs.readFileSync(new URL("../worker/project-npq-api.mjs", import.meta.url), "utf8");
const registry = fs.readFileSync(new URL("../app/domain/system-knowledge-registry.mjs", import.meta.url), "utf8");
const overview = fs.readFileSync(new URL("../app/components/workspaces/OverviewWorkspace.tsx", import.meta.url), "utf8");
const apiClient = fs.readFileSync(new URL("../app/lib/api-client.ts", import.meta.url), "utf8");

const tempDb = (schemaSql) => {
  const file = path.join(os.tmpdir(), `onboarding-f-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(schemaSql);
  return { db, file };
};

const NPQ_VERSIONS_SCHEMA = `
  CREATE TABLE project_npq_profile_versions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL,
    primary_system TEXT, additional_systems_json TEXT, delivery_scope TEXT,
    status TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL
  );
`;

// ── HYDRATE_CURRENT_CONFIRMED ───────────────────────────────────────────────

test("HYDRATE_CURRENT_CONFIRMED: GET .../npq's real query selects status='Confirmed' AND superseded_at IS NULL, deterministic order -- never a random UUID", () => {
  assert.match(npqApi, /status='Confirmed'\s*\n\s*AND superseded_at IS NULL\s*\n\s*ORDER BY version_number DESC\s*\n\s*LIMIT 1/);
});

test("HYDRATE_CURRENT_CONFIRMED (isolated fixture): a superseded v1 never outranks the current confirmed v2", () => {
  const { db, file } = tempDb(NPQ_VERSIONS_SCHEMA);
  db.prepare("INSERT INTO project_npq_profile_versions VALUES ('v1','p1',1,'Fire Alarm','[]','Supply and Installation','Confirmed','2026-09-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO project_npq_profile_versions VALUES ('v2','p1',2,'CCTV','[]','Pending Tender Review','Confirmed',NULL,'2026-09-01T00:00:00.000Z')").run();
  const row = db.prepare("SELECT * FROM project_npq_profile_versions WHERE project_id=? AND status='Confirmed' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get("p1");
  assert.equal(row.id, "v2");
  assert.equal(row.primary_system, "CCTV");
  db.close();
  fs.rmSync(file, { force: true });
});

// ── PRIMARY_EDIT / ADDITIONAL_EDIT ──────────────────────────────────────────

test("PRIMARY_EDIT: changing Primary via addSystemToScope/removeSystemFromScope produces the correct buildOnboardingSystemsPayload", () => {
  let state = { scope: ["Fire Alarm"], primary: "Fire Alarm" };
  state = addSystemToScope(state, "CCTV");
  assert.deepEqual(state, { scope: ["Fire Alarm", "CCTV"], primary: "Fire Alarm" });
  state = removeSystemFromScope(state, "Fire Alarm");
  // Removing Primary deterministically promotes the next declared system.
  assert.deepEqual(state, { scope: ["CCTV"], primary: "CCTV" });
  const payload = buildOnboardingSystemsPayload(state);
  assert.deepEqual(payload, { primarySystem: "CCTV", additionalSystems: [] });
});

test("ADDITIONAL_EDIT: adding a second/third system keeps Primary stable and lists the rest as additionalSystems", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm");
  state = addSystemToScope(state, "CCTV");
  state = addSystemToScope(state, "Access Control");
  const payload = buildOnboardingSystemsPayload(state);
  assert.equal(payload.primarySystem, "Fire Alarm");
  assert.deepEqual(payload.additionalSystems, ["CCTV", "Access Control"]);
});

// ── OPEN_SYSTEM ──────────────────────────────────────────────────────────────

test("OPEN_SYSTEM: an unregistered system name (Intercom) is a fully valid declared system -- no SYSTEM_PACK whitelist anywhere in the edit path", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Intercom");
  assert.deepEqual(state, { scope: ["Intercom"], primary: "Intercom" });
  assert.ok(isValidScope(state));
  // The editor's add-system input has no whitelist filter -- only a
  // <datalist> of registeredSystems() as SUGGESTIONS, same as Create Project.
  assert.match(page, /list="scope-editor-system-suggestions"/);
  assert.doesNotMatch(page, /scopeEditorSystemsInScope.*SYSTEM_PACKS/s);
});

// ── ZERO_SYSTEMS ─────────────────────────────────────────────────────────────

test("ZERO_SYSTEMS: saveProjectScope blocks with a clear message when no system is declared", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.match(fn, /scopeEditorSystemsInScope\.length === 0/);
  assert.match(fn, /At least one declared system is required/);
});

// ── PRIMARY_MEMBERSHIP ───────────────────────────────────────────────────────

test("PRIMARY_MEMBERSHIP: saveProjectScope rejects a Primary that is not one of the declared systems, via the existing isValidScope contract", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.match(fn, /isValidScope\(\{ scope: scopeEditorSystemsInScope, primary: scopeEditorPrimary \}\)/);
  assert.match(fn, /Primary system must be one of the declared systems\./);
  // Same contract Create Project already uses -- no duplicated logic.
  assert.equal(isValidScope({ scope: ["Fire Alarm"], primary: "CCTV" }), false);
});

// ── PRIMARY_REMOVAL ──────────────────────────────────────────────────────────

test("PRIMARY_REMOVAL: removing the declared Primary deterministically promotes the next remaining declared system (reuses removeSystemFromScope, no duplicated logic)", () => {
  const state = { scope: ["Fire Alarm", "CCTV", "Access Control"], primary: "Fire Alarm" };
  const next = removeSystemFromScope(state, "Fire Alarm");
  assert.equal(next.primary, "CCTV");
  assert.deepEqual(next.scope, ["CCTV", "Access Control"]);
  assert.match(page, /const removeScopeEditorSystem = \(name: string\) => \{/);
  const fn = page.slice(page.indexOf("const removeScopeEditorSystem"), page.indexOf("const saveProjectScope"));
  assert.match(fn, /removeSystemFromScope\(/);
});

// ── DECLARED_VS_DISCOVERED ───────────────────────────────────────────────────

test("DECLARED_VS_DISCOVERED: OverviewWorkspace shows BOQ-only-discovered systems as a distinct, read-only 'Detected from evidence' group, never merged into editable declared chips", () => {
  assert.match(overview, /discoveredOnlySystems/);
  assert.match(overview, /Detected from evidence/);
  // The discovered-only computation subtracts declaredScope (NPQ primary +
  // additional) from resolvedSystems.systems -- it never reads or mutates
  // BOQ evidence itself.
  assert.match(overview, /const discoveredOnlySystems = \(resolvedSystems\?\.systems \|\| \[\]\)\.filter\(\s*\(sys\) => !declaredScope\.includes\(sys\)\s*\);/);
});

test("DECLARED_VS_DISCOVERED (isolated fixture): a BOQ-governing system not in NPQ declared scope appears in systems but not in declaredScope", () => {
  const resolved = resolveProjectSystems({
    systemComposition: { isDerived: true, systems: [{ system: "Electrical", itemCount: 12, governing: true }] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: [] },
    systemDomain: "Fire Alarm",
  });
  assert.deepEqual(resolved.systems.sort(), ["Electrical", "Fire Alarm"].sort());
  const declaredScope = ["Fire Alarm"];
  const discoveredOnly = resolved.systems.filter((s) => !declaredScope.includes(s));
  assert.deepEqual(discoveredOnly, ["Electrical"]);
});

// ── BOQ_EVIDENCE_PERSISTENCE ──────────────────────────────────────────────────

test("BOQ_EVIDENCE_PERSISTENCE: removing a declared system never touches BOQ evidence -- saveProjectScope's only DB writes are the NPQ draft/confirm endpoints", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.doesNotMatch(fn, /boq_items|boq-items|BOQ_ITEM|deleteBoqItem/i);
  assert.match(fn, /projectApi\.npq\(projectId, "draft"\)/);
  assert.match(fn, /projectApi\.npq\(projectId, "confirm"\)/);
});

test("BOQ_EVIDENCE_PERSISTENCE (isolated fixture): the resolver still surfaces a system as BOQ evidence after it is removed from NPQ declared scope", () => {
  // Before: Fire Alarm is both declared (NPQ) and BOQ-governing.
  const before = resolveProjectSystems({
    systemComposition: { isDerived: true, systems: [{ system: "Fire Alarm", itemCount: 40, governing: true }] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: [] },
  });
  assert.ok(before.systems.includes("Fire Alarm"));
  // After: NPQ declares CCTV instead -- BOQ evidence for Fire Alarm is
  // untouched (still governing:true) and resolveProjectSystems still shows
  // it, now with provenance BOQ_EVIDENCE only.
  const after = resolveProjectSystems({
    systemComposition: { isDerived: true, systems: [{ system: "Fire Alarm", itemCount: 40, governing: true }] },
    npqSystems: { primarySystem: "CCTV", additionalSystems: [] },
  });
  assert.ok(after.systems.includes("Fire Alarm"), "Fire Alarm BOQ evidence must still be visible");
  assert.ok(after.systems.includes("CCTV"));
  assert.equal(after.primarySystem, "CCTV");
});

test("ADDING a discovered system to declared scope does not create a duplicate member", () => {
  let state = { scope: ["Fire Alarm"], primary: "Fire Alarm" };
  // "Electrical" already exists as BOQ-evidence-only; declaring it too.
  state = addSystemToScope(state, "Electrical");
  state = addSystemToScope(state, "Electrical"); // re-add, should no-op
  assert.deepEqual(state.scope, ["Fire Alarm", "Electrical"]);
});

// ── NO_SYSTEM_DOMAIN_AUTHORITY ────────────────────────────────────────────────

test("NO_SYSTEM_DOMAIN_AUTHORITY: saveProjectScope does not rewrite projects.system_domain merely to sync it -- only a traced, narrow Technical-Matching compatibility exception, gated on an actual Primary change", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.match(fn, /if \(scopeEditorPrimary && scopeEditorPrimary !== scopeEditorOriginalPrimary\) \{/);
  assert.match(fn, /projectApi\.systemDomain\(projectId\)/);
  // The sync call is scoped to the Primary-changed branch only -- a
  // Declared-Scope-only save never reaches it.
  const syncBlock = fn.slice(fn.indexOf("if (scopeEditorPrimary && scopeEditorPrimary !== scopeEditorOriginalPrimary)"));
  assert.match(syncBlock, /systemDomain: scopeEditorPrimary/);
});

test("NO_SYSTEM_DOMAIN_AUTHORITY: Part 9 trace is documented in-source, naming the real active consumer found and why the fix is the smallest compatibility strategy", () => {
  assert.match(page, /suggestLinks\(\)/);
  assert.match(page, /resolveEffectiveRequirementSystem/);
  assert.match(page, /Matching\/Requirement domain logic itself is on the DO NOT TOUCH list/);
});

test("NO_SYSTEM_DOMAIN_AUTHORITY (isolated fixture): resolveProjectSystems's own Primary authority never reads projects.system_domain when NPQ primarySystem is present", () => {
  const resolved = resolveProjectSystems({
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: { primarySystem: "CCTV", additionalSystems: [] },
    systemDomain: "Fire Alarm", // stale legacy value, deliberately different
  });
  assert.equal(resolved.primarySystem, "CCTV");
});

test("the existing system-domain control reused for the Part 9 compatibility sync is already fully governed (role-gated, reason-required, audited) -- no new endpoint or schema", () => {
  assert.match(dashboardApi, /if \(operation === "system-domain"\) \{/);
  assert.match(dashboardApi, /audit\(env\.DB, projectId, "Project Primary System Set"/);
  assert.match(apiClient, /systemDomain: \(projectId: string\) =>/);
});

// ── SCOPE_CURRENT / SCOPE_LEGACY_READ / SCOPE_LEGACY_PRESERVE / SCOPE_LEGACY_REPLACE ──

test("SCOPE_CURRENT: the Declared Scope <select> is populated only from NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS", () => {
  const drawer = page.slice(page.indexOf('id="project-scope-editor-title"'), page.indexOf("{showSettings && ("));
  assert.match(drawer, /NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS\.map\(\(scope\) => \(/);
});

test("SCOPE_LEGACY_READ: a legacy confirmed value is displayed honestly as 'Current legacy value: ...', never silently replaced with Pending Tender Review", () => {
  const drawer = page.slice(page.indexOf('id="project-scope-editor-title"'), page.indexOf("{showSettings && ("));
  assert.match(drawer, /Current legacy value: \{scopeEditorDeliveryScope\}/);
  assert.match(drawer, /NPQ_DELIVERY_SCOPE_LEGACY_VALUES\.includes\(scopeEditorDeliveryScope\)/);
});

test("SCOPE_LEGACY_PRESERVE: saving Systems-only changes never forces a Declared Scope change -- scopeEditorDeliveryScope defaults to whatever openProjectScopeEditor hydrated, untouched unless the user picks a new option", () => {
  const openFn = page.slice(page.indexOf("const openProjectScopeEditor = async"), page.indexOf("const closeProjectScopeEditor"));
  assert.match(openFn, /setScopeEditorDeliveryScope\(\s*String\(profile\.deliveryScope \|\| NPQ_DELIVERY_SCOPE_UNRESOLVED\),?\s*\)/);
  const drawer = page.slice(page.indexOf('id="project-scope-editor-title"'), page.indexOf("{showSettings && ("));
  // The synthetic legacy option is `disabled` -- selecting it back is
  // impossible, so a legacy value only ever changes via an explicit pick of
  // a real NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS entry.
  assert.match(drawer, /<option value="__legacy__" disabled>/);
});

test("SCOPE_LEGACY_REPLACE: explicitly picking a current option calls setScopeEditorDeliveryScope with that new value, which then flows into the new confirmed version -- history preserves the old value because confirm always creates a new row, never an UPDATE of the prior one", () => {
  const drawer = page.slice(page.indexOf('id="project-scope-editor-title"'), page.indexOf("{showSettings && ("));
  assert.match(drawer, /onChange=\{\(event\) => \{\s*if \(event\.target\.value === "__legacy__"\) return;\s*setScopeEditorDeliveryScope\(event\.target\.value\);\s*\}\}/);
  // The prior Confirmed row is superseded, never UPDATEd in place.
  assert.match(npqApi, /UPDATE project_npq_profile_versions\s*\n\s*SET superseded_at=\?\s*\n\s*WHERE id=\?\s*\n\s*AND status='Confirmed'/);
});

// ── PENDING ──────────────────────────────────────────────────────────────────

test("PENDING: NPQ_DELIVERY_SCOPE_UNRESOLVED (Pending Tender Review) is never auto-set by this editor except as the closed/reset default state, and only becomes the saved value via the same explicit selection path as any other current option", () => {
  const closeFn = page.slice(page.indexOf("const closeProjectScopeEditor = () => {"), page.indexOf("const addScopeEditorSystem"));
  assert.match(closeFn, /setScopeEditorDeliveryScope\(NPQ_DELIVERY_SCOPE_UNRESOLVED\)/);
  // NPQ_DELIVERY_SCOPE_UNRESOLVED is itself one of NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS
  // (per Recovery C/C1) -- selecting it explicitly is a legitimate, non-magic choice.
  assert.ok(NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.includes(NPQ_DELIVERY_SCOPE_UNRESOLVED));
});

// ── NPQ_VERSIONING / NPQ_HISTORY ─────────────────────────────────────────────

test("NPQ_VERSIONING: save always goes draft -> confirm, never a direct UPDATE of the current confirmed version", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  const draftIdx = fn.indexOf('projectApi.npq(projectId, "draft")');
  const confirmIdx = fn.indexOf('projectApi.npq(projectId, "confirm")');
  assert.ok(draftIdx > -1 && confirmIdx > -1 && draftIdx < confirmIdx);
});

test("NPQ_VERSIONING: the server confirm handler itself never UPDATEs a Confirmed row directly -- it supersedes the previous Confirmed and promotes the Draft row (whose id is unrelated to the previous confirmed id) to Confirmed", () => {
  assert.match(npqApi, /UPDATE project_npq_profile_versions\s*\n\s*SET\s*\n\s*status='Confirmed',/);
  assert.match(npqApi, /WHERE id=\?\s*\n\s*AND status='Draft'\s*\n\s*AND superseded_at IS NULL/);
});

test("NPQ_HISTORY: GET .../npq/history returns every version (current + superseded), ordered newest-first, so the prior Declared Scope/Systems values remain inspectable", () => {
  assert.match(npqApi, /ORDER BY version_number DESC\s*\n\s*LIMIT 100/);
});

// ── UNEDITED_FIELD_PRESERVATION ──────────────────────────────────────────────

test("UNEDITED_FIELD_PRESERVATION: saveProjectScope spreads the full confirmed profile and overrides only primarySystem/additionalSystems/deliveryScope", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.match(fn, /const profile = \{\s*\.\.\.scopeEditorConfirmedProfile,\s*primarySystem: systemsPayload\.primarySystem,\s*additionalSystems: systemsPayload\.additionalSystems,\s*deliveryScope: scopeEditorDeliveryScope,\s*\};/);
});

test("UNEDITED_FIELD_PRESERVATION (isolated proof): spreading a full profile and overriding only 3 keys leaves every other field byte-identical", () => {
  const confirmedProfile = {
    country: "Saudi Arabia", city: "Riyadh", location: "Site A",
    contactTitle: "Mr.", contactName: "Ahmad", contactEmail: "a@example.com", contactPhone: "0500000000",
    primarySystem: "Fire Alarm", additionalSystems: [], deliveryScope: "Supply and Installation", scopeNotes: "",
    manufacturerStrategy: "Open Manufacturer", preferredManufacturer: "", approvedManufacturers: [], manufacturerNotes: "",
    pricingStrategy: "Price List", primaryPricingSourceType: "", primaryPricingSourceId: "", fallbackPricingSources: [],
    projectCurrency: "SAR", pricingNotes: "",
    expectedEvidence: ["BOQ"], boqAvailability: "Available", drawingAvailability: "Not Available",
  };
  const systemsPayload = buildOnboardingSystemsPayload({ scope: ["CCTV"], primary: "CCTV" });
  const nextProfile = {
    ...confirmedProfile,
    primarySystem: systemsPayload.primarySystem,
    additionalSystems: systemsPayload.additionalSystems,
    deliveryScope: "Pending Tender Review",
  };
  for (const key of Object.keys(confirmedProfile)) {
    if (["primarySystem", "additionalSystems", "deliveryScope"].includes(key)) continue;
    assert.deepEqual(nextProfile[key], confirmedProfile[key], `${key} must be preserved unchanged`);
  }
  assert.equal(nextProfile.projectCurrency, "SAR");
  assert.equal(nextProfile.contactTitle, "Mr.");
  assert.equal(nextProfile.contactName, "Ahmad");
});

// ── SERVER_REHYDRATION ────────────────────────────────────────────────────────

test("SERVER_REHYDRATION: after a successful confirm, saveProjectScope calls refreshProjectReadModels() (server re-fetch) before closing -- no purely local/optimistic state update", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  const confirmIdx = fn.indexOf('projectApi.npq(projectId, "confirm")');
  const refreshIdx = fn.indexOf("await refreshProjectReadModels();", confirmIdx);
  assert.ok(refreshIdx > confirmIdx, "refreshProjectReadModels must be called after confirm succeeds");
});

test("SERVER_REHYDRATION: resolveProjectSystems() is called fresh off serverProjectDashboard.project on every render, so a refreshed dashboard automatically reflects the newly confirmed version with no reload", () => {
  assert.match(page, /resolvedSystems=\{resolveProjectSystems\(serverProjectDashboard\.project\)\}/);
});

// ── QUOTATION_IMMUTABILITY / FUTURE_QUOTATION ────────────────────────────────

test("QUOTATION_IMMUTABILITY: saveProjectScope never touches project_quotation_revisions or any quotation endpoint", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.doesNotMatch(fn, /quotation/i);
});

test("FUTURE_QUOTATION: the quotation draft-creation snapshot (presales-workflow-api.mjs) reads the current confirmed NPQ at draft time -- a Systems/Scope edit is picked up automatically by the NEXT quotation draft, never by editing an existing one", () => {
  const presalesWorker = fs.readFileSync(new URL("../worker/presales-workflow-api.mjs", import.meta.url), "utf8");
  assert.match(presalesWorker, /const currentNpqContact=async\(db,projectId\)=>\{/);
  // currentNpqContact is read-only (a SELECT), called once at draft-creation
  // time to build the immutable snapshot -- it never itself writes to
  // project_quotation_revisions (any UPDATE of that table elsewhere in this
  // file belongs to the unrelated approve/issue supersession lifecycle).
  const fnBlock = presalesWorker.slice(presalesWorker.indexOf("const currentNpqContact=async"), presalesWorker.indexOf("const quotationState=async"));
  assert.doesNotMatch(fnBlock, /UPDATE|INSERT|DELETE/);
});

// ── AL_MOUSA (read-only, informational) ──────────────────────────────────────

test("AL MOUSA: real server-authoritative Systems/Scope values, read-only -- confirms the legacy-scope-safety UX this editor must show if opened on this project", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const projectId = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const project = db.prepare("SELECT name, system_domain FROM projects WHERE id=?").get(projectId);
  if (!project) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  const npq = db.prepare("SELECT primary_system, additional_systems_json, delivery_scope FROM project_npq_profile_versions WHERE project_id=? AND status='Confirmed' AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1").get(projectId);
  assert.equal(project.name, "Al Mousa School");
  assert.ok(npq, "Al Mousa must have a confirmed NPQ row");
  assert.equal(npq.primary_system, "Fire Alarm");
  assert.equal(npq.delivery_scope, "Supply and Installation", "the real historical legacy value this slice's editor must display honestly, not silently replace");
  assert.ok(NPQ_DELIVERY_SCOPE_LEGACY_VALUES.includes(npq.delivery_scope), "confirms this is genuinely a legacy (pre-C) value, not a current option");
  assert.ok(!NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.includes(npq.delivery_scope));
  const boqSystems = db.prepare(
    "SELECT DISTINCT system_value FROM boq_items WHERE project_id=? AND system_value IS NOT NULL AND system_value<>''"
  ).all(projectId);
  // Informational only -- no assertion on exact BOQ system rows required,
  // this just proves the read path used by the editor's Declared-vs-
  // Discovered distinction runs cleanly against the real fixture.
  assert.ok(Array.isArray(boqSystems));
  db.close();
});

// ── MULTI-SYSTEM EDIT FIXTURE ─────────────────────────────────────────────────

test("MULTI-SYSTEM FIXTURE: declaring Fire Alarm + CCTV + Intercom, with CCTV promoted to Primary, produces a valid, correctly-shaped save payload", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm");
  state = addSystemToScope(state, "CCTV");
  state = addSystemToScope(state, "Intercom");
  state.primary = "CCTV"; // simulating the Primary <select> onChange
  assert.ok(isValidScope(state));
  const payload = buildOnboardingSystemsPayload(state);
  assert.equal(payload.primarySystem, "CCTV");
  assert.deepEqual(payload.additionalSystems.sort(), ["Fire Alarm", "Intercom"].sort());
  const normalized = normalizeNpQProfile({
    primarySystem: payload.primarySystem,
    additionalSystems: payload.additionalSystems,
    projectCurrency: "SAR",
  });
  assert.equal(normalized.primarySystem, "CCTV");
  assert.deepEqual(normalized.additionalSystems.sort(), ["Fire Alarm", "Intercom"].sort());
});

// ── INDEPENDENCE (Part 29) ────────────────────────────────────────────────────

test("INDEPENDENCE: changing only Systems (not Declared Scope) preserves the existing deliveryScope value exactly, and vice versa", () => {
  const confirmedProfile = { primarySystem: "Fire Alarm", additionalSystems: [], deliveryScope: "Supply Materials Only" };
  const systemsOnlyPayload = buildOnboardingSystemsPayload({ scope: ["Fire Alarm", "CCTV"], primary: "Fire Alarm" });
  const systemsOnlySave = { ...confirmedProfile, primarySystem: systemsOnlyPayload.primarySystem, additionalSystems: systemsOnlyPayload.additionalSystems, deliveryScope: confirmedProfile.deliveryScope };
  assert.equal(systemsOnlySave.deliveryScope, "Supply Materials Only");
  const scopeOnlyPayload = buildOnboardingSystemsPayload({ scope: ["Fire Alarm"], primary: "Fire Alarm" });
  const scopeOnlySave = { ...confirmedProfile, primarySystem: scopeOnlyPayload.primarySystem, additionalSystems: scopeOnlyPayload.additionalSystems, deliveryScope: "Pending Tender Review" };
  assert.equal(scopeOnlySave.primarySystem, "Fire Alarm");
  assert.deepEqual(scopeOnlySave.additionalSystems, []);
});

// ── ERROR / VALIDATION UX ─────────────────────────────────────────────────────

test("ERROR UX: a stale-conflict save (confirmed version changed since the editor opened) is blocked with a clear message before any write", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.match(fn, /\(latest\.confirmed\?\.version \?\? null\) !== scopeEditorConfirmedVersion/);
  assert.match(fn, /The project's context changed since this editor opened\. Close and reopen to see the latest values before saving\./);
  // The staleness check runs BEFORE either draft or confirm is posted.
  const staleIdx = fn.indexOf("The project's context changed since this editor opened");
  const draftIdx = fn.indexOf('projectApi.npq(projectId, "draft")');
  assert.ok(staleIdx > -1 && draftIdx > -1 && staleIdx < draftIdx);
});

test("ERROR UX: a failed draft/confirm/save request surfaces scopeEditorError instead of throwing unhandled or silently closing the editor", () => {
  const fn = page.slice(page.indexOf("const saveProjectScope = async"), page.indexOf("const mutateQuotation = async"));
  assert.match(fn, /catch \(error\) \{\s*setScopeEditorError\(/);
});

test("ERROR UX: an unavailable/no-confirmed-context project shows a clear message instead of an empty or broken editor", () => {
  const openFn = page.slice(page.indexOf("const openProjectScopeEditor = async"), page.indexOf("const closeProjectScopeEditor"));
  assert.match(openFn, /No confirmed project context exists yet for this project\./);
  const drawer = page.slice(page.indexOf('id="project-scope-editor-title"'), page.indexOf("{showSettings && ("));
  assert.match(drawer, /!scopeEditorConfirmedProfile/);
});

// ── REGRESSION: Recovery A–E untouched ───────────────────────────────────────

test("REGRESSION: Recovery B's Create Project Systems-in-scope wizard block is untouched by this slice", () => {
  const wizardBlock = page.slice(page.indexOf('aria-labelledby="new-project-title"'), page.indexOf('{showProjectEditor && ('));
  assert.match(wizardBlock, /Systems in scope \*/);
  assert.match(wizardBlock, /Primary system/);
});

test("REGRESSION: resolveProjectSystems()'s Primary authority precedence (Recovery B1) is unchanged", () => {
  assert.match(registry, /const npqPrimary = String\(npq\?\.primarySystem \|\| ""\)\.trim\(\);/);
  assert.match(registry, /const primarySystem = npqPrimary && systemsByName\.has\(npqPrimary\)/);
});

test("REGRESSION: isGoverningBoqSystemEvidence (Recovery B1) is reused, not reimplemented, by this slice's declared-vs-discovered split", () => {
  assert.equal(isGoverningBoqSystemEvidence({ category: "Cable", systemSourceType: "INFERRED" }), false);
  assert.equal(isGoverningBoqSystemEvidence({ category: "Detector", systemSourceType: "INFERRED" }), true);
  assert.equal(isGoverningBoqSystemEvidence({ category: null, systemSourceType: "EXTRACTED" }), true);
});

// ── NO SCHEMA CHANGE (Part 32) ────────────────────────────────────────────────

test("NO SCHEMA CHANGE: this slice introduces no CREATE TABLE / ALTER TABLE / new migration file", () => {
  assert.doesNotMatch(page, /CREATE TABLE|ALTER TABLE/);
  const dir = fs.readdirSync(new URL("../drizzle-active", import.meta.url));
  const numbered = dir.filter((f) => /^\d{4}_/.test(f)).sort();
  // This is a FROZEN SLICE PIN, not the active-chain authority. It records the
  // chain exactly as it stood when Onboarding F landed, plus the governed
  // successors appended since. It is deliberately a literal, because the point
  // of the guard is "this slice added nothing", which is only checkable against a
  // fixed list.
  //
  // It must be advanced deliberately whenever the chain grows, and it was NOT
  // advanced for 0011 -- which is how it went red against a chain that was
  // correct. The self-maintaining chain authority is
  // tests/migration-baseline-safety.test.mjs, which derives the head from the
  // Drizzle journal and compares the journal, the on-disk SQL set, the snapshots
  // and drizzle-active/manifest.json against each other. Do not treat a failure
  // here as a schema problem until that gate has been consulted.
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
    "0011_requirement_intelligence_constraint_restore.sql",
  ], "this slice added no migration; the active chain is exactly the frozen baseline plus the governed 0001-0011 authority migrations");
});

// ── NO LIVE DATA MUTATION ─────────────────────────────────────────────────────

test("NO DATA MUTATION: this file only reads the live DB read-only; isolated fixtures use their own temp files", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const liveDbSection = source.split("dbPath =");
  for (const chunk of liveDbSection.slice(1)) {
    const nextTest = chunk.indexOf('test("');
    const scoped = nextTest === -1 ? chunk : chunk.slice(0, nextTest);
    assert.doesNotMatch(scoped, /\.run\(|\.exec\(/);
  }
  assert.match(source, /readOnly:\s*true/);
});
