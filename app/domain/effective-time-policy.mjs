// CENTRALIZED TEMPORAL CONTRACT — DOC-R3.
//
// One place decides what an effective bound means, so no consumer can re-derive a
// weaker rule and no consumer can silently disagree about "now".
//
// The column legitimately holds two shapes, and the migration blesses both
// (`drizzle-active/0005_document_revision_addendum.sql`, effective-time CHECKs):
//
//   * a bare `YYYY-MM-DD`      -- a PROJECT CALENDAR DATE, e.g. a tender
//                                 addendum declared to take effect on 1 Feb.
//                                 Resolved against the PROJECT'S DECLARED
//                                 CALENDAR, not UTC and not the host machine.
//   * a full ISO-8601 instant  -- an INSTANT, e.g. restore re-issuing old content
//                                 with `effective_from = <now instant>`.
//
// Mixing them with a text comparison silently produces nonsense: SQLite's
// `CURRENT_TIMESTAMP` renders a SPACE where ISO-8601 has `T`, and `T` > ` `, so
// text comparison judges *every* ISO instant to lie in the future forever. That
// is exactly how a restored version would be permanently locked out of the
// current scope. Every comparison here therefore normalizes to an instant first.
//
// ---------------------------------------------------------------------------
// THE CALENDAR IS DECLARED BY THE PROJECT, AND IT IS NOT UTC.
// ---------------------------------------------------------------------------
// DOC-R3 user decision, and it is a real decision rather than a default:
//
//   * Effective-time calendar semantics are PROJECT-SCOPED. Not global, not
//     organization-wide, not host-machine inferred, not developer-local.
//   * The canonical timezone for the Al Mousa / Saudi project context is
//     `Asia/Riyadh`, whose current fixed offset is UTC+03:00.
//
// TWO SEPARATE THINGS, which this module refuses to conflate:
//
//   1. IDENTITY -- the IANA zone name. `Asia/Riyadh` is what the project
//      declares, what project metadata stores, and what any future DST rule or
//      zone-rebase must be expressed against. Identity is never an integer.
//
//   2. EVALUATION OFFSET -- the fixed `+HH:MM` that SQLite can actually apply.
//      SQLite has no IANA zone support: `julianday(x, '+3 hours')` is all it
//      offers. The offset is therefore DERIVED from the identity for the
//      evaluation instant (`zonedOffsetMinutes`) and is never treated as the
//      identity. `resolveProjectCalendar` cross-checks the stored offset against
//      the derived one and refuses a project whose two disagree, because a
//      project that has drifted from its own declared zone is a governance
//      error, not something to paper over with whichever number is convenient.
//
// A bare calendar date is the start of that day IN THE PROJECT'S ZONE. For
// Asia/Riyadh, `2026-02-01` is `2026-01-31T21:00:00Z` -- which is the whole
// point: under a UTC anchor that date would have been evaluated up to three
// hours early, and an addendum declared for "the first of the month" would have
// become effective on the evening of the 31st.
//
// WHAT IS NOT A SOURCE OF TRUTH HERE:
//   * The host machine's zone. Workers, CI and a developer's laptop each run in
//     their own zone; inferring from any of them makes the same document govern
//     differently in two deployments. `businessDayOf` and every SQL fragment
//     take the calendar as an argument for exactly this reason.
//   * The organization. A future sibling project in a different jurisdiction must
//     be able to declare a different calendar without touching this file.
//   * `app/domain/project-due-policy.mjs`, which anchors the Home due metrics in
//     UTC. That is a *reporting* policy for a stored `YYYY-MM-DD` deadline and
//     it is deliberately left alone; this module governs *effective time*.
//     The two are not required to agree and are not allowed to be conflated.
//
// FAIL CLOSED: a project that has not declared a calendar cannot have effective
// time evaluated at all (`PROJECT_CALENDAR_UNDECLARED`). It is never resolved
// from the host.
//
// Interval semantics, which are NOT open:
//   * `effective_from` INCLUSIVE, `effective_to` EXCLUSIVE — [from, to).
//   * null `effective_from` means open past  (no declared start; immediately in force).
//   * null `effective_to`   means open future (no declared end; never expires).
//   * expired evidence is never revived, and no in-force version fails CLOSED.

import { toSqliteOffsetModifier } from "./sqlite-offset-modifier.mjs";

export const CALENDAR_UNDECLARED_CODE = "PROJECT_CALENDAR_UNDECLARED";
export const CALENDAR_MISMATCH_CODE = "PROJECT_CALENDAR_MISMATCH";

export class EffectiveTimeGovernanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EffectiveTimeGovernanceError";
    this.code = code;
    this.details = details;
  }
}

