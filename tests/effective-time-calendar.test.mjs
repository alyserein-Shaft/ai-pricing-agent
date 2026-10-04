/**
 * DOC-R3 — the centralized effective-time contract and the PROJECT DECLARED
 * CALENDAR.
 *
 * Two shapes share one column and they are NOT the same thing:
 *
 *   * a bare `YYYY-MM-DD` is a PROJECT CALENDAR DATE. It is the start of that
 *     day in the calendar the project declares. It is NOT midnight UTC, and it
 *     is NOT midnight in whatever zone the worker happens to run in.
 *   * a full ISO-8601 timestamp is an INSTANT, compared as an instant, never
 *     shifted into a zone.
 *
 * The declared calendar is project-scoped and, for the Al Mousa / Saudi project
 * context, `Asia/Riyadh` at UTC+03:00. Everything here is deterministic: the
 * wall-clock-dependent assertions derive their expectation from the calendar
 * rather than hard-coding "now", so the suite cannot become time-of-day flaky.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  CALENDAR_MISMATCH_CODE,
  CALENDAR_UNDECLARED_CODE,
  EffectiveTimeGovernanceError,
  EFFECTIVE_TIME_CALENDAR,
  businessDayOf,
  calendarForTimezone,
  effectiveBoundInstant,
  effectiveBoundInstantSql,
  inForceWindowSql,
  isCalendarDay,
  resolveProjectCalendar,
  zonedOffsetMinutes,
} from "../app/domain/effective-time-policy.mjs";
import { toSqliteOffsetModifier } from "../app/domain/sqlite-offset-modifier.mjs";
import { currentBoqEvidenceFrom, documentVersionGoverningPredicate } from "../worker/current-evidence-scope.mjs";
import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";

const RIYADH = calendarForTimezone("Asia/Riyadh");
const UTC = calendarForTimezone("UTC");

// Evaluate a generated SQL fragment as an instant string, so the assertion is
// about what SQLite will actually compute rather than about a JS reimplementation.
const sqlInstant = (fragment, db) =>
  db.prepare(`SELECT datetime(${fragment}) AS at FROM probe`).get().at.replace(" ", "T") + "Z";

test("DOC-R3 the declared project calendar is Asia/Riyadh at UTC+03:00", () => {
  assert.equal(EFFECTIVE_TIME_CALENDAR.timezone, "Asia/Riyadh", "the zone is the semantic identity");
  assert.equal(EFFECTIVE_TIME_CALENDAR.offsetMinutes, 180, "the declared evaluation offset is +03:00");
  assert.equal(EFFECTIVE_TIME_CALENDAR.scope, "project", "effective time is a project-scoped dimension");
  assert.equal(EFFECTIVE_TIME_CALENDAR.status, "declared", "this is a recorded decision, not a provisional guess");

  // The identity is a zone, not an integer, and the offset is DERIVED from it.
  // Riyadh observes no DST, so the derivation is stable -- which is exactly why
  // deriving it is safe here and why the derivation is the mechanism rather than
  // a hard-coded 180.
  assert.equal(zonedOffsetMinutes("Asia/Riyadh", new Date("2026-01-15T12:00:00Z")), 180);
  assert.equal(zonedOffsetMinutes("Asia/Riyadh", new Date("2026-07-15T12:00:00Z")), 180);
  assert.equal(RIYADH.offsetMinutes, 180);
});

test("DOC-R3 the fixed offset is never treated as the timezone identity", () => {
  // A zone that DOES observe DST proves the offset is derived per instant rather
  // than stored as the identity. If the architecture had pinned the offset as the
  // semantic identity, this zone would be unrepresentable.
  assert.equal(zonedOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z")), -300);
  assert.equal(zonedOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z")), -240);
  assert.equal(zonedOffsetMinutes("Europe/London", new Date("2026-01-15T12:00:00Z")), 0);
  assert.equal(zonedOffsetMinutes("Europe/London", new Date("2026-07-15T12:00:00Z")), 60);
  assert.equal(zonedOffsetMinutes("Not/AZone", new Date()), null, "an unresolvable zone is reported, not guessed");
});

test("DOC-R3 a bare date is a project-calendar date, never midnight UTC", () => {
  assert.equal(isCalendarDay("2026-02-01"), true);
  assert.equal(isCalendarDay("2026-02-01T00:00:00Z"), false, "anything carrying a time is an instant");

  // The whole reason the project declares a calendar: 1 February in Riyadh began
  // at 21:00 UTC on 31 January. Under a UTC anchor this date would have been
  // evaluated three hours early, so an addendum declared to take effect on the
  // first would have governed from the evening before.
  assert.equal(effectiveBoundInstant("2026-02-01", RIYADH), "2026-01-31T21:00:00.000Z");
  assert.equal(effectiveBoundInstant("2026-02-01", UTC), "2026-02-01T00:00:00.000Z");
  assert.notEqual(
    effectiveBoundInstant("2026-02-01", RIYADH),
    effectiveBoundInstant("2026-02-01", UTC),
    "the two project calendars must genuinely disagree about a bare date",
  );
});

test("DOC-R3 an ISO instant is an instant and is never shifted", () => {
  for (const calendar of [RIYADH, UTC]) {
    assert.equal(
      effectiveBoundInstant("2026-02-01T00:00:00Z", calendar),
      "2026-02-01T00:00:00.000Z",
      "a full timestamp denotes the same instant under every declared calendar",
    );
  }
  assert.equal(
    effectiveBoundInstant("2026-02-01T21:00:00Z", RIYADH),
    "2026-02-01T21:00:00.000Z",
    "and an offset-bearing timestamp keeps its own offset rather than being re-anchored",
  );
});

test("DOC-R3 SQLite evaluates the bare date in the PROJECT calendar", () => {
  // Assert on the generated SQL, not on the JS helper. These are two different
  // implementations of the same rule, and only the SQL one is what production
  // actually runs; asserting on the helper alone would let the SQL drift.
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE probe (col TEXT)");
  db.prepare("INSERT INTO probe (col) VALUES ('2026-02-01')").run();
  const riyadhFragment = effectiveBoundInstantSql("col", RIYADH);
  const utcFragment = effectiveBoundInstantSql("col", UTC);

  assert.equal(sqlInstant(riyadhFragment, db), "2026-01-31T21:00:00Z");
  assert.equal(sqlInstant(utcFragment, db), "2026-02-01T00:00:00Z");

  // An instant column must be unaffected by whichever calendar is declared.
  db.prepare("UPDATE probe SET col='2026-02-01T00:00:00Z'").run();
  assert.equal(sqlInstant(riyadhFragment, db), "2026-02-01T00:00:00Z");
  assert.equal(sqlInstant(utcFragment, db), "2026-02-01T00:00:00Z");

  // And the discriminator is length, so a value with a time component can never
  // be mistaken for a bare day and shifted.
  db.prepare("UPDATE probe SET col='2026-02-01 00:00:00'").run();
  assert.equal(sqlInstant(riyadhFragment, db), "2026-02-01T00:00:00Z");
});

test("DOC-R3 a bare project-calendar day is in force for that whole day", () => {
  // Wall-clock independent: the expectation is DERIVED from the calendar, so this
  // holds at 00:00 and at 23:59 in any zone. Today's project-calendar day began
  // at or before now, and two days out has not begun.
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE probe (effective_from TEXT, effective_to TEXT)");
  const window = inForceWindowSql("p", RIYADH);
  const check = (value) => {
    db.prepare("INSERT INTO probe (effective_from, effective_to) VALUES (?, NULL)").run(value);
    const row = db.prepare(`SELECT ${window} AS in_force FROM probe p`).get();
    db.exec("DELETE FROM probe");
    return Number(row.in_force) === 1;
  };

  assert.equal(check(businessDayOf(new Date(), RIYADH)), true, "today in the project's calendar is in force");
  assert.equal(
    check(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)),
    false,
    "a declared future day has not started in the project's calendar",
  );
});

test("DOC-R3 businessDayOf depends on the declared calendar, never on the host", () => {
  // A Riyadh project and a UTC project must be able to disagree about which day
  // it is, at the same instant. If businessDayOf read the host zone, these two
  // assertions could not both hold on a machine in some third zone.
  const at = new Date("2026-02-01T20:00:00Z"); // 23:00 in Riyadh, 20:00 UTC
  assert.equal(businessDayOf(at, RIYADH), "2026-02-01");
  assert.equal(businessDayOf(at, UTC), "2026-02-01");

  const at2 = new Date("2026-02-01T22:00:00Z"); // 01:00 on 2 Feb in Riyadh
  assert.equal(businessDayOf(at2, RIYADH), "2026-02-02", "Riyadh has already rolled over");
  assert.equal(businessDayOf(at2, UTC), "2026-02-01", "UTC has not");

  const previousZone = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    assert.equal(
      businessDayOf(at2, RIYADH),
      "2026-02-02",
      "changing the host timezone must not change a project-declared calendar",
    );
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("DOC-R3 an undeclared project calendar fails closed instead of using the host", () => {
  assert.throws(
    () => resolveProjectCalendar({ id: "p1", declared_timezone: null, declared_utc_offset_minutes: null }, { projectId: "p1" }),
    (error) => {
      assert.ok(error instanceof EffectiveTimeGovernanceError);
      assert.equal(error.code, CALENDAR_UNDECLARED_CODE);
      assert.match(error.message, /host machine's timezone is never used/);
      return true;
    },
  );
  // An empty string is an absent declaration, not a zone called "".
  assert.throws(
    () => resolveProjectCalendar({ declared_timezone: "   " }),
    (error) => error.code === CALENDAR_UNDECLARED_CODE,
  );
  // A calendar object with no resolved offset can never build a predicate.
  assert.throws(
    () => inForceWindowSql("dv", { timezone: "Asia/Riyadh" }),
    (error) => error.code === CALENDAR_UNDECLARED_CODE,
  );
});

test("DOC-R3 a project whose recorded offset disagrees with its own zone is reported", () => {
  // The IANA identity is authoritative. A stored offset that contradicts the zone
  // it was stored beside is a governance error, so it is raised rather than
  // silently preferred -- and certainly not silently corrected.
  assert.throws(
    () => resolveProjectCalendar({ id: "p1", declared_timezone: "Asia/Riyadh", declared_utc_offset_minutes: 0 }),
    (error) => {
      assert.equal(error.code, CALENDAR_MISMATCH_CODE);
      assert.equal(error.details.declaredOffsetMinutes, 0);
      assert.equal(error.details.derivedOffsetMinutes, 180);
      return true;
    },
  );
  // The consistent case resolves, and the derived offset is what it returns.
  const resolved = resolveProjectCalendar({ id: "p1", declared_timezone: "Asia/Riyadh", declared_utc_offset_minutes: 180 });
  assert.equal(resolved.offsetMinutes, 180);
  assert.equal(resolved.timezone, "Asia/Riyadh");
  assert.equal(resolved.scope, "project");
  // A zone that resolves to 0 is declared, not missing.
  assert.equal(resolveProjectCalendar({ declared_timezone: "UTC", declared_utc_offset_minutes: 0 }).offsetMinutes, 0);
});

test("DOC-R3 the SQLite offset modifier carries the inverted sign, and only integers", () => {
  // A bare day D at UTC+03:00 is D-1T21:00Z, so the modifier is NEGATIVE for a
  // POSITIVE offset. Getting this backwards moves every bare effective date the
  // wrong way, which is why it is asserted from both sides.
  assert.equal(toSqliteOffsetModifier(180), "-180 minutes");
  assert.equal(toSqliteOffsetModifier(-300), "+300 minutes");
  assert.equal(toSqliteOffsetModifier(0), "0 minutes");
  assert.equal(toSqliteOffsetModifier(330), "-330 minutes");

  // The result is interpolated into SQL text, so a non-integer must be rejected
  // before it can reach the string.
  for (const bad of [180.5, "180", NaN, null, undefined, {}, 1e9]) {
    assert.throws(() => toSqliteOffsetModifier(bad), bad === 1e9 ? RangeError : TypeError, `rejects ${String(bad)}`);
  }
});

test("DOC-R3 the governing predicate is calendar-scoped, so a second project calendar is real", () => {
  // Proof of threading, not of decoration: the same predicate builder yields
  // genuinely different temporal SQL per project calendar, and the fragment it
  // embeds resolves a bare date 180 minutes apart between them.
  const riyadh = documentVersionGoverningPredicate("dv", RIYADH);
  const utc = documentVersionGoverningPredicate("dv", UTC);
  assert.notEqual(riyadh, utc, "a project calendar must reach the governing predicate");

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE probe (col TEXT)");
  db.prepare("INSERT INTO probe (col) VALUES ('2026-02-01')").run();
  const embedded = (sql) => {
    const match = /THEN julianday\(substr\(dv\.effective_from, 1, 10\), '([^']+)'\)/.exec(sql);
    assert.ok(match, "the governing predicate must carry a calendar-shifted bare-date branch");
    return match[1];
  };
  assert.equal(embedded(riyadh), "-180 minutes");
  assert.equal(embedded(utc), "0 minutes");

  // The default instance used by the shared evidence queries is the declared one,
  // so an existing consumer that passes no calendar is not silently on UTC.
  assert.ok(riyadh.length > 0);
  assert.equal(effectiveBoundInstantSql("col").includes("'-180 minutes'"), true);
});

test("DOC-R3 a bare declared date governs on a real schema, in a real query, in the project calendar", async () => {
  // End-to-end through the real active-chain fixture, so the calendar is exercised
  // by the same code path production runs rather than by a fragment inspection.
  //
  // Today in the project's calendar is in force, and the same bare shape two days
  // out is not. Both expectations are derived from the calendar, so the assertion
  // is stable at any hour of any day.
  const fixture = createDocumentFixture();
  try {
    const calendar = resolveProjectCalendar({
      id: fixture.projectId,
      declared_timezone: EFFECTIVE_TIME_CALENDAR.timezone,
      declared_utc_offset_minutes: EFFECTIVE_TIME_CALENDAR.offsetMinutes,
    });
    insertRow(fixture.raw, "documents", {
      id: "doc-calendar",
      project_id: fixture.projectId,
      logical_name: "doc-calendar.pdf",
      current_version_id: "ver-calendar-today",
      created_by: fixture.ownerUserId,
    });
    const version = (id, number, effectiveFrom) => insertRow(fixture.raw, "document_versions", {
      id,
      document_id: "doc-calendar",
      version_number: number,
      original_filename: "doc-calendar.pdf",
      stored_filename: `${id}.pdf`,
      extension: "pdf",
      mime_type: "application/pdf",
      byte_size: 128,
      sha256: `sha-${id}`,
      object_key: `${fixture.projectId}/${id}.pdf`,
      uploaded_by: fixture.ownerUserId,
      effective_from: effectiveFrom,
      effective_to: null,
    });
    version("ver-calendar-today", 1, businessDayOf(new Date(), calendar));
    version("ver-calendar-soon", 2, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));

    const governing = async (id) => (await fixture.env.DB
      .prepare(`SELECT dv.id FROM document_versions dv WHERE dv.id=? AND ${documentVersionGoverningPredicate("dv", calendar)}`)
      .bind(id).first()) !== null;

    assert.equal(await governing("ver-calendar-today"), true, "today's bare project-calendar date is in force");
    assert.equal(await governing("ver-calendar-soon"), false, "a bare date two days out has not started");

    // And through the real evidence query, so the calendar is proven on the path
    // production actually runs rather than only on a standalone predicate.
    insertRow(fixture.raw, "boq_extraction_versions", {
      id: "ex-calendar-today",
      document_id: "doc-calendar",
      document_version_id: "ver-calendar-today",
      version_number: 1,
      status: "Completed",
      parser_version: "test-parser",
      ruleset_version: "test-rules",
      ocr_version: "test-ocr",
      created_by: fixture.ownerUserId,
    });
    insertRow(fixture.raw, "boq_items", {
      id: "ver-calendar-today-item",
      extraction_version_id: "ex-calendar-today",
      project_id: fixture.projectId,
      source_document_id: "doc-calendar",
      sequence: 1,
      item_number: "1",
      section_path: "Root",
      row_type: "Item",
    });
    const itemNumbers = async (cal) => (await fixture.env.DB
      .prepare(`SELECT b.item_number FROM ${currentBoqEvidenceFrom("b", cal)} WHERE b.source_document_id='doc-calendar' ORDER BY b.id`)
      .all()).results.map((row) => row.item_number);

    assert.deepEqual(await itemNumbers(calendar), ["1"], "the in-force bare-dated version supplies the evidence");
  } finally {
    fixture.close();
  }
});
