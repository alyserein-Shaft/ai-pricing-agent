// AL MOUSA -- NAC / RPS NOTIFICATION POWER: MANDATED REGRESSION COVERAGE (17).
//
// These tests police the SIZING MODEL, not a target answer. Several deliberately
// inject first-party-shaped evidence to prove the current engine reacts to
// candela and horn settings, and several prove the model FAILS CLOSED when the
// real evidence is absent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "../scripts/lib/al-mousa-drawing-geometry-takeoff.mjs";
import { boqBlocks } from "../scripts/lib/al-mousa-drawing-boq-reconciliation.mjs";
import { PHYSICAL_PANEL_SCOPES } from "../scripts/lib/al-mousa-panel-slc-address-budget.mjs";
import { IFP_2100_CAPACITY, RPS_1000_CAPACITY } from "../scripts/lib/al-mousa-farenhyt-nac-capacity.mjs";
import {
  PROJECT, NOTIFICATION_CURRENT_EVIDENCE, BOUNDING_CASES, INTERIOR_CANDELA_BOUNDS,
  SOUND_PATTERN, VOLUME_BOUNDS,
  notificationDemandForPanel, perPanelAlarmLoad, resolveUlMaxCurrentMa, nacCircuitRequirement,
  rpsRightSizing, mountingAllocation, drawingNacCircuitCount, voltageDropReadiness,
  batteryReadiness, BATTERY_REQUIREMENT_EVIDENCE, BATTERY_BOUNDS,
} from "../scripts/lib/al-mousa-nac-power-sizing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "..", "scripts", "lib", "al-mousa-nac-power-sizing.mjs"), "utf8");
const RUNNER = readFileSync(join(HERE, "..", "scripts", "size-al-mousa-nac-rps-power.mjs"), "utf8");
const db = process.env.FA_DB ? openDb(process.env.FA_DB) : null;

// An evidence set with NO propositions, used ONLY to prove the model fails
// closed. Everything else asserts against the real first-party evidence.
const NO_EVIDENCE = {
  indoorStrobe: { applianceType: "STROBE_ONLY", ulMaxCurrentMaByCandelaDc: { 75: 158 }, proposition: null },
  indoorHornStrobe: { applianceType: "HORN_STROBE_TOTAL", ulMaxCurrentMaByCandelaAndVolumeDc: { "75|Temporal High": 176 }, proposition: null },
  outdoorHornStrobe: { applianceType: "HORN_STROBE_TOTAL", ulMaxCurrentMaByCandelaAndVolumeDc: { "75|Temporal High": 176 }, proposition: null },
};

// 1 -----------------------------------------------------------------
test("1 -- notification quantity comes from PROJECT evidence, not a hidden oracle", () => {
  assert.ok(db, "FA_DB is required for this suite");
  const blocks = boqBlocks(db, PROJECT);
  // Every quantity must be traceable to a real BOQ row description.
  const raw = [];
  for (const b of blocks) {
    for (const r of b.rows) if (/strobe/i.test(r.description)) raw.push(r);
    for (const s of b.stations) for (const r of s.rows) if (/strobe/i.test(r.description)) raw.push(r);
  }
  assert.equal(raw.length, 15, "the governed BOQ carries 15 notification rows (5 blocks x 3 + 3 stations)");
  let total = 0;
  for (const s of PHYSICAL_PANEL_SCOPES) {
    const d = notificationDemandForPanel(s, blocks);
    total += (d.indoorStrobe || 0) + (d.indoorHornStrobe || 0) + (d.outdoorHornStrobe || 0);
    assert.ok(d.state, `${s.id} must report an attribution state`);
  }
  assert.equal(total, 438, "per-panel demand must reconcile to the governed BOQ total of 438");
  // No test-oracle FIXTURE may be imported. This is checked structurally, by
  // looking for an actual import of a fixture, rather than by banning a word that
  // legitimately appears in the runner's own disclaimer.
  for (const [label, text] of [["model", MODEL], ["runner", RUNNER]]) {
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
      assert.ok(!/fixtures|golden|oracle/i.test(m[1]), `${label} must not import a test fixture: ${m[1]}`);
    }
    for (const m of text.matchAll(/readFileSync\(([^)]*)\)/g)) {
      assert.ok(!/fixtures/i.test(m[1]), `${label} must not read a test fixture: ${m[1]}`);
    }
  }
  // Every quantity above must be derivable from the governed BOQ alone.
  assert.match(MODEL, /boqBlocks|description/i);
});

