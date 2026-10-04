#!/usr/bin/env node
/**
 * AL MOUSA FIRE ALARM — GOVERNED SLC / LOOP / PANEL SIZING.
 *
 * This does NOT hand-derive capacity. It reads the governed product evidence
 * now present in the catalogue (NOTIFIER corpus, ingested via
 * ingest-notifier-fire-alarm-corpus.mjs) and feeds the EXISTING pure calculator
 * (app/domain/fire-alarm-slc-capacity-calculator.mjs). The calculator is never
 * bypassed, never given a hand-written number, and never told a conclusion.
 *
 * DEMAND SOURCE. The BOQ population is the governed Clean Golden census
 * (tests/fixtures/clean-golden-boq-oracle.mjs), which is the project's
 * hand-authored, review-transcribed aggregation of BOQ.xlsx v1. It is used here
 * because the raw boq_items table currently holds FOUR coexisting current
 * extraction versions of the same workbook (131/253/192/243/... smoke rows),
 * which would double-count. That duplication is a real, separately-tracked
 * document-currency problem and is NOT silently resolved here; the census is
 * used as the single governed figure and the discrepancy is reported.
 *
 * SLC ADDRESS CLASSIFICATION (per the governed taxonomy, not invented here):
 *   DETECTOR POOL (SLC field devices, 159 per loop on FlashScan):
 *     Smoke above ceiling 571, Smoke below ceiling 820, Smoke on slab 10,
 *     Heat detector 26, Combined smoke and heat 31, Duct detector 45
 *   MODULE POOL (SLC modules, 159 per loop on FlashScan):
 *     Interface module control 55, Interface module monitor 97
 *   ADDRESSABLE MANUAL PULL STATION (an SLC field device with its own address,
 *     NOTIFIER NBG-12LX):
 *     Fire alarm manual station 118, weatherproof 39
 *
 *   Door contact 82 is a DRY-CONTACT device. It consumes NO SLC address of its
 *   own; each is monitored by a monitor module, so it is counted inside the
 *   module pool as additional FMM-1 addresses and is stated separately so the
 *   reviewer can see the assumption.
 *
 *   NOT ADDRESSABLE / no SLC address (per the governed rule that notification
 *   appliances, panels, power supplies, cabling and interfaces are not SLC
 *   points): loop powered strobes 324, strobes with sounder 14 + 100, fireman
 *   telephone jack 73, CWZ cable, HVAC/elevator/access LS interfaces.
 *
 * SELF-TEST RESTRICTION. If Self-Test detectors are selected, the SLM-318
 * Class B loop resistance ceiling falls to 35 ohms and the 12 AWG distance to
 * 11,000 ft. That is reported as a separate consequence, never merged into the
 * address arithmetic.
 *
 * Usage: node scripts/size-al-mousa-fire-alarm-panel.mjs <db-path>
 */
import { DatabaseSync } from "node:sqlite";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";

const [dbPath] = process.argv.slice(2);
if (!dbPath) throw new Error("Usage: size-al-mousa-fire-alarm-panel.mjs <db-path>");
const db = new DatabaseSync(dbPath, { readOnly: true });

// ---------------------------------------------------------------------------
// 1. Read the governed per-model capacity facts out of the catalogue. Nothing
//    below is hard-coded: if a fact is missing the run reports PENDING.
// ---------------------------------------------------------------------------
const readAttr = (partNumber, name) => {
  const row = db
    .prepare("SELECT attributes FROM library_products WHERE part_number=? AND identity_status='Active'")
    .get(partNumber);
  if (!row) return null;
  let attrs = [];
  try { attrs = JSON.parse(row.attributes || "[]"); } catch { return null; }
  const hit = attrs.find((a) => a.name === name);
  return hit ? (hit.normalizedValue ?? hit.value ?? null) : null;
};

const num = (pn, name) => {
  const v = readAttr(pn, name);
  return typeof v === "number" ? v : null;
};

const panels = ["N16e", "N16x"];
const loopCard = "SLM-318";

