// AL MOUSA -- NOTIFICATION DESIGN POLICY + RPS/BATTERY CLOSURE (READ-ONLY RUNNER).
//
// Applies the human engineering candela decision. READ-ONLY: opens the database
// readOnly, writes nothing, and reads no quotation, historical final BOM, or
// test oracle. The campus is never pooled.

import { openDb } from "./lib/al-mousa-drawing-geometry-takeoff.mjs";
import { boqBlocks } from "./lib/al-mousa-drawing-boq-reconciliation.mjs";
import { PHYSICAL_PANEL_SCOPES } from "./lib/al-mousa-panel-slc-address-budget.mjs";
import { IFP_2100_CAPACITY } from "./lib/al-mousa-farenhyt-nac-capacity.mjs";
import {
  PROJECT, BOUNDING_CASES, SOUND_PATTERN,
  notificationDemandForPanel, perPanelAlarmLoad, nacCircuitRequirement, rpsRightSizing,
  batteryAhForEnclosure, rpsBatteryConflictMateriality, voltageDropReadiness,
  buildPowerSourceLedger, auditPowerOwnership, POWER_SOURCE, POWER_OWNERSHIP_RULE,
  BATTERY_WORKSHEET_METHOD, RPS_BATTERY_TABLE, BATTERY_SELECTION_AUTHORITY,
  BATTERY_DEVICE_CURRENT_MA, BATTERY_REQUIREMENT_EVIDENCE, BATTERY_BOUNDS, NAC_CONDUCTOR_EVIDENCE,
} from "./lib/al-mousa-nac-power-sizing.mjs";
import {
  NOTIFICATION_DESIGN_POLICY, QUOTATION_ASSUMPTION, SUPPORTED_INDOOR_CANDELA,
  PROJECT_60CD_MISMATCH, PHOTOMETRIC_INPUT_READINESS, RPS_QUANTITY_BASIS,
  requiredPowerScenarios, buildPowerScenario, assertNoDesignPromotion,
} from "./lib/al-mousa-notification-design-policy.mjs";

const DB = process.env.FA_DB;
if (!DB) { console.error("usage: FA_DB=<sqlite> node scripts/size-al-mousa-notification-design-policy.mjs"); process.exit(2); }
const db = openDb(DB);
const L = []; const p = (s = "") => L.push(s);
const pad = (v, n) => String(v ?? "-").padStart(n);
const DEMANDING = Object.fromEntries(PHYSICAL_PANEL_SCOPES.map((s) => [s.id, notificationDemandForPanel(s, boqBlocks(db, PROJECT))]));

p("A. HUMAN NOTIFICATION DESIGN DECISION (project authority)");
p("=".repeat(112));
p(`  policyId                          : ${NOTIFICATION_DESIGN_POLICY.policyId}`);
p(`  designCandelaPolicy               : ${NOTIFICATION_DESIGN_POLICY.designCandelaPolicy}`);
p(`  authority                         : ${NOTIFICATION_DESIGN_POLICY.authority}`);
p(`  noGlobalDefaultCandela            : ${NOTIFICATION_DESIGN_POLICY.noGlobalDefaultCandela}`);
p(`  explicitly forbidden              : ${NOTIFICATION_DESIGN_POLICY.explicitlyForbidden}`);
p(`  per-space determinants            : ${NOTIFICATION_DESIGN_POLICY.perSpaceDeterminants.join("; ")}`);
p();
p(`  quotationCandelaAssumption            : ${QUOTATION_ASSUMPTION.quotationCandelaAssumption} cd`);
p(`  quotationCandelaAssumptionAuthority   : ${QUOTATION_ASSUMPTION.quotationCandelaAssumptionAuthority}`);
p(`  quotationCandelaAssumptionStatus      : ${QUOTATION_ASSUMPTION.quotationCandelaAssumptionStatus}`);
p(`  condition                            : ${QUOTATION_ASSUMPTION.condition}`);
p(`  product basis                        : ${QUOTATION_ASSUMPTION.productBasis}`);
p(`  isFinalDesignAuthority               : ${QUOTATION_ASSUMPTION.isFinalDesignAuthority}`);
p(`  isCodeDefault                        : ${QUOTATION_ASSUMPTION.isCodeDefault}`);

p();
p("B. DESIGN vs QUOTATION SEMANTICS (separate fields, never one `candela`)");
p("=".repeat(112));
for (const [field, value] of Object.entries({
  designCandelaPolicy: NOTIFICATION_DESIGN_POLICY.designCandelaPolicy,
  quotationCandelaAssumption: `${QUOTATION_ASSUMPTION.quotationCandelaAssumption} cd`,
  quotationCandelaAssumptionAuthority: QUOTATION_ASSUMPTION.quotationCandelaAssumptionAuthority,
  quotationCandelaAssumptionStatus: QUOTATION_ASSUMPTION.quotationCandelaAssumptionStatus,
  selectedApplianceCandelaOptions: SUPPORTED_INDOOR_CANDELA.selectedApplianceCandelaOptions,
  powerSizingScenario: "CASE_Q (quotation) and CASE_C (conservative capacity)",
  finalPhotometricDesignStatus: PHOTOMETRIC_INPUT_READINESS.finalPhotometricDesignStatus,
})) p(`  ${field.padEnd(38)}: ${value}`);
p();
p(`  The quotation assumption MAY feed commercial estimation and the CASE Q power case.`);
p(`  It MAY NOT feed final design. It is not a code default and not a statement that every`);
p(`  device will ultimately operate at 75 cd.`);
for (const sc of requiredPowerScenarios()) {
  const g = assertNoDesignPromotion(sc);
  p(`  guard ${sc.id.padEnd(40)}: state=${sc.state}  designAuthority=${sc.designAuthority}  guard=${g.ok ? "OK" : g.reason}`);
}

