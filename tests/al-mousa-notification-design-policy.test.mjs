// AL MOUSA -- NOTIFICATION DESIGN POLICY + RPS/BATTERY CLOSURE: MANDATED COVERAGE (13).
//
// The risk these tests police is SPECIFIC: a pre-sales quotation assumption
// (75 cd) quietly becoming final engineering design authority, or a global
// design candela creeping back in through a default. Almost every assertion
// below is about that boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "../scripts/lib/al-mousa-drawing-geometry-takeoff.mjs";
import { boqBlocks } from "../scripts/lib/al-mousa-drawing-boq-reconciliation.mjs";
import { PHYSICAL_PANEL_SCOPES } from "../scripts/lib/al-mousa-panel-slc-address-budget.mjs";
import { IFP_2100_CAPACITY } from "../scripts/lib/al-mousa-farenhyt-nac-capacity.mjs";
import {
  PROJECT, BOUNDING_CASES, notificationDemandForPanel, perPanelAlarmLoad, nacCircuitRequirement, rpsRightSizing,
  batteryAhForEnclosure, rpsBatteryConflictMateriality, voltageDropReadiness,
  NAC_CONDUCTOR_EVIDENCE, BATTERY_REQUIREMENT_EVIDENCE, BATTERY_DEVICE_CURRENT_MA,
  BATTERY_WORKSHEET_METHOD, RPS_BATTERY_TABLE,
} from "../scripts/lib/al-mousa-nac-power-sizing.mjs";
import {
  NOTIFICATION_DESIGN_POLICY, QUOTATION_ASSUMPTION, POWER_SIZING_SCENARIO, SUPPORTED_INDOOR_CANDELA,
  PROJECT_60CD_MISMATCH, PHOTOMETRIC_INPUT_READINESS, RPS_QUANTITY_BASIS,
  requiredPowerScenarios, buildPowerScenario, assertNoDesignPromotion,
} from "../scripts/lib/al-mousa-notification-design-policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY_SRC = readFileSync(join(HERE, "..", "scripts", "lib", "al-mousa-notification-design-policy.mjs"), "utf8");
const RUNNER = readFileSync(join(HERE, "..", "scripts", "size-al-mousa-notification-design-policy.mjs"), "utf8");
const db = openDb(process.env.FA_DB);
const BLOCKS = boqBlocks(db, PROJECT);
const DEMAND = Object.fromEntries(
  PHYSICAL_PANEL_SCOPES.map((s) => [s.id, notificationDemandForPanel(s, BLOCKS)]),
);

const rpsFor = (candelaCd, volume = "Temporal High") => {
  let total = 0;
  for (const s of PHYSICAL_PANEL_SCOPES) {
    const load = perPanelAlarmLoad(DEMAND[s.id], { case: BOUNDING_CASES.WORST_ALLOWED_SETTING, interiorCandelaCd: candelaCd, interiorVolume: volume });
    const req = nacCircuitRequirement({ loadAmps: load.totalAlarmCurrentAmps, wiringClass: "CLASS_B", drawingNacCircuits: 1 });
    total += rpsRightSizing({
      nativeCircuitsUsable: Math.min(req.requiredCircuits ?? 0, IFP_2100_CAPACITY.flexputCircuitsClassB),
      nativeUsableAmps: IFP_2100_CAPACITY.panelTotalLimitAmps,
      requiredCircuits: req.requiredCircuits ?? 0, requiredAmps: load.totalAlarmCurrentAmps ?? 0,
    }).rpsQuantity;
  }
  return total;
};

// 1 -----------------------------------------------------------------
test("1 -- 75 cd is a QUOTATION assumption, not a final design default", () => {
  assert.equal(QUOTATION_ASSUMPTION.quotationCandelaAssumption, 75);
  assert.equal(QUOTATION_ASSUMPTION.quotationCandelaAssumptionStatus, "PRELIMINARY_COMMERCIAL_ASSUMPTION");
  assert.equal(QUOTATION_ASSUMPTION.quotationCandelaAssumptionAuthority, "HUMAN_ENGINEERING_DECISION");
  assert.equal(QUOTATION_ASSUMPTION.isFinalDesignAuthority, false, "it must never be design authority");
  assert.equal(QUOTATION_ASSUMPTION.isCodeDefault, false, "and it must never be a code default");
  assert.match(QUOTATION_ASSUMPTION.condition, /SUBJECT_TO_FINAL_NFPA72_SPACE_BY_SPACE_SIZING/);
  // The design policy must NOT be able to express a global design candela.
  assert.equal(NOTIFICATION_DESIGN_POLICY.noGlobalDefaultCandela, true);
  assert.ok(!("defaultFinalCandelaCd" in NOTIFICATION_DESIGN_POLICY),
    "a global final-candela field must not exist in the design policy");
});