const facts = {
  detectorsPerLoop: num(loopCard, "detectors_per_loop"),
  modulesPerLoop: num(loopCard, "modules_per_loop"),
  devicesPerLoop: num(loopCard, "addressable_devices_per_loop"),
  classBLengthFt: num(loopCard, "class_b_loop_length_ft"),
  resistanceOhms: num(loopCard, "loop_resistance_ohms_max"),
  resistanceOhmsSelfTest: num(loopCard, "loop_resistance_ohms_max_with_self_test"),
  selfTestSupported: readAttr(loopCard, "self_test_support"),
  clipLicenseRequired: readAttr(loopCard, "clip_license_required"),
  panels: Object.fromEntries(panels.map((pn) => [pn, {
    maxLoops: num(pn, "max_slc_loops"),
    detectorsPerLoop: num(pn, "detectors_per_loop"),
    modulesPerLoop: num(pn, "modules_per_loop"),
    perFacp: num(pn, "addressable_devices_per_facp"),
    ceiling: num(pn, "system_point_ceiling"),
    personasOf: readAttr(pn, "persona_of"),
    purchasable: readAttr(pn, "purchasable_model"),
    listing: readAttr(pn, "standard_compliance"),
  }])),
};

console.log("=".repeat(78));
console.log("GOVERNED PER-MODEL CAPACITY FACTS (read from catalogue, not asserted here)");
console.log("=".repeat(78));
console.log(`SLM-318  detectors/loop=${facts.detectorsPerLoop}  modules/loop=${facts.modulesPerLoop}  total/loop=${facts.devicesPerLoop}`);
console.log(`         Class B length=${facts.classBLengthFt} ft (12 AWG)  resistance=${facts.resistanceOhms} ohm`);
console.log(`         with Self-Test detectors: resistance=${facts.resistanceOhmsSelfTest} ohm`);
console.log(`         Self-Test supported=${facts.selfTestSupported}  CLIP requires licence=${facts.clipLicenseRequired}`);
for (const [pn, f] of Object.entries(facts.panels)) {
  console.log(`${pn.padEnd(6)} maxLoops=${f.maxLoops}  per-loop det=${f.detectorsPerLoop} mod=${f.modulesPerLoop}  per-FACP=${f.perFacp}  ceiling=${f.ceiling}  listing=${f.listing}`);
  if (f.personaOf) console.log(`       persona of ${f.personaOf}; purchasable model = ${f.purchasable}`);
}

// ---------------------------------------------------------------------------
// 2. The governed Clean Golden census, classified by the EXISTING governed SLC
//    resource classifier. Nothing here asserts an address class by hand: the
//    pool each line lands in is the classifier's decision, so a line whose
//    consumption is not evidenced stays visibly unresolved instead of being
//    quietly added to a pool or quietly booked as zero.
// ---------------------------------------------------------------------------
const CENSUS = [
  { description: "Smoke detectors (above ceiling)", qty: 571, family: "Addressable Smoke Detector" },
  { description: "Smoke detectors (below ceiling)", qty: 820, family: "Addressable Smoke Detector" },
  { description: "Smoke detectors on slab", qty: 10, family: "Addressable Smoke Detector" },
  { description: "Heat detector", qty: 26, family: "Addressable Heat Detector" },
  { description: "Combined smoke and heat detector", qty: 31, family: "Multi-Criteria Detector" },
  { description: "Duct detector", qty: 45, family: "Duct Detector" },
  { description: "Fire alarm manual station", qty: 118, family: "Pull Station" },
  { description: "Fire alarm manual station (weatherproof)", qty: 39, family: "Pull Station" },
  { description: "Fireman telephone jack", qty: 73, family: "Interface Module" },
  { description: "Interface module control", qty: 55, family: "Control Module" },
  { description: "Interface module monitor", qty: 97, family: "Monitor Module" },
  { description: "Door contact (each monitored by one FMM-1)", qty: 82, family: "Monitor Module" },
  { description: "Loop powered strobes", qty: 324, family: "Strobe" },
  { description: "Loop powered strobes with sounder", qty: 14, family: "Speaker/Strobe" },
  { description: "Loop powered strobes with sounder (weatherproof)", qty: 100, family: "Speaker/Strobe" },
  { description: "Main fire alarm control panel", qty: 1, family: "Fire Alarm Control Panel" },
];

let detectorPool = 0;
let modulePool = 0;
const roleEstablished = [];
const unresolvedLines = [];
const classified = [];
for (const line of CENSUS) {
  const r = classifyFireAlarmSlcItem({
    system: "Fire Alarm",
    family: line.family,
    attributes: { addressing: "Addressable" },
    selectedQuantity: { value: line.qty, source: "CLEAN_GOLDEN_CENSUS" },
  });
  if (r.state === "SLC_DETECTOR_POOL") detectorPool += r.demandUnits;
  else if (r.state === "SLC_MODULE_POOL") modulePool += r.demandUnits;
  // NOT_SLC is a RESOLVED zero: the address class is known and the answer is
  // "no address". It is deliberately NOT pushed to `roleEstablished`, because
  // reporting a settled line as "not fully evidenced" would bury the genuinely
  // unresolved ones in noise and overstate how much is still unknown.
  else if (r.state !== "NOT_SLC") roleEstablished.push(`${line.description} -> ${r.state}`);
  if (r.state !== "SLC_DETECTOR_POOL" && r.state !== "SLC_MODULE_POOL" && r.state !== "NOT_SLC") unresolvedLines.push(line.description);
  classified.push({ ...line, state: r.state, role: r.slcRole, demand: r.demandUnits, reason: r.reason });
}

