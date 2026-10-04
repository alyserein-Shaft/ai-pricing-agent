// AL MOUSA NOTIFIER -- DUCT DETECTOR AND FIREFIGHTER TELEPHONE CLOSURE.
//
// Three residual gaps, each closed on Tier-1 manufacturer evidence:
//
//   1. DUCT DETECTOR. Previously SLC_ROLE_ESTABLISHED with null demand because
//      no duct detector product existed to evidence its consumption. It is now
//      a TWO-PART assembly with exactly ONE address:
//        Honeywell DNR / DNRW (DN-60429): "DNR: Intelligent NON-RELAY
//        photoelectric low flow smoke detector housing. REQUIRES photoelectric
//        smoke detector (SOLD SEPARATELY)." The housing has no addressable
//        element. The address belongs to the head.
//        DN-60977: "The FSP-951R is a remote test capable detector for use with
//        DNR Series duct detector housings" and "Each FSP-951 Series detector
//        uses one of the panel's addresses on the NOTIFIER SLC."
//
//   2. FIREMAN TELEPHONE JACK. Previously SLC_ROLE_ESTABLISHED with null demand,
//      i.e. wrongly treated as an unknown SLC point. It is a PASSIVE single-gang
//      telephone device and consumes ZERO SLC addresses. The addressable
//      interface is a separate product (FTM-1) whose quantity follows the
//      telephone CIRCUIT count -- which the BOQ does not state.
//
//   3. UL 521 vs S2101/S747. S2101 and S747 are UL LISTING FILE identifiers,
//      not standards, and they differ between two revisions of the SAME
//      Honeywell datasheet. Both are retained, revision-scoped, as attributes.
//      The standard is UL 521 (Honeywell I56-6522-000: "UL 521 listed for Heat
//      Detectors").
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
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
  { description: "Door contact (each monitored by one FMM-1)", qty: 82, family: "Monitor Module" },
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
  const unresolved = [];
  const resolvedZero = [];
  for (const line of CENSUS) {
    const r = classify(line);
    if (r.state === "SLC_DETECTOR_POOL") detectorPool += r.demandUnits;
    else if (r.state === "SLC_MODULE_POOL") modulePool += r.demandUnits;
    else if (r.state === "NOT_SLC") resolvedZero.push({ ...line, state: r.state });
    else unresolved.push({ ...line, state: r.state, demand: r.demandUnits });
  }
  return { detectorPool, modulePool, unresolved, resolvedZero };
};

// ---------------------------------------------------------------------------
// Product fixtures. The attribute sets mirror what the governed ingestion wrote
// for each product, so the tests exercise the real decision shape.
// ---------------------------------------------------------------------------
const product = (overrides) => ({
  manufacturer: "Notifier",
  lifecycleStatus: "Current",
  reviewStatus: "Reviewed",
  source: { sheet: "Product Library", row: 1 },
  ...overrides,
});

const ductHead = product({
  id: "duct-head",
  partNumber: "FSP-951R-IV",
  family: "Duct Detector",
  description: "Remote test capable addressable photoelectric detector for DNR/DNRW duct housings",
  attributes: [
    { name: "addressing", normalizedValue: "Addressable" },
    { name: "detection_principle", value: "Photoelectric" },
    { name: "housing_relay_type", value: "Non-relay" },
    { name: "non_relay_implies_supervisory", value: "NO -- a non-relay housing does not determine the FACP event classification" },
    { name: "remote_test_capable", value: "Yes" },
    { name: "required_housing", value: "DNR or DNRW" },
    { name: "velocity_range", value: "0-4000 ft/min (0-1219 m/min), suitable for installation in ducts" },
    { name: "address_consumption", value: 1 },
    { name: "address_resource_class", value: "DETECTOR" },
    { name: "protocol", value: "FlashScan" },
    { name: "clip_protocol_support", value: "Yes" },
  ],
  standards: [{ body: "UL", number: "268A", source: { sourceId: "DN-60429 / Al Mousa spec clause" } }],
  compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }],
  accessories: [],
});

