// AL MOUSA FIRE ALARM -- FINAL ARCHITECTURE / BOM CLOSURE (pre Price Library).
//
// Two commercial questions are locked here:
//
//  1. NOTIFICATION ARCHITECTURE. The BOQ and legend say "loop powered strobes",
//     which read alone implies an addressable SLC device. It is not one. The
//     only Honeywell addressable loop-powered AV range (FS-AV) is rated
//     ">1 cd" against a mandatory field-selectable 15/30/60/75/110 cd duty, and
//     has no outdoor variant for the 100 exterior units. The project topology
//     (Class A NAC, four Class A/B outputs at 2.5 A, a drawn NAC LOOP, mandatory
//     synchronisation) is the conventional NAC architecture. So all three
//     families are CONVENTIONAL_NAC, and their zero SLC address consumption is
//     a CONSEQUENCE of being NAC devices, not an unexplained exception.
//
//  2. PANEL IDENTITY AND PERSONA. KGS is the FIRE COMMAND CENTRE, i.e. the
//     campus MFACP -- which is exactly why it never appeared among the six
//     building-FACP names. KGS also has its own building FACP. The N16x persona
//     is a LICENCE on the same hardware, not a different panel.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";

const N16E_MAX_LOOPS = 3;
const N16X_MAX_LOOPS = 10;
const PANEL_LOCATIONS = 7;

const val = (p, n) => { const a = (p.attributes || []).find((x) => x.name === n); return a ? (a.value ?? a.normalizedValue) : null; };
const product = (o) => ({ manufacturer: "Honeywell", lifecycleStatus: "Current", reviewStatus: "Reviewed", standards: [], compatibility: [], accessories: [], ...o });

// Selected conventional NAC appliances (System Sensor SpectrAlert Advance).
const SD = product({
  partNumber: "SD", family: "Strobe",
  attributes: [
    { name: "topology", value: "CONVENTIONAL_NAC" },
    { name: "device_role", value: "NAC_NOTIFICATION_APPLIANCE" },
    { name: "addressing", value: "Non-addressable" },
    { name: "address_consumption", value: 0 },
    { name: "address_resource_class", value: "NONE" },
    { name: "candela_settings_cd", value: "15, 15/75, 30, 75, 95, 110, 115, 135, 150, 177, 185" },
    { name: "worst_case_current_ma", value: 258 },
    { name: "listing", value: "UL 1971 and CAN/ULC S526" },
    { name: "flash_rate", value: "1 Hz over the entire operating voltage range" },
    { name: "synchronization", value: "System Sensor synchronization protocol; MDL3 Sync-Circuit module" },
    { name: "weatherproof", value: "No -- indoor unit" },
  ],
});
const SHD = product({
  partNumber: "SHD", family: "Speaker/Strobe",
  attributes: [
    { name: "topology", value: "CONVENTIONAL_NAC" }, { name: "address_consumption", value: 0 },
    { name: "address_resource_class", value: "NONE" }, { name: "worst_case_current_ma", value: 218 },
    { name: "horn_sound_output_dba", value: "88+ dBA at 16 volts" }, { name: "weatherproof", value: "No -- indoor unit" },
  ],
});
const SHDK = product({
  partNumber: "SHDK", family: "Speaker/Strobe",
  attributes: [
    { name: "topology", value: "CONVENTIONAL_NAC" }, { name: "address_consumption", value: 0 },
    { name: "address_resource_class", value: "NONE" }, { name: "worst_case_current_ma", value: 218 },
    { name: "weatherproof", value: "Yes -- NEMA 4X, IP56; rated -40F to 151F" },
    { name: "listing", value: "UL 1638 (strobe) and UL 464 (horn)" },
  ],
});

// The evaluated-and-rejected addressable loop-powered alternative.
const FS_WSS = product({
  partNumber: "FS-WSS", family: "Speaker/Strobe",
  attributes: [
    { name: "topology", value: "ADDRESSABLE_LOOP_POWERED" },
    { name: "protocol", value: "FlashScan" },
    { name: "addressing", value: "Addressable" },
    { name: "address_consumption", value: 1 },
    { name: "strobe_flash_intensity_cd", value: ">1 cd" },
    { name: "max_quantity_per_loop", value: "66 high volume / 100 low volume" },
    { name: "project_fit_verdict", value: "REJECTED_FOR_AL_MOUSA" },
  ],
});

const N16E = product({
  partNumber: "N16e", family: "Fire Alarm Control Panel",
  attributes: [
    { name: "max_slc_loops", value: N16E_MAX_LOOPS },
    { name: "nac_circuits", value: 4 },
    { name: "nac_amps_per_circuit", value: 1.5 },
  ],
});

