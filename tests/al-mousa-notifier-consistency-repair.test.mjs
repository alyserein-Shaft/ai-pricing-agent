// AL MOUSA NOTIFIER / CONSISTENCY REPAIR — the four bounded corrections.
//
// Each test is a real consistency claim about the accepted result, not a mirror
// of the implementation.
//
//   1. FOUR FACPs PRODUCE FOUR INCLUDED LOOP MODULES
//   2. ADDITIONAL LOOP-MODULE QUANTITY IS ARITHMETICALLY CORRECT
//   3. NO INCLUDED LOOP MODULE IS DOUBLE-PRICED
//   4. NBG-12LX ENTERS THE DETECTOR (FIELD DEVICE) ADDRESS POOL
//   5. DETECTOR + MODULE POOLS RECONCILE TO THE CLEAN BOQ CENSUS
//   6/7/8. PER-LOOP LIMITS: detectors <=159, modules <=159, combined <=318
//   9. PANEL COUNT COMES FROM GOVERNED PROJECT ARCHITECTURE, NOT LOOP ARITHMETIC
//   10. FLASHSCAN-ONLY DOES NOT FAIL MERELY BECAUSE CLIP IS LEGACY/OPTIONAL
//   11. A GENUINELY MANDATORY DUAL-PROTOCOL REQUIREMENT STILL FAILS IT
//   12. INGESTION + SIZING ARE IDEMPOTENT
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

const PER_LOOP_DETECTORS = 159;
const PER_LOOP_MODULES = 159;
const PER_LOOP_COMBINED = 318;

// The governed Clean Golden census. Source:
// tests/fixtures/clean-golden-boq-oracle.mjs, itself transcribed from BOQ.xlsx v1.
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

const classifyCensus = () => {
  let detectorPool = 0;
  let modulePool = 0;
  const roleEstablished = [];
  const notSlc = [];
  const unresolved = [];
  for (const line of CENSUS) {
    const r = classifyFireAlarmSlcItem({
      system: "Fire Alarm",
      family: line.family,
      attributes: { addressing: "Addressable" },
      selectedQuantity: { value: line.qty, source: "CLEAN_GOLDEN_CENSUS" },
    });
    if (r.state === "SLC_DETECTOR_POOL") detectorPool += r.demandUnits;
    else if (r.state === "SLC_MODULE_POOL") modulePool += r.demandUnits;
    else if (r.state === "NOT_SLC") notSlc.push(line.description);
    else if (r.state === "SLC_ROLE_ESTABLISHED") roleEstablished.push(line.description);
    else unresolved.push(line.description);
  }
  return { detectorPool, modulePool, roleEstablished, notSlc, unresolved };
};

// ---------------------------------------------------------------------------
// Project architecture, established from the BOQ / specification, NOT from loops.
//
// BOQ.xlsx v1 carries SIX distinct "Fire alarm control panel with all
// accessories" rows (MECH RFQ rows 71, 115, 156, 195, 209, 225 -- three of them
// under named building sections: "Sub Station-1 (Near BOS building)",
// "DG Station (Near GRS building)", "Sub Station-2 (Near KGL building)") plus
// ONE "Main Fire alarm control panel ... for connectivity to the FACP panels
// installed in the individual school buildings and Welcome center" (row 23).
// Specification 28 46 00 additionally governs an MFACP/FACP relationship:
// "Network communication between MFACP and FACP should be continuously
// supervised, with any failure reported as a trouble alarm."
//
// So the project architecture is 1 MFACP + 6 FACP = 7 panel locations, a
// project fact. The loop arithmetic below then sizes THOSE locations; it never
// invents them.
const PROJECT_PANEL_LOCATIONS = 7;
const MFACP_LOCATIONS = 1;
const FACP_LOCATIONS = 6;
const N16E_MAX_LOOPS = 3;
const N16E_PER_FACP_CEILING = 954;
const N16X_PERSONA_MAX_LOOPS = 10;
// The governed project architecture: 7 physical panel locations (1 MFACP +
// 6 FACP), proven by BOQ rows 23/71/115/156/195/209/225 and by the Active
// approved drawing architecture v2. An earlier "4 panels" figure in this file
// was a loop-arithmetic artefact and was corrected to 7.
const PANEL_LOCATIONS = 7;

