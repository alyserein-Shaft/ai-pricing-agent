/**
 * DOC-R3 — the project effective-time calendar has a real, per-project home, and
 * the shared temporal SQL is proven correct for the rows it is applied to.
 *
 * The calendar policy itself (Asia/Riyadh, bare date vs ISO instant, the sign of
 * the SQLite offset modifier, fail-closed resolution) is pinned in
 * `tests/effective-time-calendar.test.mjs`. This file covers the parts that only
 * exist because effective time is PROJECT-SCOPED:
 *
 *   * a project created by the production intake path records a declaration;
 *   * the half-declared states the migration's guards forbid really are refused;
 *   * a project with no declaration fails closed with a named error;
 *   * a project that declares a DIFFERENT zone is refused by the conformance
 *     guard, because the shared governing-evidence SQL is built from one calendar
 *     and would otherwise resolve that project's bare dates against the wrong day
 *     boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CALENDAR_UNDECLARED_CODE, EFFECTIVE_TIME_CALENDAR, zonedOffsetMinutes } from "../app/domain/effective-time-policy.mjs";
import {
  CALENDAR_CONFORMANCE_CODE,
  EffectiveTimeCalendarConformanceError,
  assertEffectiveTimeCalendarConformance,
  listProjectCalendars,
  loadProjectCalendar,
} from "../worker/project-effective-time-calendar.mjs";
import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";

const projectRow = (id, ownerUserId, declared = {}) => ({
  id,
  name: `project ${id}`,
  owner_user_id: ownerUserId,
  declared_timezone: declared.timezone ?? null,
  declared_utc_offset_minutes: declared.offset ?? null,
});

test("DOC-R3 the declared calendar is a per-project column, not application state", async () => {
  const fixture = createDocumentFixture();
  try {
    const columns = fixture.raw
      .prepare("PRAGMA table_info(projects)")
      .all()
      .map((column) => column.name);
    assert.ok(columns.includes("declared_timezone"), "the IANA identity must be stored on the project row");
    assert.ok(columns.includes("declared_utc_offset_minutes"), "the evaluation offset must be stored beside it");

    // Both are nullable with NO default. A default would be indistinguishable from
    // a value a human chose, and would reintroduce the silent global anchor the
    // policy forbids.
    for (const name of ["declared_timezone", "declared_utc_offset_minutes"]) {
      const column = fixture.raw.prepare("PRAGMA table_info(projects)").all().find((entry) => entry.name === name);
      assert.equal(column.notnull, 0, `${name} must be nullable so an undeclared project is representable`);
      assert.equal(column.dflt_value, null, `${name} must carry no default`);
    }

    // The fixture's own project row is the one the helper seeded, so it has no
    // declaration: that is the fail-closed case, and it is representable.
    const calendars = await listProjectCalendars(fixture.env.DB);
    assert.equal(calendars.length, 1);
    assert.equal(calendars[0].projectId, fixture.projectId);
    assert.equal(calendars[0].declared, false);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a project with no declaration fails closed, by name", async () => {
  const fixture = createDocumentFixture();
  try {
    await assert.rejects(
      () => loadProjectCalendar(fixture.env.DB, fixture.projectId),
      (error) => {
        assert.equal(error.code, CALENDAR_UNDECLARED_CODE);
        assert.equal(error.details.projectId, fixture.projectId);
        return true;
      },
    );
    await assert.rejects(
      () => assertEffectiveTimeCalendarConformance(fixture.env.DB),
      (error) => {
        assert.equal(error.code, CALENDAR_CONFORMANCE_CODE);
        assert.deepEqual(error.details.undeclaredProjectIds, [fixture.projectId]);
        assert.match(error.message, /host machine's timezone is never used/);
        return true;
      },
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a half-declared calendar is refused by the database, not just the resolver", async () => {
  // The resolver reports a half declaration; the migration's triggers stop it being
  // recorded in the first place, so the failure surfaces at the write that caused
  // it rather than at some later read. Both halves matter: a guard alone would
  // still be bypassable by an out-of-band writer, and a resolver alone would only
  // complain once the wrong data was already persisted.
  const fixture = createDocumentFixture();
  try {
    const insert = (id, timezone, offset) => fixture.raw
      .prepare(
        "INSERT INTO projects (id,name,owner_user_id,system_domain,initial_status,created_at,updated_at,operational_classification,declared_timezone,declared_utc_offset_minutes) "
        + "VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, id, fixture.ownerUserId, "Fire Alarm", "Draft", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "Operational", timezone, offset);

    assert.throws(() => insert("p-zone-only", "Asia/Riyadh", null), /PROJECT_CALENDAR_OFFSET_REQUIRED/);
    assert.throws(() => insert("p-offset-only", null, 180), /PROJECT_CALENDAR_ZONE_REQUIRED/);
    assert.throws(() => insert("p-blank-zone", "   ", 180), /PROJECT_CALENDAR_ZONE_REQUIRED/);
    assert.throws(() => insert("p-non-iana", "Riyadh", 180), /PROJECT_CALENDAR_ZONE_NOT_IANA/);
    assert.throws(() => insert("p-huge-offset", "Asia/Riyadh", 900), /PROJECT_CALENDAR_OFFSET_OUT_OF_RANGE/);
    // A coherent declaration, and the coherent absence, are both legal.
    insert("p-ok", "Asia/Riyadh", 180);
    insert("p-absent", null, null);
    const recorded = (await listProjectCalendars(fixture.env.DB))
      .map((entry) => [entry.projectId, entry.declared])
      .sort();
    assert.deepEqual(
      recorded.filter(([id]) => ["p-ok", "p-absent", fixture.projectId].includes(id)),
      [["p-absent", false], ["p-ok", true], [fixture.projectId, false]],
      "only the coherent declaration is recorded",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a project declaring a DIFFERENT zone is refused by the conformance guard", async () => {
  // This is the guard that makes a constant-based SQL fragment honest. The shared
  // governing-evidence SQL is built from one calendar; a project in another
  // jurisdiction would have its bare `YYYY-MM-DD` bounds resolved against the wrong
  // day boundary. Refusing loudly is the only safe answer until the shared queries
  // take a per-project calendar.
  const fixture = createDocumentFixture();
  try {
    // Declare the fixture's own project so the unscoped check below reports the
    // divergence, not the (already separately pinned) undeclared case.
    fixture.raw
      .prepare("UPDATE projects SET declared_timezone=?, declared_utc_offset_minutes=? WHERE id=?")
      .run("Asia/Riyadh", 180, fixture.projectId);
    insertRow(fixture.raw, "projects", {
      ...projectRow("p-riyadh", fixture.ownerUserId, { timezone: "Asia/Riyadh", offset: 180 }),
    });
    const ok = await assertEffectiveTimeCalendarConformance(fixture.env.DB, { projectId: "p-riyadh" });
    assert.deepEqual(ok.projectIds, ["p-riyadh"]);
    assert.equal(ok.calendar.timezone, EFFECTIVE_TIME_CALENDAR.timezone);

    // The recorded offset is DERIVED from the zone at insertion time, not
    // hard-coded: hard-coding 0 here would be wrong for half the year (London
    // observes DST), and that half-year wrongness is exactly what the
    // `PROJECT_CALENDAR_MISMATCH` check exists to catch.
    insertRow(fixture.raw, "projects", {
      ...projectRow("p-london", fixture.ownerUserId, { timezone: "Europe/London", offset: zonedOffsetMinutes("Europe/London") }),
    });
    await assert.rejects(
      () => assertEffectiveTimeCalendarConformance(fixture.env.DB),
      (error) => {
        assert.equal(error.code, CALENDAR_CONFORMANCE_CODE);
        assert.deepEqual(error.details.divergent, [
          { projectId: "p-london", timezone: "Europe/London", expected: "Asia/Riyadh" },
        ]);
        return true;
      },
    );
    // Scoping the check to the compliant project still passes: the guard reports
    // the divergence for the project that caused it, not a blanket failure.
    assert.deepEqual(
      (await assertEffectiveTimeCalendarConformance(fixture.env.DB, { projectId: "p-riyadh" })).projectIds,
      ["p-riyadh"],
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an unknown project cannot have a calendar resolved for it", async () => {
  const fixture = createDocumentFixture();
  try {
    await assert.rejects(
      () => loadProjectCalendar(fixture.env.DB, "does-not-exist"),
      (error) => error instanceof EffectiveTimeCalendarConformanceError,
    );
    await assert.rejects(
      () => assertEffectiveTimeCalendarConformance(fixture.env.DB, { projectId: "does-not-exist" }),
      (error) => error instanceof EffectiveTimeCalendarConformanceError,
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 the production project-creation path records a declaration", async () => {
  // Static check on the single production creation path. Behavioural coverage of
  // the handler is not asserted here: this pins the fact that the write exists and
  // names the two columns, so a refactor cannot quietly stop persisting a
  // calendar and leave every new project undeclared.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
  const insert = source.match(/INSERT INTO projects \(([^)]*)\)/);
  assert.ok(insert, "dashboard-api must still be the production project creation write");
  for (const column of ["declared_timezone", "declared_utc_offset_minutes"]) {
    assert.ok(insert[1].includes(column), `project creation must persist ${column}`);
  }
  assert.ok(source.includes("declaredUtcOffsetMinutes"), "the persisted offset must be the value actually bound");
  assert.ok(
    source.includes("zonedOffsetMinutes(declaredTimezone)"),
    "the offset must be DERIVED from the declared zone, never taken from the request",
  );
  assert.ok(
    source.includes("PROJECT_CALENDAR_ZONE_UNRESOLVABLE"),
    "an unresolvable declared zone must be rejected at creation, not stored",
  );
});