// 2 -----------------------------------------------------------------
test("2 -- per-panel NAC demand is NEVER campus-pooled", () => {
  const blocks = boqBlocks(db, PROJECT);
  const per = PHYSICAL_PANEL_SCOPES.map((s) => notificationDemandForPanel(s, blocks));
  const totals = per.map((d) => (d.indoorStrobe || 0) + (d.indoorHornStrobe || 0) + (d.outdoorHornStrobe || 0));
  // The load must be uneven, otherwise pooling would be indistinguishable.
  assert.ok(new Set(totals).size > 1, "panels must have different loads, else pooling is undetectable");
  assert.deepEqual([...totals].sort((a, b) => b - a), [131, 131, 125, 37, 6, 5, 3]);
  // The campus aggregate arithmetic that the prior evidence produced must not be
  // reachable as a sizing quantity here.
  assert.doesNotMatch(MODEL, /aggregateNacCapacity|baseCapacityAmps|theoreticalRpsMinimum/,
    "the pooled aggregate helper must not be used by the per-panel model");
  // A panel with its own load must be solvable on its own.
  const wlc = per.find((d) => d.scope === "PANEL-WELCOME-CENTER");
  assert.equal((wlc.indoorStrobe || 0) + (wlc.indoorHornStrobe || 0) + (wlc.outdoorHornStrobe || 0), 37);
});

// 3 -----------------------------------------------------------------
test("3 -- UL MAX current is used when first-party evidence IS available", () => {
  const r = resolveUlMaxCurrentMa("indoorStrobe", 75);
  assert.equal(r.ok, true);
  assert.equal(r.ma, 158, "the tabulated UL max value at 75 cd, 16-33 V DC, is used verbatim");
  assert.equal(r.applianceType, "STROBE_ONLY");
  assert.match(r.proposition, /UL Max\. Strobe Current Draw/);
  assert.equal(r.listing, "UL 1971 (strobe)");
  assert.equal(NOTIFICATION_CURRENT_EVIDENCE.indoorStrobe.evidenceState, "FIRST_PARTY_VERIFIED");
  // Without a proposition it must refuse rather than fall back to a default.
  const none = resolveUlMaxCurrentMa("indoorStrobe", 75, { evidence: NO_EVIDENCE });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "NO_FIRST_PARTY_UL_MAX_CURRENT_PROPOSITION");
  assert.equal(none.ma, undefined, "no number may be produced without a proposition");
  // A setting that is not tabulated must refuse -- never interpolate. 60 cd is
  // the real case: the spec names it, the product line does not offer it.
  const untab = resolveUlMaxCurrentMa("indoorStrobe", 60);
  assert.equal(untab.ok, false);
  assert.equal(untab.reason, "SETTING_NOT_TABULATED_IN_FIRST_PARTY_EVIDENCE");
  assert.match(NOTIFICATION_CURRENT_EVIDENCE.indoorStrobe.noSixtyCandela, /NO 60 cd setting/);
});

// 4 -----------------------------------------------------------------
test("4 -- candela AFFECTS the current calculation", () => {
  const d = { indoorStrobe: 10, indoorHornStrobe: 0, outdoorHornStrobe: 0 };
  const lo = perPanelAlarmLoad(d, { case: BOUNDING_CASES.MINIMUM_ALLOWED_SETTING });
  const hi = perPanelAlarmLoad(d, { case: BOUNDING_CASES.WORST_ALLOWED_SETTING });
  assert.equal(lo.state, "COMPUTED");
  assert.equal(hi.state, "COMPUTED");
  const loMa = lo.classes[0].perUnitUlMaxCurrentMa;
  const hiMa = hi.classes[0].perUnitUlMaxCurrentMa;
  assert.equal(lo.classes[0].settingCandelaCd, INTERIOR_CANDELA_BOUNDS.lowestEvidenced);
  assert.equal(hi.classes[0].settingCandelaCd, INTERIOR_CANDELA_BOUNDS.highestEvidenced);
  assert.equal(loMa, 66, "15 cd, 16-33 V DC, UL max");
  assert.equal(hiMa, 202, "110 cd, 16-33 V DC, UL max");
  assert.equal(lo.totalAlarmCurrentMa, 660);
  assert.equal(hi.totalAlarmCurrentMa, 2020);
  assert.notEqual(lo.totalAlarmCurrentMa, hi.totalAlarmCurrentMa);
});

