import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  DUE_SOON_WINDOW_DAYS,
  evaluateProjectDueState,
  isOverdueDueDate,
  isDueSoonDueDate,
  buildDueFilterClause,
  normalizeDueFilter,
  todayDay,
  soonDay,
} from "../app/domain/project-due-policy.mjs";
import { deriveProjectDashboard } from "../app/domain/dashboard-workflow-engine.mjs";

const api = fs.readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const policySrc = fs.readFileSync(new URL("../app/domain/project-due-policy.mjs", import.meta.url), "utf8");

// Fixed "today" for deterministic boundary tests: 2026-09-20.
const TODAY = "2026-09-20";
const dayPlus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test("due window is seven calendar days", () => {
  assert.equal(DUE_SOON_WINDOW_DAYS, 7);
  assert.equal(soonDay(Date.parse(`${TODAY}T00:00:00Z`)), dayPlus(7));
});

test("boundary dates: yesterday overdue, today due soon, +7 due soon, +8 not, null/blank none", () => {
  assert.equal(evaluateProjectDueState(dayPlus(-1), TODAY), "OVERDUE");
  assert.equal(evaluateProjectDueState(TODAY, TODAY), "DUE_SOON");
  assert.equal(evaluateProjectDueState(dayPlus(7), TODAY), "DUE_SOON");
  assert.equal(evaluateProjectDueState(dayPlus(8), TODAY), "NOT_DUE_SOON");
  assert.equal(evaluateProjectDueState(null, TODAY), "NO_DUE_DATE");
  assert.equal(evaluateProjectDueState("", TODAY), "NO_DUE_DATE");
  assert.equal(evaluateProjectDueState("   ", TODAY), "NO_DUE_DATE");
  assert.equal(evaluateProjectDueState("not-a-date", TODAY), "NO_DUE_DATE");
  assert.equal(isOverdueDueDate(dayPlus(-30), TODAY), true);
  assert.equal(isDueSoonDueDate(TODAY, TODAY), true);
  assert.equal(isDueSoonDueDate(dayPlus(-1), TODAY), false);
});

test("invalid due values never build a clause (no silent narrowing)", () => {
  for (const bad of ["bogus", "SOON", "Overdue", "all", "null", "undefined", "soon "] ) {
    assert.equal(buildDueFilterClause(bad, TODAY, dayPlus(7)), null);
    assert.equal(normalizeDueFilter(bad), "");
  }
  assert.equal(normalizeDueFilter("soon"), "soon");
  assert.equal(normalizeDueFilter("overdue"), "overdue");
  assert.equal(normalizeDueFilter(""), "");
});

test("clause builder emits the canonical project-level predicate", () => {
  assert.deepEqual(buildDueFilterClause("soon", TODAY, dayPlus(7)), {
    clause: "dp.due_date IS NOT NULL AND dp.due_date != '' AND dp.due_date >= ? AND dp.due_date <= ?",
    params: [TODAY, dayPlus(7)],
  });
  assert.deepEqual(buildDueFilterClause("overdue", TODAY, dayPlus(7)), {
    clause: "dp.due_date IS NOT NULL AND dp.due_date != '' AND dp.due_date < ?",
    params: [TODAY],
  });
});

// --- backend filtering against a real SQLite register-shaped query ---
const seedRegister = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, archived_at TEXT, operational_classification TEXT, owner_user_id TEXT, system_domain TEXT, initial_status TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE project_dashboard_profiles (project_id TEXT PRIMARY KEY, due_date TEXT, manual_status TEXT, deleted_at TEXT)");
  const rows = [
    // id, name, due, status, system, classification
    ["p-overdue", "Overdue Ops", dayPlus(-3), "Active", "Fire Alarm", "Operational"],
    ["p-today", "Today Ops", TODAY, "Draft", "Fire Alarm", "Operational"],
    ["p-boundary", "Boundary Ops", dayPlus(7), "Active", "CCTV", "Operational"],
    ["p-beyond", "Beyond Ops", dayPlus(8), "Active", "Fire Alarm", "Operational"],
    ["p-nodate", "No Date Ops", null, "Active", "Fire Alarm", "Operational"],
    ["p-test", "TesT", dayPlus(-1), "Active", "Fire Alarm", "Test Fixture"],
  ];
  const insP = db.prepare("INSERT INTO projects VALUES (?, ?, 'org-1', NULL, ?, 'u1', ?, ?, '2026-09-20')");
  const insD = db.prepare("INSERT INTO project_dashboard_profiles VALUES (?, ?, ?, NULL)");
  for (const [id, name, due, status, system, cls] of rows) {
    insP.run(id, name, cls, system, status);
    insD.run(id, due, null);
  }
  return db;
};

