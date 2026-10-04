// FOCUSED: the governed Fire Alarm drawing device-schedule parser.
//
// These invariants are the ones the sizing lane depends on, and each one was a
// real failure mode observed on the actual Al Mousa sheets:
//
//  1. LAYOUT IS DETECTED FROM GEOMETRY, never from the filename. BOS is
//     landscape and row-per-floor; WLC is portrait and column-per-floor. The
//     parser must pick the right strategy from the assets alone.
//  2. A printed subtotal is associated with the class codes printed BENEATH it,
//     by geometry, with no hardcoded sheet coordinates.
//  3. THE PRINTED ROW TOTAL AND THE COMPONENT SUM ARE BOTH PRESERVED. They
//     differ on the real sheets by 1-2 units, and normalising that away would
//     manufacture a clean number the drawing never printed.
//  4. A floor whose subtotals do not account for its printed total is reported
//     UNRESOLVED -- never silently completed.
//  5. CLASS CODES ARE NEVER INTERPRETED HERE. S/H/C/M could mean anything; the
//     device-class and SLC-address semantics belong to a separate authority.
//  6. DETERMINISTIC AND IDEMPOTENT: the same assets always produce the same
//     result, and parsing twice changes nothing.
//  7. MALFORMED GEOMETRY FAILS CLOSED: an asset without a readable bounding box
//     is dropped, not guessed at, and a sheet with no floor labels is reported
//     UNSUPPORTED_LAYOUT rather than producing invented floors.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFireAlarmDeviceSchedule,
  detectScheduleLayout,
  toPositionedAssets,
  SCHEDULE_LAYOUT_STRATEGIES,
} from "../app/domain/fire-alarm-drawing-device-schedule.mjs";

const box = (x, y, width = 18, height = 8) => ({ x, y, width, height, pageWidth: 3370, pageHeight: 2384 });
const asset = (text, x, y, extra = {}) => ({ text_content: text, bounding_box: JSON.stringify(box(x, y, extra.width, extra.height)), asset_type: "Text", ...extra });

// A minimal but STRUCTURALLY FAITHFUL BOS-style row: a floor label, a printed
// row total with no class cell beneath it, and two class-attributed subtotals.
const bosLike = [
  asset("LEVEL 01", 522.1, 1190.8, { width: 33.8 }),
  asset("58Nos.", 1027.5, 1222.3, { width: 19.0 }),
  asset("S", 1034.3, 1237.5),
  asset("C", 1044.5, 1237.0),
  asset("61Nos.", 1107.1, 1223.2, { width: 19.0 }),
  asset("S", 1114.2, 1237.9),
  asset("131Nos.", 1156.4, 1244.1, { width: 22.3 }),
  asset("LEVEL 02", 522.1, 1390.0, { width: 33.8 }),
  asset("52Nos.", 1107.1, 1420.0, { width: 19.0 }),
  asset("S", 1114.2, 1437.0),
  asset("121Nos.", 1156.4, 1444.0, { width: 22.3 }),
];

test("layout is detected from GEOMETRY, not the filename", () => {
  const bos = parseFireAlarmDeviceSchedule({ assets: bosLike, sheetCode: "BOS-005" });
  assert.equal(bos.strategy, "LEVEL_BAND_SUBTOTAL");
  assert.ok(SCHEDULE_LAYOUT_STRATEGIES.includes(bos.strategy));

  // WLC: portrait, four floor labels side by side at ONE y.
  const wlc = parseFireAlarmDeviceSchedule({
    sheetCode: "WLC-005",
    assets: [
      asset("GROUND FLOOR", 200, 830, { width: 60 }),
      asset("LEVEL 01", 700, 830, { width: 60 }),
      asset("ROOF 01", 1200, 830, { width: 60 }),
      asset("ROOF 02", 1700, 830, { width: 60 }),
      asset("SM-01", 200, 900, { width: 40 }),
      asset("SM", 220, 905),
      asset("1 No", 200, 950),
      asset("2 Nos", 200, 990),
    ],
  });
  assert.equal(wlc.strategy, "LEVEL_COLUMN_STACK");
});

test("a printed subtotal is associated with the class codes beneath it", () => {
  const parsed = parseFireAlarmDeviceSchedule({ assets: bosLike, sheetCode: "BOS-005" });
  const level1 = parsed.floors.find((floor) => floor.level === "LEVEL 01");
  assert.ok(level1, "LEVEL 01 must be parsed");

  const byValue = Object.fromEntries(level1.subtotals.map((entry) => [entry.value, entry.classCodes]));
  assert.deepEqual(byValue[58], ["C", "S"], "58Nos. is printed over S and C");
  assert.deepEqual(byValue[61], ["S"], "61Nos. is printed over S");

  // The printed row total is the wide cell with NO class cell beneath it.
  assert.equal(level1.printedRowTotal.value, 131);
  // Raw printed text and source coordinates are retained.
  const entry = level1.subtotals.find((item) => item.value === 61);
  assert.equal(entry.raw, "61Nos.");
  assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.y));
});

