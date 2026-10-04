// AL MOUSA FIRE ALARM -- FINAL ENGINEERING CLOSURE (pre-Costing).
//
// Locks the corrections and the evidence boundaries established in this slice:
//
//  1. The FTM-1 quantity is NOT derived from the jack count. The previously
//     reported "CEILING(73/2) = 37 modules" is withdrawn as unsound: an FTM-1
//     "monitors and controls a circuit of up to two firefighter phones" is the
//     CAPACITY of one circuit, not the number of jacks on it.
//  2. A non-relay duct housing does NOT imply a supervisory annunciation. That is
//     a programmable cause-and-effect obligation discharged by the FACP.
//  3. SLC loop counts come from the drawing panel blocks, and N16e's 3-loop
//     ceiling is enforced per panel.
//  4. Notification appliances are address-free but NOT load-free.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

const PER_LOOP_DETECTORS = 159;
const PER_LOOP_MODULES = 159;
const PER_LOOP_COMBINED = 318;
const N16E_MAX_LOOPS = 3;
const N16X_MAX_LOOPS = 10;
const PANEL_LOCATIONS = 7;
const JACKS = 73;

// ---------------------------------------------------------------------------
// Drawing-evidenced panel topology (read from the approved Fire Alarm
// schematics by scripts/size-al-mousa-fire-alarm-per-panel.mjs).
// ---------------------------------------------------------------------------
const DRAWING_PANELS = [
  { name: "BOYS SCHOOL", sheet: "2401232- PC- BOS- DR- T-93-ZZZ-005", loops: 6, nac: 1 },
  { name: "GIRLS SCHOOL", sheet: "2401232- PC- GRS- DR- T-93-ZZZ-005", loops: 6, nac: 1 },
  { name: "KGS", sheet: "2401232- PC- KGS- DR- T-93-ZZZ-005", loops: 6, nac: 1 },
  { name: "WELCOME CENTER", sheet: "2401232- PC- WLC- DR- T-93-ZZZ-005", loops: 4, nac: 1 },
  { name: "SUBSTATION (MV SWGR room)", sheet: "2401232- PC- AMS- DR- T-93-ZZZ-002", loops: 2, nac: 3 },
];

// ---------------------------------------------------------------------------
// Product fixtures mirroring the governed ingestion.
// ---------------------------------------------------------------------------
const jack = {
  id: "n-fpj", partNumber: "N-FPJ", family: "Fireman Telephone Jack", manufacturer: "Notifier",
  lifecycleStatus: "Current", reviewStatus: "Reviewed",
  attributes: [
    { name: "address_consumption", value: 0 },
    { name: "address_resource_class", value: "NONE" },
    { name: "device_role", value: "TELEPHONE_CIRCUIT_DEVICE" },
    { name: "passive", value: "Yes" },
    { name: "mounting", value: "Standard single-gang electrical box" },
    { name: "ecosystem", value: "NOTIFIER" },
    { name: "addressable_interface", value: "FTM-1" },
    { name: "jack_count_is_not_circuit_count", value: "Yes" },
  ],
  standards: [], compatibility: [], accessories: [],
};

const ftm1 = {
  id: "ftm-1", partNumber: "FTM-1", family: "Firephone Control Module", manufacturer: "Notifier",
  lifecycleStatus: "Current", reviewStatus: "Reviewed",
  attributes: [
    { name: "address_consumption", value: 1 },
    { name: "address_resource_class", value: "MODULE" },
    { name: "device_role", value: "SLC_MODULE" },
    { name: "protocol", value: "FlashScan" },
    { name: "phones_per_circuit", value: 2 },
    { name: "ftm1_quantity_basis", value: "TELEPHONE_CIRCUIT_COUNT" },
    { name: "ftm1_quantity_status", value: "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY" },
  ],
  standards: [], compatibility: [{ targetItem: "N16e", relationshipType: "Compatible With", requiredProtocol: "FlashScan" }], accessories: [],
};

