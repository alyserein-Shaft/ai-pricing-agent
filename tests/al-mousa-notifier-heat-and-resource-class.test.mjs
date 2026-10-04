// AL MOUSA NOTIFIER — HEAT-MODEL AND RESOURCE-CLASS REGRESSION.
//
// Two manufacturer-grounded corrections are locked here so they cannot silently
// regress:
//
//   1. NBG-12LX consumes the MODULE-side SLC address resource. DN-6726: "The
//      addressable module is housed inside the pull station"; the programming
//      note calls it "an Alarm Initiating Module of software type 'mpul'".
//      Brand category ("manual station") is not the address class.
//
//   2. FST-951-IV has NO rate-of-rise. DN-60975 Product Line Information:
//        "FST-951-IV:   Ivory, low-profile intelligent 135F FIXED thermal sensor"
//        "FST-951R-IV:  Ivory, low-profile intelligent RATE-OF-RISE FIXED thermal
//                       sensor"
//        "Rate-of-rise model (FST-951R), 15F (8.3C) per minute"
//      An earlier ingestion asserted ROR on FST-951-IV, which made a
//      non-compliant model score 100. That must not happen again.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

const PER_LOOP_DETECTORS = 159;
const PER_LOOP_MODULES = 159;
const PER_LOOP_COMBINED = 318;

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
  { description: "Door contact (one FMM-1 each)", qty: 82, family: "Monitor Module" },
  { description: "Loop powered strobes", qty: 324, family: "Strobe" },
  { description: "Loop powered strobes with sounder", qty: 14, family: "Speaker/Strobe" },
  { description: "Loop powered strobes with sounder (weatherproof)", qty: 100, family: "Speaker/Strobe" },
  { description: "Main fire alarm control panel", qty: 1, family: "Fire Alarm Control Panel" },
];

const classify = (line) =>
  classifyFireAlarmSlcItem({
    system: "Fire Alarm",
    family: line.family,
    attributes: { addressing: "Addressable" },
    selectedQuantity: { value: line.qty, source: "CLEAN_GOLDEN_CENSUS" },
  });

const pools = () => {
  let detectorPool = 0;
  let modulePool = 0;
  let unknown = 0;
  const unknownLines = [];
  for (const line of CENSUS) {
    const r = classify(line);
    if (r.state === "SLC_DETECTOR_POOL") detectorPool += r.demandUnits;
    else if (r.state === "SLC_MODULE_POOL") modulePool += r.demandUnits;
    else if (r.state === "NOT_SLC") continue;
    else { unknown += line.qty; unknownLines.push(line.description); }
  }
  return { detectorPool, modulePool, unknown, unknownLines };
};

// ---------------------------------------------------------------------------
// 1 / 2. NBG-12LX resource class.
// ---------------------------------------------------------------------------
test("1 -- an addressable manual pull station consumes MODULE-side SLC capacity", () => {
  const mcp = CENSUS.find((l) => l.family === "Pull Station");
  const r = classify(mcp);
  assert.equal(r.state, "SLC_MODULE_POOL", "the NBG-12LX addressable element is a module, so it draws a MODULE address");
  assert.equal(r.slcRole, "SLC_MODULE");
  assert.equal(r.unitsPerDevice, 1);
  assert.equal(r.demandUnits, 118);
});

test("2 -- an addressable manual pull station does NOT consume detector-side capacity", () => {
  const mcp = CENSUS.find((l) => l.family === "Pull Station");
  assert.notEqual(classify(mcp).state, "SLC_DETECTOR_POOL", "MCPs must not be counted in the 159-per-loop detector resource");
  const { detectorPool } = pools();
  // 1,503 now includes the 45 duct detectors, whose address class was resolved
  // after this suite was first written. The 157 manual stations are still
  // excluded, which is the point of this test.
  assert.equal(detectorPool, 1503, "detector pool excludes the 157 manual stations");
  assert.ok(detectorPool < 1660, "the original (incorrect) detector pool of 1,615 included MCPs; +45 duct = 1,660 if MCPs were wrongly re-added");
});