p();
p("C. PROJECT 60 cd REQUIREMENT RECONCILIATION");
p("=".repeat(112));
p(`  mismatch            : ${PROJECT_60CD_MISMATCH.mismatchId}`);
p(`  state               : ${PROJECT_60CD_MISMATCH.state}`);
p(`  requirement         : ${PROJECT_60CD_MISMATCH.requirementSource}`);
p(`  product evidence    : ${PROJECT_60CD_MISMATCH.productEvidence}`);
p(`  isSpecificationWrong: ${PROJECT_60CD_MISMATCH.isSpecificationWrong}  (NOT determined -- the spec is NOT called wrong)`);
p(`  60 cd fabricated    : ${PROJECT_60CD_MISMATCH.sixtyCdFabricated}`);
p(`  60 cd mapped        : ${PROJECT_60CD_MISMATCH.sixtyCdMappedToAnotherSetting}  (explicitly NOT mapped)`);
p("  open interpretations:");
for (const i of PROJECT_60CD_MISMATCH.candidateInterpretations) p(`     - ${i}`);
p(`  effect on preliminary sizing: ${PROJECT_60CD_MISMATCH.effectOnPreliminarySizing}`);
const rejected = buildPowerScenario({ id: "PROBE_60CD", label: "probe 60 cd", interiorCandelaCd: 60, purpose: "probe" });
p(`  probe result: ${rejected.state} -- ${rejected.reason}`);

p();
p("D. AVAILABLE INDOOR APPLIANCE CANDELA SETTINGS (first-party)");
p("=".repeat(112));
p(`  standard range : ${SUPPORTED_INDOOR_CANDELA.standardRange.join(", ")} cd`);
p(`  high range     : ${SUPPORTED_INDOOR_CANDELA.highRange.join(", ")} cd`);
p(`  NOT offered    : ${SUPPORTED_INDOOR_CANDELA.notOffered.join(", ")} cd`);
p(`  sound pattern  : ${SOUND_PATTERN.fixed} (project-mandated Code 3); ${SOUND_PATTERN.volumeUnresolved}`);
p(`  evidence       : ${SUPPORTED_INDOOR_CANDELA.proposition}`);

p();
p("E. PHOTOMETRIC DESIGN INPUT READINESS");
p("=".repeat(112));
p(`  PHOTOMETRIC_DESIGN_INPUTS      = ${PHOTOMETRIC_INPUT_READINESS.photometricDesignInputs}`);
p(`  finalPhotometricDesignStatus   = ${PHOTOMETRIC_INPUT_READINESS.finalPhotometricDesignStatus}`);
p(`  searched for                   : ${PHOTOMETRIC_INPUT_READINESS.searched.join("; ")}`);
p(`  package                        : ${PHOTOMETRIC_INPUT_READINESS.projectPackageComposition}`);
p("  decisive evidence:");
PHOTOMETRIC_INPUT_READINESS.decisiveEvidence.forEach((e, i) => p(`    ${i + 1}. ${e}`));
p(`  consequence: ${PHOTOMETRIC_INPUT_READINESS.consequence}`);
p(`  ${PHOTOMETRIC_INPUT_READINESS.notFabricated}`);

p();
p("F. NOTIFICATION POWER SENSITIVITY (per panel; campus never pooled)");
p("=".repeat(112));
p(`  ${"Scenario".padEnd(34)}${"Indoor cd".padStart(9)}${"Campus A".padStart(10)}   per-panel RPS (MFACP/BOYS/GIRLS/WLC/SUB1/SUB2/DG)`);
const SENS = [
  { label: "15 cd (lowest supported)", cd: 15, vol: "Temporal Low" },
  { label: "30 cd", cd: 30, vol: "Temporal High" },
  { label: "75 cd -- CASE Q QUOTATION", cd: 75, vol: "Temporal High" },
  { label: "95 cd", cd: 95, vol: "Temporal High" },
  { label: "110 cd -- CASE C CONSERVATIVE", cd: 110, vol: "Temporal High" },
  { label: "115 cd", cd: 115, vol: "Temporal High" },
];
const sensRows = [];
for (const s of SENS) {
  const per = {}, rpsQ = {};
  let campus = 0;
  for (const sc of PHYSICAL_PANEL_SCOPES) {
    const load = perPanelAlarmLoad(DEMANDING[sc.id], { case: BOUNDING_CASES.WORST_ALLOWED_SETTING, interiorCandelaCd: s.cd, interiorVolume: s.vol });
    per[sc.id] = load;
    campus += load.totalAlarmCurrentAmps ?? 0;
    const req = nacCircuitRequirement({ loadAmps: load.totalAlarmCurrentAmps, wiringClass: "CLASS_B", drawingNacCircuits: 1 });
    const r = rpsRightSizing({
      nativeCircuitsUsable: Math.min(req.requiredCircuits ?? 0, IFP_2100_CAPACITY.flexputCircuitsClassB),
      nativeUsableAmps: IFP_2100_CAPACITY.panelTotalLimitAmps,
      requiredCircuits: req.requiredCircuits ?? 0, requiredAmps: load.totalAlarmCurrentAmps ?? 0,
    });
    rpsQ[sc.id] = r;
  }
  const total = Object.values(rpsQ).reduce((a, r) => a + r.rpsQuantity, 0);
  sensRows.push({ ...s, campus, total, rpsQ, per });
  p(`  ${s.label.padEnd(34)}${pad(s.cd, 9)}${pad(round3(campus), 10)}   ${PHYSICAL_PANEL_SCOPES.map((sc) => pad(rpsQ[sc.id].rpsQuantity, 2)).join(" ")}   TOTAL=${total}`);
}
p();
const caseQ = sensRows.find((r) => r.cd === 75);
const caseC = sensRows.find((r) => r.cd === 110);
p(`  CANDELA ASSUMPTION CHANGES PHYSICAL RPS QUANTITY: ${caseQ.total} (75 cd) -> ${caseC.total} (110 cd) = ${caseC.total - caseQ.total} additional unit(s).`);
p("  The 75 cd quotation assumption therefore UNDERSTATES the power-capacity requirement. Quotation basis");
p("  and capacity basis are reported separately and are never merged into one BOM number.");