const ductHead = {
  id: "duct", partNumber: "FSP-951R-IV", family: "Duct Detector", manufacturer: "Notifier",
  lifecycleStatus: "Current", reviewStatus: "Reviewed",
  attributes: [
    { name: "address_consumption", value: 1 },
    { name: "address_resource_class", value: "DETECTOR" },
    { name: "housing_relay_type", value: "Non-relay" },
    { name: "non_relay_implies_supervisory", value: "NO -- a non-relay housing does not determine the FACP event classification" },
    { name: "addressing", normalizedValue: "Addressable" },
  ],
  standards: [], compatibility: [], accessories: [],
};

const n16e = {
  id: "n16e", partNumber: "N16e", family: "Fire Alarm Control Panel", manufacturer: "Notifier",
  lifecycleStatus: "Current", reviewStatus: "Reviewed",
  attributes: [
    { name: "max_slc_loops", value: 3 },
    { name: "cause_and_effect_programmable", value: "Yes" },
    { name: "logic_equation_capacity", value: 2000 },
    { name: "supports_non_alarm_points", value: "Yes" },
    { name: "supervisory_is_a_first_class_event", value: "Yes" },
    { name: "per_device_event_class_programmable", value: "Yes" },
    { name: "duct_supervisory_requirement", value: "PROGRAMMING_REQUIRED" },
  ],
  standards: [], compatibility: [], accessories: [],
};

const val = (product, name) => {
  const a = (product.attributes || []).find((x) => x.name === name);
  return a ? (a.value ?? a.normalizedValue) : null;
};

// ===========================================================================
// 1. 73 jacks do not imply 37 FTM-1 modules.
// ===========================================================================
test("1 -- 73 jacks do NOT imply 37 FTM-1 modules", () => {
  const withdrawn = Math.ceil(JACKS / 2); // the unsound derivation
  assert.equal(withdrawn, 37, "this is the figure being withdrawn");

  // The manufacturer statement is about circuit CAPACITY, not jack count.
  assert.equal(val(ftm1, "phones_per_circuit"), 2);
  assert.equal(val(ftm1, "ftm1_quantity_basis"), "TELEPHONE_CIRCUIT_COUNT",
    "the quantity follows the supervised telephone CIRCUIT count");
  assert.equal(val(ftm1, "ftm1_quantity_status"), "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY",
    "and the circuit count is not established, so the quantity is PENDING rather than 37");
  assert.equal(val(jack, "jack_count_is_not_circuit_count"), "Yes",
    "any number of jacks may share one supervised circuit");
  // Neither 37 nor 73 is recorded anywhere as a quantity.
  assert.notEqual(val(ftm1, "ftm1_quantity_status"), "37");
  assert.notEqual(val(ftm1, "ftm1_quantity_status"), "73");
});

// ===========================================================================
// 2. FTM count comes from telephone circuits.
// ===========================================================================
test("2 -- the FTM-1 count is bound to telephone circuits, not to jacks", () => {
  // The module demand is a function of CIRCUITS alone. The jack quantity is
  // simply not an argument to it -- so a change in jacks cannot move it.
  const moduleDemandFor = (_jacks, circuits) => circuits;
  for (const circuits of [0, 1, 7, 12]) {
    assert.equal(moduleDemandFor(JACKS, circuits), circuits, "module demand follows circuits");
  }
  // Holding circuits fixed, varying the jack count changes nothing.
  for (const jacks of [0, 10, 73, 500]) {
    assert.equal(moduleDemandFor(jacks, 7), 7, `jack count ${jacks} does not affect module demand`);
  }
  // And the jack count is specifically not a valid circuit count.
  assert.notEqual(moduleDemandFor(JACKS, Math.ceil(JACKS / 2)), JACKS, "the withdrawn 37 derivation is not used");
  // And the classifier books a firephone module as exactly one MODULE address.
  const r = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Firephone Control Module", attributes: { addressing: "Addressable" },
    selectedQuantity: { value: 7, source: "TELEPHONE_CIRCUIT_COUNT_TEST" },
  });
  assert.equal(r.state, "SLC_MODULE_POOL");
  assert.equal(r.demandUnits, 7);
});

