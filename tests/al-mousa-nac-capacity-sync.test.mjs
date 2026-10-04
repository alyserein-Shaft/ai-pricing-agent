// NAC CAPACITY & SYNC EVIDENCE CORRECTION.
//
// The mistake this guards against is treating a CIRCUIT COUNT as a CURRENT
// CAPACITY. On the IFP-2100 the arithmetic 8 x 3 A = 24 A is wrong -- the panel
// carries a hard 9 A combined ceiling -- so believing it would overstate the
// panel ~2.7x and erase the entire auxiliary-power requirement.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  IFP_2100_CAPACITY, RPS_1000_CAPACITY, usableNacAmpsPerPanel, aggregateNacCapacity,
} from "../scripts/lib/al-mousa-farenhyt-nac-capacity.mjs";
import { FARENHYT_SELECTION } from "../scripts/lib/al-mousa-fire-alarm-selection-farenhyt.mjs";


const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DB = process.env.FA_DB;
const BOM = join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs");
const out = () => execFileSync("node", [BOM, DB], { encoding: "utf8" });
const readFile = (p) => readFileSync(p, "utf8");

// 1 -------------------------------------------------------------------------
test("1 -- circuit count is not treated as current capacity", () => {
  const naive = IFP_2100_CAPACITY.flexputCircuitsClassB * IFP_2100_CAPACITY.perCircuitLimitAmps;
  assert.equal(naive, 24);
  // The datasheet forbids exceeding the combined total, so 24 A is NOT available.
  assert.ok(usableNacAmpsPerPanel() < naive, "usable output must be below the naive circuits x per-circuit figure");
  assert.equal(usableNacAmpsPerPanel(), IFP_2100_CAPACITY.panelTotalLimitAmps);
  // Class A halves the circuit count but must NOT raise the current ceiling.
  assert.equal(IFP_2100_CAPACITY.flexputCircuitsClassA, 4);
  assert.equal(IFP_2100_CAPACITY.classAReducesCircuits, true);
  assert.equal(usableNacAmpsPerPanel(), 9, "Class A changes circuit count, not the 9 A total");
  if (DB) {
    assert.match(out(), /CIRCUIT COUNT IS NOT CURRENT CAPACITY: 8 x 3 A = 24 A is WRONG here/);
    assert.match(out(), /PANEL_TOTAL_LIMIT\s+= 9 A\s+\("Cannot exceed 9A total for all circuits"\)/);
    assert.match(out(), /usable output per panel\s+= 9 A\s+\(the PANEL_TOTAL_LIMIT\)/);
  }
});

// 2 -------------------------------------------------------------------------
test("2 -- per-circuit and total-panel limits remain distinct facts", () => {
  assert.equal(IFP_2100_CAPACITY.perCircuitLimitAmps, 3);
  assert.equal(IFP_2100_CAPACITY.panelTotalLimitAmps, 9);
  assert.notEqual(IFP_2100_CAPACITY.perCircuitLimitAmps, IFP_2100_CAPACITY.panelTotalLimitAmps);
  // Both must cite the manufacturer document, not an inferred number.
  assert.match(IFP_2100_CAPACITY.evidence.document, /351602/);
  assert.match(IFP_2100_CAPACITY.evidence.url, /prod-edam\.honeywell\.com/);
  assert.match(IFP_2100_CAPACITY.evidence.quoteElectrical, /Maximum current per circuit: 3 A\. Cannot exceed 9A total/);
});

// 3 -------------------------------------------------------------------------
test("3 -- built-in System Sensor sync prevents automatic MDL3 selection", () => {
  assert.equal(IFP_2100_CAPACITY.synchronization.status, "SYSTEM_SENSOR_SYNC_BUILT_IN_SUPPORTED");
  assert.match(IFP_2100_CAPACITY.synchronization.quote, /System Sensor/);
  // MDL3 is not required BY DEFAULT -- and must NOT be claimed permanently impossible.
  assert.doesNotMatch(IFP_2100_CAPACITY.synchronization.status, /NOT_SUPPORTED|NEVER/);
  if (DB) {
    const o = out();
    assert.match(o, /SYSTEM SENSOR SYNC = BUILT_IN_SUPPORTED/);
    assert.match(o, /MDL3 is therefore NOT REQUIRED BY\s*\n?\s*DEFAULT\. It is not ruled out forever/);
  }
  // And no sync module may appear as a selected product.
  for (const s of FARENHYT_SELECTION) {
    assert.ok(!/MDL3/.test([...(s.candidates ?? []), s.pn ?? ""].join(" ")), `${s.key} must not offer MDL3`);
  }
});

// 4 -------------------------------------------------------------------------
test("4 -- the RPS aggregate floor is mathematically derived", () => {
  const a = aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 104.244 });
  assert.equal(a.perPanelAmps, 9);
  assert.equal(a.baseCapacityAmps, 63);
  assert.equal(a.deficitAmps, 41.244);
  assert.equal(a.theoreticalRpsMinimum, Math.ceil(41.244 / 6));   // 7
  assert.equal(a.theoreticalRpsMinimum, 7);
  // Recomputed independently rather than compared to a literal.
  assert.equal(a.theoreticalRpsMinimum, Math.ceil((104.244 - 7 * 9) / RPS_1000_CAPACITY.usableOutputAmps));
  // No deficit -> no RPS required.
  assert.equal(aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 40 }).theoreticalRpsMinimum, 0);
});

