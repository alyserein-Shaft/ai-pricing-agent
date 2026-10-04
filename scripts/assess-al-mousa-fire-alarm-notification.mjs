// AL MOUSA FIRE ALARM -- FINAL NOTIFICATION ARCHITECTURE AND NAC LOAD ASSESSMENT.
//
// This supersedes the earlier "loop powered, zero address" hybrid, which was
// internally inconsistent: a device cannot be an addressable SLC point and
// consume no address at the same time.
//
// THE ARCHITECTURE QUESTION, ANSWERED FROM PROJECT EVIDENCE
// ---------------------------------------------------------
// The BOQ and the drawing legend both say "LOOP POWERED STROBE(S)". That wording
// alone would imply an addressable SLC device. It is NOT the answer, for two
// independent manufacturer-grounded reasons:
//
//   (a) CANDELA. The specification mandates field-selectable 15/30/60/75/110 cd.
//       The only Honeywell addressable loop-powered AV range (FS-AV) is rated
//       "STROBE FLASH INTENSITY N/A >1cd". A >1 cd device cannot meet the spec.
//   (b) WEATHERPROOF. 100 units are exterior and the spec requires exterior
//       horns at >=85 dBA @10 ft. The FS-AV range has no outdoor variant.
//
// Every other project signal agrees on CONVENTIONAL NAC: a Class A NAC topology,
// four Class A/B NAC outputs at 2.5 A each, a drawn "NAC LOOP" at every panel,
// and a mandatory synchronisation requirement.
//
// So the three families are CONVENTIONAL_NAC, addressed by the N16 Class A/B
// outputs, and the "loop powered" label is a legacy line label. The conflict is
// recorded, not silently reconciled.
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/assess-al-mousa-fire-alarm-notification.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const attr = (pn, n) => {
  const r = db.prepare("SELECT attributes FROM library_products WHERE part_number=?").get(pn);
  if (!r) return null;
  const a = JSON.parse(r.attributes);
  const h = a.find((x) => x.name === n);
  return h ? (h.value ?? h.normalizedValue) : null;
};
const std = (pn) => {
  const r = db.prepare("SELECT standards FROM library_products WHERE part_number=?").get(pn);
  if (!r) return [];
  return JSON.parse(r.standards || "[]").map((s) => `${s.body} ${s.number}`);
};

// ---------------------------------------------------------------------------
// The three families, each decided INDEPENDENTLY on its own project evidence.
// ---------------------------------------------------------------------------
const FAMILIES = [
  {
    boqLine: "Loop powered strobes", qty: 324, audible: false, exterior: false,
    selected: "SD",
    why: "Indoor visual-only appliance. The legend and BOQ call it a loop powered strobe, but the mandatory field-selectable 15/30/60/75/110 cd duty and the absence of any exterior requirement are met only by the conventional NAC SpectrAlert strobe.",
  },
  {
    boqLine: "Loop powered strobes with sounder", qty: 14, audible: true, exterior: false,
    selected: "SHD",
    why: "Indoor audible+visual appliance. Requires multi-tone switching, selectable sound level and Code 3 temporal, all of which the conventional NAC horn/strobe provides and the FS-AV range is not evidenced to be listed for an N16 INSPIRE system.",
  },
  {
    boqLine: "Loop powered strobes with sounder (weatherproof)", qty: 100, audible: true, exterior: true,
    selected: "SHDK",
    why: "Exterior audible+visual appliance. Requires NEMA 4X weatherproof, -40F to 151F and >=85 dBA @10 ft on axis. The FS-AV range has no outdoor variant at all, which alone disqualifies it for these 100 units.",
  },
];