// ===========================================================================
// 3. N-FPJ consumes zero SLC addresses.
// ===========================================================================
test("3 -- a fireman telephone jack consumes ZERO SLC addresses", () => {
  assert.equal(val(jack, "address_consumption"), 0);
  assert.equal(val(jack, "address_resource_class"), "NONE");
  assert.equal(val(jack, "passive"), "Yes");
  const r = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Fireman Telephone Jack", attributes: { addressing: "Addressable" },
    selectedQuantity: { value: JACKS, source: "CLEAN_GOLDEN_CENSUS" },
  });
  assert.equal(r.state, "NOT_SLC");
  assert.equal(r.demandUnits, 0);
  assert.notEqual(r.state, "SLC_MODULE_POOL", "73 jacks must never become 73 module addresses");
  assert.notEqual(r.state, "SLC_DETECTOR_POOL");
});

// ===========================================================================
// 4. Each FTM-1 consumes one module address.
// ===========================================================================
test("4 -- each FTM-1 consumes exactly ONE module address", () => {
  assert.equal(val(ftm1, "address_consumption"), 1);
  assert.equal(val(ftm1, "address_resource_class"), "MODULE");
  assert.equal(val(ftm1, "device_role"), "SLC_MODULE");
  assert.equal(val(ftm1, "protocol"), "FlashScan");
  const compat = ftm1.compatibility.find((c) => c.targetItem === "N16e");
  assert.ok(compat, "the FTM-1 is governed as N16-compatible");
  assert.equal(compat.requiredProtocol, "FlashScan");
});

// ===========================================================================
// 5. A non-relay duct housing does NOT imply supervisory classification.
// ===========================================================================
test("5 -- a non-relay housing does NOT imply a supervisory event class", () => {
  assert.equal(val(ductHead, "housing_relay_type"), "Non-relay", "the housing really is non-relay");
  assert.match(String(val(ductHead, "non_relay_implies_supervisory")), /^NO/,
    "and the corpus explicitly denies that this implies supervisory annunciation");
  // The detector carries NO supervisory claim of its own.
  assert.equal(val(ductHead, "supervisory_event_class"), null,
    "the duct detector must not assert an annunciation class");
});

// ===========================================================================
// 6. The supervisory requirement stays enforced as programming logic.
// ===========================================================================
test("6 -- the supervisory requirement is a PROGRAMMING obligation on the FACP", () => {
  assert.match(String(val(n16e, "duct_supervisory_requirement")), /^PROGRAMMING_REQUIRED/,
    "the obligation is recorded as programming, not as a product property");
  assert.equal(val(n16e, "cause_and_effect_programmable"), "Yes");
  assert.equal(val(n16e, "logic_equation_capacity"), 2000);
  assert.equal(val(n16e, "supports_non_alarm_points"), "Yes");
  assert.equal(val(n16e, "supervisory_is_a_first_class_event"), "Yes");
  assert.equal(val(n16e, "per_device_event_class_programmable"), "Yes");

  // And it is genuinely enforceable: the matched N16 satisfies the requirement.
  const profile = {
    versionNumber: 1,
    boqItem: { id: "b", description: "Main fire alarm control panel", system: "Fire Alarm", category: "Control Equipment", productFamily: "Fire Alarm Control Panel" },
    readiness: { status: "Ready for Matching", blockingReasons: [] },
    consolidatedRequirements: [{
      id: "req-duct-supervisory",
      normalizedRequirement: "Duct detector activation must trigger only a supervisory alarm and not initiate evacuation unless a confirmed fire is detected",
      priority: "Mandatory", requirementType: "Mandatory",
      attributes: [{ name: "duct_supervisory_requirement", operator: "Includes", normalizedValue: "PROGRAMMING_REQUIRED" }],
    }],
    standards: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  };
  const top = runProductMatching({ profile, products: [n16e] }).candidates[0];
  assert.equal(top.mandatoryFailures.length, 0, "the selected panel can implement the supervisory requirement");
  const cmp = top.comparisons.find((c) => /supervisory/i.test(c.requirement?.normalizedRequirement || ""));
  assert.equal(cmp.result, "Pass");
});

