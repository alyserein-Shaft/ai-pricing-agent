// Canonical project due-date policy -- single source of truth for the
// organization Home metrics (Due soon / Overdue) and the Projects register
// due filter (?workspace=Projects&due=soon|overdue).
//
// Authoritative date: project_dashboard_profiles.due_date, a YYYY-MM-DD
// calendar-day string. All comparisons are lexicographic calendar-day
// comparisons in UTC (today = new Date().toISOString().slice(0, 10)) --
// the exact semantics the Home metrics have always used. No timezone
// conversion, no time-of-day: a deadline is due "today" for the whole day.
//
// Definitions (unchanged from the established Home metric behavior):
// - OVERDUE:   due date is a real date AND strictly before today.
// - DUE_SOON:  due date is a real date AND today <= due date <= today+7.
// - NOT_DUE_SOON: a real date beyond the 7-day window.
// - NO_DUE_DATE: null, empty, or blank due date.
// Completed/archived/cancelled exclusion is NOT part of this policy: the
// register query already excludes archived projects, and status filtering
// is an orthogonal, composable filter.
//
// CRITICAL LIFECYCLE RULE: OVERDUE is NOT a project lifecycle state. Due
// state is an independent scheduling indicator only -- it must never
// change project status, block execution, disable workspaces, stop BOQ /
// matching / pricing / quotation, or archive/cancel/hold a project.
// Active + Overdue remains Active (visible in BOTH filters); only explicit
// lifecycle actions may change Draft / Active / On Hold / Won / Lost /
// Cancelled / Archived. This module therefore exposes no status mutation,
// no blocking flag, and no workflow gate of any kind.

export const DUE_SOON_WINDOW_DAYS = 7;

export const DUE_STATES = ["OVERDUE", "DUE_SOON", "NOT_DUE_SOON", "NO_DUE_DATE"];

const dayOf = (value) => String(value ?? "").trim().slice(0, 10);
const isCalendarDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const todayDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export const soonDay = (now = Date.now()) =>
  new Date(now + DUE_SOON_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

export const evaluateProjectDueState = (dueDate, today = todayDay()) => {
  const day = dayOf(dueDate);
  if (!isCalendarDay(day)) return "NO_DUE_DATE";
  if (day < today) return "OVERDUE";
  if (day <= soonDay(Date.parse(`${today}T00:00:00Z`))) return "DUE_SOON";
  return "NOT_DUE_SOON";
};

export const isOverdueDueDate = (dueDate, today = todayDay()) =>
  evaluateProjectDueState(dueDate, today) === "OVERDUE";

export const isDueSoonDueDate = (dueDate, today = todayDay()) =>
  evaluateProjectDueState(dueDate, today) === "DUE_SOON";

// SQL fragment builder for the Projects register backend filter. Returns
// null when no due condition applies (All / missing / invalid), so invalid
// values can never silently narrow results -- the caller echoes the
// normalized value instead. Project-level by construction: the condition
// filters project_dashboard_profiles rows (one per project) and the
// register de-duplicates by project id.
export const buildDueFilterClause = (due, today, soon) => {
  if (due === "soon") {
    return {
      clause: "dp.due_date IS NOT NULL AND dp.due_date != '' AND dp.due_date >= ? AND dp.due_date <= ?",
      params: [today, soon],
    };
  }
  if (due === "overdue") {
    return {
      clause: "dp.due_date IS NOT NULL AND dp.due_date != '' AND dp.due_date < ?",
      params: [today],
    };
  }
  return null;
};

export const normalizeDueFilter = (due) => (due === "soon" || due === "overdue" ? due : "");