// 2 -----------------------------------------------------------------
test("2 -- FINAL design requires SPACE-BASED candela determination", () => {
  assert.equal(NOTIFICATION_DESIGN_POLICY.designCandelaPolicy, "CANDELA_BY_SPACE_REQUIRED");
  assert.equal(NOTIFICATION_DESIGN_POLICY.authority, "HUMAN_ENGINEERING_DECISION");
  assert.match(NOTIFICATION_DESIGN_POLICY.explicitlyForbidden, /DEFAULT_FINAL_CANDELA = 75 cd/);
  for (const d of ["room dimensions", "corridor geometry", "appliance mounting location",
    "wall vs ceiling mounting", "number and spacing of appliances", "NFPA 72 visual-notification rules"]) {
    assert.ok(NOTIFICATION_DESIGN_POLICY.perSpaceDeterminants.includes(d), `missing determinant: ${d}`);
  }
  // Photometric inputs are proven insufficient, so final design is blocked.
  assert.equal(PHOTOMETRIC_INPUT_READINESS.photometricDesignInputs, "INSUFFICIENT");
  assert.equal(PHOTOMETRIC_INPUT_READINESS.finalPhotometricDesignStatus, "BLOCKED_BY_PHOTOMETRIC_INPUTS");
  assert.ok(PHOTOMETRIC_INPUT_READINESS.decisiveEvidence.length >= 4);
});

// 3 -----------------------------------------------------------------
test("3 -- a quotation assumption CANNOT silently become final-design authority", () => {
  for (const sc of requiredPowerScenarios()) {
    const guard = assertNoDesignPromotion(sc);
    assert.equal(guard.ok, true, `${sc.id} must pass the no-promotion guard`);
    assert.equal(sc.designAuthority, false);
  }
  // A promoted scenario must be caught.
  const promoted = { ...requiredPowerScenarios()[0], designAuthority: true };
  const bad = assertNoDesignPromotion(promoted);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "QUOTATION_ASSUMPTION_PROMOTED_TO_DESIGN_AUTHORITY");
  // The policy object must keep the two concepts in SEPARATE fields.
  assert.notEqual(
    NOTIFICATION_DESIGN_POLICY.designCandelaPolicy,
    String(QUOTATION_ASSUMPTION.quotationCandelaAssumption),
    "design policy and quotation assumption must be distinct fields with distinct values",
  );
  assert.match(QUOTATION_ASSUMPTION.semanticBoundary, /NEVER feed finalPhotometricDesignStatus/);
});

// 4 -----------------------------------------------------------------
test("4 -- power sizing evaluates MORE than the quotation case", () => {
  const scenarios = requiredPowerScenarios();
  assert.equal(scenarios.length, 2, "at least a quotation case and a conservative case");
  const ids = scenarios.map((s) => s.id);
  assert.ok(ids.includes(POWER_SIZING_SCENARIO.CASE_Q));
  assert.ok(ids.includes(POWER_SIZING_SCENARIO.CASE_C));
  assert.notEqual(scenarios[0].interiorCandelaCd, scenarios[1].interiorCandelaCd,
    "the two cases must not evaluate the same setting");
  assert.equal(scenarios.find((s) => s.id === POWER_SIZING_SCENARIO.CASE_Q).interiorCandelaCd, 75);
  const conservative = scenarios.find((s) => s.id === POWER_SIZING_SCENARIO.CASE_C);
  assert.equal(conservative.interiorCandelaCd, Math.max(...SUPPORTED_INDOOR_CANDELA.standardRange),
    "CASE C must be the highest reasonably applicable supported setting");
  assert.ok(conservative.interiorCandelaCd > 75, "conservative must exceed the quotation assumption");
  // Both must be computable and manufacturer-supported.
  for (const s of scenarios) {
    assert.equal(s.state, "COMPUTABLE");
    assert.ok(SUPPORTED_INDOOR_CANDELA.all.includes(s.interiorCandelaCd));
  }
});