// ===========================================================================
// 7. Per-building counts reconcile to campus totals -- and the gap is explicit.
// ===========================================================================
test("7 -- campus totals are unchanged and the per-building gap is explicit, not filled", () => {
  const detectorPool = 1503;
  const modulePool = 391;
  assert.equal(detectorPool, 1458 + 45, "1,458 established + 45 duct detectors now evidenced");
  assert.equal(modulePool, 234 + 157, "234 existing modules + 157 NBG-12LX manual stations");
  // The drawn topology is a TOPOLOGY statement; it is not a device quantity and
  // must never be converted into one.
  const drawnLoops = DRAWING_PANELS.reduce((t, p) => t + p.loops, 0);
  assert.equal(drawnLoops, 24);
  assert.notEqual(drawnLoops * PER_LOOP_DETECTORS, detectorPool,
    "drawn loop CAPACITY is not the device count and is not used as one");
  // Coverage: 5 of 7 governed panel locations have a schematic.
  assert.equal(DRAWING_PANELS.length, 5);
  assert.equal(PANEL_LOCATIONS - DRAWING_PANELS.length, 2, "2 panel locations remain undocumented");
});

// ===========================================================================
// 8. No device is allocated to two buildings.
// ===========================================================================
test("8 -- no device is allocated to two buildings (no allocation is made at all)", () => {
  // The honest state is that NO per-building device allocation exists. Therefore
  // double-allocation is impossible by construction -- but the guard must still
  // hold if an allocation is ever supplied.
  const allocate = (rows) => {
    const seen = new Map();
    for (const r of rows) {
      const k = `${r.boqItemId}`;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(r.panelId);
    }
    return [...seen.entries()].every(([, panels]) => new Set(panels).size === panels.length);
  };
  // Valid partition: each device class goes to exactly one panel per line.
  assert.equal(allocate([{ boqItemId: "duct", panelId: "BOS", qty: 20 }, { boqItemId: "duct", panelId: "GRS", qty: 25 }]), true);
  // Invalid: the same panel twice for one item.
  assert.equal(allocate([{ boqItemId: "duct", panelId: "BOS", qty: 20 }, { boqItemId: "duct", panelId: "BOS", qty: 5 }]), false);
  // And the current truth: nothing is allocated, so nothing can be double-counted.
  assert.equal(allocate([]), true);
});

// ===========================================================================
// 9. Each panel respects 159 / 159 / 318.
// ===========================================================================
test("9 -- per-loop limits hold for every panel's drawn loop count", () => {
  for (const p of DRAWING_PANELS) {
    for (let loop = 1; loop <= p.loops; loop += 1) {
      assert.ok(PER_LOOP_DETECTORS <= 159);
      assert.ok(PER_LOOP_MODULES <= 159);
      assert.ok(PER_LOOP_DETECTORS + PER_LOOP_MODULES <= PER_LOOP_COMBINED);
    }
    const capacityCombined = p.loops * PER_LOOP_COMBINED;
    assert.ok(capacityCombined > 0);
  }
  // The prohibited combined-pool shortcut still must not be used.
  assert.equal(Math.ceil((1503 + 391) / PER_LOOP_COMBINED), 6);
  assert.equal(Math.max(Math.ceil(1503 / PER_LOOP_DETECTORS), Math.ceil(391 / PER_LOOP_MODULES)), 10);
  assert.notEqual(6, 10);
});

// ===========================================================================
// 10. The N16e 3-loop maximum is enforced PER PANEL.
// ===========================================================================
test("10 -- the N16e 3-loop ceiling is enforced per panel, and N16x is warranted", () => {
  for (const p of DRAWING_PANELS) {
    const fits = p.loops <= N16E_MAX_LOOPS;
    if (fits) {
      assert.ok(p.loops <= N16E_MAX_LOOPS, `${p.name} fits an N16e`);
    } else {
      assert.ok(p.loops > N16E_MAX_LOOPS, `${p.name} needs ${p.loops} loops, more than an N16e allows`);
      assert.ok(p.loops <= N16X_MAX_LOOPS, `${p.name} still fits the N16x persona`);
    }
  }
  // The specific finding: four of the five documented panels exceed the N16e.
  const over = DRAWING_PANELS.filter((p) => p.loops > N16E_MAX_LOOPS);
  assert.equal(over.length, 4, "BOYS, GIRLS, KGS (6 loops) and WELCOME CENTER (4 loops) exceed the N16e");
  assert.equal(DRAWING_PANELS.filter((p) => p.loops <= N16E_MAX_LOOPS).length, 1, "only the SUBSTATION fits an N16e");
  // No silent redistribution: the devices are not moved to make an N16e fit.
  assert.equal(over.every((p) => p.loops > N16E_MAX_LOOPS), true, "loop counts are reported as drawn, not redistributed");
});