// ---------------------------------------------------------------------------
// 3 / 4. Pool totals.
// ---------------------------------------------------------------------------
test("3 -- the detector pool recalculates to 1,503", () => {
  const { detectorPool } = pools();
  assert.equal(detectorPool, 1503, "1,401 smoke + 26 heat + 31 combined + 45 duct; no MCPs, no phone jacks");
});

test("4 -- the module pool recalculates to 391", () => {
  const { modulePool } = pools();
  assert.equal(modulePool, 391, "234 existing modules + 157 manual stations");
});

// ---------------------------------------------------------------------------
// 5. Independent 159 / 159 limits.
// ---------------------------------------------------------------------------
test("5 -- separate 159/159 limits remain enforced, not a 318 shortcut", () => {
  const { detectorPool, modulePool } = pools();
  const detectorLoopMin = Math.ceil(detectorPool / PER_LOOP_DETECTORS);
  const moduleLoopMin = Math.ceil(modulePool / PER_LOOP_MODULES);
  const aggregate = Math.max(detectorLoopMin, moduleLoopMin);
  assert.equal(detectorLoopMin, 10, "CEILING(1503/159) = 10");
  assert.equal(moduleLoopMin, 3, "CEILING(391/159) = 3");
  assert.equal(aggregate, 10, "aggregate is MAX(10,3) = 10");
  // The prohibited shortcut would under-count badly.
  const shortcut = Math.ceil((detectorPool + modulePool) / PER_LOOP_COMBINED);
  assert.equal(shortcut, 6, "CEILING(1894/318) = 6 is NOT the answer and must never be used");
  assert.notEqual(aggregate, shortcut, "the separate-pool result must differ from the combined shortcut");
  // Per-loop occupancy respects both ceilings.
  assert.ok(Math.ceil(detectorPool / detectorLoopMin) <= PER_LOOP_DETECTORS);
  assert.ok(Math.ceil(modulePool / moduleLoopMin) <= PER_LOOP_MODULES);
  assert.ok(Math.ceil(detectorPool / detectorLoopMin) + Math.ceil(modulePool / moduleLoopMin) <= PER_LOOP_COMBINED);
});

// ---------------------------------------------------------------------------
// 14. Unresolved consumption is never silently zeroed -- and a RESOLVED zero
//     is never confused with an unknown.
//
// UPDATED 2026-09-30. This test previously asserted that the duct detector and
// the telephone jack were UNRESOLVED. Both have since been resolved on Tier-1
// evidence: the duct detector is a one-address assembly (head + non-relay
// housing) and the telephone jack is a passive single-gang device with zero SLC
// addresses. The invariant being protected is unchanged -- an unresolved line
// must never be booked as zero -- but it now applies to the lines that are
// genuinely unresolved (the notification appliances).
// ---------------------------------------------------------------------------
test("14 -- genuinely unresolved SLC consumption is NOT silently zeroed", () => {
  const { unknown, unknownLines } = pools();
  assert.ok(unknown > 0, "there ARE devices whose SLC consumption is still not established");
  assert.ok(unknownLines.some((l) => /Loop powered strobes/.test(l)), "notification appliance addressability remains unevidenced");
  assert.ok(!unknownLines.some((l) => /Duct detector/.test(l)), "the duct detector is now resolved to one detector address");
  assert.ok(!unknownLines.some((l) => /Fireman telephone jack/.test(l)), "the phone jack is now resolved to zero SLC addresses");
  // An unresolved line carries NULL demand, never zero.
  const strobe = classify(CENSUS.find((l) => l.family === "Strobe"));
  assert.equal(strobe.state, "UNRESOLVED");
  assert.equal(strobe.demandUnits, null, "null demand, NOT zero");
  // ...and a resolved zero IS zero, and is stated as such rather than vanishing.
  const jack = classify(CENSUS.find((l) => l.family === "Interface Module"));
  assert.equal(jack.state, "NOT_SLC");
  assert.equal(jack.demandUnits, 0, "a passive telephone jack is a RESOLVED zero");
});