console.log("=".repeat(78));
console.log("NOTIFICATION ARCHITECTURE -- decided per family from project evidence");
console.log("=".repeat(78));
console.log("");
let totalQty = 0;
let totalWorstCase = 0;
for (const f of FAMILIES) {
  totalQty += f.qty;
  const mA = Number(attr(f.selected, "worst_case_current_ma"));
  const load = (f.qty * mA) / 1000;
  totalWorstCase += load;
  console.log(`${f.boqLine}   x${f.qty}`);
  console.log(`  topology determined        : CONVENTIONAL_NAC`);
  console.log(`  evidence for the decision   : ${f.why}`);
  console.log(`  selected product            : ${f.selected}  (${attr(f.selected, "description") ? "governed catalogue" : ""})`);
  console.log(`  listing                     : ${attr(f.selected, "listing")}`);
  console.log(`  standards recorded          : ${std(f.selected).join(", ") || "(listing-scoped, see product attributes)"}`);
  console.log(`  candela settings            : ${attr(f.selected, "candela_settings_cd")}`);
  console.log(`  supply voltage              : ${attr(f.selected, "supply_voltage")}`);
  console.log(`  weatherproof                : ${String(attr(f.selected, "weatherproof")).slice(0, 60)}`);
  console.log(`  synchronisation             : ${String(attr(f.selected, "synchronization")).slice(0, 90)}`);
  console.log(`  SLC address consumption     : ${attr(f.selected, "address_consumption")}   (${attr(f.selected, "address_resource_class")})`);
  console.log(`  alarm current, worst case   : ${mA} mA RMS per unit (${attr(f.selected, "current_draw_24v_ma_rms")})`);
  console.log(`  NAC load contribution       : ${f.qty} x ${mA} mA = ${load.toFixed(2)} A`);
  console.log("");
}

console.log("-".repeat(78));
console.log("EVALUATED AND REJECTED ALTERNATIVE (retained so the decision is re-testable)");
console.log("-".repeat(78));
console.log(`  FS-WSS  ${attr("FS-WSS", "description")}`);
console.log(`  topology if selected        : ${attr("FS-WSS", "topology")}`);
console.log(`  SLC address consumption     : ${attr("FS-WSS", "address_consumption")}  <-- it IS an addressable SLC device`);
console.log(`  strobe intensity            : ${attr("FS-WSS", "strobe_flash_intensity_cd")}`);
console.log(`  verdict                     : ${String(attr("FS-WSS", "project_fit_verdict")).slice(0, 150)}`);
console.log("");
console.log("  CONSEQUENCE: because FS-AV was NOT selected, the 438 appliances stay OUT of the SLC");
console.log("  census. The detector pool remains 1,503 and the module pool 391, and the drawing-");
console.log("  evidenced loop counts of 6/6/6/4/2 are unaffected. Had FS-AV been selected, 438");
console.log("  points would have had to be added and the loop arithmetic re-run.");

// ---------------------------------------------------------------------------
// NAC / power capacity -- CORRECTED 2026-09-30
// ---------------------------------------------------------------------------
// The previous assessment used "4 NAC x 2.5 A = 10 A per panel". That was
// WRONG, and the origin of the error is the point. The 2.5 A is the panel's
// PRIMARY AC INPUT rating at 120 V:
//   "PMB-AUX(-RTO) : 120VAC 50/60 Hz 2.5A, 240VAC 50/60 Hz, 1.25A"
// An AC input current had been read as a DC NAC output capacity.
//
// The manufacturer capability, per the PMB-AUX datasheet DN-62116, is:
//   "NAC outputs (power-limited) : ... 1.5A ..."
// and the supply total is the "6.0 A power supply" of DN-62112. So one PMB =
// 4 NACs x 1.5 A = 6.0 A exactly, which is the internal consistency check
// that proves the 2.5 A reading was the anomaly rather than the 1.5 A one.
//
// The project specification separately asks for "up to 2.5 amps per circuit".
// That is a PROJECT REQUEST, recorded as such, and it EXCEEDS the selected
// hardware. It is reported as a conflict and never silently satisfied.
const NAC_PER_PANEL = Number(attr("N16e", "nac_circuits")) || 4;
const NAC_AMPS_PER_CIRCUIT = Number(attr("N16e", "nac_amps_per_circuit")) || 1.5;
const PMB_TOTAL_AMPS = Number(attr("N16e", "pmb_total_nac_amps")) || 6.0;
const AC_INPUT_AMPS = Number(attr("N16e", "ac_input_amps_120v")) || 2.5;
const PROJECT_REQUESTED_AMPS = Number(attr("N16e", "project_requested_amps_per_circuit")) || 2.5;
const PMB_E = Number(attr("N16e", "n16e_persona_pmb_count")) || 1;
const PMB_X_MAX = Number(attr("N16e", "n16x_persona_pmb_count_max")) || 3;
const PANEL_LOCATIONS = 7;

