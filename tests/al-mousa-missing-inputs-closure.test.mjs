// MISSING ENGINEERING INPUTS -- CLOSURE PASS REGRESSIONS.
//
// Each test encodes one way a procurement BOM gets quietly wrong: a number
// appears where evidence is absent. The gates here are deliberately strict, and
// several of them FAIL against the artefacts they are meant to police -- that
// is the point, and it is recorded rather than asserted away.
//
// Run with FA_DB=<sqlite> to additionally audit the real approved evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readApprovedArchitectureFacts, drawnLoopsPerDrawing, facpServedAreas,
  expansionForPanel, expansionSummary, campusAggregateExpansion, panelTable,
  panelLocationConflicts, nacCalculationStatus, firephoneCircuitSupport, ductAccessoryStatus,
  notificationExactSelection,
} from "../scripts/lib/al-mousa-missing-inputs-closure.mjs";
import { NOTIFICATION_GROUPS } from "../scripts/lib/al-mousa-notification-resolution.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DB_PATH = process.env.FA_DB;
const readFile = (p) => readFileSync(join(REPO, p), "utf8");

let FACTS = [];
let LEGEND = [];
if (DB_PATH) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  FACTS = readApprovedArchitectureFacts(db);
  LEGEND = db.prepare("SELECT description, abbreviation FROM drawing_structure_approved_rows").all();
}

// 1 -------------------------------------------------------------------------
test("1 -- missing mounting or candela cannot produce an exact notification P/N", () => {
  const rows = notificationExactSelection();
  assert.equal(rows.length, NOTIFICATION_GROUPS.length);
  for (const r of rows) {
    assert.notEqual(r.status, "EXACT_SELECTION", "no notification family may claim an exact P/N while inputs are open");
    assert.ok(r.missing.length > 0, "each family must report at least one blocking discriminator");
  }
  // Mounting is a SKU discriminator, not a field setting.
  const blocked = rows.find((r) => r.missing.some((m) => /MOUNTING/.test(m)));
  assert.ok(blocked, "an unresolved wall/ceiling split must block exact selection");
  assert.ok(blocked.missing.some((m) => /CANDELA/.test(m)));
  // Stripping the remaining discriminators still must not silently pass.
  const fabricated = { ...NOTIFICATION_GROUPS[0], mounting: "CEILING", bodyColour: "red", wiring: "2-wire" };
  const r = evaluateExact(fabricated);
  assert.equal(r.status, "CONFIGURATION_ASSUMPTION_REQUIRED");
  assert.ok(r.missing.some((m) => /CANDELA/.test(m)), "resolving mounting alone must not unlock the exact P/N");
});

const evaluateExact = (g) => notificationExactSelection([g])[0];

// 2 -------------------------------------------------------------------------
test("2 -- campus totals cannot create panel allocations", () => {
  const drawn = campusAggregateExpansion({ campusLoopMinimum: 10, panelCount: 7 });
  assert.equal(drawn.status, "AGGREGATE_MINIMUM_ONLY");
  assert.equal(drawn.forbidden, true);
  // A panel with no drawn loop schedule is pending, not a zero-loop panel.
  const absent = expansionForPanel({ drawnLoopCount: null });
  assert.equal(absent.status, "PENDING_INPUT");
  assert.equal(absent.loopCards, null);
  assert.notEqual(absent.loopCards, 0, "an undrawn schedule must never be reported as zero expansion");
  if (DB_PATH) {
    const served = facpServedAreas(FACTS);
    assert.equal(served.size, 6, "six distinct FACP served areas are approved");
    for (const area of ["BOYS SCHOOL", "GIRLS SCHOOL", "WELCOME CENTER", "SUB STATION -1", "SUB STATION -2", "DG STATION"]) {
      assert.ok(served.has(area), `${area} must be an evidenced FACP served area`);
    }
    // Two PRIMARY MFACP locations conflict; neither may be silently chosen.
    const conflicts = panelLocationConflicts(FACTS);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].requiresApproval, true);

    const table = panelTable(FACTS);
    const pending = table.filter((p) => p.allocationStatus === "AREA_KNOWN_LOOPS_NOT_DRAWN");
    assert.ok(pending.length > 0, "at least one served area has no drawn loop schedule and must stay pending");
    for (const p of pending) assert.equal(p.knownSlcCount, null);
  }
});

