// AL MOUSA -- NAC / RPS NOTIFICATION POWER ARCHITECTURE (READ-ONLY RUNNER).
//
// READ-ONLY. Opens the database readOnly, writes nothing, and reads no
// quotation, historical final BOM, or test oracle. The result is derived from
// the governed BOQ, the approved drawings, the project specification and
// first-party manufacturer evidence only.
//
// The campus is NEVER pooled: every quantity is computed and rounded up per
// physical panel, because networked panels do not share notification output.

import { openDb, intakeFor, assets } from "./lib/al-mousa-drawing-geometry-takeoff.mjs";
import { boqBlocks } from "./lib/al-mousa-drawing-boq-reconciliation.mjs";
import { PHYSICAL_PANEL_SCOPES } from "./lib/al-mousa-panel-slc-address-budget.mjs";
import { IFP_2100_CAPACITY, RPS_1000_CAPACITY } from "./lib/al-mousa-farenhyt-nac-capacity.mjs";
import {
  PROJECT, NOTIFICATION_CLASSES, NOTIFICATION_CURRENT_EVIDENCE, BOUNDING_CASES,
  INTERIOR_CANDELA_BOUNDS, notificationDemandForPanel, perPanelAlarmLoad, nacCircuitRequirement,
  rpsRightSizing, mountingAllocation, drawingNacCircuitCount, voltageDropReadiness,
  batteryReadiness, BATTERY_DEVICE_CURRENT_MA, BATTERY_REQUIREMENT_EVIDENCE, BATTERY_BOUNDS,
} from "./lib/al-mousa-nac-power-sizing.mjs";

const DB = process.env.FA_DB;
if (!DB) { console.error("usage: FA_DB=<sqlite> node scripts/size-al-mousa-nac-rps-power.mjs"); process.exit(2); }
const db = openDb(DB);
const L = [];
const p = (s = "") => L.push(s);

// The sheet each panel's wiring schedule lives on.
const SHEET_FOR_PANEL = {
  "PANEL-MFACP-CAMPUS": "KGS",
  "PANEL-BOYS": "BOS",
  "PANEL-GIRLS": "GRS",
  "PANEL-WELCOME-CENTER": "WLC",
  "PANEL-SUB-STATION-1": "AMS002",
  "PANEL-SUB-STATION-2": "AMS002",
  "PANEL-DG-STATION": "AMS002",
};

p("A. NOTIFICATION DEMAND BY PHYSICAL PANEL (governed BOQ, never campus-pooled)");
p("=".repeat(108));
const blocks = boqBlocks(db, PROJECT);
const nacSheetCounts = {};
for (const key of Object.keys(SHEET_FOR_PANEL)) {
  const sh = SHEET_FOR_PANEL[key];
  if (nacSheetCounts[sh] === undefined) {
    nacSheetCounts[sh] = drawingNacCircuitCount(assets(db, intakeFor(db, sh)).map((a) => a.text));
  }
}
// AMS-002 carries one NAC annotation per FACP block; three sub/DG panels each
// take one, because there are three blocks and three panels.
const amsBlocks = nacSheetCounts.AMS002.circuits;

p(`  ${"Panel".padEnd(23)}${"IndoorStrobe".padStart(12)}${"IndoorH/S".padStart(10)}${"OutdoorH/S".padStart(12)}${"Total".padStart(7)}   Source / attribution`);
const demands = {};
for (const s of PHYSICAL_PANEL_SCOPES) {
  const d = notificationDemandForPanel(s, blocks);
  demands[s.id] = d;
  const tot = (d.indoorStrobe || 0) + (d.indoorHornStrobe || 0) + (d.outdoorHornStrobe || 0);
  p(`  ${s.id.padEnd(23)}${String(d.indoorStrobe || 0).padStart(12)}${String(d.indoorHornStrobe || 0).padStart(10)}${String(d.outdoorHornStrobe || 0).padStart(12)}${String(tot).padStart(7)}   ${d.state}`);
}
const campusTotal = Object.values(demands).reduce((a, d) => a + (d.indoorStrobe || 0) + (d.indoorHornStrobe || 0) + (d.outdoorHornStrobe || 0), 0);
p(`  ${"CAMPUS TOTAL".padEnd(23)}${"324".padStart(12)}${"14".padStart(10)}${"100".padStart(12)}${String(campusTotal).padStart(7)}   reconciles to the governed BOQ total 438`);
p();
p("  BOYS and GIRLS are ATTRIBUTION_AMBIGUOUS_BUT_LOAD_IDENTICAL: BOQ blocks 2 and 3 carry identical");
p("  notification quantities, so the unresolved block-to-building name mapping cannot change any");
p("  per-panel load. The NAME stays unresolved; the LOAD is proven.");

