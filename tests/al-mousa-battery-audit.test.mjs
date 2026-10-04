// AL MOUSA -- FINAL BATTERY CALCULATION AUDIT: MANDATED COVERAGE (13).
//
// This suite polices an AUDIT of a prior result, so most of it is about preventing
// the specific defects the audit found from coming back:
//   * a merged/parallel PDF table cell silently collapsing the two-condition
//     battery formula into a single worst-case total,
//   * a load belonging to two battery banks or to none,
//   * an RPS-sourced NAC load leaking into the parent panel's battery,
//   * physical enclosure location being mistaken for electrical ownership,
//   * and battery BOX capacity being used as sizing authority.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BATTERY_DEVICE_CURRENT_MA, BATTERY_WORKSHEET_METHOD, RPS_BATTERY_TABLE, BATTERY_BOUNDS,
  BATTERY_SELECTION_AUTHORITY,
  BATTERY_REQUIREMENT_EVIDENCE, batteryAhForEnclosure, rpsBatteryConflictMateriality,
  buildPowerSourceLedger, auditPowerOwnership, POWER_SOURCE, POWER_OWNERSHIP_RULE,
} from "../scripts/lib/al-mousa-nac-power-sizing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "..", "scripts", "lib", "al-mousa-nac-power-sizing.mjs"), "utf8");
const RUNNER = readFileSync(join(HERE, "..", "scripts", "size-al-mousa-notification-design-policy.mjs"), "utf8");

const nextSize = (req, sizes) => sizes.find((ah) => ah >= req) ?? null;
const prevSize = (req, sizes) => [...sizes].reverse().find((ah) => ah < req) ?? null;
const baseArgs = { enclosureId: "E", standbyLoadMa: 1000, alarmLoadMa: 2000, standbyHours: 24, alarmMinutes: 30, enclosureType: "IFP_2100" };

// 1 -----------------------------------------------------------------
test("1 -- IDP-PULL manual-station current is first-party evidence, NOT zero", () => {
  const d = BATTERY_DEVICE_CURRENT_MA.idpPullStandbyAlarm;
  assert.ok(d, "the manual station current must be modelled as an explicit fact");
  assert.notEqual(d.standby, null, "standby current must be evidenced, not left null");
  assert.notEqual(d.alarm, null, "alarm current must be evidenced, not left null");
  assert.notEqual(d.standby, 0, "a first-party current must not be recorded as zero");
  assert.notEqual(d.alarm, 0);
  assert.ok(d.proposition && d.proposition.length > 20, "the fact must carry its first-party proposition");
  assert.ok(!/SUBSTITUTE|assumed|guessed/i.test(d.proposition));
  // The two first-party documents disagree and do not state the same parameter.
  assert.ok(d.worksheetProposition, "the conflicting worksheet figure must be retained");
  assert.match(d.conflict, /OFFICIAL_DOCUMENTATION_CONFLICT/);
  assert.equal(d.conflictClass, "HIGHER_VALUE_USED__BOTH_RETAINED");
  assert.ok(d.standby > 0.3, "the data sheet value is higher than the worksheet's single 0.3 mA");
  assert.ok(d.alarm > 0.3, "and higher in the alarm condition too");
  assert.match(d.compatibility, /IFP-2100/);
  assert.match(d.excludedByFootnote, /isolator devices or accessory bases/);
  // The gap marker from the prior slice must be gone.
  assert.doesNotMatch(MODEL, /MANUAL_STATION_CURRENT_UNEVIDENCED/);
  assert.doesNotMatch(RUNNER, /NOT YET EVIDENCED -- contribution not computed/,
    "the runner must no longer report the manual station as unevidenced");
  // And a ledger containing it must be ownership-verified, not a floor.
  const led = buildPowerSourceLedger({
    panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK,
    rows: [{ label: "Manual station (IDP-PULL)", loadKey: "m", category: "FIELD_DEVICE", quantity: 58, standbyPerDeviceMa: d.standby, alarmPerDeviceMa: d.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK }],
  });
  assert.equal(led.state, "OWNERSHIP_VERIFIED");
  assert.equal(led.caseIsFloor, false, "with the current evidenced the row is no longer a floor");
  assert.ok(led.standbyTotalMa > 0);
});