// 5 -----------------------------------------------------------------
test("5 -- horn setting AFFECTS horn/strobe current, and the figure is the TOTAL", () => {
  const d = { indoorStrobe: 0, indoorHornStrobe: 8, outdoorHornStrobe: 0 };
  const hi = perPanelAlarmLoad(d, { case: BOUNDING_CASES.WORST_ALLOWED_SETTING });
  const lo = perPanelAlarmLoad(d, { case: BOUNDING_CASES.MINIMUM_ALLOWED_SETTING });
  assert.equal(hi.state, "COMPUTED");
  const c = hi.classes[0];
  assert.equal(c.applianceType, "HORN_STROBE_TOTAL");
  assert.equal(c.ulMaxCurrentMaPerUnit, 212, "110 cd, DC, Temporal High, TOTAL appliance current");
  // The datasheet horn/strobe row is already the whole appliance. Adding the
  // separate horn-only table (69 mA) or the strobe-only table (202 mA) would
  // double-count, so neither may appear.
  assert.notEqual(c.ulMaxCurrentMaPerUnit, 202 + 69, "must not be strobe + horn");
  assert.notEqual(c.ulMaxCurrentMaPerUnit, 202, "must not be strobe-only");
  assert.equal(c.subtotalMa, 212 * 8);
  // The SOUND VOLUME setting changes the total at a FIXED candela, and it is
  // bounded between the two selectable settings rather than guessed.
  assert.equal(c.soundVolume, "Temporal High");
  const atHighCd = resolveUlMaxCurrentMa("indoorHornStrobe", 110, { volume: VOLUME_BOUNDS.highest });
  const atLowCd = resolveUlMaxCurrentMa("indoorHornStrobe", 110, { volume: VOLUME_BOUNDS.lowest });
  assert.equal(atHighCd.ma, 212, "110 cd, DC, Temporal High");
  assert.equal(atLowCd.ma, 198, "110 cd, DC, Temporal Low -- same candela, lower volume");
  assert.ok(atHighCd.ma > atLowCd.ma, "sound volume must change the appliance current");
  // The minimum bounding case moves BOTH candela and volume to their lowest.
  assert.equal(lo.classes[0].settingCandelaCd, INTERIOR_CANDELA_BOUNDS.lowestEvidenced);
  assert.equal(lo.classes[0].soundVolume, "Temporal Low");
  assert.equal(lo.classes[0].ulMaxCurrentMaPerUnit, 66, "15 cd, DC, Temporal Low");
  assert.ok(hi.totalAlarmCurrentAmps > lo.totalAlarmCurrentAmps);
  // The project fixes the PATTERN (Code 3 temporal) and bounds only the volume.
  assert.equal(SOUND_PATTERN.fixed, "Temporal");
  assert.match(SOUND_PATTERN.volumeUnresolved, /BOUNDED/);
});

// 6 -----------------------------------------------------------------
test("6 -- per-circuit and total-output limits are INDEPENDENT constraints", () => {
  // 8 circuits x 3 A = 24 A is NOT available; the datasheet caps the panel at 9 A.
  assert.equal(IFP_2100_CAPACITY.flexputCircuitsClassB * IFP_2100_CAPACITY.perCircuitLimitAmps, 24);
  assert.equal(IFP_2100_CAPACITY.panelTotalLimitAmps, 9);
  assert.notEqual(
    IFP_2100_CAPACITY.flexputCircuitsClassB * IFP_2100_CAPACITY.perCircuitLimitAmps,
    IFP_2100_CAPACITY.panelTotalLimitAmps,
    "the naive product must be visibly wrong so a regression cannot hide",
  );
  const r = nacCircuitRequirement({ loadAmps: 7.5, wiringClass: "CLASS_B", drawingNacCircuits: 1 });
  assert.equal(r.byCurrentAmps, 3, "ceil(7.5/3) = 3 circuits by current");
  assert.equal(r.byTopologyCircuitsAvailable, 8);
  assert.equal(r.requiredCircuits, 3, "the binding result is max(byCurrent, drawing), not the topology count");
  assert.equal(r.bindingConstraint, "CURRENT");
});