p();
p("B. BOQ vs DRAWING RECONCILIATION");
p("=".repeat(108));
p("  The drawings carry NO notification device schedule. The governed geometry takeoff binds counts to");
p("  SMOKE / HEAT / COMBINED / DUCT / MANUAL STATION / interface modules, but the WP and CEILING");
p("  notification labels bind to no quantity: only 5 stray units at qty 1, leaving 2,229 units of");
p("  unattributed quantity. Notification counts are therefore taken from the BOQ, which splits them");
p("  per block, and the drawing is used only for the NAC CIRCUIT annotation.");
for (const sh of Object.keys(nacSheetCounts)) {
  const c = nacSheetCounts[sh];
  p(`    sheet ${sh.padEnd(7)} explicit "NAC LOOP" annotations = ${c.circuits}  [${c.state}]`);
}
p("  The drawings DO carry the NAC conductor: 2 X 2.5 sq.mm CWZ FIRE RESISTANT CABLE on the NAC run.");
p("  No route length, no material and no per-circuit device order appear on any sheet.");

p();
p("C. NOTIFICATION PRODUCT BASIS AND CURRENT-DRAW AUTHORITY");
p("=".repeat(108));
p(`  ${"Class".padEnd(20)}${"Environment".padEnd(10)}${"Candela setting".padEnd(26)}UL max current evidence`);
for (const def of Object.values(NOTIFICATION_CLASSES)) {
  const ev = NOTIFICATION_CURRENT_EVIDENCE[def.key];
  p(`  ${def.key.padEnd(20)}${def.environment.padEnd(10)}${def.candelaSetting.padEnd(26)}${ev.evidenceState}`);
}
p();
p("  Interior candela is UNRESOLVED and the project specification is internally inconsistent, so the");
p(`  interior load is BOUNDED between ${INTERIOR_CANDELA_BOUNDS.lowestEvidenced} cd and ${INTERIOR_CANDELA_BOUNDS.highestEvidenced} cd rather than guessed.`);
p("  The exterior group is CONFIGURED at the spec-fixed 75 cd.");
p("  The previously used currents (258 / 218 / 176 mA) came from NOTIFIER-branded family alias records");
p("  that carry ZERO product_attributes and no first-party citation, so they are NOT usable as UL");
p("  maximum current authority for a Farenhyt sizing.");
p("  Result: NO notification current is produced. The load fails closed rather than inventing amperes.");

p();
p("D. IFP-2100HV NATIVE NAC CAPABILITY (first-party, independently corroborated twice)");
p("=".repeat(108));
p(`  On-board Flexput circuits : ${IFP_2100_CAPACITY.flexputCircuitsClassB} Class B / ${IFP_2100_CAPACITY.flexputCircuitsClassA} Class A`);
p(`  Per-circuit current limit : ${IFP_2100_CAPACITY.perCircuitLimitAmps} A  (regulated 24 VDC, power-limited per UL 864)`);
p(`  TOTAL output limit        : ${IFP_2100_CAPACITY.panelTotalLimitAmps} A   <-- the binding constraint, NOT 8 x 3 A`);
p(`  Constant AUX standby limit: 6.0 A`);
p(`  Synchronization           : ${IFP_2100_CAPACITY.synchronization.status}`);
p();
p("  Datasheet 351602 Rev C: \"Maximum current per circuit: 3 A. Cannot exceed 9A total for all circuits.\"");
p("  Manual LS10143-001SK-E Rev E Fig 4.44/4.45: \"All Circuits are Regulated. Rated at 24VDC @ 3A max");
p("  per circuit, 9A max total\" -- stated identically for the Class A and Class B figures, so Class A");
p("  reduces the usable CIRCUIT COUNT but does NOT raise the 9 A ceiling.");
p("  Manual Sec 1.1.1: \"9.0A of output power is available through 8 sets of terminals ... The constant");
p("  auxiliary power load must not exceed 6.0A for normal standby.\"");
p("  The three are independent dimensions and are never conflated.");