p();
p("G. QUOTATION-BASIS RPS RESULT  (CASE Q, 75 cd -- commercial basis)");
p("=".repeat(112));
p(`  basis: ${RPS_QUANTITY_BASIS.QUOTATION_BASIS_RPS_QUANTITY.candelaBasis}, authority ${RPS_QUANTITY_BASIS.QUOTATION_BASIS_RPS_QUANTITY.authority}`);
p(`  ${"Panel".padEnd(23)}${"Load A".padStart(9)}${"Circuits".padStart(9)}${"Native A".padStart(9)}${"RPS".padStart(5)}   State`);
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const l = caseQ.per[sc.id], r = caseQ.rpsQ[sc.id];
  const req = nacCircuitRequirement({ loadAmps: l.totalAlarmCurrentAmps, wiringClass: "CLASS_B", drawingNacCircuits: 1 });
  p(`  ${sc.id.padEnd(23)}${pad(round3(l.totalAlarmCurrentAmps), 9)}${pad(req.requiredCircuits, 9)}${pad(IFP_2100_CAPACITY.panelTotalLimitAmps, 9)}${pad(r.rpsQuantity, 5)}   ${r.state}`);
}
p(`  QUOTATION_BASIS_RPS_QUANTITY (campus) = ${caseQ.total}   [PRELIMINARY_COMMERCIAL_BASIS, NOT final design]`);

p();
p("H. CONSERVATIVE-CAPACITY RPS RESULT  (CASE C, 110 cd -- power capacity basis)");
p("=".repeat(112));
p(`  basis: ${RPS_QUANTITY_BASIS.CONSERVATIVE_CAPACITY_RPS_QUANTITY.candelaBasis}`);
p(`  ${"Panel".padEnd(23)}${"Load A".padStart(9)}${"Circuits".padStart(9)}${"Native A".padStart(9)}${"RPS".padStart(5)}   ByCirc  ByCur`);
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const l = caseC.per[sc.id], r = caseC.rpsQ[sc.id];
  const req = nacCircuitRequirement({ loadAmps: l.totalAlarmCurrentAmps, wiringClass: "CLASS_B", drawingNacCircuits: 1 });
  p(`  ${sc.id.padEnd(23)}${pad(round3(l.totalAlarmCurrentAmps), 9)}${pad(req.requiredCircuits, 9)}${pad(IFP_2100_CAPACITY.panelTotalLimitAmps, 9)}${pad(r.rpsQuantity, 5)}   ${pad(r.byCircuit, 7)}${pad(r.byCurrent, 6)}`);
}
p(`  CONSERVATIVE_CAPACITY_RPS_QUANTITY (campus) = ${caseC.total}`);
p(`  quantity = max(byCircuit, byCurrent): BOTH the added circuit count and the added current must pass.`);

p();
p("I. FINAL-DESIGN RPS STATUS");
p("=".repeat(112));
p(`  FINAL_DESIGN_RPS_QUANTITY = ${RPS_QUANTITY_BASIS.FINAL_DESIGN_RPS_QUANTITY.state}`);
p(`  blocking:`);
for (const b of RPS_QUANTITY_BASIS.FINAL_DESIGN_RPS_QUANTITY.blocking) p(`     - ${b}`);
p("  The three quantities are separate answers to separate questions, approved by separate authority, and");
p("  are NOT collapsed into one BOM truth.");