const runRegister = (db, { due = "", status = "", system = "", hideTest = true, q = "" } = {}) => {
  const conditions = ["p.organization_id = 'org-1'", "p.archived_at IS NULL", "dp.deleted_at IS NULL"];
  const params = [];
  if (q) { conditions.push("(p.name LIKE ?)"); params.push(`%${q}%`); }
  if (status) { conditions.push("COALESCE(dp.manual_status, p.initial_status) = ?"); params.push(status); }
  if (system) { conditions.push("p.system_domain = ?"); params.push(system); }
  if (hideTest) { conditions.push("p.operational_classification = 'Operational'"); }
  const clause = buildDueFilterClause(due, TODAY, dayPlus(7));
  if (clause) { conditions.push(clause.clause); params.push(...clause.params); }
  const found = db.prepare(`SELECT p.id FROM projects p LEFT JOIN project_dashboard_profiles dp ON dp.project_id=p.id WHERE ${conditions.join(" AND ")} ORDER BY p.id`).all(...params);
  return [...new Map(found.map((r) => [r.id, r])).values()].map((r) => r.id);
};

test("backend due=soon returns exactly the due-soon projects, once each", () => {
  const db = seedRegister(); db.closeAfter?.();
  assert.deepEqual(runRegister(db, { due: "soon" }), ["p-boundary", "p-today"]);
  db.close();
});

test("backend due=overdue returns exactly the overdue projects, once each", () => {
  const db = seedRegister();
  assert.deepEqual(runRegister(db, { due: "overdue" }), ["p-overdue"]);
  db.close();
});

test("null due dates never appear in due filters", () => {
  const db = seedRegister();
  assert.ok(!runRegister(db, { due: "soon" }).includes("p-nodate"));
  assert.ok(!runRegister(db, { due: "overdue" }).includes("p-nodate"));
  db.close();
});

test("due composes with status, system, q and hideTest", () => {
  const db = seedRegister();
  assert.deepEqual(runRegister(db, { due: "overdue", status: "Active" }), ["p-overdue"]);
  assert.deepEqual(runRegister(db, { due: "overdue", status: "Draft" }), []);
  assert.deepEqual(runRegister(db, { due: "soon", system: "CCTV" }), ["p-boundary"]);
  assert.deepEqual(runRegister(db, { due: "soon", system: "Fire Alarm" }), ["p-today"]);
  assert.deepEqual(runRegister(db, { due: "soon", q: "Today" }), ["p-today"]);
  assert.deepEqual(runRegister(db, { due: "overdue", hideTest: false }), ["p-overdue", "p-test"]);
  assert.deepEqual(runRegister(db, { due: "overdue", hideTest: true }), ["p-overdue"]);
  db.close();
});

test("CONSISTENCY: Home metric counts equal filtered unique project sets on the same dataset", () => {
  const dataset = [
    { id: "a", dueDate: dayPlus(-5) },
    { id: "b", dueDate: TODAY },
    { id: "c", dueDate: dayPlus(7) },
    { id: "d", dueDate: dayPlus(8) },
    { id: "e", dueDate: null },
    { id: "f", dueDate: "" },
  ];
  const metricSoon = dataset.filter((p) => evaluateProjectDueState(p.dueDate, TODAY) === "DUE_SOON").length;
  const metricOverdue = dataset.filter((p) => evaluateProjectDueState(p.dueDate, TODAY) === "OVERDUE").length;
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, archived_at TEXT, operational_classification TEXT, owner_user_id TEXT, system_domain TEXT, initial_status TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE project_dashboard_profiles (project_id TEXT PRIMARY KEY, due_date TEXT, manual_status TEXT, deleted_at TEXT)");
  for (const p of dataset) {
    db.prepare("INSERT INTO projects VALUES (?, ?, 'org-1', NULL, 'Operational', 'u1', 'Fire Alarm', 'Active', 'x')").run(p.id, p.id);
    db.prepare("INSERT INTO project_dashboard_profiles VALUES (?, ?, NULL, NULL)").run(p.id, p.dueDate);
  }
  const runDue = (due) => {
    const clause = buildDueFilterClause(due, TODAY, dayPlus(7));
    const rows = db.prepare(`SELECT p.id FROM projects p LEFT JOIN project_dashboard_profiles dp ON dp.project_id=p.id WHERE p.organization_id='org-1' AND ${clause.clause}`).all(...clause.params);
    return [...new Set(rows.map((r) => r.id))];
  };
  assert.equal(runDue("soon").length, metricSoon);
  assert.equal(runDue("overdue").length, metricOverdue);
  assert.deepEqual([...runDue("soon")].sort(), ["b", "c"]);
  assert.deepEqual(runDue("overdue"), ["a"]);
  db.close();
});