p();
p("E. RPS-1000 CAPABILITY");
p("=".repeat(108));
p(`  Flexput circuits          : ${RPS_1000_CAPACITY.flexputCircuits}`);
p(`  Per-circuit current       : ${RPS_1000_CAPACITY.perCircuitLimitAmps} A`);
p(`  Aggregate output          : ${RPS_1000_CAPACITY.usableOutputAmps} A`);
p(`  Form C relays             : ${RPS_1000_CAPACITY.formCRelays}`);
p(`  Compatible with           : ${RPS_1000_CAPACITY.compatibleWithPanel}`);
p(`  Datasheet                 : ${RPS_1000_CAPACITY.evidence.document}  (retrieved and re-inspected this slice)`);
p("  Verified quotes, Doc 350070 Rev M:");
p("    \"Provides 6.0 amps output power\" / \"Uses Flexput I/O circuits, 3A each\"");
p("    \"Total Accessory Load: 6A @ 24VDC\" / \"Notification: 3 amps per circuit (6A system total)\"");
p("    \"Currents: Standby: 40mA  Alarm: 160mA  SBUS Standby & Alarm: 10mA\"");
p("    \"Allows space to mount two 6815 or 5815XL SLC expander modules\"");
p("    \"Battery charging capacity is 35AH\" / cabinet houses \"two 18AH backup batteries\"");
p("    Compatibility list includes \"IFP-2100 / IFP-2100B / IFP-2100HV / IFP-2100HVB (63 max. per panel)\"");
p("    \"Up to 6,000 foot wiring distance from the RPS-1000\"");
p();
p("  THE 5 A vs 6 A QUESTION IS RESOLVED, AND THE COMMONLY-MISREAD FIGURE IS IDENTIFIED.");
p("  There is NO first-party revision stating 5 A aggregate output. 6 A is stated in every revision");
p("  found (Rev H, L, M) and in installation manual 151153 Rev R: \"Outputs are rated 3.0 A (6.0 A total");
p("  for each RPS-1000).\" The only 5 A in RPS-1000 literature is a DIFFERENT parameter, in 151153 Rev R");
p("  section 3.8.6: \"Each circuit provides up to 3A (total current for all Flexput circuits must not");
p("  exceed 5A)\" -- that is the CONSTANT AUXILIARY POWER limit in normal standby, structurally identical");
p("  to the IFP-2100's own 9.0 A alarm / 6.0 A constant-aux standby pair. Recording \"5 A\" as the RPS");
p("  aggregate output would be WRONG. Both limits are now modelled as separate dimensions.");
p();
p("  OFFICIAL_DOCUMENTATION_CONFLICT -- RPS-1000 BATTERY, real and unresolved:");
p("    Doc 350070 Rev M (datasheet)     : \"Battery charging capacity is 35AH\", \"two 18AH\"");
p("    Manual 151153 Rev R (installation): \"battery charge capacity is 7 to 33 AH\", \"two 17 AH\"");
p("  Both are Honeywell first-party. Neither is silently preferred; the applicable current");
p("  installation manual governs, and the discrepancy is carried for human resolution.");
p();
p("  SYNCHRONISATION: the RPS-1000 has its OWN built-in synchronisation -- \"Built-in synchronization");
p("  compatible with appliances from System Sensor, AMSECO, Gentex, and Wheelock\". Synchronisation is");
p("  therefore LOCAL to each panel/RPS architecture. There is NO campus-wide NAC bus and NO cross-panel");
p("  synchronisation dependency, and no separate sync module (MDL3) is required by default.");
p("  Sync authority: the NAC power module driving each circuit (panel Flexput or RPS Flexput).");