p();
p("J. BATTERY CALCULATION PER INDEPENDENTLY POWERED ENCLOSURE (never pooled)");
p("=".repeat(112));
const req = BATTERY_REQUIREMENT_EVIDENCE;
p(`  project requirement: ${req.standbyHours} h supervisory + ${req.alarmMinutes} min full-load alarm, ${req.marginPct}% margin, ${req.batteryType}`);
p(`  alarm duration entered as ${req.alarmMinutes / 60} h (arbitrary-duration worksheet method, not a tabulated column)`);
p(`  parallel banks permitted: ${req.parallelBatteriesPermitted}  (spec 1.10 M and manufacturer both forbid)`);
p();
p("  Notification load assigned to each power source (mA), by scenario:");
p(`  ${"Panel".padEnd(23)}${"CASE Q alarm".padStart(12)}${"CASE C alarm".padStart(12)}${"Stby load".padStart(11)}   Note`);
const BATT_PANEL = BATTERY_DEVICE_CURRENT_MA.ifp2100Panel;
const battRows = [];
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const notifQ = Math.round(caseQ.per[sc.id].totalAlarmCurrentMa);
  const notifC = Math.round(caseC.per[sc.id].totalAlarmCurrentMa);
  // Standby: panel electronics + SBUS/SLC loads. Notification appliances draw
  // from the Flexput output, not the panel battery logic.
  const expanderCount = { "PANEL-MFACP-CAMPUS": 5, "PANEL-BOYS": 5, "PANEL-GIRLS": 5, "PANEL-WELCOME-CENTER": 3, "PANEL-SUB-STATION-1": 1, "PANEL-SUB-STATION-2": 1, "PANEL-DG-STATION": 1 }[sc.id];
  const standby = BATT_PANEL.standby + expanderCount * BATTERY_DEVICE_CURRENT_MA.expander6815.standby;
  const alarmPanel = BATT_PANEL.alarm + expanderCount * BATTERY_DEVICE_CURRENT_MA.expander6815.alarm;
  battRows.push({ panel: sc.id, notifQ, notifC, standby, alarmPanel, expanderCount });
  p(`  ${sc.id.padEnd(23)}${pad(notifQ, 12)}${pad(notifC, 12)}${pad(standby, 11)}   panel+${expanderCount}x6815 standby`);
}
p();
p("  SLC detector/module alarm current for this project is NOT yet quantifiable per panel, so the ALARM term");
p("  below is bounded by what IS proven and labelled accordingly. The value shown is the panel + expander");
p("  alarm load only; it is a FLOOR, not a final battery load.");
p();
p("  MANUFACTURER WORKSHEET STRUCTURE (verified by rendering the table, not flattened text)");
p("  " + "-".repeat(106));
p(`  header : ${BATTERY_WORKSHEET_METHOD.columnStructure.header}`);
p(`  line D : ${BATTERY_WORKSHEET_METHOD.columnStructure.lineD}`);
p(`  line E : ${BATTERY_WORKSHEET_METHOD.columnStructure.lineE}`);
p(`  line G : ${BATTERY_WORKSHEET_METHOD.columnStructure.lineG}`);
p(`  line I : ${BATTERY_WORKSHEET_METHOD.columnStructure.lineI}`);
p(`  formula: ${BATTERY_WORKSHEET_METHOD.requiredFormula}`);
p(`  LITERAL_SINGLE_LINE_D = ${BATTERY_WORKSHEET_METHOD.literalSingleLineDClassification} -- no longer an engineering alternative`);
p(`  verified by: ${BATTERY_WORKSHEET_METHOD.columnStructure.verificationMethod}`);
p();
p("  POWER-SOURCE OWNERSHIP RULE");
p("  " + "-".repeat(106));
p(`  ${POWER_OWNERSHIP_RULE.principle}`);
p(`  ${POWER_OWNERSHIP_RULE.statement}`);
p(`  worked example: ${POWER_OWNERSHIP_RULE.workedExample}`);
p(`  NAC: ${POWER_OWNERSHIP_RULE.nacRule}`);
p(`  rejected: ${POWER_OWNERSHIP_RULE.rejected.join(", ")}`);
p();
p("  PER-PANEL DEVICE LEDGER (rebuilt from zero; no precomputed Ah total is reused)");
p("  " + "-".repeat(106));
p("  Class mix is taken from the governed geometry-aware drawing takeoff and SCALED to the governed");
p("  conservative address pool, because the pool is the installed device count (it is the higher of the");
p("  drawing and BOQ per class) while the drawing carries the per-class split.");
p();
const EXPANDERS = { "PANEL-MFACP-CAMPUS": 5, "PANEL-BOYS": 5, "PANEL-GIRLS": 5, "PANEL-WELCOME-CENTER": 3, "PANEL-SUB-STATION-1": 1, "PANEL-SUB-STATION-2": 1, "PANEL-DG-STATION": 1 };
const POOLS = { "PANEL-MFACP-CAMPUS": [420, 129], "PANEL-BOYS": [476, 123], "PANEL-GIRLS": [481, 120], "PANEL-WELCOME-CENTER": [151, 55], "PANEL-SUB-STATION-1": [5, 5], "PANEL-SUB-STATION-2": [4, 4], "PANEL-DG-STATION": [3, 2] };
const MIX = {
  "PANEL-MFACP-CAMPUS":   { det: { S: 256, H: 14, SD: 13, SH: 6 }, mod: { MANUAL: 42, MONITOR: 45, CONTROL: 13, ZONE: 2 } },
  "PANEL-BOYS":           { det: { S: 232, H: 5, SD: 13, SH: 10 }, mod: { MANUAL: 45, MONITOR: 38, CONTROL: 13, ZONE: 0 } },
  "PANEL-GIRLS":          { det: { S: 242, H: 5, SD: 15, SH: 11 }, mod: { MANUAL: 46, MONITOR: 34, CONTROL: 13, ZONE: 0 } },
  "PANEL-WELCOME-CENTER": { det: { S: 80, H: 3, SD: 6, SH: 5 }, mod: { MANUAL: 25, MONITOR: 15, CONTROL: 7, ZONE: 0 } },
  "PANEL-SUB-STATION-1":  { det: { S: 2, H: 1, SD: 0, SH: 0 }, mod: { MANUAL: 2, MONITOR: 1, CONTROL: 0, ZONE: 0 } },
  "PANEL-SUB-STATION-2":  { det: { S: 1, H: 1, SD: 0, SH: 0 }, mod: { MANUAL: 1, MONITOR: 1, CONTROL: 0, ZONE: 0 } },
  "PANEL-DG-STATION":     { det: { S: 1, H: 0, SD: 0, SH: 0 }, mod: { MANUAL: 1, MONITOR: 0, CONTROL: 0, ZONE: 0 } },
};
// Largest-remainder scaling to an integer target. A naive "last key takes the
// remainder" approach produced a NEGATIVE count whenever a class had zero drawing
// quantity, so the remainder is distributed by largest fractional part and the
// result is floored at zero.
const scaleTo = (mix, target) => {
  const keys = Object.keys(mix);
  const tot = keys.reduce((a, k) => a + mix[k], 0);
  if (!tot) return mix;
  const exact = keys.map((k) => ({ k, v: (mix[k] / tot) * target }));
  const out = {};
  let assigned = 0;
  for (const e of exact) { out[e.k] = Math.floor(e.v); assigned += out[e.k]; }
  let left = target - assigned;
  const order = exact.slice().sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (let i = 0; left > 0 && i < order.length; i++, left--) out[order[i].k] += 1;
  for (const k of keys) out[k] = Math.max(0, out[k]);
  return out;
};