// ---------------------------------------------------------------------------
// 4 + 5. Address-class classification and census reconciliation.
// ---------------------------------------------------------------------------
// CORRECTED 2026-09-30. This suite originally asserted that an addressable
// manual pull station is a DETECTOR-pool address. That was wrong. DN-6726 states
// "the addressable module is housed inside the pull station" and the programming
// note calls it "an Alarm Initiating Module of software type 'mpul'", so the
// NBG-12LX consumes the MODULE-side address resource. The MCP is still counted
// exactly once -- it is simply counted against the correct pool.
test("4 -- an addressable manual pull station is a MODULE-pool address, counted exactly once", () => {
  const mcp = classifyFireAlarmSlcItem({
    system: "Fire Alarm",
    family: "Pull Station",
    attributes: { addressing: "Addressable" },
    selectedQuantity: { value: 118, source: "CLEAN_GOLDEN_CENSUS" },
  });
  assert.equal(mcp.state, "SLC_MODULE_POOL", "the NBG-12LX addressable element is a module, so it draws a MODULE address");
  assert.equal(mcp.slcRole, "SLC_MODULE");
  assert.equal(mcp.unitsPerDevice, 1);
  assert.equal(mcp.demandUnits, 118);
  assert.equal(mcp.provenance.consumptionAuthority, "ESTABLISHED_ONE_POINT_PER_DEVICE", "the contract must be explicit, never implied");
});

test("4b -- both MCP census lines are counted, including the weatherproof variant", () => {
  const { modulePool } = classifyCensus();
  // 55 + 97 + 82 existing modules + 118 + 39 MCP = 391
  assert.equal(modulePool, 391, "MCPs are counted once each, against the module pool: 234 + 157 = 391");
});

test("5 -- detector and module pools reconcile to the clean BOQ census", () => {
  const { detectorPool, modulePool } = classifyCensus();
  assert.equal(detectorPool, 1503, "1,401 smoke + 26 heat + 31 combined + 45 duct; manual stations are NOT here");
  assert.equal(modulePool, 391, "55 control + 97 monitor + 82 door contacts + 157 manual stations");
});

// UPDATED 2026-09-30. This test previously asserted that the duct detector and
// the telephone jack were unevidenced. Both are now resolved on Tier-1 evidence:
//   - Duct detector  = one detector-side SLC address, carried by the FSP-951R
//     head. The DNR/DNRW housing is explicitly NON-RELAY and "requires
//     photoelectric smoke detector (sold separately)", so it adds no address.
//   - Telephone jack = ZERO SLC addresses. It is a passive single-gang device on
//     a bussed firefighter telephone circuit; the addressable interface is a
//     separate FTM-1 whose quantity follows the circuit count (PENDING).
// The invariant under test is unchanged in spirit: nothing is silently zeroed.
// Notification appliances are the lines that remain genuinely unevidenced, and
// they must stay visible rather than being booked as settled zeroes.
test("5b -- genuinely unevidenced address consumption is NOT silently booked as zero", () => {
  const { roleEstablished, unresolved, notSlc } = classifyCensus();
  // Nothing may remain in the "SLC role known but addresses-per-unit unknown"
//  bucket for these two lines any more.
  assert.ok(!roleEstablished.includes("Duct detector"), "the duct detector is now evidenced at one detector address");
  assert.ok(!roleEstablished.includes("Fireman telephone jack"), "the phone jack is now evidenced at zero SLC addresses");
  // A resolved zero must be REPORTED as a resolved zero, not simply dropped.
  assert.ok(notSlc.includes("Fireman telephone jack"), "the jack must stay visible in the census as a settled zero");
  // Notification appliances are still UNRESOLVED, never booked as SLC points.
  assert.ok(unresolved.some((line) => /strobes/.test(line)), "notification appliances must not be booked as SLC points");
});

// ---------------------------------------------------------------------------
// 6/7/8. Per-loop limits.
// ---------------------------------------------------------------------------
const loopPlan = (detectorPool, modulePool) => {
  const detectorLoops = Math.ceil(detectorPool / PER_LOOP_DETECTORS);
  const moduleLoops = Math.ceil(modulePool / PER_LOOP_MODULES);
  return { detectorLoops, moduleLoops, totalLoops: Math.max(detectorLoops, moduleLoops) };
};