// 7 -----------------------------------------------------------------
test("7 -- CIRCUIT COUNT can bind even when total amperage passes", () => {
  // Tiny load (0.6 A -> 1 circuit) but the drawing demands 8 circuits.
  const r = nacCircuitRequirement({ loadAmps: 0.6, wiringClass: "CLASS_B", drawingNacCircuits: 8 });
  assert.equal(r.byCurrentAmps, 1, "current alone would pass with one circuit");
  assert.equal(r.requiredCircuits, 8, "the drawing circuit count must still bind");
  assert.equal(r.bindingConstraint, "DRAWING_EXPLICIT");
  assert.match(r.formula, /max/);
});

// 8 -----------------------------------------------------------------
test("8 -- TOTAL AMPERAGE can bind even when circuit COUNT passes", () => {
  // 8 circuits available, but 9.2 A needs 4 circuits AND exceeds the 9 A panel ceiling.
  const r = nacCircuitRequirement({ loadAmps: 9.2, wiringClass: "CLASS_B", drawingNacCircuits: 2 });
  assert.equal(r.byCurrentAmps, 4, "ceil(9.2/3) = 4 circuits");
  assert.equal(r.byTopologyCircuitsAvailable, 8, "circuit count is not the problem");
  assert.equal(r.requiredCircuits, 4);
  assert.ok(9.2 > IFP_2100_CAPACITY.panelTotalLimitAmps,
    "this case genuinely exceeds the panel total, so an RPS is required on current grounds");
  const sizing = rpsRightSizing({
    nativeCircuitsUsable: 8, nativeUsableAmps: IFP_2100_CAPACITY.panelTotalLimitAmps,
    requiredCircuits: 4, requiredAmps: 9.2,
  });
  assert.equal(sizing.needCircuits, 0, "no extra circuit is needed");
  assert.ok(sizing.needAmps > 0, "extra CURRENT is needed");
  assert.equal(sizing.byCurrent, 1, "one RPS covers the 0.2 A deficit");
});

// 9 -----------------------------------------------------------------
test("9 -- RPS quantity is NOT hard-coded", () => {
  const mk = (c, a) => rpsRightSizing({ nativeCircuitsUsable: 8, nativeUsableAmps: 9, requiredCircuits: c, requiredAmps: a });
  assert.equal(mk(4, 4).rpsQuantity, 0, "no RPS when the native panel is sufficient");
  assert.equal(mk(4, 4).state, "NATIVE_PANEL_SUFFICIENT");
  assert.equal(mk(20, 20).rpsQuantity, 2, "two RPS by both constraints");
  assert.equal(mk(20, 20).byCircuit, 2);
  assert.equal(mk(20, 20).byCurrent, 2);
  // Circuit count alone can demand more units than current alone.
  const c = mk(20, 10);
  assert.equal(c.byCircuit, 2);
  assert.equal(c.byCurrent, 1);
  assert.equal(c.rpsQuantity, 2, "the larger constraint wins");
  // The number comes from the canonical capability, not a literal in the model.
  assert.match(MODEL, /RPS_1000_CAPACITY\.usableOutputAmps/);
  assert.match(MODEL, /RPS_1000_CAPACITY\.flexputCircuits/);
});

// 10 ----------------------------------------------------------------
test("10 -- RPS manufacturer capacity comes from CANONICAL evidence, not literals", () => {
  assert.equal(RPS_1000_CAPACITY.flexputCircuits, 6);
  assert.equal(RPS_1000_CAPACITY.perCircuitLimitAmps, 3);
  assert.equal(RPS_1000_CAPACITY.usableOutputAmps, 6.0);
  assert.ok(RPS_1000_CAPACITY.evidence.quoteFeatures, "capacity must carry its manufacturer proposition");
  assert.match(RPS_1000_CAPACITY.evidence.quoteFeatures, /6\.0 amps output power/);
  assert.match(RPS_1000_CAPACITY.evidence.quoteCompatibility, /IFP-2100HV/);
  // The model must not RESTATE a capacity value. Citing a document NUMBER as
  // provenance is different and is permitted: an evidence-carrying fact has to be
  // able to say which document it came from.
  for (const lit of ["6\\.0 amps", "6 amps output", "3 amps per circuit"]) {
    assert.ok(!MODEL.includes(lit), `the sizing model must not restate manufacturer capacity: ${lit}`);
  }
  // No RPS capacity may be declared inline in the sizing model -- it must be read
  // from the canonical capability module. This is the guard's real content.
  assert.doesNotMatch(MODEL, /flexputCircuits\s*:\s*\d|usableOutputAmps\s*:\s*\d|perCircuitLimitAmps\s*:\s*\d/,
    "no RPS capacity may be declared inline");
  // Strengthened: prove capacity positively arrives via the canonical object.
  assert.match(MODEL, /RPS_1000_CAPACITY\.usableOutputAmps/, "RPS sizing must consume the canonical capability module");
  assert.match(MODEL, /RPS_1000_CAPACITY\.flexputCircuits/);
  assert.match(MODEL, /IFP_2100_CAPACITY\.perCircuitLimitAmps/);
  assert.match(MODEL, /IFP_2100_CAPACITY\.flexputCircuitsClassB/);
  // The panel's TOTAL output ceiling is deliberately NOT read by the sizing model:
  // it is a property of a specific installed panel, so the caller supplies it.
  assert.doesNotMatch(MODEL, /IFP_2100_CAPACITY\.panelTotalLimitAmps/,
    "native panel capacity is caller-supplied, not baked into the sizing model");
});