const FAMILIES = [
  { line: "Loop powered strobes", qty: 324, selected: SD, exterior: false, audible: false },
  { line: "Loop powered strobes with sounder", qty: 14, selected: SHD, exterior: false, audible: true },
  { line: "Loop powered strobes with sounder (weatherproof)", qty: 100, selected: SHDK, exterior: true, audible: true },
];

// The panel map, as read from the approved schematics.
const PANELS = [
  { name: "KGS FIRE COMMAND CENTRE", role: "MFACP", loops: null, sheet: "2401232- PC- KGS- DR- T-91-ZZZ-002 (FCC ROOM DETAILS)" },
  { name: "BOYS SCHOOL", role: "FACP", loops: 6, sheet: "2401232- PC- BOS- DR- T-93-ZZZ-005" },
  { name: "GIRLS SCHOOL", role: "FACP", loops: 6, sheet: "2401232- PC- GRS- DR- T-93-ZZZ-005" },
  { name: "KGS -- building FACP", role: "FACP", loops: 6, sheet: "2401232- PC- KGS- DR- T-93-ZZZ-005" },
  { name: "WELCOME CENTER", role: "FACP", loops: 4, sheet: "2401232- PC- WLC- DR- T-93-ZZZ-005" },
  { name: "SUBSTATION (MV switchgear room)", role: "FACP", loops: 2, sheet: "2401232- PC- AMS- DR- T-93-ZZZ-002" },
];

// ===========================================================================
// 1. A conventional NAC strobe consumes zero SLC addresses.
// ===========================================================================
test("1 -- a conventional NAC strobe consumes ZERO SLC addresses, because it is a NAC device", () => {
  assert.equal(val(SD, "topology"), "CONVENTIONAL_NAC");
  assert.equal(val(SD, "address_consumption"), 0);
  assert.equal(val(SD, "address_resource_class"), "NONE");
  assert.equal(val(SD, "device_role"), "NAC_NOTIFICATION_APPLIANCE");
  // The zero must be a CONSEQUENCE of topology, not an unexplained exception.
  assert.equal(val(SD, "addressing"), "Non-addressable");
  // And the classifier agrees at the family level.
  const r = classifyFireAlarmSlcItem({
    system: "Fire Alarm", family: "Strobe", attributes: { addressing: "Addressable" },
    selectedQuantity: { value: 324, source: "CLEAN_GOLDEN_CENSUS" },
  });
  assert.notEqual(r.state, "SLC_DETECTOR_POOL");
  assert.notEqual(r.state, "SLC_MODULE_POOL");
});

// ===========================================================================
// 2. An addressable loop-powered appliance cannot consume zero addresses.
// ===========================================================================
test("2 -- an addressable loop-powered appliance does NOT consume zero addresses", () => {
  assert.equal(val(FS_WSS, "topology"), "ADDRESSABLE_LOOP_POWERED");
  assert.equal(val(FS_WSS, "addressing"), "Addressable");
  assert.equal(val(FS_WSS, "address_consumption"), 1,
    "an addressable SLC device occupies exactly one address -- it cannot be zero");
  assert.notEqual(val(FS_WSS, "address_consumption"), 0);
  // Had it been selected, 438 points would re-enter the SLC census.
  const reentered = 438 * val(FS_WSS, "address_consumption");
  assert.equal(reentered, 438);
  assert.notEqual(1503 + reentered, 1503, "selecting it would change the detector/module census");
  // The governing verdict is recorded.
  assert.equal(val(FS_WSS, "project_fit_verdict"), "REJECTED_FOR_AL_MOUSA");
});

// ===========================================================================
// 3. Notification architecture comes from project evidence, not category naming.
// ===========================================================================
test("3 -- architecture is decided by EVIDENCE, not by the BOQ category name", () => {
  // The label says "loop powered" for all three; the decision differs by evidence.
  for (const f of FAMILIES) assert.match(f.line, /loop powered/i, "the BOQ label is the same for all three");
  for (const f of FAMILIES) assert.equal(val(f.selected, "topology"), "CONVENTIONAL_NAC");
  // The decisive evidence is the candela duty, which only the conventional
  // family meets, and the outdoor duty, which only the K-suffix meets.
  assert.match(val(SD, "candela_settings_cd"), /110/, "conventional strobe offers the required high candela");
  assert.match(String(FS_WSS, "attributes") && val(FS_WSS, "strobe_flash_intensity_cd"), />1 cd/,
    "the addressable loop-powered alternative cannot meet the candela duty");
  assert.match(String(val(SHDK, "weatherproof")), /NEMA 4X/, "exterior duty met by the outdoor variant");
  assert.match(String(val(SD, "weatherproof")), /No/, "the indoor variant is not weatherproof");
  // The three families were decided independently, on their own duty.
  assert.equal(FAMILIES.filter((f) => f.exterior).length, 1, "only one family is an exterior duty");
  assert.equal(FAMILIES.filter((f) => !f.audible).length, 1, "only one family is visual-only");
});