// The DECLARED project calendar for the current project context.
//
// This is a recorded governance decision, not a default and not an inference:
// `Asia/Riyadh` is the canonical project timezone and `180` is that zone's
// current fixed offset. It is the value the migration writes into project
// metadata and the value every project's own declaration is verified against.
export const EFFECTIVE_TIME_CALENDAR = Object.freeze({
  // Semantic identity. Never an offset, never a host zone.
  timezone: "Asia/Riyadh",
  // Evaluation offset only, derived from `timezone` for the evaluation instant.
  offsetMinutes: 180,
  // Effective time is a project-scoped dimension, declared per project.
  scope: "project",
  status: "declared",
  // Half-open window, fixed by the study's worked example.
  effectiveFromInclusive: true,
  effectiveToExclusive: true,
  // A bare date is a project-calendar day; a full timestamp is an instant.
  bareDateIsProjectCalendarDay: true,
});

// The legacy spelling, kept because it is referenced in review notes. The anchor
// is the declared project calendar, not UTC.
export const PROJECT_CALENDAR = EFFECTIVE_TIME_CALENDAR;

export const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A bare `YYYY-MM-DD` in the canonical shape. Anything longer carries a time
// component and is therefore an instant.
export const isCalendarDay = (value) => CALENDAR_DAY_PATTERN.test(String(value ?? "").trim());

// The true UTC offset of an IANA zone AT AN INSTANT, derived from the platform
// rather than assumed. This is what keeps the fixed offset from becoming the
// semantic identity: for `Asia/Riyadh` it always yields 180, and for a zone that
// observes DST it yields the correct per-instant value, so declaring such a zone
// does not silently freeze the wrong offset.
export const zonedOffsetMinutes = (timezone, at = new Date()) => {
  const zone = String(timezone ?? "").trim();
  if (!zone) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset", hour12: false })
      .formatToParts(at instanceof Date ? at : new Date(at));
  } catch {
    // An unresolvable zone is a REPORT, not an exception escaping into whatever
    // consumer happened to ask. `resolveProjectCalendar` turns this null into a
    // named governance error so an operator is told the declaration is unusable,
    // rather than the runtime throwing a bare RangeError from deep inside a
    // query builder.
    return null;
  }
  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  if (/^GMT$/.test(label)) return 0;
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return null;
  const magnitude = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "-" ? -magnitude : magnitude;
};

// Build the calendar a zone declares. The zone is the identity; the offset is
// derived from it for `at`.
export const calendarForTimezone = (timezone, at = new Date(), overrides = {}) => Object.freeze({
  timezone: String(timezone).trim(),
  offsetMinutes: zonedOffsetMinutes(timezone, at),
  scope: "project",
  status: "declared",
  effectiveFromInclusive: true,
  effectiveToExclusive: true,
  bareDateIsProjectCalendarDay: true,
  ...overrides,
});

// Resolve the calendar a PROJECT declares, or fail closed.
//
// `row` is a project row (or any object carrying the two declared columns). A
// missing declaration is a governance gap that must be closed by configuring the
// project -- never papered over with the host zone, the organization, or a
// silent UTC fallback.
//
// When the project also stores an evaluation offset, the stored value is
// verified against the zone rather than preferred over it: the IANA identity is
// authoritative, and a recorded offset that disagrees with its own declared zone
// is reported rather than silently used.
export const resolveProjectCalendar = (row, { at = new Date(), projectId = null } = {}) => {
  const timezone = String(row?.declared_timezone ?? row?.timezone ?? "").trim();
  const declaredOffset = row?.declared_utc_offset_minutes ?? row?.offsetMinutes ?? null;
  if (!timezone) {
    throw new EffectiveTimeGovernanceError(
      CALENDAR_UNDECLARED_CODE,
      "Project has not declared an effective-time calendar. A project calendar is required before effective time can be evaluated; the host machine's timezone is never used as a substitute.",
      { projectId: projectId ?? row?.id ?? null },
    );
  }
  const derived = zonedOffsetMinutes(timezone, at);
  if (derived === null) {
    throw new EffectiveTimeGovernanceError(
      CALENDAR_MISMATCH_CODE,
      `Project declares an effective-time calendar this runtime cannot resolve: ${timezone}. A project calendar must be an IANA timezone identifier.`,
      { projectId: projectId ?? row?.id ?? null, timezone },
    );
  }
  if (declaredOffset !== null && declaredOffset !== undefined && Number(declaredOffset) !== derived) {
    throw new EffectiveTimeGovernanceError(
      CALENDAR_MISMATCH_CODE,
      `Project declares timezone ${timezone} with evaluation offset ${declaredOffset} minutes, but ${timezone} is ${derived} minutes at the evaluation instant. The declared identity is authoritative; the recorded offset must be corrected.`,
      { projectId: projectId ?? row?.id ?? null, timezone, declaredOffsetMinutes: Number(declaredOffset), derivedOffsetMinutes: derived },
    );
  }
  return Object.freeze({
    timezone,
    offsetMinutes: derived,
    scope: "project",
    status: "declared",
    effectiveFromInclusive: true,
    effectiveToExclusive: true,
    bareDateIsProjectCalendarDay: true,
  });
};

// Whether a calendar object is usable for evaluation. Cheap guard for the SQL
// builders so a half-built calendar can never silently produce a UTC fragment.
const assertUsableCalendar = (calendar) => {
  if (!calendar || !Number.isInteger(calendar.offsetMinutes)) {
    throw new EffectiveTimeGovernanceError(
      CALENDAR_UNDECLARED_CODE,
      "An effective-time calendar with a resolved offset is required to build a temporal predicate.",
      { calendar: calendar ?? null },
    );
  }
  return calendar;
};