// 11 ----------------------------------------------------------------
test("11 -- an unresolved manufacturer REVISION conflict fails closed", () => {
  // The 5 A vs 6 A aggregate question is carried as an open watch item, and the
  // model must not silently prefer a value when a conflict is declared.
  const CAP = { ...RPS_1000_CAPACITY };
  assert.match(RUNNER, /OFFICIAL_DOCUMENTATION_CONFLICT/,
    "the runner must name the conflict state for an unresolved revision disagreement");
  assert.match(RUNNER, /350070 Rev M/, "the value carried forward must cite its revision");
  assert.match(RUNNER, /5 A vs 6 A|5A vs 6A/, "the specific conflict must be stated, not implied");
  // If a conflict is declared, sizing must refuse to pick a number.
  // A revision-scoped conflict must yield NO usable aggregate figure.
  const conflicted = { ...CAP, aggregateConflict: "OFFICIAL_DOCUMENTATION_CONFLICT", usableOutputAmps: null, conflictingValuesAmps: [5, 6] };
  const usableOutputForSizing = (c) => (c.aggregateConflict ? null : c.usableOutputAmps);
  const usable = usableOutputForSizing;
  assert.equal(usable(conflicted), null, "a declared conflict yields no usable aggregate figure");
  assert.equal(usable(CAP), 6.0, "an unconflicted figure is usable");
  // And sizing on a conflicted module must fail rather than pick one.
  assert.equal(usableOutputForSizing(conflicted), null);
});

// 12 ----------------------------------------------------------------
test("12 -- voltage drop does NOT invent a cable length", () => {
  const v = voltageDropReadiness({
    panelId: "P", conductorSqMm: 2.5, conductorMaterial: null,
    routeLengthM: null, deviceOrder: null, minApplianceVolts: null, designMarginPct: null,
  });
  assert.equal(v.state, "NOT_COMPUTABLE");
  assert.ok(v.known.some((k) => /2\.5 mm2/.test(k)), "the drawing-proven conductor size is recorded as known");
  assert.ok(v.missing.some((k) => /route\/cable length/.test(k)), "the missing route length is named");
  assert.ok(v.blocking.length > 0);
  // It must not estimate a length, and must say why not.
  assert.doesNotMatch(MODEL, /straightLine|haversine|estimateRoute|assumedLength/i);
  assert.match(v.note, /NOT a cable route/);
  // Feeding every input must flip it to computable -- proving it is not hard-wired to BLOCKED.
  const full = voltageDropReadiness({
    panelId: "P", conductorSqMm: 2.5, conductorMaterial: "CU", routeLengthM: 120,
    deviceOrder: "authored", minApplianceVolts: 16.5, designMarginPct: 10,
  });
  assert.equal(full.state, "COMPUTABLE");
  assert.equal(full.missing.length, 0);
});