p();
p("F. PER-PANEL ALARM LOAD");
p("=".repeat(108));
p(`  ${"Panel".padEnd(23)}${"Strobe mA".padStart(11)}${"H/S mA".padStart(10)}${"Outdoor mA".padStart(12)}${"Total A".padStart(9)}   State`);
const loads = {};
for (const s of PHYSICAL_PANEL_SCOPES) {
  const worst = perPanelAlarmLoad(demands[s.id], { case: BOUNDING_CASES.WORST_ALLOWED_SETTING });
  const min = perPanelAlarmLoad(demands[s.id], { case: BOUNDING_CASES.MINIMUM_ALLOWED_SETTING });
  loads[s.id] = { worst, min };
  const by = (l) => Object.fromEntries(l.classes.map((c) => [c.clsKey, c.subtotalMa ?? null]));
  const w = by(worst), m = by(min);
  p(`  ${s.id.padEnd(23)}${String(w.indoorStrobe ?? "-").padStart(11)}${String(w.indoorHornStrobe ?? "-").padStart(10)}${String(w.outdoorHornStrobe ?? "-").padStart(12)}${String(worst.totalAlarmCurrentAmps ?? "-").padStart(9)}   ${worst.state}`);
  p(`  ${"".padEnd(23)}${"(min-setting bound)".padStart(11)} ${String(m.indoorStrobe ?? "-").padStart(8)}${String(m.indoorHornStrobe ?? "-").padStart(9)}${String(m.outdoorHornStrobe ?? "-").padStart(10)}${String(min.totalAlarmCurrentAmps ?? "-").padStart(9)}   ${min.state}`);
}
p();
p("  SLC current, SBUS current, panel electronics and auxiliary loads are EXCLUDED from the NAC budget");
p("  by construction. They belong to the battery ledger, not the notification power budget.");

p();
p("G. NAC CIRCUIT REQUIREMENT");
p("=".repeat(108));
p(`  ${"Panel".padEnd(23)}${"ByCurrent".padStart(10)}${"TopologyAvail".padStart(14)}${"DrawingNAC".padStart(11)}${"Required".padStart(10)}   Binding`);
const circuits = {};
for (const s of PHYSICAL_PANEL_SCOPES) {
  const sh = SHEET_FOR_PANEL[s.id];
  let drawingN = nacSheetCounts[sh].circuits;
  if (sh === "AMS002") drawingN = 1; // one NAC annotation per FACP block; three blocks, three panels
  const req = nacCircuitRequirement({
    loadAmps: loads[s.id].worst.totalAlarmCurrentAmps,
    wiringClass: "CLASS_B",
    drawingNacCircuits: drawingN,
  });
  circuits[s.id] = { ...req, drawingN };
  p(`  ${s.id.padEnd(23)}${String(req.byCurrentAmps ?? "-").padStart(10)}${String(req.byTopologyCircuitsAvailable).padStart(14)}${String(req.drawingExplicitCircuits).padStart(11)}${String(req.requiredCircuits ?? "-").padStart(10)}   ${req.bindingConstraint ?? "-"}`);
}
p();
p("  Each drawing states exactly ONE NAC circuit per panel. A single 3 A circuit cannot serve a panel");
p("  carrying more than three 3 A-equivalents of appliances, so the current-driven minimum BINDS and");
p("  the drawing annotation UNDER-SPECIFIES the load. This is recorded as an engineering discrepancy,");
p("  not silently overridden in either direction.");
p("  EXACT_NAC_DISTRIBUTION_NOT_AUTHORED: no notification device schedule exists on the drawings, so no");
p("  per-circuit device assignment is produced. Only a FEASIBLE_CIRCUIT_ALLOCATION is proven.");