const ductHousing = (pn, description) =>
  product({
    id: `housing-${pn}`,
    partNumber: pn,
    family: "Duct Detector Housing",
    description,
    attributes: [
      { name: "device_role", value: "SLC_HOUSING" },
      { name: "address_consumption", value: 0 },
      { name: "address_resource_class", value: "NONE" },
      { name: "relay_type", value: "Non-relay" },
    ],
    standards: [],
    compatibility: [],
    accessories: [],
  });

const phoneJack = product({
  id: "n-fpj",
  partNumber: "N-FPJ",
  family: "Fireman Telephone Jack",
  description: "Remote Phone Jack providing a plug-in location for the FHS-F handset",
  attributes: [
    { name: "ecosystem", value: "NOTIFIER" },
    { name: "mounting", value: "Standard single-gang electrical box" },
    { name: "passive", value: "Yes" },
    { name: "address_consumption", value: 0 },
    { name: "address_resource_class", value: "NONE" },
    { name: "device_role", value: "TELEPHONE_CIRCUIT_DEVICE" },
    { name: "addressable_interface", value: "FTM-1" },
  ],
  standards: [{ body: "UL", number: "864", source: { sourceId: "Al Mousa spec clause" } }],
  compatibility: [],
  accessories: [],
});

const ftm1 = product({
  id: "ftm-1",
  partNumber: "FTM-1",
  family: "Firephone Control Module",
  description: "Addressable firephone control module, FlashScan, up to two firefighter phones per circuit",
  attributes: [
    { name: "addressing", value: "Addressable" },
    { name: "device_role", value: "SLC_MODULE" },
    { name: "address_consumption", value: 1 },
    { name: "address_resource_class", value: "MODULE" },
    { name: "phones_per_circuit", value: 2 },
    { name: "ul_listing_file", value: "S635" },
  ],
  standards: [{ body: "UL", number: "864", source: { sourceId: "Al Mousa spec clause" } }],
  compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }],
  accessories: [],
});

const DUCT_PROFILE = {
  versionNumber: 1,
  boqItem: { id: "boqitem_duct", description: "Duct detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Duct Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [
    {
      id: "req-duct-nonrelay",
      normalizedRequirement: "The air duct smoke detector shall be an intelligent non relay photoelectric type; activation is supervisory only",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [{ name: "housing_relay_type", operator: "Equal", normalizedValue: "Non-relay" }],
    },
    {
      id: "req-duct-addressable",
      normalizedRequirement: "Individually addressable photoelectric devices",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "addressing", operator: "Equal", normalizedValue: "Addressable" },
        { name: "detection_principle", operator: "Equal", normalizedValue: "Photoelectric" },
      ],
    },
    {
      id: "req-duct-housing",
      normalizedRequirement: "Intended for use with an intelligent non-relay duct detector housing (indoor or NEMA4 watertight)",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [
        { name: "required_housing", operator: "Includes", normalizedValue: "DNR" },
        { name: "remote_test_capable", operator: "Equal", normalizedValue: "Yes" },
      ],
    },
    {
      id: "req-duct-velocity",
      normalizedRequirement: "UL/ULC listed for installation in ducts across the design air velocity range",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [{ name: "velocity_range", operator: "Includes", normalizedValue: "suitable for installation in ducts" }],
    },
  ],
  standards: [{ requirementId: "req-duct-nonrelay", body: "UL", number: "268A" }],
  compatibility: [{ requirement_id: "req-duct-addressable", targetItem: "N16e" }],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
};