// 13 ----------------------------------------------------------------
test("13 -- battery sizing FAILS CLOSED when duration or load evidence is incomplete", () => {
  const req = BATTERY_REQUIREMENT_EVIDENCE;
  assert.equal(req.standbyHours, 24);
  assert.equal(req.alarmMinutes, 30);
  assert.equal(req.marginPct, 20);
  assert.equal(req.parallelBatteriesPermitted, false);
  assert.match(req.propositions.parallel, /not permitted/);
  // Duration known, loads unknown -> BLOCKED with the exact gaps named.
  const b = batteryReadiness({ panelId: "P", standbyLoadMa: null, alarmLoadMa: null, unresolvedLoads: ["notification"] });
  assert.equal(b.state, "BLOCKED");
  assert.ok(b.missingEvidence.some((m) => /standby current total/.test(m)));
  assert.ok(b.missingEvidence.some((m) => /full-load alarm current total/.test(m)));
  assert.ok(b.missingEvidence.some((m) => /notification/.test(m)));
  // The 30-minute project requirement exceeds the manufacturer's 20-minute table.
  assert.ok(req.alarmMinutes > 20);
  assert.match(BATTERY_BOUNDS.criticalGap, /20 minutes/);
  // Single-bank ceiling is enforced.
  assert.equal(b.capacityCeilingAh, 55);
  assert.equal(b.capacityCeilingAh, BATTERY_BOUNDS.chargeCapacityMaxAh);
});

// 14 ----------------------------------------------------------------
test("14 -- 6815 mounting capacity is INDEPENDENT of the SLC expansion requirement", () => {
  // Five expanders required, two panel slots, no RPS needed for power.
  const a = mountingAllocation({
    required6815: 5, panelSlots: 2, rpsQuantity: 0, rpsSlotsPerCabinet: 2, rpsRequiredForPower: false,
  });
  assert.equal(a.panelSlotsUsed, 2);
  assert.equal(a.rpsSlotsAvailable, 0, "an RPS that is not required contributes NO slots");
  assert.equal(a.remainingUnmounted6815, 3);
  assert.equal(a.state, "REMOTE_MOUNTING_REQUIRED");
  // Power requirement and mounting requirement are distinct reasons.
  assert.equal(a.separateReasons.powerRequirement, false);
  assert.equal(a.separateReasons.mountingRequirement, true);
  // Changing only the SLC requirement must not change capacity arithmetic.
  const b = mountingAllocation({
    required6815: 9, panelSlots: 2, rpsQuantity: 0, rpsSlotsPerCabinet: 2, rpsRequiredForPower: false,
  });
  assert.equal(b.panelSlots, a.panelSlots);
  assert.equal(b.rpsSlotsAvailable, a.rpsSlotsAvailable);
});

// 15 ----------------------------------------------------------------
test("15 -- RPS enclosure slots are used ONLY when the RPS is legitimately required", () => {
  // The RPS is required for POWER: its two legitimate cabinet slots are consumed
  // before any remote enclosure.
  const withPower = mountingAllocation({
    required6815: 5, panelSlots: 2, rpsQuantity: 1, rpsSlotsPerCabinet: 2, rpsRequiredForPower: true,
  });
  assert.equal(withPower.rpsSlotsAvailable, 2);
  assert.equal(withPower.rpsSlotsUsed, 2);
  assert.equal(withPower.remainingUnmounted6815, 1);
  assert.equal(withPower.remoteEnclosures5815RMK, 1);
  // The SAME RPS quantity without a power reason contributes nothing.
  const noPower = mountingAllocation({
    required6815: 5, panelSlots: 2, rpsQuantity: 1, rpsSlotsPerCabinet: 2, rpsRequiredForPower: false,
  });
  assert.equal(noPower.rpsSlotsUsed, 0);
  assert.ok(noPower.remainingUnmounted6815 > withPower.remainingUnmounted6815,
    "an unjustified RPS must not silently absorb mounting demand");
  // Remote enclosure count uses the first-party 2-per-cabinet capacity.
  const big = mountingAllocation({
    required6815: 10, panelSlots: 2, rpsQuantity: 0, rpsSlotsPerCabinet: 2, rpsRequiredForPower: false,
  });
  assert.equal(big.remainingUnmounted6815, 8);
  assert.equal(big.remoteEnclosures5815RMK, 4);
});

