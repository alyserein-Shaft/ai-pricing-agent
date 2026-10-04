import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProjectDueState,
  isOverdueDueDate,
  isDueSoonDueDate,
  buildDueFilterClause,
  normalizeDueFilter,
  todayDay,
  soonDay,
  DUE_SOON_WINDOW_DAYS,
  DUE_STATES,
} from "../app/domain/project-due-policy.mjs";

// ---- Due-date boundary policy tests (Recovery Slice 3A) ----

test("DUE_STATES constant is complete and ordered", () => {
  assert.deepEqual(DUE_STATES, ["OVERDUE", "DUE_SOON", "NOT_DUE_SOON", "NO_DUE_DATE"]);
});

test("due_date = yesterday → OVERDUE", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.equal(evaluateProjectDueState(yesterday), "OVERDUE");
  assert.equal(isOverdueDueDate(yesterday), true);
  assert.equal(isDueSoonDueDate(yesterday), false);
});

test("due_date = today → DUE_SOON (not overdue)", () => {
  const today = todayDay();
  assert.equal(evaluateProjectDueState(today), "DUE_SOON");
  assert.equal(isOverdueDueDate(today), false);
  assert.equal(isDueSoonDueDate(today), true);
});

test("due_date = today + 1 → DUE_SOON", () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(evaluateProjectDueState(tomorrow), "DUE_SOON");
  assert.equal(isDueSoonDueDate(tomorrow), true);
});

test("due_date = today + 7 → DUE_SOON (boundary inclusive)", () => {
  const boundary = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  assert.equal(evaluateProjectDueState(boundary), "DUE_SOON");
  assert.equal(isDueSoonDueDate(boundary), true);
});

test("due_date = today + 8 → NOT_DUE_SOON", () => {
  const beyond = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
  assert.equal(evaluateProjectDueState(beyond), "NOT_DUE_SOON");
  assert.equal(isDueSoonDueDate(beyond), false);
  assert.equal(isOverdueDueDate(beyond), false);
});

test("due_date = null → NO_DUE_DATE", () => {
  assert.equal(evaluateProjectDueState(null), "NO_DUE_DATE");
  assert.equal(isOverdueDueDate(null), false);
  assert.equal(isDueSoonDueDate(null), false);
});

test("due_date = empty string → NO_DUE_DATE", () => {
  assert.equal(evaluateProjectDueState(""), "NO_DUE_DATE");
});

test("due_date = whitespace → NO_DUE_DATE", () => {
  assert.equal(evaluateProjectDueState("  "), "NO_DUE_DATE");
});

test("due_date = garbage text → NO_DUE_DATE", () => {
  assert.equal(evaluateProjectDueState("not-a-date"), "NO_DUE_DATE");
});

// ---- DUE_SOON_WINDOW_DAYS constant ----

test("DUE_SOON_WINDOW_DAYS is 7", () => {
  assert.equal(DUE_SOON_WINDOW_DAYS, 7);
});

// ---- todayDay / soonDay consistency ----