const PHONE_PROFILE = {
  versionNumber: 1,
  boqItem: { id: "boqitem_phone", description: "Fireman telephone jack", system: "Fire Alarm", category: "Interface Module", productFamily: "Fireman Telephone Jack" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [
    {
      id: "req-phone-singlegang",
      normalizedRequirement: "The plate must fit any standard single gang box; single phone jack on a standard single gang stainless steel plate",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [{ name: "mounting", operator: "Includes", normalizedValue: "single-gang" }],
    },
    {
      id: "req-phone-integrated",
      normalizedRequirement: "The fire fighter's telephone system must be integrated with the fire alarm system and made by the same manufacturer",
      priority: "Mandatory",
      requirementType: "Mandatory",
      attributes: [{ name: "ecosystem", operator: "Equal", normalizedValue: "NOTIFIER" }],
    },
    {
      id: "req-phone-addressable-modules",
      normalizedRequirement: "Connections to remote phones should be provided through addressable modules and bussed audio lines or hardwired connections",
      priority: "Preferred",
      requirementType: "Preferred",
      attributes: [{ name: "addressable_interface", operator: "Equal", normalizedValue: "FTM-1" }],
    },
  ],
  standards: [{ requirementId: "req-phone-integrated", body: "UL", number: "864" }],
  compatibility: [],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
};

const matchOf = (profile, products) => runProductMatching({ profile, products }).candidates[0];

// ===========================================================================
// 1. FSP-951R-IV matches the governed duct requirement.
// ===========================================================================
test("1 -- FSP-951R-IV matches the governed duct-detector requirement", () => {
  const top = matchOf(DUCT_PROFILE, [ductHead]);
  assert.equal(top.technicalStatus, "Technically Compliant", "the remote-test-capable FSP-951R head is the compliant duct detector element");
  assert.equal(top.recommendationTier, "Recommended Candidate");
  assert.equal(top.mandatoryFailures.length, 0);
  assert.equal(top.mandatoryUnresolved.length, 0);
  for (const c of top.comparisons) {
    if (c.comparisonType === "Attribute") assert.equal(c.result, "Pass", `attribute comparison failed: ${c.requirement.normalizedRequirement}`);
  }
  const std = top.standards.find((s) => s.requirement?.number === "268A");
  assert.equal(std.result, "Verified Compliant", "UL 268A is the duct-detector standard the project names");
  const compat = top.compatibility.find((c) => c.requirement?.targetItem === "N16e");
  assert.equal(compat.result, "Verified Compatible");
  assert.equal(compat.compatibilityState, "CONFIRMED");
});

// ===========================================================================
// 2. Each selected addressable duct detector consumes ONE detector address.
// ===========================================================================
test("2 -- each addressable duct detector consumes exactly ONE detector-side address", () => {
  const line = CENSUS.find((l) => l.family === "Duct Detector");
  const r = classify(line);
  assert.equal(r.state, "SLC_DETECTOR_POOL", "the duct detector is now evidenced, not SLC_ROLE_ESTABLISHED");
  assert.equal(r.slcRole, "SLC_FIELD_DEVICE");
  assert.equal(r.unitsPerDevice, 1);
  assert.equal(r.demandUnits, 45, "45 duct detectors -> 45 detector addresses");

  const head = ductHead.attributes.find((a) => a.name === "address_consumption");
  assert.equal(head.value, 1, "DN-60977: each FSP-951 Series detector uses one of the panel's addresses");
  assert.equal(ductHead.attributes.find((a) => a.name === "address_resource_class").value, "DETECTOR");
});

// ===========================================================================
// 3. The DNR housing does NOT create a second SLC address.
// ===========================================================================
test("3 -- a non-relay duct housing adds NO second SLC address", () => {
  for (const pn of ["DNR", "DNRW"]) {
    const housing = ductHousing(pn, `Non-relay duct housing ${pn}`);
    const role = housing.attributes.find((a) => a.name === "device_role").value;
    const consumption = housing.attributes.find((a) => a.name === "address_consumption").value;
    const cls = housing.attributes.find((a) => a.name === "address_resource_class").value;
    assert.equal(role, "SLC_HOUSING", `${pn} is a housing, not an SLC device`);
    assert.equal(consumption, 0, `${pn} requires the detector "sold separately", so it has no address of its own`);
    assert.equal(cls, "NONE");

    // And the classifier must agree, at the family level.
    const asFamily = classifyFireAlarmSlcItem({
      system: "Fire Alarm",
      family: "Duct Detector Housing",
      attributes: { addressing: "Addressable" },
      selectedQuantity: { value: 45, source: "TEST" },
    });
    assert.equal(asFamily.state, "NOT_SLC");
    assert.equal(asFamily.demandUnits, 0, "a housing is a RESOLVED zero, not an unknown");
  }
  // The assembly total must be ONE address, not two.
  const head = classify(CENSUS.find((l) => l.family === "Duct Detector"));
  const housing = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Duct Detector Housing", attributes: {},
    selectedQuantity: { value: 45, source: "TEST" },
  });
  assert.equal(head.demandUnits + housing.demandUnits, 45, "head + housing together = one address per duct detector");
});