// 2 -----------------------------------------------------------------
test("2 -- the worksheet STANDBY and ALARM columns remain distinct", () => {
  const cs = BATTERY_WORKSHEET_METHOD.columnStructure;
  assert.ok(cs, "the verified column structure must be recorded as evidence");
  assert.match(cs.header, /Standby Current/);
  assert.match(cs.header, /Alarm Current/);
  assert.match(cs.lineD, /TWO value cells/);
  assert.match(cs.lineE, /TWO value cells/);
  assert.match(cs.lineG, /STANDBY column/);
  assert.match(cs.lineI, /ALARM column/);
  // The two inputs must be consumed as two different numbers.
  const r = batteryAhForEnclosure(baseArgs);
  assert.notEqual(r.standbyLoadMa, r.alarmLoadMa);
  assert.ok(r.standbyAh > 0 && r.alarmAh > 0);
  assert.ok(Math.abs(r.requiredAh - (r.standbyAh + r.alarmAh) * r.factor) < 1e-3);
});

// 3 -----------------------------------------------------------------
test("3 -- flattened-PDF text cannot collapse the two-condition formula", () => {
  // The bogus alternative is retained ONLY as a labelled artefact marker.
  const r = batteryAhForEnclosure(baseArgs);
  assert.equal(r.method, "TWO_CONDITION_COLUMNS");
  assert.equal(r.rejectedAlternative.classification, "PDF_TEXT_EXTRACTION_ARTEFACT");
  assert.equal(r.rejectedAlternative.engineeringValid, false);
  assert.equal("literalSingleLineDAh" in r, false,
    "the artefact figure must not be emitted as a computed engineering result");
  assert.equal(BATTERY_WORKSHEET_METHOD.literalSingleLineDClassification, "PDF_TEXT_EXTRACTION_ARTEFACT");
  // A single worst-case current used for BOTH terms would give
  // max*24 + max*0.5. The two-column reading gives 2*24 + 2*0.5. Prove both
  // terms are consumed from their own column, at their own durations.
  const same = batteryAhForEnclosure({ ...baseArgs, standbyLoadMa: 2000, alarmLoadMa: 2000 });
  assert.equal(same.standbyAh, 48, "standby term uses the standby column x 24 h");
  assert.equal(same.alarmAh, 1, "alarm term uses the alarm column x 0.5 h");
  assert.equal(same.requiredAh, Math.round(49 * 1.25 * 1000) / 1000);
  const different = batteryAhForEnclosure({ ...baseArgs, standbyLoadMa: 1000, alarmLoadMa: 2000 });
  assert.ok(different.requiredAh < same.requiredAh,
    "raising only the standby column must not raise the alarm term");
  // And the module must not contain a literal 371 anywhere as a result.
  assert.doesNotMatch(MODEL, /371\.?\d*/, "the 371 Ah artefact must not survive in the model");
});