test("the printed row total and the component sum are BOTH preserved", () => {
  // 58 + 61 = 119 against a printed row total of 131: a real 12-unit gap on a
  // synthetic sheet, standing in for the observed 1-2 unit gaps. The parser must
  // report BOTH numbers and the delta, never reconcile them.
  const parsed = parseFireAlarmDeviceSchedule({ assets: bosLike });
  const level1 = parsed.floors.find((floor) => floor.level === "LEVEL 01");
  assert.equal(level1.componentSum, 119);
  assert.equal(level1.printedRowTotal.value, 131);
  assert.equal(level1.discrepancy.printedRowTotal, 131);
  assert.equal(level1.discrepancy.componentSum, 119);
  assert.equal(level1.discrepancy.delta, 12);
  assert.ok(parsed.discrepancies.length > 0, "the sheet discrepancy must surface at the sheet level");
  assert.ok(level1.unresolved, "a floor whose parts do not account for its total is UNRESOLVED");
});

test("a floor that reconciles exactly is COMPLETE, not unresolved", () => {
  const clean = [
    asset("LEVEL 01", 522.1, 1190.8, { width: 33.8 }),
    asset("60Nos.", 1027.5, 1222.3, { width: 19.0 }),
    asset("S", 1034.3, 1237.5),
    asset("70Nos.", 1107.1, 1223.2, { width: 19.0 }),
    asset("S", 1114.2, 1237.9),
    asset("130Nos.", 1156.4, 1244.1, { width: 22.3 }),
  ];
  const parsed = parseFireAlarmDeviceSchedule({ assets: clean });
  const level1 = parsed.floors[0];
  assert.equal(level1.componentSum, 130);
  assert.equal(level1.discrepancy.delta, 0);
  assert.equal(level1.unresolved, false);
  assert.equal(parsed.confidence, "COMPLETE");
});

test("class codes are collected but NEVER interpreted", () => {
  const parsed = parseFireAlarmDeviceSchedule({ assets: bosLike });
  assert.deepEqual(parsed.classCodesSeen, ["C", "S"]);
  // No engineering meaning may be asserted anywhere in the parser output.
  const serialised = JSON.stringify(parsed);
  for (const forbidden of ["smoke", "detector", "module", "monitor", "heat", "SLC", "address"]) {
    assert.equal(
      serialised.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `parser output must not assert device semantics (found "${forbidden}")`,
    );
  }
});

test("parsing is deterministic and idempotent", () => {
  const first = parseFireAlarmDeviceSchedule({ assets: bosLike, sheetCode: "BOS-005" });
  const second = parseFireAlarmDeviceSchedule({ assets: bosLike, sheetCode: "BOS-005" });
  assert.deepEqual(first, second);
  const third = parseFireAlarmDeviceSchedule({ assets: [...bosLike].reverse(), sheetCode: "BOS-005" });
  assert.deepEqual(first.floors, third.floors, "input order must not change the result");
});

test("a column-stack sheet never asserts an invented per-floor total", () => {
  const parsed = parseFireAlarmDeviceSchedule({
    sheetCode: "WLC-005",
    assets: [
      asset("GROUND FLOOR", 200, 830, { width: 60 }),
      asset("LEVEL 01", 700, 830, { width: 60 }),
      asset("SM-01", 200, 900, { width: 40 }),
      asset("SM", 220, 905),
      asset("1 No", 200, 950),
      asset("2 Nos", 200, 990),
    ],
  });
  assert.equal(parsed.strategy, "LEVEL_COLUMN_STACK");
  assert.equal(parsed.confidence, "PARTIAL");
  const column = parsed.floors[0];
  assert.equal(column.unresolved, true);
  assert.ok(column.unresolvedReason, "the unresolved reason must be explicit");
  assert.equal(column.componentSum, null, "no derived sum may be invented for a column layout");
  assert.equal(column.printedRowTotal, null);
  assert.equal(column.quantityCells.length, 2, "individual cells are still preserved");
});

test("malformed geometry and absent floor labels fail closed", () => {
  // Unreadable bounding box -> dropped, not guessed.
  const withBad = parseFireAlarmDeviceSchedule({
    assets: [...bosLike, { text_content: "S", bounding_box: "not json", asset_type: "Text" }],
  });
  assert.equal(withBad.positionedAssetCount, bosLike.length, "the unparseable asset must be dropped");

  // No floor labels at all -> UNSUPPORTED_LAYOUT, zero invented floors.
  const none = parseFireAlarmDeviceSchedule({ assets: [asset("NAC LOOP", 10, 10)] });
  assert.equal(none.strategy, null);
  assert.equal(none.confidence, "UNSUPPORTED_LAYOUT");
  assert.equal(none.floors.length, 0);
  assert.ok(none.layoutReason);
});

test("layout detection is exposed and explains its decision", () => {
  const detection = detectScheduleLayout(toPositionedAssets(bosLike));
  assert.equal(detection.strategy, "LEVEL_BAND_SUBTOTAL");
  assert.ok(detection.reason.includes("vertically"), "the reason must state the geometric basis");

  const single = detectScheduleLayout(toPositionedAssets([asset("LEVEL 01", 10, 10)]));
  assert.ok(single.reason, "a single label must still be explained");
});
