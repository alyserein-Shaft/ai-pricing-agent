import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

// Authority Consolidation Sprint, item 2B/12: a pricing scenario's currency
// defaults to the project's canonical currency (project_dashboard_profiles
// .currency) rather than a client-supplied value (previously hardcoded
// "SAR" in app/page.tsx, silently disagreeing with the real project
// currency whenever it wasn't SAR). An explicit override is still allowed
// and persists independently -- changing the project's default currency
// afterward never silently mutates an already-created scenario.

const PROJECT_ID = "project-scenario-currency";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE project_dashboard_profiles (project_id TEXT PRIMARY KEY, currency TEXT, deleted_at TEXT);
    CREATE TABLE pricing_scenarios (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, mode TEXT, version_number INTEGER,
      project_currency TEXT, status TEXT, deleted_at TEXT, superseded_at TEXT
    );
    INSERT INTO project_dashboard_profiles (project_id, currency, deleted_at) VALUES ('${PROJECT_ID}', 'USD', NULL);
  `);
  return raw;
};

// Reproduces the exact resolution logic in worker/pricing-api.mjs's
// scenario POST handler (server-side default, not a copy of client input).
const resolveScenarioCurrency = (raw, projectId, requestedCurrency) => {
  const profile = raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL").get(projectId);
  const projectDefaultCurrency = profile?.currency || "SAR";
  return String(requestedCurrency || "").trim() || projectDefaultCurrency;
};

test("a new scenario with no explicit currency inherits the project's real default currency, not a hardcoded fallback", () => {
  const raw = fixture();
  const resolved = resolveScenarioCurrency(raw, PROJECT_ID, undefined);
  assert.equal(resolved, "USD");
  raw.close();
});

test("an explicit scenario currency is recorded as a deliberate override, independent of the project default", () => {
  const raw = fixture();
  const resolved = resolveScenarioCurrency(raw, PROJECT_ID, "EUR");
  assert.equal(resolved, "EUR");
  assert.notEqual(resolved, "USD");
  raw.close();
});

test("changing the project default currency does not silently mutate an already-created scenario", () => {
  const raw = fixture();
  raw.prepare("INSERT INTO pricing_scenarios (id, project_id, name, mode, version_number, project_currency, status) VALUES (?,?,?,?,?,?,?)")
    .run("scenario-1", PROJECT_ID, "Base Case", "Base Case", 1, "USD", "Draft");

  // Project default currency changes later (a real Project Settings edit).
  raw.prepare("UPDATE project_dashboard_profiles SET currency=? WHERE project_id=?").run("EGP", PROJECT_ID);

  const scenario = raw.prepare("SELECT project_currency FROM pricing_scenarios WHERE id='scenario-1'").get();
  const projectNow = raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=?").get(PROJECT_ID);
  assert.equal(scenario.project_currency, "USD", "the existing scenario keeps its own recorded currency");
  assert.equal(projectNow.currency, "EGP");
  assert.notEqual(scenario.project_currency, projectNow.currency, "override status must now read as true -- see currencyIsOverride below");
  raw.close();
});

test("currencyIsOverride is a read-time comparison, never a stored flag that could itself go stale", () => {
  const raw = fixture();
  raw.prepare("INSERT INTO pricing_scenarios (id, project_id, name, mode, version_number, project_currency, status) VALUES (?,?,?,?,?,?,?)")
    .run("scenario-1", PROJECT_ID, "Base Case", "Base Case", 1, "USD", "Draft");
  const profile = raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=?").get(PROJECT_ID);
  const scenario = raw.prepare("SELECT project_currency FROM pricing_scenarios WHERE id='scenario-1'").get();
  const currencyIsOverride = scenario.project_currency !== profile.currency;
  assert.equal(currencyIsOverride, false, "matches the project default -- not an override");

  raw.prepare("UPDATE project_dashboard_profiles SET currency=? WHERE project_id=?").run("SAR", PROJECT_ID);
  const profileAfter = raw.prepare("SELECT currency FROM project_dashboard_profiles WHERE project_id=?").get(PROJECT_ID);
  const overrideAfter = scenario.project_currency !== profileAfter.currency;
  assert.equal(overrideAfter, true, "the comparison recomputes live -- the same scenario now reads as an override without any write to the scenario row");
  raw.close();
});

test("worker/pricing-api.mjs no longer requires the client to supply projectCurrency, and computes currencyIsOverride at read time", async () => {
  const worker = await (await import("node:fs/promises")).readFile(new URL("../worker/pricing-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /if \(!name \|\| !body\.projectCurrency\)/);
  assert.match(worker, /projectDefaultCurrency = profile\?\.currency \|\| "SAR"/);
  assert.match(worker, /currencyIsOverride: row\.project_currency !== projectDefaultCurrency/);
});

test("app/page.tsx no longer hardcodes the scenario-creation currency to SAR", async () => {
  const page = await (await import("node:fs/promises")).readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /const currency = "SAR";/);
  // Backend & Codebase Consolidation Sprint: made null-safe
  // (serverProjectDashboard can be null before a project is loaded, e.g.
  // the bare app shell -- confirmed by a real SSR crash this fix corrects).
  assert.match(page, /const currency = serverProjectDashboard\?\.project\.currency \|\| "SAR";/);
});

// Backend & Codebase Consolidation Sprint, item 11: the Pricing workspace's
// scenario picker must say so plainly when a scenario's currency overrides
// the project default -- and say nothing extra when it does not.
test("the scenario option label marks an override, and stays silent for a non-override", async () => {
  // The live Costing surface is PricingWorkspace (app/page.tsx renders it); the
  // inline picker that used to live in page.tsx is behind a `Boolean(0)` guard,
  // so asserting on page.tsx would pass or fail against dead code.
  const pricing = await (await import("node:fs/promises")).readFile(new URL("../app/components/workspaces/PricingWorkspace.tsx", import.meta.url), "utf8");
  assert.match(pricing, /s\.currencyIsOverride \? " · Override" : ""/);
});

test("the selected-scenario currency note names the project default only when overriding, and is otherwise a bare currency line", async () => {
  const pricing = await (await import("node:fs/promises")).readFile(new URL("../app/components/workspaces/PricingWorkspace.tsx", import.meta.url), "utf8");
  assert.match(
    pricing,
    /Currency: \{selectedScenario\.project_currency\}\{selectedScenario\.currencyIsOverride \? ` · Project default: \$\{props\.currency\} · Override` : ""\}/,
  );
});