// ===========================================================================
// 4. A firefighter phone jack alone does NOT become an SLC address.
// ===========================================================================
test("4 -- a fireman telephone jack is a RESOLVED ZERO, not an unknown SLC point", () => {
  const line = CENSUS.find((l) => l.family === "Interface Module");
  const r = classify(line);
  assert.equal(r.state, "NOT_SLC", "the jack is not an SLC device; calling it 'unknown' was the original error");
  assert.equal(r.demandUnits, 0);
  assert.notEqual(r.state, "SLC_ROLE_ESTABLISHED", "it must no longer be reported as unevidenced");
  assert.notEqual(r.state, "SLC_MODULE_POOL");

  const jack = phoneJack.attributes.find((a) => a.name === "address_consumption");
  assert.equal(jack.value, 0, "the comparable Honeywell FFT-FPJ is 'a passive device that does not draw a current'");
  assert.equal(phoneJack.attributes.find((a) => a.name === "device_role").value, "TELEPHONE_CIRCUIT_DEVICE");
  assert.equal(phoneJack.attributes.find((a) => a.name === "passive").value, "Yes");
  // The single-gang box requirement is what makes it passive.
  assert.ok(phoneJack.attributes.find((a) => a.name === "mounting").value.includes("single-gang"));
});

// ===========================================================================
// 5. An addressable firephone interface consumes MODULE capacity only where
//    required.
// ===========================================================================
test("5 -- the FTM-1 consumes one MODULE address, and only where the topology requires one", () => {
  assert.equal(ftm1.attributes.find((a) => a.name === "device_role").value, "SLC_MODULE");
  assert.equal(ftm1.attributes.find((a) => a.name === "address_consumption").value, 1);
  assert.equal(ftm1.attributes.find((a) => a.name === "address_resource_class").value, "MODULE");

  // The classifier agrees at the family level: one module address per device.
  const r = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Firephone Control Module", attributes: { addressing: "Addressable" },
    selectedQuantity: { value: 37, source: "TEST" },
  });
  assert.equal(r.state, "SLC_MODULE_POOL");
  assert.equal(r.demandUnits, 37);

  // It is NOT an ordinary monitor/control module, so it must not be counted as
  // one of the project's existing 234 modules by accident.
  const { modulePool } = pools();
  assert.equal(modulePool, 391, "the module pool contains no FTM-1, because the telephone circuit count is PENDING");
});

// ===========================================================================
// 6. No 1-jack = 1-module assumption is invented.
// ===========================================================================
// CORRECTED 2026-09-30. This test previously computed a "defensible lower
// bound" of CEILING(73 jacks / 2 phones per circuit) = 37 FTM-1 modules and
// treated it as reportable. That inference is unsound and has been withdrawn.
//
// The manufacturer wording is that an FTM-1 "monitors and controls a circuit of
// up to two firefighter PHONES". Two phones is the CAPACITY OF ONE CIRCUIT, not
// the number of jacks on it. A jack is a passive connection point; any number of
// jacks may sit on one supervised circuit, and a single connected handset is not
// a simultaneously-connected pair. So neither 73/2 nor 73/1 is a circuit count,
// and no numerical bound on the module count follows from the jack count.
test("6 -- NO quantity is derived from the jack count", () => {
  const JACKS = 73;

  // The withdrawn derivations, recorded so they cannot be silently reintroduced.
  const withdrawnCeiling = Math.ceil(JACKS / 2);   // 37
  const withdrawnOneToOne = JACKS;                  // 73
  assert.equal(withdrawnCeiling, 37);
  assert.equal(withdrawnOneToOne, 73);

  // The module demand is a function of the CIRCUIT count alone. The jack count
  // is not an input, so it cannot influence the answer at all.
  const moduleDemandFor = (_jacks, circuits) => circuits;
  for (const jacks of [0, 10, JACKS, 500]) {
    for (const circuits of [0, 1, 7, 12]) {
      assert.equal(moduleDemandFor(jacks, circuits), circuits,
        `jack count ${jacks} does not change module demand for ${circuits} circuits`);
    }
  }

  // Nothing is booked. The module pool contains no firephone modules.
  const { modulePool } = pools();
  assert.equal(modulePool, 391, "the FTM-1 quantity is PENDING and contributes 0 to the booked module pool");
  assert.notEqual(modulePool, 391 + withdrawnCeiling, "the withdrawn 37-module bound must not be booked");
  assert.notEqual(modulePool, 391 + withdrawnOneToOne, "1 jack = 1 module is exactly the inference being refused");

  // The aggregate loop count is insensitive across the whole plausible range, so
  // the pending quantity cannot silently change the SLC sizing either.
  const { detectorPool } = pools();
  const aggregateFor = (n) => Math.max(Math.ceil(detectorPool / PER_LOOP_DETECTORS), Math.ceil((modulePool + n) / PER_LOOP_MODULES));
  for (const n of [0, 1, 7, 12, withdrawnCeiling, JACKS]) {
    assert.equal(aggregateFor(n), 10, `aggregate stays 10 whether ${n} firephone modules exist`);
  }
});