// --- lifecycle independence: due passage mutates nothing ---
test("LIFECYCLE: due states are scheduling-only; the policy exposes no lifecycle mutation", () => {
  assert.ok(!/\b(UPDATE|INSERT|DELETE|SET)\b/i.test(policySrc), "policy module performs no writes of any kind");
  assert.ok(!/manual_status|archived_at|operational_classification|initial_status\s*=/.test(policySrc), "policy module touches no lifecycle field");
  const code = policySrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/deriveProjectDashboard|workspace|matching|pricing|quotation|bom/i.test(code), "policy module gates no workflow");
  for (const state of ["OVERDUE", "DUE_SOON", "NOT_DUE_SOON", "NO_DUE_DATE"]) {
    assert.ok(!["Draft", "Active", "On Hold", "Won", "Lost", "Cancelled", "Archived"].includes(state));
  }
});

test("LIFECYCLE: Active + Overdue remains Active in dashboard derivation", () => {
  const facts = { documents: 4, classified: 4, processing: 0, failedJobs: 0, boqItems: 20, extractionReview: 0, specificationExtractions: 1 };
  const base = { id: "p1", name: "Late but live", organizationId: "org-1", systemDomain: "Fire Alarm", initialStatus: "Active" };
  const overdue = deriveProjectDashboard({ project: { ...base, dueDate: dayPlus(-30) }, facts });
  const future = deriveProjectDashboard({ project: { ...base, dueDate: dayPlus(30) }, facts });
  const nodate = deriveProjectDashboard({ project: { ...base, dueDate: null }, facts });
  assert.equal(evaluateProjectDueState(dayPlus(-30), TODAY), "OVERDUE");
  assert.equal(overdue.project.status, future.project.status, "due passage must not move status");
  assert.equal(overdue.project.status, nodate.project.status, "due presence must not move status");
});

test("LIFECYCLE: Draft + Overdue remains Draft; no workspace or workflow gate fires on due state alone", () => {
  const facts = { documents: 0, classified: 0, processing: 0, failedJobs: 0, boqItems: 0, extractionReview: 0, specificationExtractions: 0 };
  const base = { id: "p2", name: "Draft and late", organizationId: "org-1", systemDomain: "Fire Alarm", initialStatus: "Draft" };
  const overdue = deriveProjectDashboard({ project: { ...base, dueDate: dayPlus(-1) }, facts });
  const future = deriveProjectDashboard({ project: { ...base, dueDate: dayPlus(30) }, facts });
  assert.equal(overdue.project.status, "Draft");
  assert.equal(overdue.project.status, future.project.status, "due passage must not move status");
  assert.ok(overdue.workflow, "workflow derivation still runs for an overdue project");
});

test("LIFECYCLE: advancing calendar past a due date changes only the scheduling state", () => {
  const due = dayPlus(3);
  assert.equal(evaluateProjectDueState(due, TODAY), "DUE_SOON");
  assert.equal(evaluateProjectDueState(due, dayPlus(4)), "OVERDUE");
});

// --- wiring: backend uses the shared policy; invalid due echoes honestly ---
test("backend organizationProjects applies the shared due clause for soon/overdue", () => {
  assert.match(api, /buildDueFilterClause\(due, today, soon\)/);
  assert.match(api, /evaluateProjectDueState\(p\.project\.dueDate, today\)/);
  assert.match(api, /normalizeDueFilter\(/);
});

test("backend echoes normalized due alongside other filters", () => {
  assert.match(api, /filters: \{ status, system, risk, hideTest, due[^}]*\}/);
});