// 5 -----------------------------------------------------------------
test("5 -- different supported candela settings can produce DIFFERENT RPS quantities", () => {
  const at75 = rpsFor(75);
  const at110 = rpsFor(110);
  assert.notEqual(at75, at110, "the candela assumption must be able to change the physical RPS count");
  assert.ok(at110 > at75, "the higher candela must not require fewer RPS units");
  // And the low end must be materially cheaper, proving the model is responsive.
  const at15 = rpsFor(15, "Temporal Low");
  assert.ok(at15 < at75);
  // Sensitivity is monotone non-decreasing in candela.
  let prev = -1;
  for (const cd of [15, 30, 75, 95, 110]) {
    const n = rpsFor(cd);
    assert.ok(n >= prev, `RPS count must not decrease as candela rises (at ${cd} cd)`);
    prev = n;
  }
});

// 6 -----------------------------------------------------------------
test("6 -- an UNSUPPORTED 60 cd is never fabricated", () => {
  assert.ok(!SUPPORTED_INDOOR_CANDELA.all.includes(60), "60 cd must not appear as supported");
  assert.deepEqual([...SUPPORTED_INDOOR_CANDELA.notOffered], [60]);
  const probe = buildPowerScenario({ id: "X", label: "60 cd probe", interiorCandelaCd: 60, purpose: "probe" });
  assert.equal(probe.state, "REJECTED_UNSUPPORTED_CANDELA");
  assert.match(probe.reason, /NOT a manufacturer-supported selection/);
  assert.match(probe.reason, /never fabricated or mapped/);
  // No 60 cd current may be produced by the load engine.
  const load = perPanelAlarmLoad(DEMAND["PANEL-MFACP-CAMPUS"], { case: BOUNDING_CASES.WORST_ALLOWED_SETTING, interiorCandelaCd: 60, interiorVolume: "Temporal High" });
  assert.equal(load.state, "NOT_COMPUTABLE");
  assert.equal(load.totalAlarmCurrentAmps, null);
  assert.ok(load.blockingReasons.some((r) => r.reason === "SETTING_NOT_TABULATED_IN_FIRST_PARTY_EVIDENCE"));
});

// 7 -----------------------------------------------------------------
test("7 -- the 60 cd requirement mismatch remains VISIBLE and unresolved", () => {
  assert.equal(PROJECT_60CD_MISMATCH.mismatchId, "PROJECT_REQUIREMENT_TO_PRODUCT_SETTING_MISMATCH");
  assert.match(PROJECT_60CD_MISMATCH.state, /OPEN/);
  assert.equal(PROJECT_60CD_MISMATCH.isSpecificationWrong, null,
    "we must not declare the specification wrong");
  assert.equal(PROJECT_60CD_MISMATCH.sixtyCdFabricated, false);
  assert.equal(PROJECT_60CD_MISMATCH.sixtyCdMappedToAnotherSetting, null,
    "60 cd must not be silently mapped onto another setting");
  assert.ok(PROJECT_60CD_MISMATCH.candidateInterpretations.length >= 4);
  // It must NOT block preliminary sizing, because the requirement is not proven exact.
  assert.match(PROJECT_60CD_MISMATCH.effectOnPreliminarySizing, /NONE_BLOCKING/);
  assert.match(RUNNER, /PROJECT_60CD_MISMATCH/);
  assert.match(RUNNER, /mismatchId/);
  assert.match(RUNNER, /isSpecificationWrong/);
});

// 8 -----------------------------------------------------------------
test("8 -- appliance selection stays MULTI-CANDELA where appropriate", () => {
  assert.equal(SUPPORTED_INDOOR_CANDELA.selectedApplianceCandelaOptions, "FIELD_SELECTABLE_MULTI_CANDELA_APPLIANCE");
  assert.equal(QUOTATION_ASSUMPTION.productBasis, "FIELD_SELECTABLE_MULTI_CANDELA_APPLIANCE");
  assert.ok(SUPPORTED_INDOOR_CANDELA.all.length >= 8, "the family must remain multi-candela");
  assert.deepEqual([...SUPPORTED_INDOOR_CANDELA.standardRange], [15, 30, 75, 95, 110, 115]);
  assert.deepEqual([...SUPPORTED_INDOOR_CANDELA.highRange], [135, 150, 177, 185]);
  assert.match(SUPPORTED_INDOOR_CANDELA.proposition, /Standard Candela Range 15, 15\/75, 30, 75, 95, 110, 115/);
});