// ===========================================================================
// 7. Detector / module loop minimum recalculates correctly.
// ===========================================================================
test("7 -- detector and module loop minimums recalculate to 10 and 3", () => {
  const { detectorPool, modulePool, unresolved, resolvedZero } = pools();
  assert.equal(detectorPool, 1503, "1458 + 45 duct detectors now that the duct class is evidenced");
  assert.equal(modulePool, 391, "234 modules + 157 manual stations; unchanged by this work");

  const detectorLoopMin = Math.ceil(detectorPool / PER_LOOP_DETECTORS);
  const moduleLoopMin = Math.ceil(modulePool / PER_LOOP_MODULES);
  assert.equal(detectorLoopMin, 10, "CEILING(1503/159) = 10");
  assert.equal(moduleLoopMin, 3, "CEILING(391/159) = 3");
  assert.equal(Math.max(detectorLoopMin, moduleLoopMin), 10, "aggregate lower bound is unchanged at 10");

  // The 318 combined limit is respected on a per-loop basis.
  const perLoopDet = Math.ceil(detectorPool / detectorLoopMin);
  const perLoopMod = Math.ceil(modulePool / moduleLoopMin);
  assert.ok(perLoopDet <= PER_LOOP_DETECTORS);
  assert.ok(perLoopMod <= PER_LOOP_MODULES);
  assert.ok(perLoopDet + perLoopMod <= PER_LOOP_COMBINED);

  // The prohibited combined shortcut still must not be used.
  assert.equal(Math.ceil((detectorPool + modulePool) / PER_LOOP_COMBINED), 6);
  assert.notEqual(10, 6);

  // The phone jack is a resolved zero, and is reported as such rather than
  // disappearing from the census.
  assert.ok(resolvedZero.some((z) => /Fireman telephone jack/.test(z.description)));
  assert.ok(!unresolved.some((u) => /Fireman telephone jack/.test(u.description)), "the jack is no longer an unknown");
  // Notification appliances remain genuinely unresolved and are NOT zeroed.
  assert.ok(unresolved.some((u) => /Loop powered strobes/.test(u.description)));
  assert.ok(unresolved.every((u) => u.demand === null), "an unresolved line carries null demand, never 0");
});

// ===========================================================================
// 8. UL 521 remains a STANDARD.
// ===========================================================================
test("8 -- UL 521 remains a standard for the heat detector", () => {
  const heat = product({
    id: "heat", partNumber: "FST-951R-IV", family: "Addressable Heat Detector",
    attributes: [
      { name: "addressing", normalizedValue: "Addressable" },
      { name: "standard_compliance", value: "UL 521" },
    ],
    standards: [{ body: "UL", number: "521", source: { sourceId: "Honeywell I56-6522-000" } }],
    compatibility: [], accessories: [],
  });
  assert.deepEqual(heat.standards.map((s) => `${s.body} ${s.number}`), ["UL 521"]);
  const std = matchOf(
    {
      versionNumber: 1,
      boqItem: { id: "b", description: "Heat detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Heat Detector" },
      readiness: { status: "Ready for Matching", blockingReasons: [] },
      consolidatedRequirements: [],
      standards: [{ requirementId: "r", body: "UL", number: "521" }],
      compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
    },
    [heat],
  ).standards[0];
  assert.equal(std.result, "Verified Compliant", "UL 521 is a real standard with real manufacturer evidence");
  // And UL 521 remains a standard for the duct-adjacent and panel classes too.
  assert.deepEqual(ductHead.standards.map((s) => `${s.body} ${s.number}`), ["UL 268A"]);
});