// 3 -------------------------------------------------------------------------
test("3 -- SLM/loop expansion quantity cannot be finalised from total loop arithmetic", () => {
  // Per panel: six drawn loops means five loop cards, whatever the campus sum.
  const six = expansionForPanel({ drawnLoopCount: 6 });
  assert.equal(six.status, "EVIDENCED");
  assert.equal(six.loopCards, 5);
  assert.equal(six.kits, 3);
  const two = expansionForPanel({ drawnLoopCount: 2 });
  assert.equal(two.loopCards, 1);
  const one = expansionForPanel({ drawnLoopCount: 1 });
  assert.equal(one.loopCards, 0);
  assert.ok(one.note, "a single-loop panel needs no expansion and must say so");

  if (DB_PATH) {
    const drawn = drawnLoopsPerDrawing(FACTS);
    assert.equal(drawn.reduce((t, d) => t + d.drawnLoopCount, 0), 24, "24 loops are drawn across the evidenced sheets");
    const summary = expansionSummary(drawn);
    // Per-panel expansion is 19 cards -- the campus aggregate said 4.
    assert.equal(summary.evidencedLoopCards, 19);
    assert.ok(summary.evidencedLoopCards > campusAggregateExpansion({ campusLoopMinimum: 10, panelCount: 7 }).loopCards,
      "per-panel allocation must exceed the campus-aggregate figure it replaces");
  }
});

// 4 -------------------------------------------------------------------------
test("4 -- N16-XUPG2 is not inferred from expansion-module use alone", () => {
  const src = readFile("scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs");
  const line = src.split("\n").find((l) => /N16-XUPG2/.test(l));
  assert.ok(line, "the persona licence must remain present in the census");
  assert.match(line, /never inferred from panel count or from additional SLM count/);
  assert.match(line, /exceed 3/, "the licence must be gated on per-panel loop requirement");
  assert.match(line, /qty: null/, "the licence quantity must stay open while allocation is unproven");
});

// 5 -------------------------------------------------------------------------
test("5 -- firephone jack count cannot equal FTM-1 count without circuit evidence", () => {
  const r = firephoneCircuitSupport(FACTS, 73, LEGEND);
  assert.equal(r.evidencedCircuits, 0);
  assert.equal(r.supportedFtm1Modules, null, "no module count may be derived from a jack count");
  assert.equal(r.status, "PENDING_INPUT");
  assert.match(r.rule, /does NOT imply 73 FTM-1/);
  if (DB_PATH) {
    // An FTCP symbol exists in the approved legend: real equipment type,
    // but no proven circuit count or panel assignment.
    assert.equal(r.centralEquipmentRequired, "FTCP_SYMBOL_EXISTS_PLACEMENT_UNPROVEN");
  }
});

// 6 -------------------------------------------------------------------------
test("6 -- MDL3 quantity cannot be derived from the total strobe count", () => {
  const census = readFile("scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs");
  const line = census.split("\n").find((l) => /pn: "MDL3"/.test(l));
  assert.ok(line, "the sync module must remain present in the census");
  assert.match(line, /topology-driven only -- never inferred from the mere existence of strobes/);
  assert.match(line, /qty: null/, "MDL3 quantity must stay open while NAC zoning is unproven");
  assert.match(readFile("scripts/build-al-mousa-farenhyt-internal-bom.mjs"), /MDL3 is therefore NOT REQUIRED BY/,
    "the panel-capability finding must stay on the record");
});