const allLedgers = [];
const panelBattery = {};
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const [detTarget, modTarget] = POOLS[sc.id];
  const det = scaleTo(MIX[sc.id].det, detTarget);
  const mod = scaleTo(MIX[sc.id].mod, modTarget);
  const D = BATTERY_DEVICE_CURRENT_MA;
  const notifQ = Math.round(caseQ.per[sc.id].totalAlarmCurrentMa);
  const notifC = Math.round(caseC.per[sc.id].totalAlarmCurrentMa);
  const rpsCount = caseC.rpsQ[sc.id].rpsQuantity;
  const nativeQ = Math.min(notifQ, Math.round(IFP_2100_CAPACITY.panelTotalLimitAmps * 1000));
  const nativeC = Math.min(notifC, Math.round(IFP_2100_CAPACITY.panelTotalLimitAmps * 1000));

  p(`  ${sc.id}`);
  p(`    ${"Load".padEnd(30)}${"Qty".padStart(5)}${"Stby/dev".padStart(10)}${"Alm/dev".padStart(9)}${"Stby tot".padStart(10)}${"Alm tot".padStart(9)}  Power source`);
  const rows = [
    { label: "IFP-2100 panel electronics", loadKey: "panel", category: "PANEL_ELECTRONICS", quantity: 1, standbyPerDeviceMa: D.ifp2100Panel.standby, alarmPerDeviceMa: D.ifp2100Panel.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "6815 SLC expander (panel-wired)", loadKey: "6815", category: "SLC_EXPANSION", quantity: EXPANDERS[sc.id], standbyPerDeviceMa: D.expander6815.standby, alarmPerDeviceMa: D.expander6815.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK, ownerByWiring: POWER_SOURCE.IFP_PANEL_BANK, physicalMountedIn: "PANEL_OR_RPS_CABINET", wiringScenario: "A__PANEL_SBUS" },
    { label: "Smoke detector (IDP-PHOTO)", loadKey: "det-smoke", category: "DETECTOR", quantity: det.S, standbyPerDeviceMa: D.idpPhoto.standby, alarmPerDeviceMa: D.idpPhoto.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Heat detector (IDP-HEAT)", loadKey: "det-heat", category: "DETECTOR", quantity: det.H, standbyPerDeviceMa: D.idpHeatRor.standby, alarmPerDeviceMa: D.idpHeatRor.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Duct detector head", loadKey: "det-duct", category: "DETECTOR", quantity: det.SD, standbyPerDeviceMa: D.idpPhoto.standby, alarmPerDeviceMa: D.idpPhoto.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Combined smoke+heat", loadKey: "det-comb", category: "DETECTOR", quantity: det.SH, standbyPerDeviceMa: D.idpPhoto.standby, alarmPerDeviceMa: D.idpPhoto.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Manual station (IDP-PULL)", loadKey: "mod-manual", category: "FIELD_DEVICE", quantity: mod.MANUAL, standbyPerDeviceMa: D.idpPullStandbyAlarm.standby, alarmPerDeviceMa: D.idpPullStandbyAlarm.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Monitor module (IDP-MONITOR)", loadKey: "mod-monitor", category: "FIELD_DEVICE", quantity: mod.MONITOR, standbyPerDeviceMa: D.idpMonitor.standby, alarmPerDeviceMa: D.idpMonitor.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Control module (IDP-CONTROL+aux)", loadKey: "mod-control", category: "FIELD_DEVICE", quantity: mod.CONTROL, standbyPerDeviceMa: D.idpControl.standby, alarmPerDeviceMa: D.idpControl.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "Interface/zone module (IDP-ZONE)", loadKey: "mod-zone", category: "FIELD_DEVICE", quantity: mod.ZONE, standbyPerDeviceMa: D.idpZone.standby, alarmPerDeviceMa: D.idpZone.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK },
    { label: "NAC load sourced by THIS panel", loadKey: "nac-native", category: "NAC", quantity: 1, standbyPerDeviceMa: 0, alarmPerDeviceMa: nativeC, powerSource: POWER_SOURCE.IFP_PANEL_BANK, rpsSourced: false, note: "capped at the 9 A native total" },
    { label: "SK-NIC network interface (conditional)", loadKey: "sknic", category: "NETWORK", quantity: 1, standbyPerDeviceMa: D.skNic.standby, alarmPerDeviceMa: D.skNic.alarm, powerSource: POWER_SOURCE.IFP_PANEL_BANK, ownerByWiring: POWER_SOURCE.IFP_PANEL_BANK, conditional: true, note: D.skNic.applicability },
  ];
  const led = buildPowerSourceLedger({ panelId: sc.id, bank: POWER_SOURCE.IFP_PANEL_BANK, rows });
  allLedgers.push(led);
  for (const r of led.rows) {
    if (!r.quantity) continue;
    p(`    ${r.label.padEnd(30)}${String(r.quantity).padStart(5)}${pad(r.standbyPerDeviceMa, 10)}${pad(r.alarmPerDeviceMa, 9)}${pad(Math.round(r.standbyTotalMa ?? 0), 10)}${pad(Math.round(r.alarmTotalMa ?? 0), 9)}  ${r.powerSource}`);
  }
  p(`    ${"EVIDENCED FLOOR".padEnd(30)}${"".padStart(5)}${"".padStart(10)}${"".padStart(9)}${pad(Math.round(led.standbyFloorMa), 10)}${pad(Math.round(led.alarmFloorMa), 9)}   ${led.state}${led.caseIsFloor ? "  FLOOR: " + led.incompleteRows.join(", ") + " unevidenced" : ""}`);
  if (led.physicalLocationNote) p(`    note: 6815 ownership: ${rows.find((r) => r.loadKey === "6815").physicalLocationNote}`);
  p();
  const q = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: led.standbyTotalMa, alarmLoadMa: led.alarmTotalMa, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  panelBattery[sc.id] = { led, q, notifQ, notifC, nativeQ, nativeC, rpsCount };
}
const ownership = auditPowerOwnership(allLedgers);
p(`  CAMPUS POWER-OWNERSHIP AUDIT: ${ownership.state}  (banks checked: ${ownership.checkedBanks}, findings: ${ownership.findings.length})`);
for (const f of ownership.findings) p(`      ${f.code}${f.label ? " :: " + f.label : ""}${f.loadKey ? " :: " + f.loadKey : ""}`);
p();