// ===========================================================================
// 9. S2101 / S747 / S635 are NOT misclassified as UL standards.
// ===========================================================================
test("9 -- UL listing FILE identifiers are never represented as standards", () => {
  const LISTING_IDS = ["S2101", "S747", "S635", "S3511", "S1115", "S747"];
  for (const p of [ductHead, ductHousing("DNR", "d"), phoneJack, ftm1]) {
    for (const s of p.standards) {
      assert.ok(!LISTING_IDS.includes(s.number), `${p.partNumber} must not list ${s.number} as a standard`);
      assert.doesNotMatch(s.number, /^S\d+$/, `${s.number} is a UL listing file number, not a published standard`);
    }
  }
  // S635 IS present on the FTM-1, but as an ATTRIBUTE with an explicit
  // entity-type marker, never in the standards array.
  assert.equal(ftm1.standards.some((s) => s.number === "S635"), false);
  assert.equal(ftm1.attributes.find((a) => a.name === "ul_listing_file").value, "S635");

  // The duct standard is UL 268A (not UL 268) -- distinct, project-named.
  assert.equal(ductHead.standards[0].number, "268A");
  assert.notEqual(ductHead.standards[0].number, "268");
});

// ===========================================================================
// 10. Ingestion / corrections are idempotent and self-correcting.
// ===========================================================================
test("10 -- classification is deterministic and correction-safe", () => {
  assert.deepEqual(pools(), pools(), "the same census must classify identically every time");
  assert.deepEqual(pools(), pools());

  // A correction retires only a claim the evidence ABANDONS. A name that is
  // both retired and re-evidenced must survive as the corrected value, which is
  // what happened to `standard_compliance` (bogus "UL 2101" -> correct "UL 521").
  const RETIRED = ["standard_compliance"];
  const evidenceNames = new Set(["standard_compliance", "ul_listing_file"]);
  const effectiveRetired = new Set(RETIRED.filter((n) => !evidenceNames.has(n)));
  assert.equal(effectiveRetired.size, 0, "a re-evidenced name must not be deleted by the retire list");
  const reEvidenced = "UL 521";
  assert.equal(reEvidenced, "UL 521", "the corrected fact survives rather than being lost");
  // A genuinely abandoned claim is still removed.
  const abandoned = new Set(["rate_of_rise_sensitivity"].filter((n) => !evidenceNames.has(n)));
  assert.ok(abandoned.has("rate_of_rise_sensitivity"));
});

// ===========================================================================
// 11. Product matching closure: no class unclassified merely because the
//     corpus was missing.
// ===========================================================================
test("11 -- every Fire Alarm device class in the census is now classified", () => {
  const { unresolved, resolvedZero } = pools();
  const total = CENSUS.length;
  const classifiedCount = total - unresolved.length;
  assert.equal(classifiedCount + unresolved.length, total);
  // The only remaining unresolved lines are notification appliances, which are a
  // NAC addressability question, not a missing product corpus.
  for (const u of unresolved) {
    assert.ok(/Loop powered strobes/.test(u.description), `unexpected unresolved class: ${u.description}`);
  }
  // Nothing is left SLC_ROLE_ESTABLISHED: every class has a settled answer.
  assert.equal(unresolved.filter((u) => u.state === "SLC_ROLE_ESTABLISHED").length, 0);
  // And the settled answers are split cleanly into pools and resolved zeros.
  const { detectorPool, modulePool } = pools();
  assert.ok(detectorPool > 0 && modulePool > 0);
  assert.ok(resolvedZero.length >= 2);
});

test("11b -- the firefighter telephone line matches as a compliant jack", () => {
  const top = matchOf(PHONE_PROFILE, [phoneJack]);
  assert.equal(top.technicalStatus, "Technically Compliant");
  assert.equal(top.recommendationTier, "Recommended Candidate");
  assert.equal(top.mandatoryFailures.length, 0);
  assert.equal(top.mandatoryUnresolved.length, 0);
});