// --- frontend: tiles, register control, URL truth, restoration ---
//
// UI RECOVERY -- HOME DUE TILE ROUTING REPAIR corrected this test's own
// premise. This slice's later, deliberate "Home is a compact executive
// snapshot" simplification (tests/phase5c-ux-journey.test.mjs) intentionally
// removed the "Due soon" Home tile while keeping it reachable via the
// Projects register filter and API -- that is current, still-enforced
// product intent, not a regression. This test originally asserted the
// PRE-Phase-5C contract (both tiles on Home) and had simply never been
// updated after that later decision; it now asserts the current one instead
// of re-litigating it.
test("HOME: Overdue tile is clickable with the matching destination; Due soon is deliberately not a Home tile (Phase 5C) but remains reachable elsewhere", () => {
  assert.match(page, /\{ label: "Overdue", key: "projectsOverdue", route: "due=overdue", clickable: true \}/);
  assert.doesNotMatch(page, /label: "Overdue"[^}]*clickable: false/);
  assert.doesNotMatch(page, /\{ label: "Due soon", key: "projectsDueSoon"/, "Phase 5C deliberately excluded this Home tile -- see tests/phase5c-ux-journey.test.mjs");
  // The destination side (Projects register + API) is untouched and intact
  // -- Due soon is still a first-class, fully governed filter, just not a
  // dedicated Home summary tile.
  assert.match(page, /<option value="soon">Due soon<\/option>/);
});

test("PROJECTS REGISTER: Due filter renders All/Due soon/Overdue and updates the URL", () => {
  assert.match(page, /<span>Due<\/span>/);
  assert.match(page, /<option value="soon">Due soon<\/option>/);
  assert.match(page, /<option value="overdue">Overdue<\/option>/);
  assert.match(page, /updateProjectsUrl\(\{ due: value \|\| undefined \}\)/);
});

test("URL remains source of truth: fetch sends due, init and popstate restore it", () => {
  assert.match(page, /if \(projectDueFilter\) params\.set\("due", projectDueFilter\)/);
  assert.match(page, /setProjectDueFilter\(query\.get\("due"\) \|\| ""\)/);
});

// ── UI RECOVERY -- HOME DUE TILE ROUTING REPAIR ─────────────────────────────
//
// ROOT CAUSE (traced, then re-verified against the fuller regression suite,
// not assumed): root cause E -- a STALE test expectation, not a missing
// feature. The failing test above ("HOME: Due soon and Overdue tiles...")
// asserted the ORIGINAL Slice 3/3A contract (both tiles on Home). A LATER,
// deliberate, still-enforced decision (tests/phase5c-ux-journey.test.mjs,
// "Home is a compact executive snapshot") intentionally removed the "Due
// soon" Home tile while explicitly keeping it reachable via the Projects
// register filter and API -- confirmed by that file's own test, "Due soon
// is excluded from the Home summary but remains available via Projects
// filter and API". Re-adding the tile (the first fix attempted here) was
// wrong and was reverted after running the fuller Home/UX regression group
// surfaced the conflict -- reintroducing it would have broken Phase 5C's
// own, still-passing, still-intended contract.
//
// A genuine, separate, narrower defect DID survive from the original bug:
// the tiles' shared onClick handler only ever called
// window.history.pushState (a cosmetic URL update for shareability) -- it
// never called setProjectDueFilter, so even the still-present "Overdue"
// tile did not actually hydrate the Projects register's due filter state
// (the one the fetch effect and <select> both read from). THAT is the one
// change made to source: a minimal, generic `due=` hydration line in the
// shared click handler. Active/Blocked/Ready for quotation keep whatever
// pre-existing (unreported, out of scope) behavior they already had.

test("OVERDUE_TILE: the shared Home tile click handler hydrates projectDueFilter to 'overdue' for the Overdue tile", () => {
  const gridBlock = page.slice(page.indexOf('className="organization-metric-grid home-metric-grid"'), page.indexOf('</div></>}', page.indexOf('className="organization-metric-grid home-metric-grid"')));
  assert.match(gridBlock, /if \(route\.startsWith\("due="\)\) setProjectDueFilter\(route\.slice\(4\)\);/);
});