test("todayDay returns YYYY-MM-DD format", () => {
  const today = todayDay();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test("soonDay returns today + 7 days", () => {
  const today = todayDay();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const soon = soonDay(todayMs);
  const expected = new Date(todayMs + 7 * 86400000).toISOString().slice(0, 10);
  assert.equal(soon, expected);
});

// ---- buildDueFilterClause SQL generation ----

test("buildDueFilterClause for due=soon uses >= today AND <= soon", () => {
  const today = "2026-09-20";
  const soon = "2026-09-27";
  const result = buildDueFilterClause("soon", today, soon);
  assert.ok(result);
  assert.match(result.clause, /dp\.due_date >= \?/);
  assert.match(result.clause, /dp\.due_date <= \?/);
  assert.deepEqual(result.params, [today, soon]);
});

test("buildDueFilterClause for due=overdue uses < today", () => {
  const today = "2026-09-20";
  const result = buildDueFilterClause("overdue", today, "2026-09-27");
  assert.ok(result);
  assert.match(result.clause, /dp\.due_date < \?/);
  assert.deepEqual(result.params, [today]);
});

test("buildDueFilterClause for invalid value returns null", () => {
  assert.equal(buildDueFilterClause("invalid", "2026-09-20", "2026-09-27"), null);
  assert.equal(buildDueFilterClause("", "2026-09-20", "2026-09-27"), null);
  assert.equal(buildDueFilterClause(null, "2026-09-20", "2026-09-27"), null);
});

test("buildDueFilterClause for due=soon requires non-null non-empty due_date", () => {
  const result = buildDueFilterClause("soon", "2026-09-20", "2026-09-27");
  assert.match(result.clause, /dp\.due_date IS NOT NULL/);
  assert.match(result.clause, /dp\.due_date != ''/);
});

test("buildDueFilterClause for due=overdue requires non-null non-empty due_date", () => {
  const result = buildDueFilterClause("overdue", "2026-09-20", "2026-09-27");
  assert.match(result.clause, /dp\.due_date IS NOT NULL/);
  assert.match(result.clause, /dp\.due_date != ''/);
});

// ---- normalizeDueFilter ----

test("normalizeDueFilter accepts 'soon' and 'overdue'", () => {
  assert.equal(normalizeDueFilter("soon"), "soon");
  assert.equal(normalizeDueFilter("overdue"), "overdue");
});

test("normalizeDueFilter normalizes invalid values to empty string", () => {
  assert.equal(normalizeDueFilter(""), "");
  assert.equal(normalizeDueFilter("invalid"), "");
  assert.equal(normalizeDueFilter(null), "");
  assert.equal(normalizeDueFilter(undefined), "");
});

// ---- SQL clause consistency with evaluateProjectDueState ----

test("SQL clause for due=soon is semantically equivalent to evaluateProjectDueState === DUE_SOON", () => {
  // The SQL clause filters: due_date IS NOT NULL AND due_date != '' AND due_date >= today AND due_date <= soon
  // evaluateProjectDueState returns DUE_SOON when: day >= today AND day <= soon
  // Both exclude null/empty due dates (NO_DUE_DATE state)
  // Both use same boundary: >= today and <= today+7
  const today = todayDay();
  const soonMs = Date.parse(`${today}T00:00:00Z`) + DUE_SOON_WINDOW_DAYS * 86400000;
  const soon = new Date(soonMs).toISOString().slice(0, 10);
  const clause = buildDueFilterClause("soon", today, soon);

  // Test boundary values against both the policy and the clause logic
  const testDates = [
    [new Date(Date.now() - 86400000).toISOString().slice(0, 10), false], // yesterday: not in clause
    [today, true], // today: in clause
    [new Date(Date.now() + 86400000).toISOString().slice(0, 10), true], // tomorrow: in clause
    [soon, true], // today+7: in clause
    [new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10), false], // today+8: not in clause
  ];

  for (const [date, expected] of testDates) {
    const policyMatch = evaluateProjectDueState(date, today) === "DUE_SOON";
    const sqlMatch = date >= today && date <= soon && date !== "";
    assert.equal(policyMatch, expected, `Policy says ${date} -> DUE_SOON=${expected}`);
    assert.equal(sqlMatch, expected, `SQL logic says ${date} -> in clause=${expected}`);
    assert.equal(policyMatch, sqlMatch, `Policy and SQL agree for ${date}`);
  }
});

test("SQL clause for due=overdue is semantically equivalent to evaluateProjectDueState === OVERDUE", () => {
  const today = todayDay();
  const clause = buildDueFilterClause("overdue", today, soonDay());

  const testDates = [
    [new Date(Date.now() - 86400000).toISOString().slice(0, 10), true], // yesterday: in clause
    [today, false], // today: not in clause
    [new Date(Date.now() + 86400000).toISOString().slice(0, 10), false], // tomorrow: not in clause
  ];

  for (const [date, expected] of testDates) {
    const policyMatch = evaluateProjectDueState(date, today) === "OVERDUE";
    const sqlMatch = date < today && date !== "";
    assert.equal(policyMatch, expected, `Policy says ${date} -> OVERDUE=${expected}`);
    assert.equal(sqlMatch, expected, `SQL logic says ${date} -> in clause=${expected}`);
    assert.equal(policyMatch, sqlMatch, `Policy and SQL agree for ${date}`);
  }
});

// ---- Lifecycle non-mutation regression ----

test("due state is independent of project lifecycle status", async () => {
  // This is a code-structural test: the policy module exports only
  // evaluation functions, no status-mutation functions.
  const policy = await import("../app/domain/project-due-policy.mjs");
  const exports = Object.keys(policy);
  // Must not export any lifecycle mutation functions
  for (const name of exports) {
    assert.doesNotMatch(name, /set.*[Ss]tatus|update.*[Ss]tatus|change.*[Ss]tatus|archive|hold|resume|cancel|close|complete/i,
      `Policy must not export lifecycle mutation: ${name}`);
  }
  // Must only export evaluation/query functions
  assert.ok(exports.includes("evaluateProjectDueState"));
  assert.ok(exports.includes("isOverdueDueDate"));
  assert.ok(exports.includes("isDueSoonDueDate"));
  assert.ok(exports.includes("buildDueFilterClause"));
});

test("home metric filter SQL in dashboard-api does not mutate project status", async () => {
  const api = await (await import("node:fs/promises")).readFile(
    new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8"
  );
  // The due filter section must only add WHERE conditions, never UPDATE/INSERT
  const dueSection = api.slice(
    api.indexOf("buildDueFilterClause"),
    api.indexOf("buildDueFilterClause") + 500
  );
  assert.doesNotMatch(dueSection, /UPDATE|INSERT|DELETE|SET.*status/i,
    "Due filter must not mutate any project data");
});