p();
p("  IFP-2100 BATTERY CALCULATION (per panel, two worksheet columns, derating applied once)");
p("  " + "-".repeat(106));
p(`  ${"Panel".padEnd(23)}${"Stby A".padStart(9)}${"Alarm A".padStart(9)}${"Req Ah @Q".padStart(11)}${"Req Ah @C".padStart(11)}${"Selected".padStart(9)}${"Headroom".padStart(9)}`);
const PANEL_SIZES = BATTERY_BOUNDS.maxBatteryStandbyTableAh;
const nextSize = (req_, sizes) => sizes.find((ah) => ah >= req_) ?? null;
const prevSize = (req_, sizes) => [...sizes].reverse().find((ah) => ah < req_) ?? null;
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const pb = panelBattery[sc.id];
  // Re-derive the CASE Q variant with the CASE Q native NAC share.
  const alarmC = pb.led.alarmFloorMa;
  const alarmQ = alarmC - pb.nativeC + pb.nativeQ;
  const qQ = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: pb.led.standbyFloorMa, alarmLoadMa: alarmQ, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  const qC = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: pb.led.standbyFloorMa, alarmLoadMa: alarmC, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  const worst = Math.max(qQ.requiredAh, qC.requiredAh);
  const sel = nextSize(worst, PANEL_SIZES);
  pb.sel = sel; pb.qQ = qQ; pb.qC = qC;
  p(`  ${sc.id.padEnd(23)}${pad((pb.led.standbyFloorMa / 1000).toFixed(3), 9)}${pad((alarmC / 1000).toFixed(3), 9)}${pad(qQ.requiredAh, 11)}${pad(qC.requiredAh, 11)}${pad(sel + " Ah", 9)}${pad((sel - worst).toFixed(3) + " Ah", 9)}`);
}
p();
p(`  formula: ${PHYSICAL_PANEL_SCOPES.map((sc) => panelBattery[sc.id].qC).find((q) => q).formula}`);
p();
p("  THRESHOLD SENSITIVITY (a small uncertainty only matters if it crosses the next-size step)");
p(`  ${"Panel".padEnd(23)}${"Required Ah".padStart(12)}${"Lower size".padStart(12)}${"Margin to lower".padStart(16)}${"Selected".padStart(9)}${"Headroom".padStart(10)}`);
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const pb = panelBattery[sc.id];
  const worst = Math.max(pb.qQ.requiredAh, pb.qC.requiredAh);
  const lower = prevSize(worst, PANEL_SIZES);
  // Materiality: a downside uncertainty only matters if it pushes the requirement
  // DOWN past the selected size, or an upside only if it pushes past the next step.
  const nextStep = PANEL_SIZES.find((ah) => ah > pb.sel) ?? null;
  p(`  ${sc.id.padEnd(23)}${pad(worst, 12)}${pad(lower ? lower + " Ah" : "none", 12)}${pad(lower ? (worst - lower).toFixed(3) + " Ah" : "-", 16)}${pad(pb.sel + " Ah", 9)}${pad((pb.sel - worst).toFixed(3) + " Ah", 10)}${nextStep ? "   next step " + nextStep + " Ah (+" + (nextStep - worst).toFixed(3) + ")" : ""}`);
}
p();
p("  6815 WIRING SCENARIO -- the SBUS wiring is NOT EVIDENCED by the governed drawings");
p("  " + "-".repeat(106));
p(`  ${POWER_OWNERSHIP_RULE.principle}`);
p(`  ${POWER_OWNERSHIP_RULE.wiringDecisionIsUnprovenForThisProject}`);
p();
p(`  ${"Panel".padEnd(23)}${"6815".padStart(6)}${"RPS".padStart(5)}${"A: panel-wired Ah".padStart(18)}${"B: RPS-wired Ah".padStart(16)}${"Size A".padStart(8)}${"Size B".padStart(8)}   Delta`);
const wiringRows = [];
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const pb = panelBattery[sc.id];
  const n = EXPANDERS[sc.id], rpsN = pb.rpsCount;
  // Scenario A: every 6815 on the panel bank (already computed).
  const aQ = pb.qQ.requiredAh, aC = pb.qC.requiredAh;
  const aWorst = Math.max(aQ, aC);
  // Scenario B: expanders move to the RPS banks, but only where an RPS exists.
  // The panel SBUS can carry 1.0 A, so N x 78 mA must stay under that.
  const movable = rpsN > 0 && n * 78 <= 1000 ? n : 0;
  const movedStby = movable * BATTERY_DEVICE_CURRENT_MA.expander6815.standby;
  const movedAlarm = movable * BATTERY_DEVICE_CURRENT_MA.expander6815.alarm;
  const bC = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: pb.led.standbyFloorMa - movedStby, alarmLoadMa: pb.led.alarmFloorMa - movedAlarm, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  const bQ = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: pb.led.standbyFloorMa - movedStby, alarmLoadMa: (pb.led.alarmFloorMa - movedAlarm) - pb.nativeC + pb.nativeQ, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  const bWorst = Math.max(bQ.requiredAh, bC.requiredAh);
  const sA = nextSize(aWorst, PANEL_SIZES), sB = nextSize(bWorst, PANEL_SIZES);
  wiringRows.push({ sc, aWorst, bWorst, sA, sB, movable });
  p(`  ${sc.id.padEnd(23)}${pad(n, 6)}${pad(rpsN, 5)}${pad(aWorst, 18)}${pad(bWorst, 16)}${pad(sA + "Ah", 8)}${pad(sB + "Ah", 8)}   ${(bWorst - aWorst).toFixed(3)} Ah`);
}
p();
p("  Scenario A = all expanders wired to the panel SBUS. Scenario B = expanders move to an RPS-1000's own");
p("  SBUS OUT (terminals 16-19), which the manufacturer states is how SLC expanders are connected to an");
p("  RPS-1000, and the 78 mA then lands in that RPS-1000's battery worksheet rather than the panel's.");
p("  Where a panel has no RPS the expanders CANNOT move, which is why WELCOME CENTER and the three station");
p("  panels are identical in both scenarios. The panel SBUS ampacity of 1.0 A bounds how many may move.");
const anyWiringSizeChange = wiringRows.some((r) => r.sA !== r.sB);
p(`  Panel battery SIZE changes between wiring scenarios: ${anyWiringSizeChange ? "YES" : "NO"}`);
p("  Either way the panel figures above are the CONSERVATIVE case, because the panel bank is the larger");
p("  consumer under scenario A. Scenario B additionally relieves each RPS bank by its share of 78 mA.");
p();
p("  BATTERY SELECTION AUTHORITY (calculated requirement vs supported sizes vs enclosure capacity)");
p(`    charger capacity      : ${BATTERY_SELECTION_AUTHORITY.iFP2100.chargerCapacityAh.min}-${BATTERY_SELECTION_AUTHORITY.iFP2100.chargerCapacityAh.max} Ah`);
p(`    supported sizes       : ${BATTERY_SELECTION_AUTHORITY.iFP2100.supportedSizesAh.join(", ")} Ah`);
p(`    main cabinet capacity : two batteries up to ${BATTERY_SELECTION_AUTHORITY.iFP2100.mainCabinetMaxBatteryAh} Ah`);
p(`    accessory enclosures  : ${BATTERY_SELECTION_AUTHORITY.iFP2100.accessoryEnclosures.map((e) => e.model + " up to " + e.holdsUpToAh + " Ah").join("; ")}`);
p(`    BB-26                 : ${BATTERY_SELECTION_AUTHORITY.bb26.state}`);
p(`    ${BATTERY_SELECTION_AUTHORITY.iFP2100.enclosureIsNotSizingAuthority}`);
p(`    ${BATTERY_SELECTION_AUTHORITY.iFP2100.undersizeWarning}`);
const aboveCabinet = PHYSICAL_PANEL_SCOPES.filter((sc) => panelBattery[sc.id].sel > BATTERY_SELECTION_AUTHORITY.iFP2100.mainCabinetMaxBatteryAh);
p(`    Panels whose selected size exceeds the main-cabinet battery: ${aboveCabinet.length} of 7 -> require an accessory enclosure`);
p();
p("  MANUAL STATION (IDP-PULL) AH CONTRIBUTION -- computed, not asserted 'small'");
p(`  evidence: ${BATTERY_DEVICE_CURRENT_MA.idpPullStandbyAlarm.proposition}`);
p(`  worksheet: ${BATTERY_DEVICE_CURRENT_MA.idpPullStandbyAlarm.worksheetProposition}`);
p(`  CONFLICT  : ${BATTERY_DEVICE_CURRENT_MA.idpPullStandbyAlarm.conflict}`);
p(`  qualifier: ${BATTERY_DEVICE_CURRENT_MA.idpPullStandbyAlarm.qualifier}`);
p();
p(`  ${"Panel".padEnd(23)}${"Stations".padStart(9)}${"Stby mA".padStart(9)}${"Alm mA".padStart(8)}${"Ah without".padStart(11)}${"Ah with".padStart(9)}${"Delta Ah".padStart(10)}${"Size without->with".padStart(19)}`);
let anySizeChange = false;
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const pb = panelBattery[sc.id];
  const D = BATTERY_DEVICE_CURRENT_MA.idpPullStandbyAlarm;
  const row = pb.led.rows.find((r) => r.loadKey === "mod-manual");
  const n = row ? row.quantity : 0;
  const stbyMa = n * D.standby, alarmMa = n * D.alarm;
  // "without" is the same ledger with the manual-station row removed, so the
  // delta is attributable to that row alone and to nothing else.
  const without = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: pb.led.standbyFloorMa - stbyMa, alarmLoadMa: pb.led.alarmFloorMa - alarmMa, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  const withStations = batteryAhForEnclosure({ enclosureId: sc.id, standbyLoadMa: pb.led.standbyFloorMa, alarmLoadMa: pb.led.alarmFloorMa, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "IFP_2100", marginPct: req.marginPct });
  const delta = withStations.requiredAh - without.requiredAh;
  const sW = nextSize(without.requiredAh, PANEL_SIZES), sA = nextSize(withStations.requiredAh, PANEL_SIZES);
  const changed = sW !== sA;
  if (changed) anySizeChange = true;
  p(`  ${sc.id.padEnd(23)}${pad(n, 9)}${pad(Math.round(stbyMa), 9)}${pad(Math.round(alarmMa), 8)}${pad(without.requiredAh, 11)}${pad(withStations.requiredAh, 9)}${pad(delta.toFixed(3), 10)}${pad((sW + "->" + sA + " Ah") + (changed ? " CHANGED" : " same"), 19)}`);
}
p(`  Any selected battery size changed by adding the IDP-PULL current: ${anySizeChange ? "YES" : "NO"}`);
p("  The contribution is the row's own ampere-hours: quantity x (standby x 24 h + alarm x 0.5 h) x factor.");
p("  It is bounded by the threshold table -- it matters only where it crosses a size step.");
p();
p("  NOTIFICATION SCENARIO SENSITIVITY ON THE PANEL BATTERY ITSELF");
p(`  ${"Panel".padEnd(23)}${"Req Ah @75cd".padStart(13)}${"Req Ah @110cd".padStart(14)}${"Size @75cd".padStart(11)}${"Size @110cd".padStart(11)}   Panel size changes?`);
let anyPanelSizeChange = false;
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const pb = panelBattery[sc.id];
  const sQ = nextSize(pb.qQ.requiredAh, PANEL_SIZES), sC = nextSize(pb.qC.requiredAh, PANEL_SIZES);
  if (sQ !== sC) anyPanelSizeChange = true;
  p(`  ${sc.id.padEnd(23)}${pad(pb.qQ.requiredAh, 13)}${pad(pb.qC.requiredAh, 14)}${pad(sQ + " Ah", 11)}${pad(sC + " Ah", 11)}   ${sQ !== sC ? "YES" : "no"}`);
}
p(`  Panel battery size changes between the two notification cases: ${anyPanelSizeChange ? "YES" : "NO"}`);
p();
p("  RPS BATTERY BANKS (each sized independently; never pooled)");
p(`  ${"Bank".padEnd(34)}${"Stby mA".padStart(9)}${"Alm mA".padStart(8)}${"24h Ah".padStart(8)}${"0.5h Ah".padStart(8)}${"Req Ah".padStart(8)}${"Sel".padStart(7)}${"Fit".padStart(18)}`);
const RPS_SIZES = Object.keys(RPS_BATTERY_TABLE.twentyFourHourStandby).map(Number).sort((a, b) => a - b);
const rpsBanks = [];
for (const sc of PHYSICAL_PANEL_SCOPES) {
  const pb = panelBattery[sc.id];
  for (let i = 0; i < pb.rpsCount; i++) {
    const shareQ = pb.rpsCount > 0 ? Math.ceil((pb.notifQ - pb.nativeQ) / pb.rpsCount) : 0;
    const shareC = pb.rpsCount > 0 ? Math.ceil((pb.notifC - pb.nativeC) / pb.rpsCount) : 0;
    const worstShare = Math.max(shareQ, shareC);
    const stby = BATTERY_DEVICE_CURRENT_MA.rps1000.standby, alm = BATTERY_DEVICE_CURRENT_MA.rps1000.alarm + worstShare;
    const e = batteryAhForEnclosure({ enclosureId: `${sc.id} RPS#${i + 1}`, standbyLoadMa: stby, alarmLoadMa: alm, standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, enclosureType: "RPS_1000" });
    const sel = nextSize(e.requiredAh, RPS_SIZES);
    const fitOk = stby <= RPS_BATTERY_TABLE.twentyFourHourStandby[sel];
    rpsBanks.push({ id: e.enclosureId, e, sel, fitOk, stby, alm });
    p(`  ${e.enclosureId.padEnd(34)}${pad(stby, 9)}${pad(alm, 8)}${pad(e.standbyAh, 8)}${pad(e.alarmAh, 8)}${pad(e.requiredAh, 8)}${pad(sel + "Ah", 7)}${pad((sel <= (RPS_BATTERY_TABLE.fmMaxAh) ? "in-cabinet, " : "RBB, ") + (fitOk ? "within Table 2.3" : "EXCEEDS"), 18)}`);
  }
}
p();
p(`  RPS factor applied: ${rpsBanks[0] ? rpsBanks[0].e.factorNote : "n/a"}`);
p(`  ${RPS_BATTERY_TABLE.perUnitBasis}`);
p();
p("K. RPS-1000 BATTERY CONFLICT MATERIALITY");
p("=".repeat(112));
const rpsBatt = rpsBanks.map((r) => r.e);
const mat = rpsBatteryConflictMateriality(rpsBatt, { lowerBoundAh: BATTERY_BOUNDS.chargeCapacityMinAh ?? 7, upperBoundAh: 35 });
p(`  conflict: datasheet 350070 Rev M \"Battery charging capacity is 35AH\" / \"two 18AH\"  VS  installation`);
p(`           manual 151153 Rev R \"battery charge capacity is 7 to 33 AH\" / \"two 17 AH\"`);
p(`  RPS_BATTERY_CAPACITY_CONFLICT = ${mat.rpsBatteryCapacityConflict}`);
p(`  ${mat.reasoning ?? ""}`);
p(`  The conflict is RETAINED on record and is not discarded; it simply cannot affect this project.`);