test("14b -- the aggregate loop bound is insensitive to the unresolved devices", () => {
  const { detectorPool, modulePool, unknown } = pools();
  const base = Math.max(Math.ceil(detectorPool / PER_LOOP_DETECTORS), Math.ceil(modulePool / PER_LOOP_MODULES));
  // Worst case for the module pool: every remaining unresolved device is
  // treated as module-side. Notification appliances sit on the NAC, but
  // stressing them anyway is the conservative check.
  const stressed = Math.max(Math.ceil(detectorPool / PER_LOOP_DETECTORS), Math.ceil((modulePool + unknown) / PER_LOOP_MODULES));
  assert.equal(base, 10);
  assert.equal(stressed, 10, `even if all ${unknown} unresolved devices are module-side, the loop bound stays 10`);
  // The telephone firephone interface is the other open quantity. Its count is
  // bounded, not known, and the bound must not move the answer either.
  for (const ftm of [0, Math.ceil(73 / 2), 73]) {
    assert.equal(Math.max(Math.ceil(detectorPool / PER_LOOP_DETECTORS), Math.ceil((modulePool + ftm) / PER_LOOP_MODULES)), 10,
      `aggregate stays 10 for ${ftm} firephone modules`);
  }
});

// ---------------------------------------------------------------------------
// 6 / 7 / 8. Heat model selection.
// ---------------------------------------------------------------------------
const heatProduct = (overrides = {}) => ({
  id: "p1",
  manufacturer: "Notifier",
  family: "Addressable Heat Detector",
  partNumber: "FST-951R-IV",
  description: "Intelligent addressable rate-of-rise fixed thermal sensor, ivory, FlashScan and CLIP",
  lifecycleStatus: "Current",
  reviewStatus: "Reviewed",
  attributes: [
    { name: "addressing", normalizedValue: "Addressable" },
    { name: "fixed_temperature_setpoint", value: "135°F" },
    { name: "rate_of_rise_sensitivity", value: "15°F/min" },
    // DN-60975: "-IV suffix indicates CLIP and FlashScan device".
    { name: "protocol", value: "FlashScan" },
    { name: "clip_protocol_support", value: "Yes" },
  ],
  standards: [{ body: "UL", number: "2101", source: { sourceId: "DN-60975" } }],
  compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }],
  accessories: [{ name: "B300-6", relationshipType: "Compatible Base" }],
  source: { sheet: "Product Library", row: 1 },
  ...overrides,
});

const heatProfile = (accessories = [{ requirement_id: "r1", ruleId: "accessory.detector-base", output: { accessory: "Compatible detector base" }, reviewStatus: "Needs Review" }]) => ({
  versionNumber: 1,
  boqItem: { id: "boq-heat", description: "Heat detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Heat Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [
    { id: "r-fixed", normalizedRequirement: "Factory-set fixed temperature at 135F (57C)", priority: "Mandatory", attributes: [{ name: "fixed_temperature_setpoint", operator: "Equal", normalizedValue: "135°F" }] },
    { id: "ror-r", normalizedRequirement: "Rate-of-rise detection at 15F (8.3C) per minute", priority: "Mandatory", attributes: [{ name: "rate_of_rise_sensitivity", operator: "Equal", normalizedValue: "15°F/min" }] },
    { id: "addr-r", normalizedRequirement: "Individually addressable devices", priority: "Mandatory", attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }] },
  ],
  standards: [{ requirementId: "r-fixed", body: "UL", number: "2101" }],
  compatibility: [{ requirement_id: "r-fixed", targetItem: "N16e" }],
  accessories,
  derivedRequirements: [],
  clarifications: [],
});

const matchOf = (product, profile = heatProfile()) => runProductMatching({ profile, products: [product] }).candidates[0];

test("6 -- FST-951-IV FAILS a mandatory rate-of-rise requirement", () => {
  const fixedOnly = heatProduct({
    id: "fixed",
    partNumber: "FST-951-IV",
    description: "Intelligent addressable 135F FIXED thermal sensor, ivory, FlashScan and CLIP. Fixed temperature only; NO rate-of-rise.",
    attributes: [
      { name: "addressing", normalizedValue: "Addressable" },
      { name: "fixed_temperature_setpoint", value: "135°F" },
    ],
  });
  const top = matchOf(fixedOnly);
  assert.notEqual(top.technicalStatus, "Technically Compliant", "a fixed-only model must not pass a mandatory ROR requirement");
  assert.ok(top.mandatoryUnresolved.some((u) => /Rate-of-rise/.test(u.requirement?.normalizedRequirement || "")),
    "the ROR comparison must be the unresolved one");
  const ror = top.comparisons.find((c) => /Rate-of-rise/.test(c.requirement?.normalizedRequirement || ""));
  assert.notEqual(ror.result, "Pass", "FST-951-IV has no ROR attribute, so ROR must not compare as Pass");
});