// 4 -----------------------------------------------------------------
test("4 -- every powered load has EXACTLY ONE power source", () => {
  const row = (label, key, powerSource) => ({ label, loadKey: key, quantity: 1, standbyPerDeviceMa: 1, alarmPerDeviceMa: 1, powerSource });
  const ok = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [row("a", "a", POWER_SOURCE.IFP_PANEL_BANK), row("b", "b", POWER_SOURCE.IFP_PANEL_BANK)] });
  assert.equal(ok.state, "OWNERSHIP_VERIFIED");
  assert.equal(ok.standbyTotalMa, 2);

  // An unassigned load is rejected.
  const orphan = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [{ label: "orphan", loadKey: "z", quantity: 1, standbyPerDeviceMa: 1, alarmPerDeviceMa: 1 }] });
  assert.equal(orphan.state, "OWNERSHIP_VIOLATION");
  assert.ok(orphan.findings.some((f) => f.code === "UNASSIGNED_POWER_LOAD"));
  assert.ok(POWER_OWNERSHIP_RULE.rejected.includes("UNASSIGNED_POWER_LOAD"));

  // A duplicated load in one bank is rejected as a double assignment.
  const dup = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [row("nac", "nac", POWER_SOURCE.IFP_PANEL_BANK), row("nac", "nac", POWER_SOURCE.IFP_PANEL_BANK)] });
  assert.ok(dup.findings.some((f) => f.code === "DOUBLE_POWER_ASSIGNMENT"));
  assert.ok(POWER_OWNERSHIP_RULE.rejected.includes("DOUBLE_POWER_ASSIGNMENT"));

  // A load pointed at the wrong bank is rejected.
  const wrong = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [row("nac", "nac", POWER_SOURCE.RPS_BANK)] });
  assert.ok(wrong.findings.some((f) => f.code === "POWER_LOAD_ASSIGNED_TO_OTHER_BANK"));
});

// 5 -----------------------------------------------------------------
test("5 -- RPS-sourced NAC load is ABSENT from the panel battery bank", () => {
  const native = (per) => ({ label: "NAC native share", loadKey: "nac-native", quantity: 1, standbyPerDeviceMa: 0, alarmPerDeviceMa: per, powerSource: POWER_SOURCE.IFP_PANEL_BANK, rpsSourced: false });
  const rpsShare = (per) => ({ label: "NAC rps share", loadKey: "nac-rps", quantity: 1, standbyPerDeviceMa: 0, alarmPerDeviceMa: per, powerSource: POWER_SOURCE.RPS_BANK, rpsSourced: true });
  const panel = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [native(9000)] });
  const rps = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.RPS_BANK, rows: [rpsShare(5000)] });
  // The panel bank must carry ONLY the native 9 A, never the RPS share.
  assert.equal(panel.alarmTotalMa, 9000);
  assert.equal(panel.rows.length, 1);
  assert.equal(rps.alarmTotalMa, 5000);
  // A clean split audits clean.
  assert.equal(auditPowerOwnership([panel, rps]).state, "OWNERSHIP_VERIFIED");
  // If the RPS share is ALSO left in the panel bank, that is rejected.
  const leaky = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [native(9000), rpsShare(5000)] });
  const audit = auditPowerOwnership([leaky, rps]);
  assert.equal(audit.state, "OWNERSHIP_VIOLATION");
  assert.ok(audit.findings.some((f) => f.code === "POWER_LOAD_ASSIGNED_TO_OTHER_BANK"));
  assert.match(POWER_OWNERSHIP_RULE.nacRule, /must not also appear/i);
});