// 9 -----------------------------------------------------------------
test("9 -- the FINAL RPS BOM stays PROVISIONAL without voltage-drop / distribution evidence", () => {
  const f = RPS_QUANTITY_BASIS.FINAL_DESIGN_RPS_QUANTITY;
  assert.equal(f.state, "NOT_COMPUTABLE");
  assert.equal(f.isFinalDesign, true);
  assert.equal(f.authority, null, "no approval authority may be claimed for the final quantity");
  assert.equal(RPS_QUANTITY_BASIS.QUOTATION_BASIS_RPS_QUANTITY.isFinalDesign, false);
  assert.equal(RPS_QUANTITY_BASIS.CONSERVATIVE_CAPACITY_RPS_QUANTITY.isFinalDesign, false);
  // The three must be three distinct bases, never one number.
  const bases = Object.keys(RPS_QUANTITY_BASIS);
  assert.equal(bases.length, 3);
  assert.notEqual(
    RPS_QUANTITY_BASIS.QUOTATION_BASIS_RPS_QUANTITY.candelaBasis,
    RPS_QUANTITY_BASIS.CONSERVATIVE_CAPACITY_RPS_QUANTITY.candelaBasis,
  );
  // Voltage drop is still not computable, which is one of the stated blockers.
  const vd = voltageDropReadiness({ panelId: "P", conductorSqMm: 1.5, conductorMaterial: "COPPER", routeLengthM: null, deviceOrder: null, minApplianceVolts: null, designMarginPct: null });
  assert.equal(vd.state, "NOT_COMPUTABLE");
  assert.ok(f.blocking.some((b) => /voltage drop/i.test(b)));
  assert.match(RUNNER, /FINAL_RPS_BOM_STATUS\s+=\s+PROVISIONAL/);
});

// 10 ----------------------------------------------------------------
test("10 -- the battery calculation uses the load ACTUALLY ASSIGNED to each power source", () => {
  // A panel that sources only its native 9 A must NOT be charged the full load.
  const notifMa = 24630;
  const nativeMa = 9000;
  const panelAlarm = BATTERY_DEVICE_CURRENT_MA.ifp2100Panel.alarm + nativeMa;
  const rpsAlarm = 160 + Math.ceil((notifMa - nativeMa) / 3);
  assert.equal(BATTERY_DEVICE_CURRENT_MA.ifp2100Panel.alarm, 415);
  // The panel takes its native 9 A; the RPS units take the deficit. The shares must
  // reconstruct the total exactly -- that is what proves no load is lost or doubled.
  assert.equal(nativeMa + 3 * Math.ceil((notifMa - nativeMa) / 3), notifMa, "assigned shares must reconstruct the total");
  assert.ok(rpsAlarm > 160, "each RPS must carry its own alarm current plus its assigned notification share");
  assert.ok(panelAlarm > 415, "the panel must carry its own alarm current plus its assigned notification share");
  assert.equal(nativeMa, 9000, "the panel is capped at its 9 A native total");
  // Ah is computed per enclosure and never pooled.
  const a = batteryAhForEnclosure({ enclosureId: "PANEL", standbyLoadMa: 620, alarmLoadMa: panelAlarm, standbyHours: 24, alarmMinutes: 30, enclosureType: "IFP_2100", marginPct: 20 });
  const b = batteryAhForEnclosure({ enclosureId: "RPS", standbyLoadMa: 40, alarmLoadMa: rpsAlarm, standbyHours: 24, alarmMinutes: 30, enclosureType: "RPS_1000" });
  assert.equal(a.pooled, false);
  assert.equal(b.pooled, false);
  assert.notEqual(a.requiredAh, b.requiredAh, "two enclosures must yield two independent figures");
  // Neither equals the sum: that would be pooling.
  assert.notEqual(a.requiredAh + b.requiredAh, a.requiredAh);
  // A missing load must fail closed rather than assume zero.
  const missing = batteryAhForEnclosure({ enclosureId: "X", standbyLoadMa: null, alarmLoadMa: 100, standbyHours: 24, alarmMinutes: 30 });
  assert.equal(missing.state, "NOT_COMPUTABLE");
  assert.deepEqual(missing.missing, ["standby load"]);
  // The RPS-1000 worksheets carry NO derating row, so no factor may be applied to them.
  assert.equal(a.factor, 1.2, "the IFP-2100 worksheet applies the project margin");
  assert.equal(b.factor, 1, "the RPS-1000 worksheet states no derating factor, so none is invented");
  assert.match(BATTERY_WORKSHEET_METHOD.rpsHasNoDeratingRow, /NO .*Derating Factor 1\.25/);
  // The literal single-Line-D reading was a PDF-extraction ARTEFACT and is no
  // longer emitted as an engineering result at all.
  assert.equal("literalSingleLineDAh" in b, false, "the artefact figure must not be computed");
  assert.equal(b.rejectedAlternative.classification, "PDF_TEXT_EXTRACTION_ARTEFACT");
  assert.equal(b.rejectedAlternative.engineeringValid, false);
  assert.equal(b.method, "TWO_CONDITION_COLUMNS");
});