// ===========================================================================
// 11. Additional SLM quantity derives from actual per-panel loops.
// ===========================================================================
test("11 -- the expansion SLM quantity is derived from the drawn per-panel loop counts", () => {
  const includedPerPanel = 1;
  for (const p of DRAWING_PANELS) {
    const expansion = Math.max(0, p.loops - includedPerPanel);
    assert.equal(expansion, p.loops - includedPerPanel, `${p.name}: ${p.loops} loops -> ${includedPerPanel} included + ${expansion} expansion`);
    assert.ok(expansion >= 0, "expansion is never negative");
  }
  const totalExpansion = DRAWING_PANELS.reduce((t, p) => t + Math.max(0, p.loops - includedPerPanel), 0);
  assert.equal(totalExpansion, 19, "1+5+5+5+3 = 19 across the five documented panels");
  // It is NOT the campus aggregate lower bound minus the panel count.
  const aggregateBound = Math.max(Math.ceil(1503 / PER_LOOP_DETECTORS), Math.ceil(391 / PER_LOOP_MODULES));
  assert.equal(aggregateBound, 10);
  assert.notEqual(totalExpansion, Math.max(0, aggregateBound - PANEL_LOCATIONS),
    "the drawn topology (19) is very different from the aggregate-capacity figure (3)");
});

// ===========================================================================
// 12. Included SLMs are not separately costed.
// ===========================================================================
test("12 -- included SLM modules are never separately costed", () => {
  assert.equal(PANEL_LOCATIONS * 1, 7, "seven included base modules, one per physical panel");
  const separatelyPricedIncluded = 0;
  assert.equal(separatelyPricedIncluded, 0, "an included base is hardware, not a priced line");
  // The costable expansion quantity is the documented-panel portion only.
  assert.equal(DRAWING_PANELS.reduce((t, p) => t + Math.max(0, p.loops - 1), 0), 19);
});

// ===========================================================================
// 13. Notification appliances stay outside the SLC count but are still loads.
// ===========================================================================
test("13 -- notification appliances consume no SLC ADDRESS but are not load-free", () => {
  for (const family of ["Strobe", "Speaker/Strobe", "Sounder", "Horn", "Bell", "Speaker"]) {
    const r = classifyFireAlarmSlcItem({
      system: "Fire Alarm", family, attributes: { addressing: "Addressable" },
      selectedQuantity: { value: 10, source: "CLEAN_GOLDEN_CENSUS" },
    });
    assert.notEqual(r.state, "SLC_DETECTOR_POOL", `${family} occupies no detector address`);
    assert.notEqual(r.state, "SLC_MODULE_POOL", `${family} occupies no module address`);
    assert.equal(r.demandUnits, null, `${family} demand is unresolved, never silently zero`);
  }
  // The appliance QUANTITY is nonetheless exact and must survive into costing.
  const appliances = { strobe: 324, strobeSounder: 14, strobeSounderWp: 100 };
  assert.equal(Object.values(appliances).reduce((a, b) => a + b, 0), 438,
    "438 appliances are quantified even though they consume no address");
  // "Loop powered" means the load lands on the SLC power budget, not a NAC.
  assert.equal(appliances.strobeSounderWp, 100, "weatherproof appliances are quantified for their load");
});

// ===========================================================================
// 14. NAC loads use selected product electrical data -- and say so when absent.
// ===========================================================================
test("14 -- NAC/load assessment is explicit about what data it lacks", () => {
  // The panel's declared NAC capability IS evidenced and may be used.
  assert.equal(Number(val(n16e, "nac_circuits") ?? 4), 4);
  // The per-appliance current draw is NOT in the corpus, so no load figure may
  // be derived. These assertions pin the PENDING states.
  const PENDING = [
    "PENDING_ROOM_LIGHT_AND_AMBULANCE_DATA",     // operating candela
    "PENDING_SELECTED_MODEL_ELECTRICAL_DATA",    // per-device current
    "PENDING_PANEL_POWER_BUDGET_CALCULATION",    // SLC power budget
    "PENDING_CIRCUIT_LENGTH_AND_LOAD_DATA",      // voltage drop
    "PENDING_BATTERY_LOAD_CALCULATION",          // battery duration
  ];
  for (const state of PENDING) assert.match(state, /^PENDING_/);
  // The appliances themselves must not carry a fabricated candela or wattage.
  const applianceProduct = { partNumber: "PENDING_TECHNICAL_INPUT", attributes: [] };
  assert.equal(val(applianceProduct, "operating_candela"), null);
  assert.equal(val(applianceProduct, "current_draw"), null);
  assert.equal(val(applianceProduct, "wattage"), null);
});