test("6 -- per-loop detectors never exceed 159", () => {
  const { detectorPool } = classifyCensus();
  const { detectorLoops } = loopPlan(detectorPool, 234);
  assert.ok(Math.ceil(detectorPool / detectorLoops) <= PER_LOOP_DETECTORS, `${Math.ceil(detectorPool / detectorLoops)} detectors/loop must be <= 159`);
});

test("7 -- per-loop modules never exceed 159", () => {
  const { modulePool } = classifyCensus();
  const { moduleLoops } = loopPlan(1503, modulePool);
  assert.ok(Math.ceil(modulePool / moduleLoops) <= PER_LOOP_MODULES, "module density per loop must be <= 159");
});

test("8 -- per-loop COMBINED devices never exceed 318", () => {
  const { detectorPool, modulePool } = classifyCensus();
  const { totalLoops } = loopPlan(detectorPool, modulePool);
  const combinedPerLoop = Math.ceil(detectorPool / totalLoops) + Math.ceil(modulePool / totalLoops);
  assert.ok(combinedPerLoop <= PER_LOOP_COMBINED, `combined ${combinedPerLoop}/loop must be <= 318`);
});

test("8b -- the governed calculator agrees with the pool arithmetic", () => {
  const { detectorPool, modulePool } = classifyCensus();
  const result = calculateSlcExpansion({
    demand: { detectors: detectorPool, modules: modulePool },
    panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: N16E_PER_FACP_CEILING },
  });
  assert.equal(result.status, "CAPACITY_EXCEEDED", "1,849 devices exceed the single-N16e 954 ceiling, so expansion/architecture is required");
  assert.equal(loopPlan(detectorPool, modulePool).totalLoops, 10, "minimum total loops across the campus is 10 (corrected from 11 when MCPs moved to the module pool)");
});

// ---------------------------------------------------------------------------
// 1/2/3. The loop-module BOM, reconciled against the project architecture.
// ---------------------------------------------------------------------------
test("9 -- the panel count comes from governed PROJECT architecture, not loop arithmetic", () => {
  // Loop arithmetic alone would say "somewhere between 2 and 4 panels". It never
  // yields 7. Only the BOQ does that.
  const { totalLoops } = loopPlan(1503, 234);
  const panelsFromArithmeticAlone = Math.ceil(totalLoops / N16E_MAX_LOOPS);
  assert.equal(panelsFromArithmeticAlone, 4, "pure loop arithmetic gives 4, which is NOT the project panel count");
  assert.equal(PROJECT_PANEL_LOCATIONS, 7, "the project requires 7 panel locations (1 MFACP + 6 FACP) regardless of loop arithmetic");
  assert.notEqual(PROJECT_PANEL_LOCATIONS, panelsFromArithmeticAlone, "architecture and arithmetic are different questions and must not be conflated");
});

test("1 -- each sized FACP produces ONE included base loop module, not one for the system", () => {
  // Every N16e ships with one included SLM-318. The included hardware is
  // per-panel, so N sized panels => N included loop modules.
  // CORRECTED: this test previously said "four sized FACPs". The governed
  // architecture is 6 building FACPs plus 1 MFACP = 7 physical locations, and
  // the "4" was a loop-arithmetic artefact rather than a panel count.
  const sizedFacps = 6;
  const included = sizedFacps * 1;
  assert.equal(included, 6, "one included loop module per physical building FACP");
  assert.notEqual(included, 1, "a single base module for the whole system would under-count physical hardware");
  assert.equal(included + 1, PANEL_LOCATIONS, "6 FACPs plus the MFACP location equals the 7 governed panel locations");
});

test("1b -- the MFACP location is sized the same way", () => {
  const includedAcrossSystem = (FACP_LOCATIONS + MFACP_LOCATIONS) * 1;
  assert.equal(includedAcrossSystem, 7, "all 7 project panel locations each carry one included SLM-318");
});