// 7 -------------------------------------------------------------------------
test("7 -- power calculation stays pending when NAC allocation, current or routing is incomplete", () => {
  const nac = nacCalculationStatus(FACTS);
  assert.equal(nac.status, "PENDING_INPUT");
  for (const row of nac.perNac) {
    assert.equal(row.calculationStatus, "PENDING_INPUT");
    for (const f of ["deviceCount", "candela", "alarmCurrent", "circuitLength", "wireSize", "syncMethod", "supplySource"]) {
      assert.equal(row[f], null, `NAC ${f} must be null, never synthesised`);
    }
  }
  if (DB_PATH) assert.ok(nac.nacFactCount > 0, "NAC facts exist, and still cannot drive an allocation");
});

// 8 -------------------------------------------------------------------------
test("8 -- sampling-tube selection requires duct dimension evidence", () => {
  const none = ductAccessoryStatus({ ductDetectorCount: 45 });
  assert.equal(none.samplingTube, "PENDING_DUCT_DIMENSION");
  assert.equal(none.status, "PENDING_INPUT");
  assert.equal(none.unresolvedUnits, 45, "no proven indoor/outdoor split leaves all 45 unresolved");
  const withWidth = ductAccessoryStatus({ ductDetectorCount: 45, evidencedDuctWidths: [{ mm: 1200 }] });
  assert.equal(withWidth.samplingTube, "SIZING_POSSIBLE");
  assert.equal(withWidth.status, "PARTIAL", "a duct dimension alone still does not close the accessory schedule");
});

// 9 -------------------------------------------------------------------------
test("9 -- DNRW cannot be inferred from the phrase 'duct detector'", () => {
  const r = ductAccessoryStatus({ ductDetectorCount: 45 });
  assert.equal(r.dnrwQtyProven, 0, "nothing is proven weatherproof without an evidenced environment");
  assert.ok(r.rules.some((x) => /do not establish an outdoor/i.test(x)));
  assert.match(readFile("scripts/build-al-mousa-farenhyt-internal-bom.mjs"), /ST-10|DNRW/i,
    "the sampling-tube line must remain an open configuration item");
});

// 10 ------------------------------------------------------------------------
test("10 -- cross-sheet evidence preserves applicability scope", () => {
  const src = readFile("scripts/lib/al-mousa-missing-inputs-closure.mjs");
  assert.match(src, /never proves a device quantity/, "a legend must not be promoted to a device count");
  assert.match(src, /per source drawing/i);
  if (DB_PATH) {
    const drawn = drawnLoopsPerDrawing(FACTS);
    assert.ok(drawn.length >= 5, "loops must stay partitioned per source sheet, not merged");
    for (const d of drawn) assert.ok(d.drawing.length > 0 && d.pages.length > 0, "each loop group keeps its sheet and page provenance");
    // Two sheets may both exist without the facts merging into a campus figure.
    assert.equal(new Set(drawn.map((d) => d.drawing)).size, drawn.length);
  }
});

// 11 ------------------------------------------------------------------------
test("11 -- exact BOM quantities are blocked whenever the evidence chain is incomplete", () => {
  const summary = expansionSummary([{ drawing: "A", drawnLoopCount: 6 }, { drawing: "B", drawnLoopCount: null }]);
  assert.equal(summary.status, "PARTIAL");
  assert.equal(summary.evidenced.length, 1);
  assert.equal(summary.pending.length, 1, "an unevidenced panel must remain visible as pending");
  assert.equal(summary.pending[0].kits, null);
  // The evidenced part may be costed; the pending part must not be folded into it.
  assert.ok(summary.evidenced[0].kits > 0);
  assert.equal(summary.evidenced[0].kits, 3);

  const bom = readFile("scripts/build-al-mousa-farenhyt-internal-bom.mjs");
  // The blocker vocabulary must survive in the reported states.
  assert.match(bom, /PENDING_|AGGREGATE_MINIMUM_ONLY|CONFIGURATION_REQUIRED|QUANTITY_TOPOLOGY_REQUIRED/);
  // No line may silently default an unresolved allocation to zero.
  assert.doesNotMatch(bom, /PENDING_[A-Z_]*\s*\?\?\s*0\s*:/);
});