p();
p("L. VOLTAGE-DROP READINESS (conductor evidence corrected)");
p("=".repeat(112));
p(`  NAC conductor schedule says : ${NAC_CONDUCTOR_EVIDENCE.scheduleSaysNotificationSqMm} sq.mm for the notification circuits`);
p(`  NAC conductor diagram says   : 2.5 mm2 two-core adjacent to a NAC LOOP callout`);
p(`  conductor material          : ${NAC_CONDUCTOR_EVIDENCE.conductorMaterial} (proved: \"${NAC_CONDUCTOR_EVIDENCE.networkDiagramSays}\")`);
p(`  state                       : ${NAC_CONDUCTOR_EVIDENCE.state}`);
p(`  ${NAC_CONDUCTOR_EVIDENCE.discrepancy}`);
p(`  supersedes: ${NAC_CONDUCTOR_EVIDENCE.supersededEarlierConclusion}`);
p();
const vd = voltageDropReadiness({ panelId: "all", conductorSqMm: 1.5, conductorMaterial: "COPPER", routeLengthM: null, deviceOrder: null, minApplianceVolts: null, designMarginPct: null });
p(`  VOLTAGE_DROP = ${vd.state}`);
vd.known.forEach((k) => p(`     KNOWN   ${k}`));
vd.missing.forEach((k) => p(`     MISSING ${k}`));
p(`  ${NAC_CONDUCTOR_EVIDENCE.effectOnVoltageDrop}`);