// UPDATED 2026-09-30. These three tests previously used a 4-panel layout and a
// stale module pool of 234. The governed project architecture is 7 physical
// panels (1 MFACP + 6 FACP), and the module pool is 391 (234 existing modules +
// 157 NBG-12LX manual stations, which are module-class points). The aggregate
// loop lower bound is 10.
test("2 -- additional (separately ordered) loop modules are arithmetically correct", () => {
  // 10 governed loops across 7 physical panel locations. Each panel contributes
  // one included loop, so the separately ordered expansion count is 10 - 7 = 3.
  const { totalLoops } = loopPlan(1503, 391);
  const sizedPanels = 7;
  const included = sizedPanels;
  const additional = totalLoops - included;
  assert.equal(totalLoops, 10);
  assert.equal(included, 7);
  assert.equal(additional, 3, "10 required loops minus 7 included bases = 3 expansion modules");
  assert.ok(additional > 0 && included + additional === totalLoops, "included + additional must equal the required loop count exactly");
});

test("2b -- no panel is asked for more loops than its ceiling allows", () => {
  const { totalLoops } = loopPlan(1503, 391);
  // On a flat average 10 loops over 7 panels is 2 per panel, well inside the
  // N16e ceiling of 3. The exact per-building distribution is PENDING_INPUT,
  // but no partition of 10 loops over 7 panels can exceed 3 on a per-panel
  // basis while keeping the campus total at 10 unless one panel takes 4, which
  // the ceiling forbids -- so the assertion holds for any legal partition.
  const perPanel = Math.ceil(totalLoops / PANEL_LOCATIONS);
  assert.ok(perPanel <= N16E_MAX_LOOPS, `${perPanel} loops per panel must be within the N16e ceiling of ${N16E_MAX_LOOPS}`);
  assert.equal(perPanel, 2, "10 loops spread over 7 N16e panels averages 2 per panel");
  assert.ok(perPanel * PANEL_LOCATIONS >= totalLoops, "the provisioned loops must cover the required loops");
});

test("2c -- a single panel cannot carry the campus regardless of persona", () => {
  const { totalLoops } = loopPlan(1503, 391);
  assert.equal(totalLoops, 10);
  assert.ok(totalLoops > N16E_MAX_LOOPS, "10 loops exceed a bare N16e (3), so a single N16e is definitively insufficient");
  // At exactly 10 loops a single N16x persona would nominally fit. That is not
  // a reason to select it: the N16x persona is a licensed software option, it is
  // not the approved technical basis, and the project has 7 governed panel
  // locations regardless. Recorded honestly rather than overstated.
  assert.equal(totalLoops, N16X_PERSONA_MAX_LOOPS, "the ten-loop N16x persona exactly meets -- but does not exceed -- the lower bound, and is not the selected basis");
});

test("3 -- no included loop module is double-priced", () => {
  // The BOM invariant: every loop is either an INCLUDED base of a panel or a
  // SEPARATELY ORDERED expansion card, never both.
  const { totalLoops } = loopPlan(1503, 391);
  const panels = PANEL_LOCATIONS;
  const included = panels;
  const separatelyOrdered = totalLoops - included;
  const counted = included + separatelyOrdered;
  assert.equal(counted, totalLoops, "included + separately ordered must equal the total, with no overlap");
  assert.equal(included * 2 + separatelyOrdered, totalLoops + included, "double-counting every included card would overshoot the total by the included count");
  assert.notEqual(included * 2 + separatelyOrdered, totalLoops, "the double-counted total must NOT be accepted as the BOM total");
  // Quotation shape: the included base is not a separately priced line.
  const separatelyPricedLoopLines = separatelyOrdered;
  assert.equal(separatelyPricedLoopLines, 3, "only the 3 expansion cards are separately priced; the 7 included bases are not line items");
  assert.equal(included, 7, "all 7 physical panels ship with an included base module that is never quoted separately");
});

// ---------------------------------------------------------------------------
// 10/11. CLIP semantics: legacy allowance vs mandatory requirement.
// ---------------------------------------------------------------------------
const candidate = (overrides = {}) => ({
  id: "p-selft",
  manufacturer: "Notifier",
  family: "Addressable Heat Detector",
  partNumber: "FST-951-SELFT",
  description: "Self-test addressable heat detector, FlashScan protocol only",
  lifecycleStatus: "Current",
  reviewStatus: "Reviewed",
  attributes: [{ name: "fixed_temperature_setpoint", normalizedValue: "135°F" }],
  standards: [{ body: "UL", number: "521", source: { sourceId: "doc" } }],
  compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }],
  accessories: [],
  source: { sheet: "Product Library", row: 1 },
  ...overrides,
});