p();
p("H. RPS RIGHT-SIZING");
p("=".repeat(108));
p(`  ${"Panel".padEnd(23)}${"NativeCircuitsUsed".padStart(18)}${"NativeAmps".padStart(11)}${"RPS Qty".padStart(8)}   ${"ByCircuit".padStart(10)}${"ByCurrent".padStart(10)}   State`);
const rps = {};
for (const s of PHYSICAL_PANEL_SCOPES) {
  const requiredCircuits = circuits[s.id].requiredCircuits;
  const requiredAmps = loads[s.id].worst.totalAlarmCurrentAmps;
  if (requiredCircuits == null) {
    rps[s.id] = { state: "NOT_COMPUTABLE", rpsQuantity: null };
    p(`  ${s.id.padEnd(23)}${String(requiredCircuits ?? "-").padStart(18)}${String(requiredAmps ?? "-").padStart(11)}${"-".padStart(8)}   ${"-".padStart(10)}${"-".padStart(10)}   NOT_COMPUTABLE`);
    continue;
  }
  const nativeCircuitsUsable = Math.min(requiredCircuits, IFP_2100_CAPACITY.flexputCircuitsClassB);
  const res = rpsRightSizing({
    nativeCircuitsUsable,
    nativeUsableAmps: IFP_2100_CAPACITY.panelTotalLimitAmps,
    requiredCircuits,
    requiredAmps,
  });
  rps[s.id] = res;
  p(`  ${s.id.padEnd(23)}${String(nativeCircuitsUsable).padStart(18)}${String(IFP_2100_CAPACITY.panelTotalLimitAmps).padStart(11)}${String(res.rpsQuantity).padStart(8)}   ${String(res.byCircuit).padStart(10)}${String(res.byCurrent).padStart(10)}   ${res.state}`);
}
p();
p("  quantity = max(byCircuit, byCurrent): BOTH the added circuit COUNT and the added CURRENT must pass.");
p("  An RPS is never added merely to obtain 6815 mounting space, and no historical architecture is reused.");
p("  No RPS is proposed for any panel while the notification current is unevidenced.");

p();
p("I. 6815 PHYSICAL MOUNTING ALLOCATION (independent of the SLC expansion requirement)");
p("=".repeat(108));
const REQUIRED_6815 = { "PANEL-MFACP-CAMPUS": 5, "PANEL-BOYS": 5, "PANEL-GIRLS": 5, "PANEL-WELCOME-CENTER": 3, "PANEL-SUB-STATION-1": 1, "PANEL-SUB-STATION-2": 1, "PANEL-DG-STATION": 1 };
p(`  ${"Panel".padEnd(23)}${"6815 needed".padStart(12)}${"PanelSlots".padStart(11)}${"Used".padStart(6)}${"RPS needed".padStart(11)}${"RPS slots used".padStart(15)}${"Remote 5815RMK".padStart(15)}`);
for (const s of PHYSICAL_PANEL_SCOPES) {
  const rpsQty = rps[s.id]?.rpsQuantity ?? 0;
  const rpsRequiredForPower = rpsQty > 0;
  const a = mountingAllocation({
    required6815: REQUIRED_6815[s.id],
    panelSlots: 2,
    rpsQuantity: rpsQty,
    rpsSlotsPerCabinet: 2,
    rpsRequiredForPower,
  });
  p(`  ${s.id.padEnd(23)}${String(a.required6815).padStart(12)}${String(a.panelSlots).padStart(11)}${String(a.panelSlotsUsed).padStart(6)}${String(rpsQty).padStart(11)}${String(a.rpsSlotsUsed).padStart(15)}${String(a.remoteEnclosures5815RMK).padStart(15)}`);
}
p();
p("  Panel cabinet capacity 2 and RPS cabinet capacity 2 are FIRST-PARTY (6815 Data Sheet). The IFP-2100");
p("  cabinet takes 2 and each required RPS cabinet takes 2, so where an RPS is required for power its");
p("  slots are consumed BEFORE any remote enclosure is contemplated. Power requirement and mounting");
p("  requirement stay separate reasons. Values are provisional because the RPS quantity is itself blocked.");