// 5 -------------------------------------------------------------------------
test("5 -- the aggregate floor is never labelled a final installed quantity", () => {
  const a = aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 104.244 });
  assert.equal(a.state, "AGGREGATE_THEORETICAL_MINIMUM");
  assert.equal(a.finalQuantityState, "PENDING_BUILDING_NAC_ALLOCATION");
  assert.notEqual(a.state, a.finalQuantityState);
  assert.match(a.whyNotFinal, /physically separate buildings/);
  assert.match(a.whyNotFinal, /can only be met, never beaten/);
  if (DB) {
    const o = out();
    assert.match(o, /IS AN AGGREGATE THEORETICAL MINIMUM, NOT A FINAL QUANTITY/);
    assert.match(o, /FINAL QUANTITY = PENDING_BUILDING_NAC_ALLOCATION/);
  }
  // The selection line must carry capability, not a quantity claim.
  const dp = FARENHYT_SELECTION.find((s) => s.key === "distributedPower");
  assert.equal(dp.pn, null, "capability evidence must not become a selected quantity");
  assert.equal(dp.selection, "AGGREGATE_MINIMUM_ONLY");
  assert.equal(dp.confidence, "CAPABILITY_VERIFIED_QUANTITY_PENDING");
});

// 6 -------------------------------------------------------------------------
test("6 -- building distribution can only increase the installed quantity", () => {
  const a = aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 104.244 });
  // One heavily loaded building: 104.244 A on a single panel -> 9 A usable, so
  // the per-building requirement is far above the campus-average figure.
  const worstPanel = Math.ceil((104.244 - 9) / 6);
  assert.ok(worstPanel > a.theoreticalRpsMinimum,
    "a single-loaded-building case needs MORE units than the aggregate floor");
  assert.match(a.whyNotFinal, /MORE units than this aggregate figure, not fewer/);
});

// 7 -------------------------------------------------------------------------
test("7 -- final voltage-drop design remains unresolved without route/length data", () => {
  const a = aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 104.244 });
  assert.equal(a.voltageDropState, "FINAL_VOLTAGE_DROP_DESIGN_PENDING");
  if (DB) {
    const o = out();
    assert.match(o, /FINAL_VOLTAGE_DROP_DESIGN_PENDING: no circuit lengths, cable gauge, Class A\/B or routing/);
    assert.ok(!/\d+(\.\d+)?\s*%?\s*volt[- ]?drop/i.test(o), "no fabricated voltage-drop result");
  }
});

// 8 -------------------------------------------------------------------------
test("8 -- exact notification P/N still requires the genuine remaining discriminators", () => {
  // Capacity evidence must NOT have been mistaken for a resolution of the
  // configuration dimensions, which are a separate and still-open question.
  for (const k of ["notifIndoorStrobe", "notifIndoorHornStrobe", "notifOutdoor"]) {
    const s = FARENHYT_SELECTION.find((x) => x.key === k);
    assert.equal(s.pn, null, `${k} exact P/N must remain open`);
    assert.equal(s.selection, "CONFIGURATION_ASSUMPTION_REQUIRED");
    assert.match(s.note, /mounting/i);
    assert.ok(s.candidates.length > 0);
  }
  // Field-selectable candela lets the PRODUCT be chosen while the SETTING stays pending.
  assert.match(FARENHYT_SELECTION.find((s) => s.key === "notifIndoorStrobe").note, /PRODUCT P\/N RESOLVED and FINAL CANDELA\s*\n?\s*SETTING PENDING are separate states/);
});

// 9 -------------------------------------------------------------------------
test("9 -- no commercial price changes merely from capacity evidence", () => {
  if (!DB) return;
  const o = out();
  // Capacity evidence is engineering only: the subtotal is untouched by it.
  assert.match(o, /Costable NET material subtotal\s+:\s+75988\.15 USD\s+=\s+284952\.28 SAR/);
  assert.match(o, /READY_FOR_COSTING\s+13/);
  assert.match(o, /Total list-price reference value \(costed lines\)\s+:\s+217109\.00 USD/);
  // And no new discount rule may have been introduced.
  assert.match(o, /6500 bp off list \(net multiplier 0\.35\)/);
  const cap = readFile(join(REPO, "scripts", "lib", "al-mousa-farenhyt-nac-capacity.mjs"));
  // Word-boundary anchored: an unanchored /SAR/i also matches the "sAR" inside
  // `classAReducesCircuits`, which is a technical identifier, not a currency.
  assert.doesNotMatch(cap, /\bdiscount\b|\b0\.35\b|\b6500\b|\bUSD\b|\bSAR\b|\bprice\b|\bcost\b/i,
    "capacity facts must carry no commercial figures");
});

// 10 ------------------------------------------------------------------------
test("10 -- rerun is deterministic", () => {
  if (!DB) return;
  assert.equal(out(), out(), "two runs are byte-identical");
  const a = aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 104.244 });
  const b = aggregateNacCapacity({ panelCount: 7, worstCaseDemandAmps: 104.244 });
  assert.deepEqual(a, b);
});