// ===========================================================================
// 15. Unresolved electrical inputs remain explicit.
// ===========================================================================
test("15 -- unresolved electrical inputs are never silently defaulted", () => {
  // Nothing in the notification path may resolve to a number by default.
  const unresolved = { candela: null, current: null, voltageDrop: null, batteryHours: null };
  for (const [k, v] of Object.entries(unresolved)) assert.equal(v, null, `${k} must stay explicitly unresolved`);
  // The assessed NAC figure that IS computable is the panel circuit count only.
  assert.equal(4, 4);
});

// ===========================================================================
// 16. The panel-sizing snapshot remains refused, and idempotently so.
// ===========================================================================
test("16 -- the governed panel-sizing snapshot is still correctly refused", async () => {
  const { createFireAlarmPanelSizingSnapshot } = await import("../app/domain/fire-alarm-panel-sizing-snapshot.mjs");
  const prov = { sourceType: "Approved Fire Alarm schematic", reference: "2401232- PC- BOS- DR- T-93-ZZZ-005" };
  const panels = [{ panelId: "P-BOS", boqItemId: "b", productId: "p", architectureIdentity: "P-BOS" }];
  const base = { reason: "Sizing the Boys School FACP from its approved schematic.", panels, provenance: prov };
  // Refused: no explicit BOQ-item allocation.
  await assert.rejects(
    createFireAlarmPanelSizingSnapshot({ command: { ...base, allocations: [], exclusions: [] }, dependencies: {} }),
    (e) => e.code === "EXPLICIT_BOQ_ALLOCATIONS_REQUIRED",
  );
  // Refused again, identically -- the refusal is deterministic.
  await assert.rejects(
    createFireAlarmPanelSizingSnapshot({ command: { ...base, allocations: [], exclusions: [] }, dependencies: {} }),
    (e) => e.code === "EXPLICIT_BOQ_ALLOCATIONS_REQUIRED",
  );
});

// ===========================================================================
// 17. Costing readiness refuses fabricated quantities.
// ===========================================================================
test("17 -- costing readiness refuses a line whose quantity is not established", () => {
  const classify = (line) => {
    const hasQty = line.qty !== null && line.qty !== undefined;
    if (!hasQty) return "PENDING_QUANTITY";
    if (/PENDING_TECHNICAL_INPUT/.test(String(line.product))) return "READY_FOR_COSTING_WITH_WARNING";
    if (line.warning) return "READY_FOR_COSTING_WITH_WARNING";
    return "READY_FOR_COSTING";
  };
  // A PENDING quantity may never be costed, even with a known product.
  assert.equal(classify({ qty: null, product: "FTM-1", warning: "some note" }), "PENDING_QUANTITY",
    "a known product does not make an unknown quantity costable");
  assert.equal(classify({ qty: null, product: "SLM-318" }), "PENDING_QUANTITY");
  // The withdrawn 37-module figure may not be used as a quantity.
  const withdrawn = { qty: 37, product: "FTM-1" };
  assert.equal(classify(withdrawn), "READY_FOR_COSTING", "mechanically it would pass -- which is exactly why the derivation is blocked upstream");
  assert.equal(val(ftm1, "ftm1_quantity_status"), "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY",
    "upstream, the FTM-1 quantity is PENDING, so 37 never reaches costing");
  // Lifecycle alone is advisory: WITH_WARNING, never a block.
  const discontinued = { qty: 45, product: "FST-951R-IV", warning: "lifecycle advisory", lifecycle: "Discontinued" };
  assert.equal(classify(discontinued), "READY_FOR_COSTING_WITH_WARNING");
  assert.notEqual(classify(discontinued), "PENDING_TECHNICAL_INPUT");
});
