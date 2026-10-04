// DOC-R3 — resolving a PROJECT's declared effective-time calendar, and proving
// the shared temporal SQL is correct for the rows it is applied to.
//
// Why this module exists
// ----------------------
// `worker/current-evidence-scope.mjs` builds the governing-evidence SQL from a
// single calendar instance (`EFFECTIVE_TIME_CALENDAR`) and exposes it as module
// constants, because roughly twenty-five consumers embed those constants directly
// in their own SQL. That is the right shape for "one governing policy" — but it
// only stays correct if every project it is applied to actually declares that
// calendar.
//
// So the calendar is per-project DATA, and this module is the seam between the two:
//
//   * `loadProjectCalendar` resolves one project's declaration and fails closed if
//     it is absent, so a project that was never configured cannot quietly inherit
//     a global anchor or a host timezone.
//   * `assertEffectiveTimeCalendarConformance` proves the shared SQL is valid for
//     the rows in question. If a project ever declares a different zone, this
//     throws rather than letting the shared constant evaluate that project's bare
//     dates against the wrong day boundary.
//
// The second function is deliberately NOT an assertion that can be skipped. It is
// the guard that makes a constant-based SQL fragment honest, and turning it into
// an optional check would leave the failure mode as "some documents quietly
// governed from the wrong instant" instead of "the deployment refuses to start
// claiming an authority it does not have".
import { EFFECTIVE_TIME_CALENDAR, resolveProjectCalendar } from "../app/domain/effective-time-policy.mjs";

export const CALENDAR_CONFORMANCE_CODE = "EFFECTIVE_TIME_CALENDAR_CONFORMANCE";

export class EffectiveTimeCalendarConformanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EffectiveTimeCalendarConformanceError";
    this.code = CALENDAR_CONFORMANCE_CODE;
    this.details = details;
  }
}

const PROJECT_CALENDAR_COLUMNS = "id, declared_timezone, declared_utc_offset_minutes";

/** Every project that carries an effective-time decision, with its declaration. */
export const listProjectCalendars = async (db) => {
  const rows = await db
    .prepare(`SELECT ${PROJECT_CALENDAR_COLUMNS} FROM projects ORDER BY id`)
    .all();
  return (rows.results || []).map((row) => ({
    projectId: row.id,
    timezone: row.declared_timezone ?? null,
    offsetMinutes: row.declared_utc_offset_minutes ?? null,
    declared: row.declared_timezone != null && String(row.declared_timezone).trim() !== "",
  }));
};

/**
 * Resolve one project's declared calendar, or fail closed.
 *
 * Fails closed with a NAMED error rather than a fallback: a project with no
 * declaration is a configuration gap an operator must close, and silently
 * evaluating its documents against a global or host-anchored calendar is exactly
 * the defect DOC-R3 exists to remove.
 */
export const loadProjectCalendar = async (db, projectId) => {
  const row = await db
    .prepare(`SELECT ${PROJECT_CALENDAR_COLUMNS} FROM projects WHERE id = ?`)
    .bind(projectId)
    .first();
  if (!row) {
    throw new EffectiveTimeCalendarConformanceError(
      "Project not found, so its effective-time calendar cannot be declared.",
      { projectId },
    );
  }
  return resolveProjectCalendar(row, { projectId });
};

/**
 * Prove the shared governing-evidence SQL is valid for these projects.
 *
 * The shared SQL is built from `EFFECTIVE_TIME_CALENDAR`. A project may declare
 * a different calendar, and then that SQL is NOT the correct authority for it —
 * a bare `YYYY-MM-DD` bound would be resolved against the wrong day boundary. This
 * refuses that state loudly instead of allowing it.
 */
export const assertEffectiveTimeCalendarConformance = async (db, { projectId = null } = {}) => {
  const projects = projectId
    ? (await listProjectCalendars(db)).filter((entry) => entry.projectId === projectId)
    : await listProjectCalendars(db);
  if (projectId && projects.length === 0) {
    throw new EffectiveTimeCalendarConformanceError("Project not found for calendar conformance.", { projectId });
  }

  const undeclared = projects.filter((entry) => !entry.declared).map((entry) => entry.projectId);
  if (undeclared.length > 0) {
    throw new EffectiveTimeCalendarConformanceError(
      "One or more projects have not declared an effective-time calendar, so their documents cannot be evaluated. The host machine's timezone is never used as a substitute.",
      { undeclaredProjectIds: undeclared },
    );
  }

  const divergent = [];
  for (const entry of projects) {
    const calendar = resolveProjectCalendar(entry, { projectId: entry.projectId });
    if (calendar.timezone !== EFFECTIVE_TIME_CALENDAR.timezone) {
      divergent.push({ projectId: entry.projectId, timezone: calendar.timezone, expected: EFFECTIVE_TIME_CALENDAR.timezone });
    }
  }
  if (divergent.length > 0) {
    throw new EffectiveTimeCalendarConformanceError(
      "A project declares an effective-time calendar other than the one the shared governing-evidence SQL was built from, so that SQL is not a correct authority for it. A bare project-calendar date would be resolved against the wrong day boundary.",
      { divergent },
    );
  }
  return { projectIds: projects.map((entry) => entry.projectId), calendar: EFFECTIVE_TIME_CALENDAR };
};