// 6 -----------------------------------------------------------------
test("6 -- 6815 ownership follows the WIRING, not the physical cabinet", () => {
  assert.match(POWER_OWNERSHIP_RULE.principle, /TERMINAL_PAIR_DETERMINES_OWNERSHIP__NOT_PHYSICAL_CABINET/);
  assert.match(POWER_OWNERSHIP_RULE.decisiveText, /Terminals 16-19/);
  assert.match(POWER_OWNERSHIP_RULE.decisiveText, /Terminals 30-33/);
  assert.match(POWER_OWNERSHIP_RULE.workedExample, /6815/);
  assert.match(POWER_OWNERSHIP_RULE.workedExample, /SBUS OUT/);
  // The rule must be explicit that the SAME board can be either bank's load.
  assert.match(POWER_OWNERSHIP_RULE.workedExample, /PANEL bank if wired/);
  assert.match(POWER_OWNERSHIP_RULE.workedExample, /RPS-1000 bank if wired/);
  // And the project decision must be recorded as unproven, not assumed.
  assert.match(POWER_OWNERSHIP_RULE.wiringDecisionIsUnprovenForThisProject, /NOT EVIDENCED/);
  assert.match(POWER_OWNERSHIP_RULE.deviceOwners["6815 SLC expander"], /DEPENDS_ON_TERMINAL_PAIR/);
  assert.equal(POWER_OWNERSHIP_RULE.deviceOwners["SK-NIC"], POWER_SOURCE.IFP_PANEL_BANK);
  // Cabinet location alone must not be able to move a load between banks: the
  // ledger compares the declared bank against the WIRING owner.
  const expander = (powerSource, ownerByWiring) => ({
    label: "6815 in RPS cabinet", loadKey: "6815", quantity: 2,
    standbyPerDeviceMa: 78, alarmPerDeviceMa: 78, powerSource, ownerByWiring,
    physicalMountedIn: "RPS_CABINET",
  });
  const panelWired = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows: [expander(POWER_SOURCE.IFP_PANEL_BANK, POWER_SOURCE.IFP_PANEL_BANK)] });
  assert.equal(panelWired.state, "OWNERSHIP_VERIFIED", "a panel-wired expander in an RPS cabinet is a PANEL load");
  assert.equal(panelWired.alarmTotalMa, 156);
  const rpsWired = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.RPS_BANK, rows: [expander(POWER_SOURCE.RPS_BANK, POWER_SOURCE.RPS_BANK)] });
  assert.equal(rpsWired.state, "OWNERSHIP_VERIFIED", "an RPS-wired expander is an RPS load");
  assert.equal(rpsWired.alarmTotalMa, 156);
  // The failure mode is a MISMATCH between the two, not the cabinet.
  const mismatched = buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.RPS_BANK, rows: [expander(POWER_SOURCE.RPS_BANK, POWER_SOURCE.IFP_PANEL_BANK)] });
  assert.equal(mismatched.state, "OWNERSHIP_VIOLATION");
  assert.ok(mismatched.findings.some((f) => f.code === "PHYSICAL_MOUNTING_MISTAKEN_FOR_POWER_OWNERSHIP"));
  assert.ok(POWER_OWNERSHIP_RULE.rejected.includes("PHYSICAL_MOUNTING_MISTAKEN_FOR_POWER_OWNERSHIP"));
});

// 7 -----------------------------------------------------------------
test("7 -- the 24 h + 0.5 h calculation is applied correctly", () => {
  const r = batteryAhForEnclosure(baseArgs);
  assert.equal(r.standbyHours, 24);
  assert.equal(r.alarmMinutes, 30);
  assert.equal(r.alarmHours, 0.5, "30 minutes must be exactly 0.5 hours");
  assert.equal(r.standbyAh, 1 * 24);
  assert.equal(r.alarmAh, 2 * 0.5);
  assert.equal(BATTERY_REQUIREMENT_EVIDENCE.standbyHours, 24);
  assert.equal(BATTERY_REQUIREMENT_EVIDENCE.alarmMinutes, 30);
  // Line H is the authority and is expressed in hours.
  assert.equal(BATTERY_WORKSHEET_METHOD.alarmDurationArbitraryHours, true);
  assert.match(BATTERY_WORKSHEET_METHOD.lines.H, /in hours/);
  // Tables 3.5/3.6 are explicitly NOT the route for 30 minutes.
  assert.match(BATTERY_WORKSHEET_METHOD.tablesAreNotTheRouteFor30Minutes, /only 5, 15 and 20 minute alarm columns/);
});

// 8 -----------------------------------------------------------------
test("8 -- the 1.25 derating is applied EXACTLY ONCE for the IFP-2100", () => {
  const withManual = batteryAhForEnclosure({ ...baseArgs, marginPct: null });
  assert.equal(withManual.factor, 1.25, "the manufacturer's own factor is used when the project states none");
  const bare = batteryAhForEnclosure({ ...baseArgs, marginPct: null });
  assert.ok(Math.abs(bare.requiredAh - (bare.standbyAh + bare.alarmAh) * 1.25) < 1e-3);
  // Applying it to the already-factored value would square it; prove we do not.
  const once = (bare.standbyAh + bare.alarmAh) * 1.25;
  const twice = (bare.standbyAh + bare.alarmAh) * 1.25 * 1.25;
  assert.equal(bare.requiredAh, Math.round(once * 1000) / 1000);
  assert.notEqual(bare.requiredAh, Math.round(twice * 1000) / 1000);
  assert.match(bare.unitNote, /before the derating factor is applied once/);
  // And the derating must not be applied again on top of a Table 3.5 comparison.
  assert.match(BATTERY_WORKSHEET_METHOD.deratingNote, /built in/);
});