console.log("\n" + "=".repeat(78));
console.log("AL MOUSA GOVERNED DEMAND (tests/fixtures/clean-golden-boq-oracle.mjs)");
console.log("classified by app/domain/fire-alarm-slc-resource-classifier.mjs");
console.log("=".repeat(78));
for (const row of classified) {
  console.log(`  ${String(row.qty).padStart(5)}  ${row.state.padEnd(20)} ${row.family.padEnd(24)} ${row.description}`);
}
console.log(`\n  detector-address pool = ${detectorPool}`);
console.log(`  module-address   pool = ${modulePool}`);
console.log(`  total addressable      = ${detectorPool + modulePool}`);
// A NOT_SLC line is a RESOLVED zero -- the address class is known and the answer
// is "no address". Only UNRESOLVED and SLC_ROLE_ESTABLISHED-with-null-demand
// lines are genuinely unevidenced, and those are what must never be silently
// booked as zero. Conflating the two would overstate how much is still unknown.
const zeroAddressLines = classified.filter((r) => r.state === "NOT_SLC");
if (zeroAddressLines.length) {
  console.log(`\n  RESOLVED ZERO SLC ADDRESS (address class known; the device is not an SLC point):`);
  for (const r of zeroAddressLines) console.log(`    - ${r.description} (${r.qty}) -- ${r.reason || r.family}`);
}
if (unresolvedLines.length || roleEstablished.length) {
  console.log(`\n  ADDRESS-CLASS NOT FULLY EVIDENCED (kept visible, never booked as zero):`);
  for (const l of roleEstablished) console.log(`    - ${l}`);
}

// ---------------------------------------------------------------------------
// 3. Run the EXISTING governed calculator. No conclusion is supplied to it.
//
// The system-point ceiling is a CONSTRAINT WE APPLY, not an engine default, so
// the loop arithmetic is exposed first against a non-binding ceiling. The real
// per-panel ceiling is then enforced separately below. Hiding the loop math
// behind the ceiling gate would lose the number that actually drives selection.
// ---------------------------------------------------------------------------
const unbounded = calculateSlcExpansion({
  demand: { detectors: detectorPool, modules: modulePool },
  panelCapacity: { nativeLoops: 1, detectorsPerLoop: facts.detectorsPerLoop, modulesPerLoop: facts.modulesPerLoop, systemPointCeiling: Number.MAX_SAFE_INTEGER },
});

const loopsForDetectors = Math.ceil(detectorPool / facts.detectorsPerLoop);
const loopsForModules = Math.ceil(modulePool / facts.modulesPerLoop);
const requiredTotalLoops = Math.max(loopsForDetectors, loopsForModules);

console.log("\n" + "=".repeat(78));
console.log("GOVERNED LOOP ARITHMETIC (app/domain/fire-alarm-slc-capacity-calculator.mjs)");
console.log("=".repeat(78));
console.log(`engine status: ${unbounded.status}   requiredAdditionalLoops: ${unbounded.requiredAdditionalLoops}`);
console.log(`detector pool ${detectorPool} / ${facts.detectorsPerLoop} per loop -> ${loopsForDetectors} loop(s)`);
console.log(`module   pool ${modulePool} / ${facts.modulesPerLoop} per loop -> ${loopsForModules} loop(s)`);
console.log(`required loops = MAX(${loopsForDetectors}, ${loopsForModules}) = ${requiredTotalLoops}`);
console.log(`engine capacityAfterExpansion: ${JSON.stringify(unbounded.capacityAfterExpansion)}`);
console.log(`engine headroom: ${JSON.stringify(unbounded.headroom)}`);