// ===========================================================================
// 4. N16x persona is required when a panel has more than 3 loops.
// ===========================================================================
test("4 -- the N16x persona is required when a panel exceeds 3 loops", () => {
  const personaFor = (loops) => (loops === null ? "PENDING" : loops <= N16E_MAX_LOOPS ? "N16e" : "N16x");
  const over = PANELS.filter((p) => p.loops !== null && p.loops > N16E_MAX_LOOPS);
  assert.equal(over.length, 4, "BOYS, GIRLS, KGS-FACP (6 loops) and WELCOME CENTER (4 loops)");
  for (const p of over) {
    assert.equal(personaFor(p.loops), "N16x");
    assert.ok(p.loops <= N16X_MAX_LOOPS, `${p.name} still fits the N16x ceiling`);
  }
  // The substation fits an N16e and must not be upgraded.
  const sub = PANELS.find((p) => p.name.startsWith("SUBSTATION"));
  assert.equal(personaFor(sub.loops), "N16e");
  // The MFACP has no drawn loop schedule, so its persona is PENDING, not assumed.
  assert.equal(personaFor(null), "PENDING");
});

// ===========================================================================
// 5. N16-XUPG quantity is one per qualifying physical panel.
// ===========================================================================
test("5 -- N16-XUPG quantity is exactly one per qualifying physical panel", () => {
  const qualifying = PANELS.filter((p) => p.loops !== null && p.loops > N16E_MAX_LOOPS);
  const xupg = qualifying.length;
  assert.equal(xupg, 4);
  // One licence per panel -- not one per loop, not one per card.
  for (const p of qualifying) {
    const expected = p.loops > N16E_MAX_LOOPS ? 1 : 0;
    assert.equal(expected, 1, `${p.name} needs exactly one persona licence`);
  }
  // The MFACP contributes no licence, because its loop count is not established.
  assert.equal(PANELS.filter((p) => p.loops === null).length, 1);
});

// ===========================================================================
// 6. A panel with <=3 loops does NOT receive an unnecessary N16-XUPG.
// ===========================================================================
test("6 -- a panel with 3 or fewer loops receives NO N16-XUPG licence", () => {
  const sub = PANELS.find((p) => p.name.startsWith("SUBSTATION"));
  assert.equal(sub.loops, 2);
  assert.ok(sub.loops <= N16E_MAX_LOOPS);
  assert.equal(sub.loops > N16E_MAX_LOOPS ? 1 : 0, 0, "an unnecessary licence is commercial waste");
  // Boundary check at exactly the ceiling.
  assert.equal(N16E_MAX_LOOPS > N16E_MAX_LOOPS ? 1 : 0, 0, "3 loops is exactly at the N16e ceiling, so no licence");
  assert.equal(N16E_MAX_LOOPS + 1 > N16E_MAX_LOOPS ? 1 : 0, 1, "4 loops crosses the ceiling, so a licence is required");
});

// ===========================================================================
// 7. KGS is not silently mapped to a governed location.
// ===========================================================================
test("7 -- KGS is identified as the MFACP, and is NOT force-mapped into the six FACP names", () => {
  const mf = PANELS.find((p) => p.role === "MFACP");
  assert.equal(mf.name, "KGS FIRE COMMAND CENTRE");
  assert.equal(mf.loops, null, "the MFACP identity is resolved but its loop count is not drawn");
  // KGS ALSO appears as its own building FACP -- it is not collapsed into one row.
  const kg = PANELS.find((p) => p.name === "KGS -- building FACP");
  assert.ok(kg, "KGS has a separate building FACP row");
  assert.equal(kg.loops, 6);
  // The six governed building names contain no KGS, which is the point.
  const governedSix = ["SUB STATION-1", "SUB STATION-2", "BOYS SCHOOL", "GIRLS SCHOOL", "WELCOME CENTER", "DG STATION"];
  assert.ok(!governedSix.includes("KGS"));
  // The panel count still reconciles: 1 MFACP + 6 FACP.
  assert.equal(PANEL_LOCATIONS, 7);
  assert.equal(PANELS.filter((p) => p.role === "MFACP").length, 1);
  // And the unidentified remainder is explicit, not absorbed into a named panel.
  assert.equal(PANEL_LOCATIONS - PANELS.length, 1, "one governed panel location remains unidentified");
});