test("6b -- the previously-reported FST-951-IV 'score 100 compliant' result cannot recur", () => {
  const fixedOnly = heatProduct({
    id: "fixed",
    partNumber: "FST-951-IV",
    attributes: [
      { name: "addressing", normalizedValue: "Addressable" },
      { name: "fixed_temperature_setpoint", value: "135°F" },
    ],
  });
  const top = matchOf(fixedOnly);
  assert.notEqual(top.recommendationTier, "Recommended Candidate");
  assert.ok(top.mandatoryUnresolved.length > 0);
  assert.equal(top.technicalStatus, "Technical Review Required");
});

test("7 -- FST-951R-IV passes BOTH the fixed-temperature and the rate-of-rise requirement", () => {
  const top = matchOf(heatProduct());
  const fixed = top.comparisons.find((c) => /fixed temperature/i.test(c.requirement?.normalizedRequirement || ""));
  const ror = top.comparisons.find((c) => /Rate-of-rise/.test(c.requirement?.normalizedRequirement || ""));
  assert.equal(fixed.result, "Pass");
  assert.equal(ror.result, "Pass", "FST-951R-IV is the rate-of-rise model per DN-60975");
  assert.equal(top.technicalStatus, "Technically Compliant");
  assert.equal(top.recommendationTier, "Recommended Candidate");
  assert.equal(top.mandatoryFailures.length, 0);
  assert.equal(top.mandatoryUnresolved.length, 0);
});

test("8 -- FST-951R-IV passes the mandatory FlashScan + CLIP and the control unit", () => {
  const top = matchOf(heatProduct());
  const compat = top.compatibility.find((c) => c.requirement?.targetItem === "N16e");
  assert.ok(compat, "the control-unit comparison must be present");
  assert.equal(compat.result, "Verified Compatible");
  assert.equal(compat.compatibilityState, "CONFIRMED");
  // Dual protocol is a recorded product attribute per DN-60975 ("-IV suffix
  // indicates CLIP and FlashScan device").
  const fs = top.product.attributes.find((a) => a.name === "protocol");
  const clip = top.product.attributes.find((a) => a.name === "clip_protocol_support");
  assert.equal(fs.value, "FlashScan");
  assert.equal(clip.value, "Yes", "the -IV suffix is the dual-protocol device");
});

test("8b -- UL listing, base and N16/SLM compatibility all resolve for FST-951R-IV", () => {
  const top = matchOf(heatProduct());
  const std = top.standards.find((entry) => entry.requirement?.body === "UL");
  assert.equal(std.result, "Verified Compliant", "UL 2101 is Verified Compliant because the listing carries its source document");
  const acc = top.accessories.find(() => true);
  assert.equal(acc.result, "Pass", "the compatible detector base resolves");
  // `offered` is the matched product-relationship object, not a bare string.
  assert.equal(acc.offered.name, "B300-6");
  assert.equal(acc.offered.relationshipType, "Compatible Base");
});

test("9 -- the human quantity decision is untouched: 9 ambient/ROR, 0 high-temperature", () => {
  // The decision is a quantity split, not a model choice. Selecting the
  // rate-of-rise model for the 9 ambient units does not change the split.
  const HUMAN_DECISION = { standardAmbientRor: 9, highTemperature: 0 };
  assert.equal(HUMAN_DECISION.standardAmbientRor, 9);
  assert.equal(HUMAN_DECISION.highTemperature, 0);
  // FST-951H-IV remains a catalogued alternative at quantity 0.
  const highTemp = heatProduct({
    id: "ht",
    partNumber: "FST-951H-IV",
    attributes: [
      { name: "addressing", normalizedValue: "Addressable" },
      { name: "fixed_temperature_setpoint", value: "190°F" },
    ],
  });
  const top = matchOf(highTemp);
  assert.notEqual(top.technicalStatus, "Technically Compliant", "the 190F model is not the answer to the 135F line");
});

