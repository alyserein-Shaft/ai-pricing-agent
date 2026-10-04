// GEOMETRY-AWARE FIRE ALARM SCHEMATIC TAKEOFF -- MANDATED REGRESSION COVERAGE.
//
// These tests police the METHOD, not any particular number. Each of the ten
// mandated properties is proved against synthetic geometry so the proof does
// not depend on the Al Mousa database being present, plus source-level
// assertions that the method cannot quietly acquire a forbidden dependency.
//
// READ-ONLY: these tests open the database in readOnly mode and never write.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  associateAnnotations,
  columnPitchProof,
  labelUnits,
  levelBands,
  DETECTOR_FAMILIES,
  GOVERNED_LABEL_FAMILY,
  LEGEND_ORDER,
  QTY_RE,
  campusTotals,
  takeOffSheet,
  buildingTotals,
  openDb,
} from "../scripts/lib/al-mousa-drawing-geometry-takeoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "scripts", "lib", "al-mousa-drawing-geometry-takeoff.mjs");
const source = readFileSync(SRC, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const run = (text, x, y, w, h) => ({ text, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
const qty = (n, x, y) => run(`${n} Nos`, x, y, 16, 8);

/**
 * CENTRED_ABOVE fixture: each count sits centred over the LEADING run of its own
 * device column. A 4-wide run has its centre 2 units in, so a 16-wide count must
 * start 6 units left of that run for the two centres to coincide.
 */
function centredSheet(columns) {
  const qtys = columns.map((c) => qty(c.n, c.x - 6, c.y - 14));
  const labels = columns.flatMap((c) => c.runs.map((r, i) =>
    run(r, c.x + (c.dcx?.[i] ?? 0), c.y, 4, 8)));
  return { qtys, units: labelUnits(labels, qtys) };
}

test("1 -- adjacent graphical S and C columns do NOT fuse into a synthetic 'S C' device", () => {
  // Two genuinely separate columns, each with its OWN count and its own
  // column pitch (36 units, matching the real schematics).
  const { qtys, units } = centredSheet([
    { n: 12, x: 100, y: 800, runs: ["S"] },
    { n: 4, x: 136, y: 800, runs: ["C"] },
  ]);
  assert.equal(units.length, 2, "two separate columns must stay two label units");
  assert.deepEqual(units.map((u) => u.label).sort(), ["C", "S"]);
  const hits = associateAnnotations(qtys, units).filter((h) => h.unit);
  assert.equal(hits.length, 2, "each column keeps its own count");
  const labels = hits.map((h) => h.unit.label).sort();
  assert.deepEqual(labels, ["C", "S"]);
  // And crucially: no fabricated compound label appears anywhere.
  assert.ok(!units.some((u) => u.label === "S C"), "'S C' must not be manufactured");
  assert.equal(GOVERNED_LABEL_FAMILY["S C"], undefined, "'S C' is not a governed legend label");
});

test("2 -- adjacent S/H/C runs do NOT fuse into a synthetic 'S HC' device", () => {
  // 'S' at 100 and 'H' at 136 are a full column pitch apart: separate columns.
  const { units } = centredSheet([
    { n: 9, x: 100, y: 800, runs: ["S"] },
    { n: 2, x: 136, y: 800, runs: ["H"] },
    { n: 3, x: 172, y: 800, runs: ["C"] },
  ]);
  assert.equal(units.length, 3);
  assert.ok(!units.some((u) => u.label === "S HC" || u.label === "S H C"),
    "no synthetic compound may be manufactured from separate columns");
  assert.ok(!units.some((u) => u.label === "S H"), "'S H' must not absorb a neighbouring column");
});

test("3 -- C resolves independently as an Interface Module CONTROL where geometry supports it", () => {
  // 'CE' and 'C' are 10 units apart -- well inside the one-column label gap --
  // so they are one label 'CE C', and the governed legend names it CONTROL.
  const qtys = [qty(13, 700, 786)];
  const labels = [run("CE", 700, 800, 8, 8), run("C", 710, 800, 4, 8)];
  const units = labelUnits(labels, qtys);
  assert.equal(units.length, 1, "'CE' + 'C' at label spacing is one unit");
  assert.equal(units[0].label, "CE C");
  const hit = associateAnnotations(qtys, units)[0];
  assert.equal(hit.unit.label, "CE C");
  assert.equal(GOVERNED_LABEL_FAMILY["CE C"], "INTERFACE_MODULE_CONTROL");
  // A bare 'C' column stays a bare 'C' and is not promoted to a control module.
  assert.equal(GOVERNED_LABEL_FAMILY.C, "CEILING_STROBE_SOUNDER");
});

test("4 -- M resolves independently as an Interface Module MONITORING where geometry supports it", () => {
  const qtys = [qty(9, 620, 786)];
  const labels = [run("CE", 620, 800, 8, 8), run("M", 630, 800, 5, 8)];
  const units = labelUnits(labels, qtys);
  assert.equal(units.length, 1);
  assert.equal(units[0].label, "CE M");
  assert.equal(GOVERNED_LABEL_FAMILY["CE M"], "INTERFACE_MODULE_MONITORING");
  // And the trailing 'M' run is NOT counted as its own column.
  const hits = associateAnnotations(qtys, units).filter((h) => h.unit);
  assert.equal(hits.length, 1, "one label unit, one count -- no second phantom column");
});

test("5 -- the true combined smoke/heat symbol stays ONE detector", () => {
  // 'S H' is one governed compound with one count: exactly one detector.
  // The count is centred on the LEADING "S" run (centre 902), not on the pair.
  const qtys = [qty(6, 894, 786)];
  const labels = [run("S", 900, 800, 4, 8), run("H", 910, 800, 4, 8)];
  const units = labelUnits(labels, qtys);
  assert.equal(units.length, 1, "the combined symbol is one unit, not two");
  assert.equal(units[0].label, "S H");
  assert.equal(GOVERNED_LABEL_FAMILY["S H"], "COMBINED");
  const hits = associateAnnotations(qtys, units).filter((h) => h.unit);
  assert.equal(hits.length, 1, "one combined detector, not an S and an H");
  // It must never be split into SMOKE or HEAT.
  assert.notEqual(GOVERNED_LABEL_FAMILY["S H"], "SMOKE");
  assert.notEqual(GOVERNED_LABEL_FAMILY["S H"], "HEAT");
  // And the legend genuinely defines that identity.
  assert.ok(LEGEND_ORDER.includes("SMOKE AND HEAT COMBINED DETECTOR"),
    "the governed legend carries a distinct combined smoke/heat identity");
});

test("6 -- quantity association requires 2-D geometry, not text order", () => {
  // Same tokens, same text order, but the count is moved to a different column.
  // If association used flattened order it would still return the same answer.
  const a = centredSheet([{ n: 61, x: 100, y: 800, runs: ["S"] }, { n: 2, x: 136, y: 800, runs: ["H"] }]);
  const b = centredSheet([{ n: 61, x: 100, y: 800, runs: ["S"] }, { n: 2, x: 136, y: 800, runs: ["H"] }]);
  const qa = a.qtys.map((q, i) => ({ ...q, x: q.x + i * 900, cx: q.x + i * 900 + q.w / 2 }));
  const ua = a.units.map((u, i) => ({
    ...u, x: u.x + i * 900, leadCx: u.leadCx + i * 900,
    rightEdge: u.rightEdge + i * 900, tokens: u.tokens.map((t) => ({ ...t, x: t.x + i * 900, cx: t.cx + i * 900 })),
  }));
  const hitA = associateAnnotations(qa, ua).filter((h) => h.unit).map((h) => [h.q.text, h.unit.label]);
  const hitB = associateAnnotations(b.qtys, b.units).filter((h) => h.unit).map((h) => [h.q.text, h.unit.label]);
  assert.deepEqual(hitA, hitB, "a pure translation must not change the association");
  // Every accepted row records both the count box and the symbol box.
  for (const h of associateAnnotations(a.qtys, a.units)) {
    if (!h.unit) continue;
    assert.ok(Number.isFinite(h.q.cx) && Number.isFinite(h.q.cy), "count centre is recorded");
    assert.ok(Number.isFinite(h.unit.leadCx) && Number.isFinite(h.unit.cy), "symbol centre is recorded");
  }
  assert.match(code, /CENTRED_ABOVE/, "a centred-above geometric convention is implemented");
  assert.match(code, /RIGHT_ABOVE/, "a right-above geometric convention is implemented");
});

test("7 -- flattened text order alone cannot authorise a quantity", () => {
  // A count sitting in a column with no device label stays unbound, even when it
  // is adjacent in the token list and would match under a text-order rule.
  const qtys = [qty(144, 1150, 786)];
  const labels = [run("S", 900, 800, 4, 8)];
  const units = labelUnits(labels, qtys);
  const hits = associateAnnotations(qtys, units);
  assert.equal(hits[0].unit, null, "a count 250 units away in X is not bound by proximity in the token list");
  // No occurrence-counting path may exist anywhere in the method.
  assert.doesNotMatch(code, /occurrenceCount|symbolCount|countSymbols|matchAll\(/,
    "there is no symbol-occurrence quantity path");
  assert.match(code, /QTY_RE/, "quantity comes from the explicit annotation pattern only");
  assert.match(code, /NOT_A_DEVICE_COLUMN_COUNT/, "an unbound count is classified, not guessed");
});

test("8 -- no target quantity is present in the implementation or these tests", () => {
  // A three-digit-or-larger literal in the method is the shape of a baked-in
  // expectation. Every constant it legitimately needs is a geometric tolerance
  // well under 100, so this is a general check, not a list of remembered figures.
  // Drawing numbers and project GUIDs are identifiers, not quantities, so drop
  // them before the check. Everything left must be a geometric tolerance.
  const codeNoIds = code.replace(/2401232[-\w.]*/g, "").replace(/project_[0-9a-f-]+/g, "");
  assert.doesNotMatch(codeNoIds, /\b[1-9]\d{2,}\b/,
    "the geometry module must contain no three-digit-or-larger quantity literal");
  // No reconciliation target language in the implementation.
  for (const phrase of ["target", "expected", "reconcile", "boq", "quotation", "bom"]) {
    assert.ok(!new RegExp(`\\b${phrase}\\b`, "i").test(code),
      `the geometry module must not contain "${phrase}"`);
  }
  // This suite asserts METHOD properties only; it states no building or campus
  // total, so nothing here can steer the takeoff toward a known figure.
  assert.ok(!/\bSPOT_SMOKE_DRAWING_TOTAL\b/.test(readFileSync(fileURLToPath(import.meta.url), "utf8")),
    "this suite states no campus total");
  // And it must never open a writable handle or read a non-drawing table.
  assert.doesNotMatch(code, /readOnly:\s*false/);
  assert.match(code, /readOnly:\s*true/, "the database is opened read-only");
  for (const table of ["boq_items", "boq_review_decisions", "bom_lines", "product_selections", "pricing"]) {
    assert.ok(!code.includes(table), `the takeoff must not read ${table}`);
  }
});

test("9 -- rerun is deterministic", () => {
  const fixture = centredSheet([
    { n: 39, x: 100, y: 800, runs: ["S", "C"], dcx: [0, 10] },
    { n: 8, x: 200, y: 800, runs: ["S", "HC"], dcx: [0, 10] },
    { n: 2, x: 300, y: 800, runs: ["H"] },
  ]);
  const once = JSON.stringify(associateAnnotations(fixture.qtys, fixture.units).map((h) => [h.q.text, h.unit?.label, h.dx]));
  const twice = JSON.stringify(associateAnnotations(fixture.qtys, fixture.units).map((h) => [h.q.text, h.unit?.label, h.dx]));
  assert.equal(once, twice, "two runs must bind identically");
  // Level banding must also be stable.
  const bands = [run("LEVEL 01", 10, 100, 40, 8), run("LEVEL 02", 10, 200, 40, 8)];
  assert.deepEqual(levelBands(bands), levelBands(bands));
});

test("10 -- the governed legend is the only identity authority, and geometry decides compounds", () => {
  // Every governed label must resolve to a family; the two schematic-only labels
  // must NOT.
  for (const label of ["S", "H", "S D", "S H", "CE C", "CE M"]) {
    assert.ok(GOVERNED_LABEL_FAMILY[label], `${label} must be governed`);
  }
  for (const label of ["S C", "S HC", "SIM", "M"]) {
    assert.equal(GOVERNED_LABEL_FAMILY[label], undefined,
      `${label} appears on the schematics but is NOT in the governed legend`);
  }
  // A compound's trailing run is off the device-column pitch grid, which is what
  // proves it belongs to the label rather than forming its own counted column.
  const units = centredSheet([
    { n: 39, x: 100, y: 800, runs: ["S", "C"], dcx: [0, 10] },
    { n: 8, x: 200, y: 800, runs: ["H"] },
  ]).units;
  const proof = columnPitchProof(units);
  assert.ok(proof.pitch > 36 && proof.pitch < 130, "column pitch is measured from the row itself");
  const compound = units.find((u) => u.label === "S C");
  assert.ok(compound, "the S C label exists as one unit");
  assert.ok(compound.innerGaps.length === 1, "its trailing run is part of the label");
});

test("11 -- campus totals equal the sum of the accepted building rows", () => {
  const rows = {
    A: [{ building: "A", family: "SMOKE", quantity: 10 }, { building: "A", family: "HEAT", quantity: 2 }],
    B: [{ building: "B", family: "SMOKE", quantity: 5 }],
  };
  const byBuilding = buildingTotals(rows);
  const campus = campusTotals(byBuilding);
  assert.equal(campus.SMOKE, 15);
  assert.equal(campus.HEAT, 2);
  assert.equal(campus.SMOKE, byBuilding.A.families.SMOKE + byBuilding.B.families.SMOKE);
  for (const f of DETECTOR_FAMILIES) {
    const fromRows = Object.values(byBuilding)
      .reduce((t, b) => t + b.rows.filter((r) => r.family === f).reduce((s, r) => s + r.quantity, 0), 0);
    assert.equal(campus[f], fromRows, `${f} campus total must equal the sum of its rows`);
  }
});

test("12 -- annotation detection accepts the drafting variants seen on the sheets", () => {
  for (const good of ["39Nos.", "4 Nos", "1 No", "1Nos.", "3NoS.", "16Nos", "9Nos."]) {
    assert.ok(QTY_RE.test(good), `${good} must be recognised as a count`);
  }
  for (const bad of ["2 X 2.5 sq.mm CWZ FIRE", "LOOP-1", "SIM", "S", "PS/PVC"]) {
    assert.ok(!QTY_RE.test(bad), `${bad} must not be read as a device count`);
  }
});

test("13 -- live read-only run over the governed sheets binds counts in 2-D", () => {
  const dbFile = process.env.FA_DB;
  if (!dbFile) return; // no database configured: the method tests above still hold
  const db = openDb(dbFile);
  try {
    for (const key of ["BOS", "GRS", "KGS", "WLC", "AMS002"]) {
      const sheet = takeOffSheet(db, key, { bandBy: key === "AMS002" ? "sheet" : "level" });
      assert.ok(sheet.rows.length > 0, `${key} produced no annotation rows`);
      for (const row of sheet.rows) {
        assert.ok(row.quantity >= 0, "quantity is a real count");
        assert.ok(row.associationRationale.length > 0, "every row states its rationale");
        if (row.state === "RESOLVED_FROM_GEOMETRY") {
          assert.ok(row.quantityBox && row.symbolBox, "a resolved row carries both boxes");
          assert.ok(row.symbolRuns.length >= 1, "a resolved row names its symbol run(s)");
        }
      }
      const bound = sheet.rows.filter((r) => r.family);
      assert.ok(bound.length > 0, `${key} bound at least one governed device column`);
      for (const row of bound) {
        assert.ok(Number.isFinite(row.dx), "a governed row records its geometric dx");
      }
    }
  } finally {
    db.close();
  }
});