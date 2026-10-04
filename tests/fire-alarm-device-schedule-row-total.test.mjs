/**
 * Focused tests for the printed-row-total selection rule.
 *
 * THE DEFECT THESE EXIST FOR. The rule used to be "the first quantity cell with
 * no class codes beneath it is the printed row total". That holds only when a
 * floor prints exactly one unattributed quantity. KGS prints TWO on every floor:
 * a small per-class quantity and the real row total. The first-by-position rule
 * took the small one, so every KGS floor reported a printed total of 2-9 against
 * a component sum in the hundreds -- which is how a sheet whose quantity cells
 * sum to 1281 was reported as a printed total of 23.
 *
 * The rule is now geometric: the printed row total is the unattributed cell
 * lying OUTSIDE the horizontal span of that floor's class-attributed subtotals.
 *
 * These tests use the REAL KGS / BOS / GRS geometry measured from the governed
 * Al Mousa intake, not invented fixtures, so a regression on the actual sheets
 * cannot pass.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEDULE_PARSER_VERSION,
  parseFireAlarmDeviceSchedule,
  detectScheduleLayout,
  toPositionedAssets,
} from "../app/domain/fire-alarm-drawing-device-schedule.mjs";

/** Builds an ingested-asset row at a position, as drawing_assets stores it. */
const at = (text, x, y, height = 8) => ({
  id: `a_${text}_${x}_${y}`,
  text_content: text,
  bounding_box: JSON.stringify({ x, y, width: Math.max(text.length * 4, 4), height }),
});

/**
 * A KGS GROUND FLOOR-shaped band, from the real geometry:
 * seven class-attributed subtotals at x -893..-676, then TWO unattributed
 * quantities -- "9Nos." inside the block at x=-867 and the real total
 * "185Nos." at x=-632, outside it.
 */
const KGS_GROUND_FLOOR = [
  at("GROUND FLOOR", -1110, -331, 16),
  at("LEVEL 01", -1110, 195, 16),
  // subtotals with class codes beneath
  at("11Nos.", -855, 44),
  at("3Nos.", -821, 55),
  at("17Nos.", -783, 55),
  at("57Nos.", -752, 55),
  at("4Nos.", -711, 55),
  at("6Nos.", -893, 55),
  at("86Nos.", -676, 56),
  // class codes
  at("M", -840, 64),
  at("M", -875, 66),
  at("F", -813, 69),
  at("S", -743, 70),
  at("C", -733, 70),
  at("F", -778, 70),
  at("H", -706, 70),
  at("S", -670, 70),
  at("CE", -887, 72),
  at("CE", -851, 72),
  // the two unattributed quantities
  at("9Nos.", -867, 76),
  at("185Nos.", -632, 77),
];

const floorTotals = (result) =>
  Object.fromEntries((result.floors ?? []).map((f) => [f.level, f.printedRowTotal?.value ?? null]));

test("ROOT CAUSE REGRESSION: KGS picks the row total OUTSIDE the subtotal span, not the first bare cell", () => {
  const result = parseFireAlarmDeviceSchedule({ assets: KGS_GROUND_FLOOR, sheetCode: "KGS" });

  assert.equal(result.strategy, "LEVEL_BAND_SUBTOTAL");
  const groundFloor = result.floors.find((f) => f.level === "GROUND FLOOR");
  assert.ok(groundFloor, "the GROUND FLOOR row must be recovered");

  // 185, not 9.
  assert.equal(
    groundFloor.printedRowTotal?.value,
    185,
    "the printed row total must be 185Nos., the cell outside the subtotal block",
  );
  assert.equal(groundFloor.componentSum, 184);
  assert.equal(groundFloor.discrepancy.delta, 1);
  // delta 1 is non-zero, so the floor stays unresolved by design. The parser
  // never declares a floor COMPLETE while printed and component disagree, and the
  // repair must not weaken that to make this test tidier.
  assert.equal(groundFloor.unresolved, true);
  assert.equal(groundFloor.discrepancy.printedRowTotal, 185);
  assert.equal(groundFloor.discrepancy.componentSum, 184);
});