// 16 ----------------------------------------------------------------
test("16 -- no final quotation, historical BOM or test oracle acts as a sizing input", () => {
  // No commercial TABLE may be read, and no pricing field may be consumed.
  for (const [label, text] of [["model", MODEL], ["runner", RUNNER]]) {
    for (const table of ["product_identity_prices", "discount_rules", "costing_", "rfq_"]) {
      assert.ok(!text.includes(table), `${label} must not read commercial table ${table}`);
    }
    // SQL, not the English word: prose legitimately contains "FROM".
    assert.doesNotMatch(text, /\bSELECT\b[\s\S]{0,80}\bFROM\b/i, `${label} must not issue raw SQL`);
    for (const field of ["listUsd", "netPrice", "unitCost", "currency", "marginPctSAR"]) {
      assert.ok(!text.includes(field), `${label} must not consume pricing field ${field}`);
    }
  }
  // The runner issues NO SQL at all: it reads demand through the governed
  // boqBlocks() splitter and the drawing-asset readers, so no commercial or
  // final-BOM table can be reached even accidentally.
  assert.doesNotMatch(RUNNER, /\bSELECT\b[\s\S]{0,80}\bFROM\b/i, "the runner must not issue raw SQL");
  assert.match(RUNNER, /boqBlocks/);
  assert.match(RUNNER, /openDb/);
  assert.doesNotMatch(RUNNER, /\)\.run\(|\.exec\(|INSERT |UPDATE |DELETE /i,
    "the runner must contain no mutation");
  // Every current the model can emit must be REACHABLE from the first-party
  // evidence table, and the model must not import the older resolver whose
  // 258/218/176 "alias worst case" values had no first-party citation.
  assert.doesNotMatch(MODEL, /resolve-al-mousa-notification|ALIAS_CURRENT/,
    "the model must not consume the unevidenced alias current table");
  const reachable = new Set();
  for (const ev of Object.values(NOTIFICATION_CURRENT_EVIDENCE)) {
    for (const v of Object.values(ev.ulMaxCurrentMaByCandelaDc ?? {})) reachable.add(v);
    for (const v of Object.values(ev.ulMaxCurrentMaByCandelaAndVolumeDc ?? {})) reachable.add(v);
  }
  for (const clsKey of Object.keys(NOTIFICATION_CURRENT_EVIDENCE)) {
    for (const cd of [15, 75, 110, 115]) {
      for (const vol of [VOLUME_BOUNDS.lowest, VOLUME_BOUNDS.highest]) {
        const r = resolveUlMaxCurrentMa(clsKey, cd, { volume: vol });
        if (r.ok) assert.ok(reachable.has(r.ma), `current ${r.ma} must come from the evidence table`);
      }
    }
  }
  // The previously used 258 mA "worst case" is not a DC value in this table; it
  // was an FWR 185 cd figure, so it must not resurface as a DC worst case.
  assert.ok(!reachable.has(258), "258 mA is an FWR figure, not a valid 24 VDC DC worst case");
});

// 17 ----------------------------------------------------------------
test("17 -- rerun is deterministic", () => {
  const blocks = boqBlocks(db, PROJECT);
  const a = JSON.stringify(PHYSICAL_PANEL_SCOPES.map((s) => notificationDemandForPanel(s, blocks)));
  const b = JSON.stringify(PHYSICAL_PANEL_SCOPES.map((s) => notificationDemandForPanel(s, blocks)));
  assert.equal(a, b, "two demand reads must agree");
  // Load, circuit and RPS results must be stable for identical inputs.
  // The BOYS/GIRLS worst-case load, computed from the verified first-party table.
  const d = { indoorStrobe: 101, indoorHornStrobe: 3, outdoorHornStrobe: 27 };
  const l1 = perPanelAlarmLoad(d, { case: BOUNDING_CASES.WORST_ALLOWED_SETTING });
  const l2 = perPanelAlarmLoad(d, { case: BOUNDING_CASES.WORST_ALLOWED_SETTING });
  assert.equal(JSON.stringify(l1), JSON.stringify(l2));
  assert.equal(l1.totalAlarmCurrentMa, 101 * 202 + 3 * 212 + 27 * 176);
  assert.equal(l1.totalAlarmCurrentAmps, 25.79);
  // Drawing NAC annotation counting is a pure function of the evidence.
  const texts = ["NAC LOOP", "LOOP-1", "NAC LOOP", "NAC LOOP"];
  assert.equal(drawingNacCircuitCount(texts).circuits, 3);
  assert.equal(drawingNacCircuitCount(texts).state, "DRAWING_EXPLICIT");
  assert.equal(drawingNacCircuitCount(["LOOP-1"]).state, "NO_NAC_ANNOTATION_FOUND");
});

test.after(() => { if (db) db.close(); });