const perPanelFromCircuits = NAC_PER_PANEL * NAC_AMPS_PER_CIRCUIT;
const circuitsAgreeWithTotal = Math.abs(perPanelFromCircuits - PMB_TOTAL_AMPS) < 0.01;
const baseCampus = PANEL_LOCATIONS * PMB_TOTAL_AMPS;
const deficit = totalWorstCase - baseCampus;

console.log("");
console.log("=".repeat(78));
console.log("NAC / POWER CAPACITY -- CORRECTED");
console.log("=".repeat(78));
console.log("");
console.log("  2.5 A AUDIT -- where the wrong figure came from");
console.log(`    ac input at 120 V                : ${AC_INPUT_AMPS} A   [${attr("N16e", "ac_input_entity")}]`);
console.log(`    project specification requests   : ${PROJECT_REQUESTED_AMPS} A per output circuit   [${attr("N16e", "project_requested_entity")}]`);
console.log(`    MANUFACTURER_CAPABILITY per NAC  : ${NAC_AMPS_PER_CIRCUIT} A   [${attr("N16e", "nac_amps_per_circuit_entity")}]`);
console.log(`    PMB total NAC output             : ${PMB_TOTAL_AMPS} A`);
console.log(`    consistency check: ${NAC_PER_PANEL} x ${NAC_AMPS_PER_CIRCUIT} A = ${perPanelFromCircuits} A vs PMB total ${PMB_TOTAL_AMPS} A -> ${circuitsAgreeWithTotal ? "AGREE" : "DISAGREE, ASSESSMENT INVALID"}`);
console.log("");
console.log(`    CAPABILITY CONFLICT: ${attr("N16e", "capability_conflict")}`);
console.log("");
console.log("  PERSONA POWER-SUPPLY CAPACITY (INSPIRE V11 licence table)");
console.log(`    N16e persona : ${PMB_E} power supply  -> ${PMB_E * PMB_TOTAL_AMPS} A NAC capacity`);
console.log(`    N16x persona : up to ${PMB_X_MAX} power supplies -> ${PMB_X_MAX * PMB_TOTAL_AMPS} A NAC capacity`);
console.log(`    An N16x is NOT automatically filled to ${PMB_X_MAX} PMBs. A PMB is added only where a calculated circuit load needs it.`);
console.log("");
console.log(`  appliances (campus)                : ${totalQty}  (${FAMILIES.filter((f) => f.audible).reduce((t, f) => t + f.qty, 0)} audible / ${FAMILIES.filter((f) => !f.audible).reduce((t, f) => t + f.qty, 0)} visual)`);
console.log(`  DESIGN WORST CASE NAC load         : ${totalWorstCase.toFixed(2)} A  (every unit at the highest published candela, temporal high)`);
console.log(`  base NAC capacity, 7 base PMBs    : ${baseCampus.toFixed(1)} A   (${PANEL_LOCATIONS} x ${PMB_TOTAL_AMPS} A)`);
console.log(`    -- the superseded figure was 70.0 A (7 x 10 A), which wrongly used 2.5 A per circuit`);
console.log(`  AGGREGATE DEFICIT                  : ${deficit.toFixed(2)} A`);
console.log(`  BASE CAPACITY SUFFICIENT?          : ${deficit <= 0 ? "YES" : "NO"}`);
console.log("");
if (deficit > 0) {
  console.log("  KNOWN-PERSONA INTERNAL CAPACITY (the five panels whose persona is established)");
  console.log("    4 x N16x maximum (3 PMBs x 6.0 A = 18 A) = 72.0 A");
  console.log("    1 x N16e maximum (1 PMB  x 6.0 A =  6 A) =  6.0 A");
  console.log("    known five-panel theoretical maximum      = 78.0 A");
  console.log("    MFACP and the sixth FACP                  = persona PENDING, excluded");
  console.log("");
  console.log("  A WITHDRAWN CONCLUSION, RECORDED SO IT CANNOT RETURN");
  console.log("    An earlier pass concluded that internal capacity would be 126 A, which would cover");
  console.log("    the 108.44 A worst case, so the internal path is proven viable. That is WITHDRAWN.");
  console.log("    It assumed all seven panels carry three PMBs, which the governed architecture does");
  console.log("    not support: two panels have an unresolved persona, and an N16x is not populated to");
  console.log("    three PMBs without a calculated circuit load.");
  console.log("");
  console.log("  POWER ADEQUACY IS PANEL-LOCAL AND CIRCUIT-LOCAL");
  console.log("    A campus aggregate current says nothing about whether any given NAC is served within");
  console.log("    its 1.5 A limit. Adequacy is decided per circuit, from that circuit's device list and");
  console.log("    its load. No sufficiency or insufficiency conclusion is drawn here.");
  console.log("");
  console.log("  GOVERNED REMOTE SUPPLY PATH (evaluated, not selected)");
  console.log(`    ${attr("N16e", "remote_supply_path")}`);
  console.log("");
  console.log("  EXACT SUPPLY QUANTITY : PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION");
  console.log("     Both the internal PMB-AUX quantity and the remote supply quantity stay pending, and");
  console.log("     neither is derived from the campus aggregate. The count follows circuit-level load");
  console.log("     data and the final NAC zoning, neither of which exists.");
}
console.log("");
console.log("  LOAD BASIS -- DESIGN WORST CASE vs ACTUAL CONFIGURED LOAD");
console.log(`    DESIGN_WORST_CASE     : ${FAMILIES.map((f) => `${f.qty} x ${attr(f.selected, "worst_case_current_ma")} mA`).join(" + ")} = ${totalWorstCase.toFixed(2)} A`);
console.log("      Every unit at the HIGHEST published candela with temporal high sound. This is the");
console.log("      conservative feasibility figure used for the capacity comparison above.");
console.log("    ACTUAL_CONFIGURED_LOAD : PENDING_CONFIGURED_CANDELA_AND_TONE");
console.log("      The configured figure depends on the per-device candela and horn-tone selection, which is an");
console.log(`      NFPA 72 field decision. It is NOT ${totalWorstCase.toFixed(2)} A and must never be reported as the final battery or`);
console.log("      NAC calculation. The worst case may be carried forward for sizing headroom only.");
console.log("");
console.log("  IDENTITY GOVERNANCE -- a family alias is a TECHNICAL match, not an orderable identity");
for (const f of FAMILIES) {
  console.log(`    ${String(f.selected).padEnd(6)} ${attr(f.selected, "commercial_part_number_status")}`);
  console.log(`           ${attr(f.selected, "orderable_candidates").slice(0, 108)}`);
}
console.log("    A family alias may not be sent to the Price Library as a manufacturer SKU.");
console.log("");
console.log("  STILL PENDING (named, not fabricated)");
console.log("    per-device operating candela : PENDING_ROOM_LIGHT_AND_AMBULANCE_DATA");
console.log("    per-circuit load             : PENDING_NAC_ZONING");
console.log("    MDL3 synchronisation modules : PENDING_NAC_ZONING (one per synchronised NAC group)");
console.log("    voltage drop                 : PENDING_CIRCUIT_LENGTH_AND_LOAD_DATA");
console.log("    battery capacity / duration  : PENDING_BATTERY_LOAD_CALCULATION");