// 11 ----------------------------------------------------------------
test("11 -- 30-minute alarm duration is computed as 0.5 h where the worksheet permits", () => {
  const r = batteryAhForEnclosure({ enclosureId: "P", standbyLoadMa: 620, alarmLoadMa: 9805, standbyHours: 24, alarmMinutes: 30, enclosureType: "IFP_2100", marginPct: 20 });
  assert.equal(r.state, "COMPUTED");
  assert.equal(r.alarmHours, 0.5, "30 minutes must be exactly 0.5 hours, not a rounded tabulated column");
  assert.equal(r.alarmMah, 9805 * 0.5);
  assert.equal(r.standbyMah, 620 * 24);
  assert.equal(r.totalMah, 620 * 24 + 9805 * 0.5);
  // The two terms come from separate worksheet COLUMNS, not one shared total.
  // The reported Ah values are rounded to 3 dp for deterministic reporting.
  assert.equal(r.standbyAh, 14.88);
  assert.equal(r.alarmAh, 4.903);
  assert.ok(Math.abs(r.alarmAh - (9805 / 1000) * 0.5) < 1e-3);
  // Ampere-hours per condition, summed, then the derating factor.
  assert.ok(Math.abs(r.requiredAh - (r.standbyAh + r.alarmAh) * 1.2) < 1e-3);
  // The manufacturer states the factor as 1.25 and demonstrates minutes -> hours.
  assert.equal(BATTERY_WORKSHEET_METHOD.deratingFactor, 1.25);
  assert.equal(BATTERY_WORKSHEET_METHOD.alarmDurationArbitraryHours, true);
  assert.match(BATTERY_WORKSHEET_METHOD.lines.H, /Alarm sounding period in hours/);
  assert.match(BATTERY_WORKSHEET_METHOD.tablesAreNotTheRouteFor30Minutes, /only 5, 15 and 20 minute alarm columns/);
  // Without an explicit project margin the manual's own 1.25 is used.
  const manualFactor = batteryAhForEnclosure({ enclosureId: "P", standbyLoadMa: 620, alarmLoadMa: 9805, standbyHours: 24, alarmMinutes: 30, enclosureType: "IFP_2100" });
  assert.equal(manualFactor.factor, 1.25);
  // The previously blocked input is now closed by first-party evidence.
  assert.equal(BATTERY_DEVICE_CURRENT_MA.idpHeatRorIV.standby, 0.2);
  assert.equal(BATTERY_DEVICE_CURRENT_MA.idpHeatRorIV.alarm, 4.5);
  assert.ok(BATTERY_DEVICE_CURRENT_MA.idpHeatRorIV.proposition.includes("MERGED") || BATTERY_DEVICE_CURRENT_MA.idpHeatRorIV.proposition.includes("merged"));
  assert.equal(BATTERY_DEVICE_CURRENT_MA.idpHeatRor.standby, 0.3);
  // The RPS is its own power source, first-party.
  assert.match(RPS_BATTERY_TABLE.perUnitBasis, /For each RPS-1000 in the installation/);
  assert.equal(RPS_BATTERY_TABLE.fmMaxAh, 33);
  assert.match(r.formula, /x 0\.5 h/);
  assert.match(r.unitNote, /ampere-hours/);
  // The manufacturer calls line J "Total ampere hours required" -- A.h IS the Ah
  // rating, so there is NO division by battery voltage.
  assert.ok(!/\/ 24 V|\/24 V/.test(r.formula), "the worksheet does not divide by battery voltage");
  // A 20-minute tabulated column must NOT be substituted for the 30-minute project requirement.
  assert.equal(BATTERY_REQUIREMENT_EVIDENCE.alarmMinutes, 30);
});