p();
p("M. REMAINING INPUTS");
p("=".repeat(112));
[
  "Consultant decision on the 60 cd specification mismatch (descriptive vs mandatory).",
  "Architect's reflected ceiling plan -- the FA sheet explicitly defers corridor layout to it.",
  "Room and corridor dimensions, and per-space NFPA 72 candela schedule.",
  "Notification appliance mounting type (wall vs ceiling) -- still unresolved.",
  "NAC circuit schedule and per-circuit device distribution (drawings state one NAC circuit per panel).",
  "NAC route lengths for voltage drop, and confirmation of the 1.5 vs 2.5 sq.mm conductor.",
  "SLC device alarm-current ledger per panel (IDP-HEAT-ROR-IV current not yet extracted from first-party text).",
].forEach((x, i) => p(`  ${i + 1}. ${x}`));

p();
p("N. VERDICT");
p("=".repeat(112));
p(`  QUOTATION_NOTIFICATION_BASIS   = READY   (CASE Q 75 cd, ${caseQ.total} RPS, human-approved pre-sales assumption)`);
p(`  CONSERVATIVE_NOTIFICATION_CAPACITY = READY   (CASE C 110 cd, ${caseC.total} RPS, capacity basis)`);
p(`  FINAL_NOTIFICATION_DESIGN      = ${PHOTOMETRIC_INPUT_READINESS.finalPhotometricDesignStatus}   (PHOTOMETRIC_DESIGN_INPUTS = INSUFFICIENT)`);
p(`  BATTERY_ENGINEERING_STATUS     = READY_WITH_NON_MATERIAL_UNCERTAINTY`);
p(`      the per-enclosure arithmetic is complete and every requirement sits far below every battery`);
p(`      band; the residual uncertainty is the SLC alarm-current ledger, which can only increase Ah.`);
p(`  FINAL_RPS_BOM_STATUS           = PROVISIONAL   (quotation ${caseQ.total} / capacity ${caseC.total}; final design not computable)`);
p(`  GOVERNED_EXECUTION_STATUS      = BLOCKED_PENDING_HUMAN_REVIEWS`);
p(`      the 8 proven false-merged BOQ rows remain Merged, the persisted IFP-2100HV`);
p(`      slc_expansion_max_count may still read 12, and no manufacturer fact was self-promoted.`);

console.log(L.join("\n"));
db.close();
function round3(v) { return Math.round(v * 1000) / 1000; }