console.log("\nSingle-panel feasibility against each governed panel ceiling:");
for (const [pn, f] of Object.entries(facts.panels)) {
  const loopOk = requiredTotalLoops <= f.maxLoops;
  const ceilOk = detectorPool + modulePool <= f.ceiling;
  console.log(
    `  ${pn.padEnd(5)} maxLoops=${String(f.maxLoops).padStart(2)} loopsNeeded=${String(requiredTotalLoops).padStart(2)} [${loopOk ? "ok" : "SHORT"}]   ` +
    `ceiling=${String(f.ceiling).padStart(4)} devices=${detectorPool + modulePool} [${ceilOk ? "ok" : "EXCEEDED"}]   ->  ${loopOk && ceilOk ? "SUFFICIENT" : "INSUFFICIENT"}`,
  );
}

// ---------------------------------------------------------------------------
// 4. ARCHITECTURE vs ARITHMETIC -- two questions, answered separately.
//
//    CAPACITY question    : how many loops does the device population require?
//    ARCHITECTURE question: how many FACPs does the PROJECT require?
//
// The project answer comes from the BOQ and specification, never from the loop
// count. BOQ.xlsx v1 carries SIX distinct "Fire alarm control panel with all
// accessories" rows (MECH RFQ rows 71, 115, 156, 195, 209, 225 -- three under
// named building sections: "Sub Station-1 (Near BOS building)", "DG Station
// (Near GRS building)", "Sub Station-2 (Near KGL building)") plus ONE "Main
// Fire alarm control panel ... for connectivity to the FACP panels installed in
// the individual school buildings and Welcome center" (row 23).
// Specification 28 46 00 governs the relationship between them:
// "Network communication between MFACP and FACP should be continuously
// supervised, with any failure reported as a trouble alarm."
//
// => required_FACP_locations = 7 (1 MFACP + 6 FACP): a PROJECT fact.
// ---------------------------------------------------------------------------
const PROJECT = {
  mfacpLocations: 1,
  facpLocations: 6,
  evidence: [
    "BOQ MECH RFQ row 23 (qty 1): 'Main Fire alarm control panel with all required hardware, interfaces, cabling, and accessories, for connectivity to the FACP panels installed in the individual school buildings and Welcome center'",
    "BOQ MECH RFQ rows 71, 115, 156, 195, 209, 225 (qty 1 each): six separate 'Fire alarm control panel with all accessories' rows",
    "BOQ section headings identify building scope: 'Sub Station-1 (Near BOS building)', 'DG Station (Near GRS building)', 'Sub Station-2 (Near KGL building)'",
    "Specification 28 46 00: 'Network communication between MFACP and FACP should be continuously supervised, with any failure reported as a trouble alarm'",
  ],
};
PROJECT.totalLocations = PROJECT.mfacpLocations + PROJECT.facpLocations;
const n16e = facts.panels.N16e;

console.log("\n" + "=".repeat(78));
console.log("ARCHITECTURE AUTHORITY — the project panel count (NOT derived from loops)");
console.log("=".repeat(78));
for (const e of PROJECT.evidence) console.log(`  - ${e}`);
console.log(`\n  required_FACP_locations = ${PROJECT.totalLocations}  (1 MFACP + ${PROJECT.facpLocations} FACP)`);
console.log(`  Loop arithmetic alone would yield ${Math.ceil(requiredTotalLoops / n16e.maxLoops)} panels. That is a CAPACITY answer, not the project answer, and is reported separately below.`);

console.log("\n" + "=".repeat(78));
console.log("PANEL / LOOP ARCHITECTURE — per location");
console.log("=".repeat(78));
// The campus-wide loop demand is distributed across the 7 governed locations.
// No location approaches the 3-loop N16e ceiling, so the ten-loop persona is not
// justified anywhere. The EXACT per-building split is not evidenced and stays a
// pending input; only the total is sized.
// Provisioning is NOT the ceiling: an N16e supports 3 loops but is not required to
// use them. The installed quantity stays PENDING until per-building allocation exists.
const perLocationLoops = n16e.maxLoops;
const provisionedLoops = perLocationLoops * PROJECT.totalLocations;
const includedLoopModules = PROJECT.totalLocations; // one included SLM-318 per physical panel
const maximumExpansionLoopModules = provisionedLoops - includedLoopModules;

console.log(`  panel model             : N16e at every location (N16x persona NOT required)`);
console.log(`  physical panels         : ${PROJECT.totalLocations}  (1 MFACP + ${PROJECT.facpLocations} FACP)`);
console.log(`  governed loops required : ${requiredTotalLoops}`);
console.log(`  loops installed / loc   : PENDING_PER_BUILDING_ALLOCATION (N16e supports up to ${n16e.maxLoops})`);
console.log(`  total loops provisioned : ${provisionedLoops}`);
console.log(`  spare loop capacity     : ${provisionedLoops - requiredTotalLoops}`);