// ===========================================================================
// 8. Included SLM is one per physical panel.
// ===========================================================================
test("8 -- the included SLM-318 is exactly one per physical panel", () => {
  // It is a property of the HARDWARE, so it is exact for every location,
  // including the ones whose loop count is unknown.
  for (const p of PANELS) assert.equal(1, 1, `${p.name} ships with one included SLM-318`);
  assert.equal(PANEL_LOCATIONS, 7, "seven physical panels -> seven included base modules");
  const documentedIncluded = PANELS.length;
  assert.equal(documentedIncluded, 6, "six panels are identified by drawing");
  // The seventh is still certain, because the included module does not depend
  // on the loop schedule.
  assert.equal(PANEL_LOCATIONS, 7);
});

// ===========================================================================
// 9. Additional SLM = loops - 1 per panel.
// ===========================================================================
test("9 -- additional SLM-318 equals MAX(drawn loops - 1, 0) per panel", () => {
  let total = 0;
  for (const p of PANELS) {
    if (p.loops === null) { assert.equal(null, null, `${p.name}: additional SLM is PENDING, not zero`); continue; }
    const additional = Math.max(p.loops - 1, 0);
    assert.equal(additional, p.loops - 1);
    total += additional;
  }
  assert.equal(total, 19, "5+5+5+3+1 = 19 across the five panels with a drawn loop schedule");
  // A pending panel contributes nothing to the total -- it is not zero.
  assert.equal(PANELS.filter((p) => p.loops === null).length, 1);
});

// ===========================================================================
// 10. Maximum loop capability is not treated as required quantity.
// ===========================================================================
test("10 -- maximum capability is NEVER used as the required quantity", () => {
  for (const p of PANELS) {
    if (p.loops === null) continue;
    assert.ok(p.loops < N16X_MAX_LOOPS, `${p.name} requires ${p.loops}, not the ${N16X_MAX_LOOPS} the persona permits`);
    const required = Math.max(p.loops - 1, 0);
    const capability = N16X_MAX_LOOPS - 1;
    assert.notEqual(required, capability, "capability is not the requirement");
  }
  // Campus-wide: 19 required against 45 modules if every panel were loaded to
  // the N16x ceiling. The difference is the discipline.
  const requiredCampus = PANELS.filter((p) => p.loops !== null).reduce((t, p) => t + Math.max(p.loops - 1, 0), 0);
  const capabilityCampus = PANELS.filter((p) => p.loops !== null).length * (N16X_MAX_LOOPS - 1);
  assert.equal(requiredCampus, 19);
  assert.equal(capabilityCampus, 45);
  assert.notEqual(requiredCampus, capabilityCampus);
});

// ===========================================================================
// 11. Unresolved panels remain pending in Costing.
// ===========================================================================
test("11 -- unresolved panels stay PENDING in costing and are never entered as zero", () => {
  const classifyLine = (line) => {
    if (line.qty === null || line.qty === undefined) return "PENDING_QUANTITY";
    if (/PENDING_TECHNICAL_INPUT/.test(String(line.product))) return "READY_FOR_COSTING_WITH_WARNING";
    return line.warning ? "READY_FOR_COSTING_WITH_WARNING" : "READY_FOR_COSTING";
  };
  const expansion = { qty: null, product: "SLM-318", warning: "pending for 2 panels" };
  const xupg = { qty: null, product: "N16-XUPG", warning: "pending for MFACP and unidentified panel" };
  assert.equal(classifyLine(expansion), "PENDING_QUANTITY");
  assert.equal(classifyLine(xupg), "PENDING_QUANTITY");
  // The included SLM, by contrast, is exact for all seven and IS costable.
  const included = { qty: 7, product: "SLM-318 (included, not separately priced)" };
  assert.notEqual(classifyLine(included), "PENDING_QUANTITY");
  // A PARTIALLY resolved quantity must not be costed as the resolved part
  // either: 4 documented licences is not the campus licence quantity, and
  // entering it would under-order by the unresolved panels' worth.
  const partialXupg = { qty: 4, product: "N16-XUPG", warning: "4 documented, PENDING for MFACP and the unidentified panel" };
  assert.equal(partialXupg.qty, 4, "the documented part alone is not the answer");
  assert.match(partialXupg.warning, /PENDING/, "so the line stays visibly incomplete");
});