// The PROJECT CALENDAR DAY of an instant, under a declared calendar.
//
// Deliberately takes the calendar: computing this from the host would make the
// same document govern differently on a Riyadh laptop and a UTC CI runner, which
// is the defect this module exists to prevent.
export const businessDayOf = (instant = new Date(), calendar = EFFECTIVE_TIME_CALENDAR) => {
  assertUsableCalendar(calendar);
  return new Date(new Date(instant).getTime() + calendar.offsetMinutes * 60000).toISOString().slice(0, 10);
};

// The instant a bare project-calendar day denotes: the START of that day in the
// project's declared zone. An ISO instant is returned as-is, unshifted.
export const effectiveBoundInstant = (value, calendar = EFFECTIVE_TIME_CALENDAR) => {
  assertUsableCalendar(calendar);
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (isCalendarDay(raw)) {
    return new Date(Date.parse(`${raw}T00:00:00.000Z`) - calendar.offsetMinutes * 60000).toISOString();
  }
  return new Date(raw).toISOString();
};

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------
// `julianday()` accepts every shape this column legitimately holds: a bare
// date, an ISO-8601 instant, and SQLite's own space-separated
// `CURRENT_TIMESTAMP`. It is UTC-based, which is exactly right for an INSTANT --
// and that is all it is used for. A bare calendar date is first shifted out of
// the project's zone, because a bare date is not midnight UTC.
//
// The discriminator is `length(col) = 10`: a canonical bare `YYYY-MM-DD` is
// exactly ten characters, and every shape carrying a time component is longer.
// The migration's CHECK already guarantees the leading ten characters are a real
// calendar date, so the length test is sufficient and needs no second parse.
export const effectiveBoundInstantSql = (column, calendar = EFFECTIVE_TIME_CALENDAR) => {
  assertUsableCalendar(calendar);
  return `(CASE WHEN length(${column}) = 10 `
    + `THEN julianday(substr(${column}, 1, 10), '${toSqliteOffsetModifier(calendar.offsetMinutes)}') `
    + `ELSE julianday(${column}) END)`;
};

// Half-open in-force test: effective_from inclusive, effective_to exclusive.
//
// `julianday('now')` is the evaluation INSTANT, so it is never calendar-shifted:
// "now" is a point on the timeline, not a day in the project's calendar.
export const inForceWindowSql = (alias, calendar = EFFECTIVE_TIME_CALENDAR) =>
  `(${alias}.effective_from IS NULL OR ${effectiveBoundInstantSql(`${alias}.effective_from`, calendar)} <= julianday('now')) `
  + `AND (${alias}.effective_to IS NULL OR ${effectiveBoundInstantSql(`${alias}.effective_to`, calendar)} > julianday('now'))`;

// Precedence key for "which in-force version outranks which", as a TOTAL numeric
// expression.
//
// Two properties here are load-bearing, and both were got wrong once already:
//
// 1. A version with no declared start is open-past, so it ranks BELOW every
//    declared start. The fallback is therefore negative: a missing start is the
//    OLDEST possible value, not the newest and not "unknown".
//
// 2. The result is wrapped ONCE. `julianday()` already yields a number, so
//    passing its output back through `julianday()` -- which treats a numeric
//    argument as a Julian day and returns NULL when it is out of range -- makes
//    the whole comparison NULL. `COALESCE` is inside `julianday`, never outside.
//
// TOTAL is the point: the expression can never evaluate to NULL, so a comparison
// built from it can never be NULL, so "unknown ordering" can never masquerade as
// "no ordering".
export const effectiveFromPrecedenceSql = (alias, calendar = EFFECTIVE_TIME_CALENDAR) =>
  `COALESCE(${effectiveBoundInstantSql(`${alias}.effective_from`, calendar)}, -1.0e12)`;

// Strict "a is later than b" where BOTH sides are already-normalized numeric
// expressions such as `effectiveFromPrecedenceSql`. Passing a raw column here
// would be correct too (julianday of NULL is NULL, and NULL > NULL is NULL), but
// `precedenceLaterThanSql` is what guarantees totality.
export const precedenceLaterThanSql = (aExpr, bExpr) => `(${aExpr} > ${bExpr})`;

// A comparison that is explicitly "yes" or "no", never "unknown".
//
// This exists because of a real, silent failure: in SQL, `FALSE OR NULL` is
// NULL, not FALSE. A precedence test that evaluates to NULL therefore vanishes
// from an `EXISTS`/`NOT` guard instead of deciding anything, which had the
// effect of making a genuine tie between two equally-ranked versions look
// resolvable -- the exact opposite of failing closed. Every consumer of a
// precedence test must route it through this helper so that an undeterminable
// comparison counts as "not outranking", which is what makes a tie a tie.
export const definiteComparisonSql = (comparisonExpr) => `COALESCE(${comparisonExpr}, 0)`;