// 9 -----------------------------------------------------------------
test("9 -- the RPS does NOT inherit the panel derating without RPS authority", () => {
  const rps = batteryAhForEnclosure({ ...baseArgs, enclosureType: "RPS_1000" });
  assert.equal(rps.factor, 1, "the RPS-1000 worksheets state no derating factor");
  assert.match(rps.factorNote, /none is inherited from the IFP-2100/);
  assert.match(BATTERY_WORKSHEET_METHOD.rpsHasNoDeratingRow, /Derating Factor 1\.25/);
  assert.match(BATTERY_WORKSHEET_METHOD.rpsHasNoDeratingRow, /carry NO/);
  // Passing the project margin to an RPS must NOT apply it either.
  const rpsWithMargin = batteryAhForEnclosure({ ...baseArgs, enclosureType: "RPS_1000", marginPct: 20 });
  assert.equal(rpsWithMargin.factor, 1);
});

// 10 ----------------------------------------------------------------
test("10 -- battery BOX capacity cannot act as battery sizing authority", () => {
  const sizes = BATTERY_BOUNDS.maxBatteryStandbyTableAh;
  // The panel cabinet fits two 18 Ah batteries, but the charger accepts 17-55 Ah.
  // A physical box limit must never cap the SIZING range.
  assert.ok(BATTERY_BOUNDS.chargeCapacityMaxAh > 18, "the charger range must exceed the in-cabinet battery size");
  assert.equal(BATTERY_BOUNDS.chargeCapacityMinAh, 17);
  assert.equal(BATTERY_BOUNDS.chargeCapacityMaxAh, 55);
  // Selection authority is the SUPPORTED SIZE LIST plus 'next size greater'.
  const required = 29.4;
  assert.equal(nextSize(required, sizes), 33);
  assert.equal(prevSize(required, sizes), 24);
  // A 33 Ah battery does not fit the main cabinet -- and the model must say so
  // rather than silently pick an in-cabinet size that cannot meet the requirement.
  assert.ok(33 > 18, "the selected size can exceed the in-cabinet battery, requiring an accessory enclosure");
  assert.match(MODEL, /RBB/);
  assert.match(MODEL, /AB-55/);
  assert.equal(BATTERY_SELECTION_AUTHORITY.iFP2100.accessoryEnclosures.length, 2);
  // BB-26 EXISTS as a first-party document but is NOT an IFP-2100 accessory, and
  // it must never be offered as a sizing option for this panel.
  assert.equal(BATTERY_SELECTION_AUTHORITY.bb26.state, "EXISTS_BUT_NOT_AN_IFP_2100_ACCESSORY");
  assert.match(BATTERY_SELECTION_AUTHORITY.bb26.notAuthorisedForIFP2100, /NOT an authorised IFP-2100 accessory/);
  assert.match(BATTERY_SELECTION_AUTHORITY.bb26.noSizingDependency, /depends on the BB-26/);
  assert.doesNotMatch(MODEL, /bb26[\s\S]{0,200}holdsUpToAh/,
    "the unauthorised BB-26 must not be modelled as a capacity option");
  assert.match(RUNNER, /RBB|RBB,|accessory/i);
  // The manufacturer's own undersizing warning must be carried.
  assert.match(BATTERY_WORKKSHEET_UNSIZE_WARNING(), /DOES NOT SUPPORT THE USE OF BATTERIES SMALLER/);
});
function BATTERY_WORKKSHEET_UNSIZE_WARNING() { return BATTERY_WORKSHEET_METHOD.doNotUndersize; }