test("the old first-bare-cell behaviour would have produced the defect", () => {
  // Guards the regression itself: the fixture must still contain the bare cell
  // the old rule picked. If this stops being true, the fixture no longer
  // reproduces the bug and the test above would pass for the wrong reason.
  //
  // BARE means "no class codes beneath", which is what the old rule keyed on.
  // The 11Nos. cell also has codes beneath it, so it is not a candidate at all.
  const rows = KGS_GROUND_FLOOR.map((r) => ({
    ...JSON.parse(r.bounding_box),
    t: r.text_content,
  }));
  const cls = rows.filter((r) => /^[A-Z]{1,4}$/.test(r.t));
  const bare = rows
    .filter((r) => /Nos?\./.test(r.t))
    .filter((cell) => {
      const window = Math.max(24, cell.height * 4);
      return !cls.some(
        (o) =>
          o !== cell &&
          o.y > cell.y &&
          o.y <= cell.y + window &&
          o.x >= cell.x - 12 &&
          o.x <= cell.x + 60,
      );
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  assert.deepEqual(
    bare.map((b) => Number(/(\d+)/.exec(b.t)[1])),
    [9, 185],
    "the fixture must reproduce exactly two bare quantity cells",
  );
  assert.equal(bare[0].x, -867);
  assert.equal(
    Number(/(\d+)/.exec(bare[0].t)[1]),
    9,
    "position-first selection -- the old rule -- yields the wrong value 9",
  );
});

test("BOS REGRESSION: one bare cell is accepted unchanged", () => {
  // BOS prints exactly one unattributed quantity per floor. The real geometry.
  // The FULL measured BOS GROUND FLOOR band: nine class-attributed subtotals and
  // one bare quantity at x=1156, outside the subtotal span 669..956.
  const bos = [
    at("GROUND FLOOR", 522, 665, 16),
    at("LEVEL 01", 522, 1191, 16),
    at("9Nos.", 703, 820),
    at("8Nos.", 810, 831),
    at("39Nos.", 845, 831),
    at("2Nos.", 886, 831),
    at("1No.", 924, 831),
    at("3Nos.", 738, 831),
    at("17Nos.", 775, 831),
    at("3Nos.", 669, 832),
    at("61Nos.", 956, 832),
    // class codes beneath, at the real measured positions
    at("H", 936, 841),
    at("M", 720, 843),
    at("M", 685, 843),
    at("F", 745, 845),
    at("S", 816, 846),
    at("HC", 825, 846),
    at("S", 854, 846),
    at("C", 863, 846),
    at("F", 781, 846),
    at("H", 891, 846),
    at("S", 962, 846),
    at("S", 927, 846),
    at("CE", 707, 848),
    at("CE", 672, 848),
    at("144Nos.", 1156, 1033),
  ];
  const r = parseFireAlarmDeviceSchedule({ assets: bos, sheetCode: "BOS" });
  const gf = r.floors.find((f) => f.level === "GROUND FLOOR");
  assert.equal(gf.printedRowTotal?.value, 144);
  assert.equal(gf.componentSum, 9 + 8 + 39 + 2 + 1 + 3 + 17 + 3 + 61);
  assert.equal(gf.componentSum, 143);
  assert.equal(gf.discrepancy.delta, 1);
});

test("ambiguity is reported as unresolved, never resolved by picking the largest value", () => {
  // Two bare cells, BOTH outside the subtotal span. The rule cannot choose, so it
  // must return null. A value-based "take the max" heuristic would silently
  // absorb a real drawing discrepancy.
  // NOTE: the band filter excludes cells more than 900px from the level label's x,
  // so both bare cells must stay inside that window to reach the rule.
  const ambiguous = [
    at("GROUND FLOOR", 0, 100, 16),
    at("LEVEL 01", 0, 500, 16),
    at("10Nos.", 300, 200),
    at("M", 305, 220),
    at("20Nos.", 700, 210),
    at("900Nos.", 860, 205),
  ];
  const r = parseFireAlarmDeviceSchedule({ assets: ambiguous, sheetCode: "AMBIG" });
  const gf = r.floors.find((f) => f.level === "GROUND FLOOR");
  assert.equal(gf.printedRowTotal, null, "an ambiguous row total must not be guessed");
  assert.equal(gf.unresolved, true);
});

test("a floor with no subtotals cannot have a span, so its bare cells are not a row total", () => {
  const noSubtotals = [
    at("GROUND FLOOR", 0, 100, 16),
    at("LEVEL 01", 0, 500, 16),
    at("7Nos.", 300, 200),
    at("8Nos.", 400, 210),
  ];
  const r = parseFireAlarmDeviceSchedule({ assets: noSubtotals, sheetCode: "NOSUB" });

  // A floor with neither subtotals nor a resolvable row total contributes no
  // usable quantity evidence, so the existing contract drops it rather than
  // emitting a floor that looks measured. What matters here is that the rule did
  // not invent a row total: had it guessed one, this floor would appear.
  const gf = r.floors.find((f) => f.level === "GROUND FLOOR");
  assert.equal(
    gf,
    undefined,
    "a floor with no subtotals and an unresolvable row total is dropped, not invented",
  );
  assert.equal(r.floors.length, 0);
});

test("a genuine discrepancy is preserved, not normalised away", () => {
  // KGS BASEMENT 01 measures 144 printed against a component sum of 57. That is a
  // real observation about the sheet. The repair must leave it visible.
  // The real measured KGS BASEMENT 01 band. Note "2Nos." at x=-779, y=-456 is
  // ABOVE the class-code row and so has no codes beneath it, and "144Nos." at
  // x=-566 sits outside the subtotal span (-885..-600).
  const basement = [
    at("BASEMENT 01", -1110, -485, 16),
    at("GROUND FLOOR", -1110, -331, 16),
    at("2Nos.", -779, -456),
    at("2Nos.", -885, -443),
    at("1No.", -850, -443),
    at("9Nos.", -817, -443),
    at("5Nos.", -745, -442),
    at("2Nos.", -708, -442),
    at("2Nos.", -670, -442),
    at("1No.", -632, -442),
    at("33Nos.", -600, -441),
    at("M", -765, -433),
    at("D", -620, -432),
    at("C", -834, -431),
    at("M", -800, -431),
    at("F", -738, -428),
    at("F", -702, -427),
    at("H", -665, -427),
    at("S", -629, -427),
    at("S", -594, -427),
    at("CE", -883, -425),
    at("CE", -847, -425),
    at("CE", -812, -425),
    at("CE", -776, -425),
    at("2Nos.", -794, -421),
    at("144Nos.", -566, -420),
  ];
  const r = parseFireAlarmDeviceSchedule({ assets: basement, sheetCode: "KGS" });
  const b = r.floors.find((f) => f.level === "BASEMENT 01");
  assert.equal(b.printedRowTotal?.value, 144, "the outside-span cell is the row total");
  // Component sum is whatever the real class attribution yields; assert it is a
  // real positive figure rather than the previously mis-selected small value.
  assert.ok(b.componentSum > 0, "subtotals must still be attributed");
  assert.notEqual(b.printedRowTotal.value, 2, "must not select the unattributed 2Nos. cell");
  assert.equal(b.discrepancy.printedRowTotal, 144);
  assert.equal(
    b.unresolved,
    true,
    "printed 144 against a component sum far below it must remain unresolved, not normalised",
  );
});

test("class codes are still never interpreted by the parser", () => {
  // The row-total repair must not have introduced semantics. The serialised
  // output may contain the codes themselves but never a device meaning.
  const r = parseFireAlarmDeviceSchedule({ assets: KGS_GROUND_FLOOR, sheetCode: "KGS" });
  const serialised = JSON.stringify(r);
  for (const word of ["SMOKE", "HEAT", "DETECTOR", "MANUAL", "JACK", "MODULE", "STROBE", "TELEPHONE"]) {
    assert.ok(
      !serialised.includes(word),
      `parser output must not contain the device meaning "${word}"`,
    );
  }
  assert.ok(serialised.includes("CE"), "the raw class code itself is preserved");
});

test("the repair did not change determinism or the parser version contract", () => {
  const a = parseFireAlarmDeviceSchedule({ assets: KGS_GROUND_FLOOR, sheetCode: "KGS" });
  const b = parseFireAlarmDeviceSchedule({ assets: [...KGS_GROUND_FLOOR].reverse(), sheetCode: "KGS" });
  assert.deepEqual(floorTotals(a), floorTotals(b));
  assert.equal(a.parserVersion, SCHEDULE_PARSER_VERSION);
});