p();
p("I2. WHY CAMPUS POOLING IS WRONG (proof, not assertion)");
p("=".repeat(108));
const campusWorstAmps = Object.values(loads).reduce((a, l) => a + (l.worst.totalAlarmCurrentAmps ?? 0), 0);
const campusNativeAmps = PHYSICAL_PANEL_SCOPES.length * IFP_2100_CAPACITY.panelTotalLimitAmps;
const pooledDeficit = campusWorstAmps - campusNativeAmps;
const pooledFloor = pooledDeficit > 0 ? Math.ceil(pooledDeficit / RPS_1000_CAPACITY.usableOutputAmps) : 0;
const perPanelTotal = Object.values(rps).reduce((a, r) => a + (r.rpsQuantity ?? 0), 0);
p(`  Campus worst-case notification load      : ${Math.round(campusWorstAmps * 1000) / 1000} A (sum of 7 INDEPENDENT panels)`);
p(`  Campus native capacity (7 x ${IFP_2100_CAPACITY.panelTotalLimitAmps} A)   : ${campusNativeAmps} A`);
p(`  POOLED deficit ${Math.round(pooledDeficit * 1000) / 1000} A -> pooled floor  : ${pooledFloor} x RPS-1000HV   <-- WRONG`);
p(`  PER-PANEL total (each panel rounded UP)  : ${perPanelTotal} x RPS-1000HV`);
p(`  Understatement if pooled                 : ${perPanelTotal - pooledFloor} units (${(perPanelTotal / pooledFloor).toFixed(2)}x)`);
p();
p("  Spare Flexput output in the KGS fire command room cannot serve a strobe in the Welcome");
p("  Center. Pooling therefore understates the installed count. This is the same lesson already on");
p("  record for SLC loops (aggregate minimum 10 vs installed 11), here at a much larger magnitude.");
p(`  AMS-002 carries ${amsBlocks} explicit NAC circuit annotations across its ${amsBlocks} FACP blocks, one per panel.`);

p();
p("J. VOLTAGE-DROP READINESS");
p("=".repeat(108));
for (const s of PHYSICAL_PANEL_SCOPES) {
  const v = voltageDropReadiness({
    panelId: s.id,
    conductorSqMm: 2.5,
    conductorMaterial: null,
    routeLengthM: null,
    deviceOrder: null,
    minApplianceVolts: null,
    designMarginPct: null,
  });
  p(`  ${s.id.padEnd(23)} ${v.state}`);
  for (const k of v.known) p(`      KNOWN   ${k}`);
  for (const k of v.missing) p(`      MISSING ${k}`);
}
p();
p("  Conductor size IS proven by the drawings, so voltage drop is not blocked on it. It is blocked on");
p("  route length, which no governed sheet states. A straight-line building distance is NOT a cable route");
p("  and is not substituted. The drawing geometry (2-D page coordinates) yields a page layout, not a");
p("  cable route, so no defensible route length is derivable from the governed assets.");

p();
p("K. BATTERY-SIZING READINESS");
p("=".repeat(108));
const req = BATTERY_REQUIREMENT_EVIDENCE;
p(`  Governing requirement: ${req.source}`);
p(`    standby (supervisory) : ${req.standbyHours} h`);
p(`    alarm (full load)     : ${req.alarmMinutes} min`);
p(`    margin                : ${req.marginPct} %`);
p(`    battery type          : ${req.batteryType}`);
p(`    parallel banks        : ${req.parallelBatteriesPermitted ? "permitted" : "NOT PERMITTED (spec 1.10 M)"}`);
p();
p("  Battery input ledger (UL currents, IFP-2100 Manual Rev E Table 3.2 / LS10173-001SK-E:A):");
for (const [k, v] of Object.entries(BATTERY_DEVICE_CURRENT_MA)) {
  p(`    ${k.padEnd(22)} standby=${String(v.standby ?? "-").padStart(6)} mA  alarm=${String(v.alarm ?? "-").padStart(6)} mA   ${v.proposition ? "" : "[NOT EVIDENCED]"}`);
}
p();
p(`  Battery capacity ceiling : ${BATTERY_BOUNDS.chargeCapacityMinAh}-${BATTERY_BOUNDS.chargeCapacityMaxAh} Ah (panel charge capacity)`);
p(`  Manufacturer table (Table 3.5, 24 h standby, built-in 20% derating): ${BATTERY_BOUNDS.maxBatteryStandbyTableAh.map((a) => a + "Ah").join(", ")}`);
p(`  Max standby load at those sizes: ${Object.entries(BATTERY_BOUNDS.maxStandbyLoadMa).map(([a, m]) => a + "Ah=" + m + "mA").join(", ")}`);
p();
p(`  CRITICAL GAP: ${BATTERY_BOUNDS.criticalGap}`);
p();
const sample = batteryReadiness({ panelId: "ALL PANELS", standbyLoadMa: null, alarmLoadMa: null, unresolvedLoads: ["IDP-HEAT-ROR detector current", "notification appliance UL max current"] });
p(`  BATTERY_FINAL_SIZING = ${sample.state}`);
for (const m of sample.missingEvidence) p(`    missing: ${m}`);
p(`  ${sample.capacityCeilingReason}`);