// 11 ----------------------------------------------------------------
test("11 -- the LOWER-size threshold is tested explicitly", () => {
  const sizes = BATTERY_BOUNDS.maxBatteryStandbyTableAh;
  // A requirement just above a size must step up; just below must not.
  assert.equal(nextSize(17.0, sizes), 17);
  assert.equal(nextSize(17.001, sizes), 18);
  assert.equal(nextSize(24.0, sizes), 24);
  assert.equal(nextSize(24.001, sizes), 33);
  // Margin to the lower size is what decides materiality, and it must be computable.
  const worst = 30.256;
  assert.equal(prevSize(worst, sizes), 24);
  assert.ok(Math.abs((worst - 24) - 6.256) < 1e-3);
  // Headroom to the selected size is the other side of the same test.
  const sel = nextSize(worst, sizes);
  assert.ok(sel - worst > 0, "the selection rule requires strictly greater capacity");
  assert.match(RUNNER, /THRESHOLD SENSITIVITY/);
  assert.match(RUNNER, /Margin to lower/);
});

// 12 ----------------------------------------------------------------
test("12 -- no historical BOM, quotation or expected Ah enters the calculation", () => {
  for (const [label, text] of [["model", MODEL], ["runner", RUNNER]]) {
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
      assert.ok(!/fixtures|golden|oracle/i.test(m[1]), `${label} must not import a fixture: ${m[1]}`);
    }
    for (const table of ["product_identity_prices", "discount_rules", "costing_", "rfq_"]) {
      assert.ok(!text.includes(table), `${label} must not read commercial table ${table}`);
    }
    for (const f of ["listUsd", "netPrice", "unitCost", "expectedAh", "targetAh", "historicalBom"]) {
      assert.ok(!text.includes(f), `${label} must not consume ${f}`);
    }
  }
  // Selection must be derived from the supported list, not asserted.
  const sizes = BATTERY_BOUNDS.maxBatteryStandbyTableAh;
  assert.deepEqual([...sizes], [17, 18, 24, 33, 35, 40, 55]);
  assert.equal(nextSize(29.4, sizes), 33);
  // The RPS conflict must remain a real, evaluated question.
  const small = [{ state: "COMPUTED", requiredAh: 3.6 }];
  assert.equal(rpsBatteryConflictMateriality(small, { lowerBoundAh: 7, upperBoundAh: 35 }).rpsBatteryCapacityConflict, "NON_MATERIAL_TO_CURRENT_PROJECT");
  assert.equal(rpsBatteryConflictMateriality([{ state: "COMPUTED", requiredAh: 30 }], { lowerBoundAh: 7, upperBoundAh: 35 }).rpsBatteryCapacityConflict, "MATERIAL__BLOCKING");
  assert.equal(RPS_BATTERY_TABLE.fmMaxAh, 33);
});

// 13 ----------------------------------------------------------------
test("13 -- deterministic rerun", () => {
  assert.equal(JSON.stringify(batteryAhForEnclosure(baseArgs)), JSON.stringify(batteryAhForEnclosure(baseArgs)));
  const rows = [{ label: "a", loadKey: "a", quantity: 3, standbyPerDeviceMa: 2, alarmPerDeviceMa: 4, powerSource: POWER_SOURCE.IFP_PANEL_BANK }];
  assert.equal(
    JSON.stringify(buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows })),
    JSON.stringify(buildPowerSourceLedger({ panelId: "P", bank: POWER_SOURCE.IFP_PANEL_BANK, rows })),
  );
  assert.equal(JSON.stringify(auditPowerOwnership([])), JSON.stringify(auditPowerOwnership([])));
  // The method and artefact classification are stable properties, not per-run state.
  assert.equal(batteryAhForEnclosure(baseArgs).method, "TWO_CONDITION_COLUMNS");
  assert.equal(batteryAhForEnclosure(baseArgs).rejectedAlternative.classification, "PDF_TEXT_EXTRACTION_ARTEFACT");
});