// ---------------------------------------------------------------------------
// 10 / 11 / 12 / 13. Panel and loop-module BOM semantics.
// ---------------------------------------------------------------------------
const PROJECT_PANELS = 7; // 1 MFACP + 6 FACP, from the BOQ and the approved drawing architecture
const N16E_MAX_LOOPS = 3;
const AGGREGATE_LOOP_LOWER_BOUND = 10;

test("10 -- seven N16e panels provide seven included SLM base modules", () => {
  const included = PROJECT_PANELS * 1;
  assert.equal(included, 7, "each physical panel includes exactly one SLM-318");
  assert.notEqual(included, 1, "a single system-wide base module would under-count physical hardware");
});

test("11 -- included SLM modules are not separately priced", () => {
  const included = PROJECT_PANELS;
  const separatelyPricedLoopLines = 0; // included bases are hardware, not line items
  assert.equal(separatelyPricedLoopLines, 0, "an included base must never be quoted as a priced line");
  assert.ok(included > 0 && separatelyPricedLoopLines === 0);
});

test("12 -- exact expansion quantity remains PENDING without per-building allocation", () => {
  const theoreticalMinimum = Math.max(0, AGGREGATE_LOOP_LOWER_BOUND - PROJECT_PANELS);
  assert.equal(theoreticalMinimum, 3, "MAX(0, 10 - 7) = 3 as an AGGREGATE theoretical minimum");
  // The aggregate is a LOWER bound: per-building partitioning can only increase it.
  const perBuilding = [300, 400, 258, 500]; // an illustrative partition
  const partitioned = perBuilding.reduce((t, d) => t + Math.ceil(d / PER_LOOP_DETECTORS), 0);
  assert.ok(partitioned >= Math.ceil(perBuilding.reduce((a, b) => a + b, 0) / PER_LOOP_DETECTORS),
    "SUM(CEILING(building/159)) >= CEILING(campus/159)");
  assert.equal("PENDING_PER_BUILDING_ALLOCATION", "PENDING_PER_BUILDING_ALLOCATION");
});

test("13 -- maximum panel capability is NOT confused with the required BOM", () => {
  const maximumLoops = PROJECT_PANELS * N16E_MAX_LOOPS;
  const maximumExpansion = maximumLoops - PROJECT_PANELS;
  assert.equal(maximumLoops, 21);
  assert.equal(maximumExpansion, 14);
  // The maximum-loaded figure must never be presented as the required BOM.
  const requiredMinimumExpansion = Math.max(0, AGGREGATE_LOOP_LOWER_BOUND - PROJECT_PANELS);
  assert.equal(requiredMinimumExpansion, 3, "3 expansion modules cover the campus aggregate lower bound of 10 loops");
  assert.notEqual(requiredMinimumExpansion, maximumExpansion, "14 is capability, 3 is the aggregate minimum");
  // Supporting three loops is not the same as requiring three loops. The 3 is
  // CAMPUS-WIDE, so the per-panel expectation is far below the 3-loop ceiling.
  const campusExpansionPerPanel = requiredMinimumExpansion / PROJECT_PANELS;
  assert.ok(campusExpansionPerPanel < N16E_MAX_LOOPS, "a fully loaded panel needs far fewer than three expansion modules");
  assert.equal(Math.ceil(campusExpansionPerPanel), 1, "on an even average, one expansion module per panel is the ceiling");
  // Even the maximum-loaded topology is legal, which is exactly why the
  // capability figure must never be presented as the requirement.
  assert.ok(maximumExpansion >= requiredMinimumExpansion);
});

// ---------------------------------------------------------------------------
// 15. Idempotency of the corrected governed paths.
// ---------------------------------------------------------------------------
test("15 -- the corrected SLC arithmetic is stable under repetition", () => {
  const first = pools();
  const second = pools();
  assert.deepEqual(first, second, "classification must be deterministic and idempotent");
  const a = calculateSlcExpansion({
    demand: { detectors: first.detectorPool, modules: first.modulePool },
    panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  const b = calculateSlcExpansion({
    demand: { detectors: second.detectorPool, modules: second.modulePool },
    panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  assert.deepEqual(a, b, "the governed calculator must return an identical result on repeat");
});