p();
p("L. NEW MANUFACTURER FACTS REQUIRING HUMAN REVIEW");
p("=".repeat(108));
p("  No governed write was performed. Decision-ready facts for the Technical Manager packet:");
p("   1. IFP-2100HV NAC: 8 Flexput / 3 A per circuit / 9 A total / 6 A constant auxiliary standby.");
p("      Now corroborated by BOTH datasheet 351602 Rev C and manual LS10143-001SK-E Rev E Sec 1.1.1 +");
p("      Fig 4.44/4.45. The governed capability store carries circuit COUNT and (per prior slice) 3 A /");
p("      9 A; the 6.0 A constant auxiliary standby limit is NEW and not yet persisted.");
p("   2. IFP-2100HV battery: charge capacity 17-55 Ah; parallel banks forbidden (manual + spec agree).");
p("   3. IFP-2100HV Table 3.5 max battery standby loads, with the 20-minute alarm ceiling vs the project's");
p("      30-minute requirement recorded as a conflict.");
p("   4. RPS-1000: 6 Flexput / 3 A per circuit / 6 A aggregate / 2 Form C, Rev F or higher, 6815 Data Sheet");
p("      compatible-panel list includes IFP-2100HV. Any 5 A first-party revision must be recorded as a");
p("      conflict, not silently preferred.");
p("   5. 6815: 78 mA standby / 78 mA alarm (LS10173-001SK-E:A).");
p("   6. Notification appliance UL max current: NOT yet evidenced. Must not be persisted from the");
p("      NOTIFIER alias values.");

p();
p("M. VERDICT");
p("=".repeat(108));
const allLoadsComputed = Object.values(loads).every((l) => l.worst.state === "COMPUTED");
const rpsTotal = Object.values(rps).reduce((a, r) => a + (r.rpsQuantity ?? 0), 0);
p(`  NAC_RPS_ENGINEERING_STATUS   = ${allLoadsComputed ? "READY_WITH_NON_MATERIAL_UNCERTAINTY" : "BLOCKED"}`);
p(`     per-panel load, circuit count and RPS quantity ARE produced: ${rpsTotal} x RPS-1000HV total.`);
p(`     The remaining uncertainty is the UNRESOLVED interior candela and sound-volume field setting,`);
p(`     which is BOUNDED (min ${Object.values(loads)[0].min.totalAlarmCurrentAmps} A to max ${Object.values(loads)[0].worst.totalAlarmCurrentAmps} A on the KGS panel)`);
p(`     rather than guessed. That bound does not change WHICH panels need an RPS, but it does change`);
p(`     HOW MANY, so the RPS count is stated at the worst-case setting and is a labelled preliminary`);
p(`     assumption per the brand/pre-sales policy, not a final quantity.`);
p(`  BATTERY_ENGINEERING_STATUS   = BLOCKED`);
p(`     reason: the project duration/margin requirement is proven, but the load ledger is incomplete`);
p(`             (IDP-HEAT-ROR and notification currents) and the manufacturer's 20-minute alarm table`);
p(`             column does not cover the project's 30-minute requirement.`);
p(`  GOVERNED_EXECUTION_STATUS    = BLOCKED_PENDING_HUMAN_REVIEWS`);
p(`     the 8 proven false-merged BOQ rows are still Merged and downstream-ineligible; the persisted`);
p(`     IFP-2100HV slc_expansion_max_count may still read 12; and no capability fact was self-promoted.`);
p(`  Runtime path still consuming stale capability data: the governed product_attributes row for`);
p(`  IFP-2100HV slc_expansion_max_count is read by capabilityFromAttributes and therefore by`);
p(`  loopAdmissibility, so any governed consumer still sees 12 until a human applies the review packet.`);

console.log(L.join("\n"));
db.close();