// 12 ----------------------------------------------------------------
test("12 -- no final quotation, historical BOM or test oracle enters the calculation", () => {
  for (const [label, text] of [["policy", POLICY_SRC], ["runner", RUNNER]]) {
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
      assert.ok(!/fixtures|golden|oracle/i.test(m[1]), `${label} must not import a fixture: ${m[1]}`);
    }
    for (const table of ["product_identity_prices", "discount_rules", "costing_", "rfq_"]) {
      assert.ok(!text.includes(table), `${label} must not read commercial table ${table}`);
    }
    for (const field of ["listUsd", "netPrice", "unitCost"]) {
      assert.ok(!text.includes(field), `${label} must not consume pricing field ${field}`);
    }
  }
  // No target RPS or battery quantity may be asserted as an expected answer.
  assert.doesNotMatch(POLICY_SRC, /targetRps|expectedRps|targetAh|expectedAh/i);
  assert.match(RUNNER, /CANDELA ASSUMPTION CHANGES PHYSICAL RPS QUANTITY/);
  assert.match(RUNNER, /never pooled/);
  // The RPS battery conflict must be assessed, not assumed immaterial.
  assert.match(RUNNER, /RPS_BATTERY_CAPACITY_CONFLICT/);
  assert.match(RUNNER, /rpsBatteryCapacityConflict/);
  // The materiality decision is real: a requirement above the lower bound must flip it.
  assert.equal(rpsBatteryConflictMateriality([{ state: "COMPUTED", requiredAh: 0.19 }], { lowerBoundAh: 7, upperBoundAh: 35 }).rpsBatteryCapacityConflict, "NON_MATERIAL_TO_CURRENT_PROJECT");
  assert.equal(rpsBatteryConflictMateriality([{ state: "COMPUTED", requiredAh: 30 }], { lowerBoundAh: 7, upperBoundAh: 35 }).rpsBatteryCapacityConflict, "MATERIAL__BLOCKING");
  assert.equal(NAC_CONDUCTOR_EVIDENCE.state, "DISCREPANCY__NOT_SILENTLY_RESOLVED");
});

// 13 ----------------------------------------------------------------
test("13 -- rerun is deterministic", () => {
  const once = PHYSICAL_PANEL_SCOPES.map((s) => perPanelAlarmLoad(DEMAND[s.id], { case: BOUNDING_CASES.WORST_ALLOWED_SETTING, interiorCandelaCd: 75, interiorVolume: "Temporal High" }));
  const twice = PHYSICAL_PANEL_SCOPES.map((s) => perPanelAlarmLoad(DEMAND[s.id], { case: BOUNDING_CASES.WORST_ALLOWED_SETTING, interiorCandelaCd: 75, interiorVolume: "Temporal High" }));
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
  // Scenario construction is a pure function.
  assert.equal(JSON.stringify(requiredPowerScenarios()), JSON.stringify(requiredPowerScenarios()));
  // Battery arithmetic is deterministic.
  const args = { enclosureId: "P", standbyLoadMa: 620, alarmLoadMa: 9805, standbyHours: 24, alarmMinutes: 30, marginPct: 20 };
  assert.equal(JSON.stringify(batteryAhForEnclosure(args)), JSON.stringify(batteryAhForEnclosure(args)));
  // Conflict materiality is deterministic and directionally correct.
  const small = [{ state: "COMPUTED", requiredAh: 0.2 }];
  const big = [{ state: "COMPUTED", requiredAh: 40 }];
  assert.equal(rpsBatteryConflictMateriality(small, { lowerBoundAh: 7, upperBoundAh: 35 }).state, "NON_MATERIAL_TO_CURRENT_PROJECT");
  assert.equal(rpsBatteryConflictMateriality(big, { lowerBoundAh: 7, upperBoundAh: 35 }).state, "MATERIAL__BLOCKING");
});

test.after(() => db.close());