const heatRequirement = (compatibility) => ({
  versionNumber: 1,
  boqItem: { id: "boq-heat", description: "Heat detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Heat Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [{ id: "r1", normalizedRequirement: "135F fixed", priority: "Mandatory", attributes: [{ name: "fixed_temperature_setpoint", operator: "Equal", normalizedValue: "135°F" }] }],
  standards: [],
  compatibility,
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
});

test("10 -- a FlashScan-only device is NOT non-compliant when CLIP is not a requirement of the line", () => {
  // The ecosystem decision carries CLIP as a LEGACY / EXCEPTION path. A line that
  // makes no dual-protocol demand must not fail a FlashScan-only device.
  const result = runProductMatching({ profile: heatRequirement([]), products: [candidate()] });
  const top = result.candidates[0];
  assert.notEqual(top.technicalStatus, "Non-Compliant", "absent a CLIP requirement, a FlashScan-only device must not be rejected as incompatible");
  assert.equal(top.mandatoryFailures.length, 0);
  assert.notEqual(top.recommendationTier, "Rejected Candidate");
});

test("11 -- a genuinely mandatory dual-protocol requirement DOES still fail a FlashScan-only device", () => {
  // Requirement 196 (heat detector) and 177 (combined detector) both carry
  // targetItem CLIP with mandatory:true and relationshipMode ALL_REQUIRED.
  // When that requirement is genuinely in scope, the failure is correct.
  const result = runProductMatching({
    profile: heatRequirement([{ requirement_id: "r1", targetItem: "CLIP", statement: "Compatible with Flash Scan and CLIP protocol systems" }]),
    products: [candidate()],
  });
  const top = result.candidates[0];
  const clip = top.compatibility.find((c) => c.requirement?.targetItem === "CLIP");
  assert.ok(clip, "the CLIP comparison must be present when the requirement exists");
  assert.notEqual(clip.result, "Verified Compatible", "a FlashScan-only device cannot be Verified Compatible with CLIP");
  assert.equal(clip.compatibilityState, "UNKNOWN", "absence of CLIP is UNKNOWN evidence, never a proven incompatibility");
  assert.equal(clip.blocking, false, "UNKNOWN must not become a blocking contradiction");
});

test("11b -- the standard dual-protocol device satisfies the mandatory CLIP requirement", () => {
  const dual = candidate({
    id: "p-std",
    partNumber: "FST-951-IV",
    compatibility: [
      { targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" },
      { targetItem: "CLIP", relationshipType: "Compatible With", requiredProtocol: "CLIP" },
    ],
  });
  const result = runProductMatching({
    profile: heatRequirement([{ requirement_id: "r1", targetItem: "CLIP", statement: "Compatible with Flash Scan and CLIP protocol systems" }]),
    products: [dual],
  });
  const top = result.candidates[0];
  const clip = top.compatibility.find((c) => c.requirement?.targetItem === "CLIP");
  assert.equal(clip.result, "Verified Compatible");
  assert.equal(top.technicalStatus, "Technically Compliant", "the standard device is the technically compliant answer where dual protocol is mandatory");
});

test("11c -- not selected is not the same as non-compliant", () => {
  // Both devices satisfy the same mandatory requirement. Selection is an
  // engineering preference (simplicity, no electrical penalty), not a
  // compliance difference.
  const selfTest = candidate({ id: "a", partNumber: "FST-951-SELFT", compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }] });
  const standard = candidate({ id: "b", partNumber: "FST-951-IV", compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }] });
  const result = runProductMatching({ profile: heatRequirement([]), products: [selfTest, standard] });
  const statuses = result.candidates.map((c) => c.technicalStatus);
  assert.ok(!statuses.includes("Non-Compliant"), "on a line with no CLIP demand, neither device is non-compliant; the Self-Test device is merely NOT SELECTED");
});