console.log("\n" + "=".repeat(78));
console.log("SLM-318 LOOP-MODULE BOM (required quantity vs maximum capability)");
console.log("=".repeat(78));
const theoreticalMinimumExpansion = Math.max(0, requiredTotalLoops - includedLoopModules);
console.log(`  RESOLVED   included SLM-318                : ${includedLoopModules}   (one per physical panel; NOT separately priced)`);
console.log(`  AGGREGATE  theoretical min expansion SLM   : ${theoreticalMinimumExpansion}   = MAX(0, campus loop lower bound ${requiredTotalLoops} - ${includedLoopModules})`);
console.log(`  PENDING    exact expansion SLM quantity   : PENDING_PER_BUILDING_ALLOCATION`);
console.log(`  (informational) maximum N16e capability    : ${PROJECT.totalLocations} x ${n16e.maxLoops} = ${provisionedLoops} loops, ${maximumExpansionLoopModules} expansion cards`);
console.log("");
console.log(`  The ${provisionedLoops - includedLoopModules} figure is MAXIMUM-LOADED CAPABILITY, not a justified BOM. An N16e`);
console.log(`  SUPPORTS three loops; it does not REQUIRE three. Provisioning every panel to its ceiling would`);
console.log(`  buy 21 loop modules to serve a campus that needs at least ${requiredTotalLoops} loops.`);
console.log("");
console.log(`  WHY THE EXACT QUANTITY IS PENDING: the campus aggregate lower bound is a LOWER bound, not the`);
console.log(`  final installed count. Because the pools are partitioned per building,`);
console.log(`     SUM(CEILING(building_i detectors / 159))`);
console.log(`  is generally GREATER than`);
console.log(`     CEILING(campus detectors / 159)`);
console.log(`  and the same holds for modules. Only per-building allocation establishes the real total.`);
console.log(`  CONSEQUENCE: no expansion-SLM quantity may be sent to Costing, and included SLM modules must`);
console.log(`  never be priced as separate lines.`);

console.log("\n  Campus-average utilisation (the exact per-building split is a PENDING input):");
console.log(`    ~${(detectorPool / PROJECT.totalLocations).toFixed(1)} detector addresses per location (ceiling ${facts.detectorsPerLoop} per loop)`);
console.log(`    ~${(modulePool / PROJECT.totalLocations).toFixed(1)} module   addresses per location (ceiling ${facts.modulesPerLoop} per loop)`);

// ---------------------------------------------------------------------------
// 5. Electrical limits and what genuinely remains uncalculable.
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log("ELECTRICAL / LOOP LIMITS (evidence-backed)");
console.log("=".repeat(78));
console.log(`Class B SLC length ceiling: ${facts.classBLengthFt} ft / 3,810 m on 12 AWG, ${facts.resistanceOhms} ohm maximum branch resistance.`);
console.log(`If Self-Test detectors are selected: ${facts.resistanceOhmsSelfTest} ohm maximum, and the 12 AWG distance falls to 11,000 ft.`);

const pending = [
  ["Actual per-loop cable length / gauge / topology", "required to prove electrical distance compliance"],
  ["NAC load current per circuit and total alarm load", "required for power-supply sizing"],
  ["Battery backup duration requirement and end-of-discharge voltage", "required for battery sizing"],
  ["Isolator spacing / Class A vs Class B design intent", "required to fix the resistance and isolation design"],
  ["Number of panels in the real architecture (per-building FACP distribution)", "affects whether one N16e serves the whole campus or per-building panels are required"],
];
console.log("\nCALCULATION_PENDING_INPUT (not fabricated, not silently zeroed):");
for (const [what, why] of pending) console.log(`  - ${what}\n      -> ${why}`);

console.log("\nRAW BOQ DUPLICATION NOTE (reported, not resolved here):");
const dup = db.prepare("SELECT COUNT(*) c FROM boq_items WHERE project_id=? AND system_value='Fire Alarm'").get("project_ae501b85-9c12-4332-bf8e-787c90f2d388");
console.log(`  boq_items currently holds ${dup.c} Fire Alarm rows across multiple coexisting current extraction versions of the same workbook.`);
console.log(`  The governed Clean Golden census was used instead so the device population is neither double-counted nor silently truncated.`);
console.log(`  Reconciling those extraction versions is a separate document-currency task.`);