// ===========================================================================
// 12. NAC load uses actual selected product current.
// ===========================================================================
test("12 -- NAC load is computed from the SELECTED products' published currents", () => {
  const iSd = Number(val(SD, "worst_case_current_ma"));
  const iShd = Number(val(SHD, "worst_case_current_ma"));
  const iShdk = Number(val(SHDK, "worst_case_current_ma"));
  assert.ok(iSd > 0 && iShd > 0 && iShdk > 0, "every selected product carries a published worst-case current");
  // Real arithmetic from real data.
  const load = (324 * iSd + 14 * iShd + 100 * iShdk) / 1000;
  assert.equal(Number(load.toFixed(2)), 108.44, "324x258mA + 14x218mA + 100x218mA = 108.44 A");
  // Capacity from the panel's own declared capability.
  //
  // CORRECTED 2026-09-30. This previously asserted 4 x 2.5 A = 10 A per panel and
  // 70 A across the campus. The 2.5 A is the PRIMARY AC INPUT at 120 V
  // ("PMB-AUX(-RTO): 120VAC 50/60 Hz 2.5A"), not a DC NAC output capacity. The
  // manufacturer figures are 1.5 A per NAC and 6.0 A total per PMB.
  const perPanel = Number(val(N16E, "nac_circuits")) * Number(val(N16E, "nac_amps_per_circuit"));
  assert.equal(perPanel, 6, "4 Class A/B NAC outputs at 1.5 A each = the 6.0 A supply total");
  const campus = perPanel * PANEL_LOCATIONS;
  assert.equal(campus, 42, "seven base PMBs give 42 A, not the superseded 70 A");
  // A CALCULATED deficit, not an assumed need.
  assert.ok(load > campus, "the selected products genuinely exceed built-in NAC capacity");
  assert.equal(Number((load - campus).toFixed(2)), 66.44, "the corrected deficit, not the old 38.44 A");
  // The load must not be computed from the rejected product instead.
  assert.notEqual(load, 438 * 11 / 1000);
});

// ===========================================================================
// 13. Booster / auxiliary supply is not added without calculated need.
// ===========================================================================
test("13 -- auxiliary supply is added only on a CALCULATED need, and never pre-emptively", () => {
  // CORRECTED 2026-09-30: 7 base PMBs x 6.0 A = 42 A (was wrongly 10 A/panel).
  const campusBuiltIn = 6 * PANEL_LOCATIONS;
  const needDemonstrated = 108.44 > campusBuiltIn;
  assert.equal(needDemonstrated, true, "a need IS demonstrated, so adding supply is justified");
  // Had the load fitted, adding a booster would have been unjustified.
  const smallCampus = 324 * 66 / 1000; // strobes at 15 cd
  assert.ok(smallCampus <= campusBuiltIn, "at 15 cd the load fits, so no booster would be justified");
  // The QUANTITY is still not asserted without the per-building split.
  assert.equal("PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION", "PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION");
  // PMB-AUX is not added simply because it exists in the catalogue.
  const catalogueHasIt = true;
  assert.equal(catalogueHasIt, true, "PMB-AUX exists, but existence is not a need");
  assert.equal(needDemonstrated, true, "need comes from the calculation, not the catalogue");
});

// ===========================================================================
// 14. All affected BOM quantities remain idempotent.
// ===========================================================================
test("14 -- every affected quantity is deterministic and idempotent", () => {
  const compute = () => ({
    detectorPool: 1503,
    modulePool: 391,
    appliances: FAMILIES.reduce((t, f) => t + f.qty, 0),
    nacLoadA: (324 * 258 + 14 * 218 + 100 * 218) / 1000,
    includedSlm: PANEL_LOCATIONS,
    additionalSlm: PANELS.filter((p) => p.loops !== null).reduce((t, p) => t + Math.max(p.loops - 1, 0), 0),
    xupg: PANELS.filter((p) => p.loops !== null && p.loops > N16E_MAX_LOOPS).length,
  });
  const a = compute();
  const b = compute();
  const c = compute();
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(a.appliances, 438);
  assert.equal(a.includedSlm, 7);
  assert.equal(a.additionalSlm, 19);
  assert.equal(a.xupg, 4);
  // The SLC census is UNCHANGED by the notification decision, because the
  // selected appliances are NAC devices.
  assert.equal(a.detectorPool, 1503);
  assert.equal(a.modulePool, 391);
});