test("DUE_SOON_TILE: Due soon is intentionally absent from the Home tile array (Phase 5C), and the generic due= hydration fix does not reintroduce it", () => {
  const gridBlock = page.slice(page.indexOf('className="organization-metric-grid home-metric-grid"'), page.indexOf('</div></>}', page.indexOf('className="organization-metric-grid home-metric-grid"')));
  assert.doesNotMatch(gridBlock, /label: "Due soon"/);
  const overdueIdx = gridBlock.indexOf('{ label: "Overdue", key: "projectsOverdue", route: "due=overdue", clickable: true }');
  assert.ok(overdueIdx > -1, "Overdue remains the one due-related Home tile");
});

test("FILTER_HYDRATION: clicking the Overdue tile sets BOTH the URL (shareable) and the projectDueFilter React state the Projects register/fetch effect actually reads -- not just a cosmetic URL update", () => {
  const gridBlock = page.slice(page.indexOf('className="organization-metric-grid home-metric-grid"'), page.indexOf('</div></>}', page.indexOf('className="organization-metric-grid home-metric-grid"')));
  const setStateIdx = gridBlock.search(/if \(route\.startsWith\("due="\)\) setProjectDueFilter\(route\.slice\(4\)\);/);
  const pushStateIdx = gridBlock.indexOf("window.history.pushState(null, \"\", buildGlobalLocation(\"Projects\") + `&${route}`)");
  assert.ok(setStateIdx > -1 && pushStateIdx > -1, "both the state hydration and the URL push must exist in the same handler");
  assert.ok(setStateIdx < pushStateIdx, "state is hydrated before the URL push, so the very next render is already consistent");
  // The <select>'s value prop reads projectDueFilter directly -- proving
  // the same state variable the tile now hydrates is what the visible
  // control (and, per the existing "URL remains source of truth" test
  // above, the fetch effect) actually renders/uses.
  assert.match(page, /value=\{projectDueFilter\}/);
});

test("POLICY_REUSE: the Home tile fix introduces no second due implementation -- projectsDueSoon/projectsOverdue are still computed by the one shared evaluateProjectDueState() policy", () => {
  assert.match(api, /projectsDueSoon: allProjects\.filter\(\(p\) => evaluateProjectDueState\(p\.project\.dueDate, today\) === "DUE_SOON"\)\.length/);
  assert.match(api, /projectsOverdue: allProjects\.filter\(\(p\) => evaluateProjectDueState\(p\.project\.dueDate, today\) === "OVERDUE"\)\.length/);
  // Still exactly one definition of the policy -- this fix did not fork it.
  const definitionCount = (policySrc.match(/export const evaluateProjectDueState = /g) || []).length;
  assert.equal(definitionCount, 1);
});

test("OVERDUE_NOT_LIFECYCLE: this fix touches only navigation/filter-state wiring -- no lifecycle, status, archival or readiness code was changed", () => {
  const gridBlock = page.slice(page.indexOf('className="organization-metric-grid home-metric-grid"'), page.indexOf('</div></>}', page.indexOf('className="organization-metric-grid home-metric-grid"')));
  assert.doesNotMatch(gridBlock, /setStatus|archived_at|lifecycleState|workflowStatus|operationalClassification/);
});

test("AL MOUSA (read-only): the project with due_date 2026-09-15 classifies as Overdue under the unchanged policy, and remains readable/operational -- not mutated by this fix", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const projectId = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const project = db.prepare("SELECT name, archived_at FROM projects WHERE id=?").get(projectId);
  if (!project) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  const dp = db.prepare("SELECT due_date FROM project_dashboard_profiles WHERE project_id=?").get(projectId);
  const dueDate = dp?.due_date;
  assert.equal(project.name, "Al Mousa School");
  assert.equal(dueDate, "2026-09-15");
  const todayForTest = "2026-09-22"; // today per this session's system reminder
  assert.equal(evaluateProjectDueState(dueDate, todayForTest), "OVERDUE");
  assert.equal(project.archived_at, null, "Overdue must never archive a project -- read-only confirmation");
  db.close();
});

test("NO LIVE MUTATION: this repair's own tests never write to the live dev DB", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const liveDbSection = source.split("dbPath =");
  for (const chunk of liveDbSection.slice(1)) {
    const nextTest = chunk.indexOf('test("');
    const scoped = nextTest === -1 ? chunk : chunk.slice(0, nextTest);
    assert.doesNotMatch(scoped, /\.run\(|\.exec\(/);
  }
  assert.match(source, /readOnly:\s*true/);
});
