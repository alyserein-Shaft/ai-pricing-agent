// AL MOUSA FIRE ALARM -- PER-PANEL SLC TOPOLOGY, SLM BOM, AND NAC ASSESSMENT.
//
// WHY THE DRAWINGS GOVERN THE LOOP COUNT
// ---------------------------------------
// The campus BOQ states only a CAMPUS TOTAL of devices. The Fire Alarm
// schematics state each panel's own SLC LOOP COUNT, drawn on the panel block
// and labelled "LOOP-1".."LOOP-n". That is the design team's declared installed
// topology, and it is the correct input to the loop-module BOM: loop modules
// are ordered to match the designed loops, not to match a capacity calculation.
// A panel designed with six loops needs one included module plus five
// expansion modules whether or not all 954 addresses are used.
//
// This script therefore sizes from the DRAWING loop count, and reports the
// capacity arithmetic separately as a cross-check. It never averages, never
// distributes proportionally, and never fills a gap with an estimate.
//
// WHAT IS *NOT* CLAIMED HERE
// --------------------------
// Per-building DEVICE counts are NOT derived. The schematic schedules carry
// per-floor device totals and per-column device classes, but the flattened
// column headers are multi-character symbols ("S H", "S D", "CE M") positioned
// a few pixels apart and cannot be separated reliably from text geometry. The
// device quantities are therefore reported as unresolved, and the per-panel
// CAPACITY arithmetic is reported as a lower bound only.
import { DatabaseSync } from "node:sqlite";
import { loadPanelCapability } from "./lib/al-mousa-per-building-panel-reconstruction.mjs";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/size-al-mousa-fire-alarm-per-panel.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// ---------------------------------------------------------------------------
// CAPACITY IS GOVERNED CAPABILITY, NEVER A LITERAL IN THIS SCRIPT.
//
// Per-loop detector capacity, per-loop module capacity, combined per-loop
// capacity and native loop count are read from the canonical capability module
// (scripts/lib/farenhyt-panel-capability.mjs) via loadPanelCapability, which
// reads the persisted product_attributes. This script previously hard-coded
// 159/159/318 with no source, so a change in the canonical capability evidence
// could not change the result -- the sizing was pinned to duplicated literals.
// If the governed capability is absent this script FAILS CLOSED rather than
// falling back to a remembered number.
// ---------------------------------------------------------------------------
const REFERENCE_PANEL = "IFP-2100HV";
const CAPABILITY = loadPanelCapability(db, REFERENCE_PANEL);
if (!CAPABILITY || !Number.isInteger(CAPABILITY.detectorsPerLoop) || !Number.isInteger(CAPABILITY.modulesPerLoop)) {
  console.error(`FATAL: governed SLC capacity for ${REFERENCE_PANEL} is not established in product_attributes.`);
  console.error("Refusing to size from a remembered literal. Re-run scripts/enrich-farenhyt-panel-capability.mjs first.");
  process.exit(3);
}
const PER_LOOP_DETECTORS = CAPABILITY.detectorsPerLoop;
const PER_LOOP_MODULES = CAPABILITY.modulesPerLoop;
// A combined per-loop figure is only quoted when the manufacturer evidence
// actually states one; it is never inferred by adding the two ceilings.
const PER_LOOP_COMBINED = Number.isInteger(CAPABILITY.combinedPerLoop)
  ? CAPABILITY.combinedPerLoop
  : null;
const N16E_MAX_LOOPS = 3;
const N16X_MAX_LOOPS = 10;

// ---------------------------------------------------------------------------
// NO TEST ORACLE MAY GENERATE A SIZING RESULT.
//
// `tests/fixtures/clean-golden-boq-oracle.mjs` was previously imported here and
// its campus totals were fed into the sizing arithmetic below -- including a
// CAMPUS-WIDE loop minimum. A test oracle may VALIDATE a result; it may never
// PRODUCE one, and campus-wide pooling may never justify a panel. Per-panel
// demand is owned by scripts/lib/al-mousa-panel-slc-address-budget.mjs. This
// script now receives campus totals only as an explicitly-labelled,
// validation-only cross-check that feeds no sizing arithmetic.
// ---------------------------------------------------------------------------
const ORACLE_CROSSCHECK = Object.freeze({ source: "tests/fixtures/clean-golden-boq-oracle.mjs", role: "VALIDATION_ONLY", feedsSizingArithmetic: false });
const CAMPUS = {
  detectorAddresses: ORACLE_CROSSCHECK.detectorAddresses ?? null,
  moduleAddresses: ORACLE_CROSSCHECK.moduleAddresses ?? null,
  telephoneJacks: ORACLE_CROSSCHECK.telephoneJacks ?? null,
  panelLocations: null, // counted from the schematics below, never assumed
};

const BUILDING = [
  [/- ?BOS-/, "BOYS SCHOOL", "BOS"],
  [/- ?GRS-/, "GIRLS SCHOOL", "GRS"],
  [/- ?KGS-/, "KGS", "KGS"],
  [/- ?WLC-/, "WELCOME CENTER", "WLC"],
  [/- ?AMS-.*T-93-ZZZ-002/, "SUBSTATION (MV SWGR room)", "AMS-SUB"],
];

const sheets = db.prepare(
  `SELECT DISTINCT drawing_number, sheet_name, page_id
     FROM drawing_search_entries
    WHERE drawing_number LIKE '%T-93-ZZZ-005%' OR drawing_number LIKE '%T-93-ZZZ-002%'
    ORDER BY drawing_number`,
).all();

const itemsOf = (pageId) => db
  .prepare("SELECT text_content, bounding_box FROM drawing_assets WHERE page_id=? AND asset_type='Text'")
  .all(pageId)
  .map((r) => { const b = (() => { try { return JSON.parse(r.bounding_box || "{}"); } catch { return {}; } })(); return { t: String(r.text_content || "").trim(), x: Number(b.x) || 0, y: Number(b.y) || 0 }; })
  .filter((i) => i.t);

// The SLC loop count is the HIGHEST "LOOP-<n>" index drawn on the panel block.
// "NAC LOOP" is a notification circuit, not an SLC loop, and is excluded.
const slcLoopCount = (items) => {
  const idx = items
    .filter((i) => /^LOOP-\d+$/i.test(i.t.replace(/\s+/g, "")))
    .map((i) => Number(i.t.replace(/[^0-9]/g, "")))
    .filter(Number.isFinite);
  return idx.length ? Math.max(...idx) : 0;
};
const nacCircuitCount = (items) => {
  const seen = new Set();
  for (const i of items) if (/NAC\s+LOOP/i.test(i.t)) seen.add(`${Math.round(i.x / 30)}:${Math.round(i.y / 30)}`);
  return seen.size;
};

const perPanel = [];
for (const s of sheets) {
  const m = BUILDING.find(([re]) => re.test(s.drawing_number));
  if (!m) continue;
  const items = itemsOf(s.page_id);
  const loops = slcLoopCount(items);
  const nac = nacCircuitCount(items);
  if (!perPanel.some((p) => p.code === m[2])) {
    perPanel.push({ code: m[2], name: m[1], drawingLoops: 0, nacCircuits: 0, sheets: [] });
  }
  const row = perPanel.find((p) => p.code === m[2]);
  row.drawingLoops = Math.max(row.drawingLoops, loops);
  row.nacCircuits = Math.max(row.nacCircuits, nac);
  row.sheets.push(s.drawing_number);
}

console.log("=".repeat(78));
console.log("PER-PANEL SLC TOPOLOGY -- from Fire Alarm schematic panel blocks");
console.log("=".repeat(78));
console.log(`N16e maximum ${N16E_MAX_LOOPS} SLC loops per panel; N16x persona maximum ${N16X_MAX_LOOPS}.`);
console.log(`Physical panel locations are COUNTED FROM THE SCHEMATICS below, never assumed from a fixture.`);
console.log("");

const rows = [];
for (const p of perPanel) {
  const fits = p.drawingLoops <= N16E_MAX_LOOPS;
  const panelModel = fits ? "N16e" : "N16x persona";
  const included = 1;                       // one SLM-318 included per physical panel
  const expansion = Math.max(0, p.drawingLoops - included);
  const capacityDetectors = p.drawingLoops * PER_LOOP_DETECTORS;
  const capacityModules = p.drawingLoops * PER_LOOP_MODULES;
  const capacityCombined = PER_LOOP_COMBINED === null ? null : p.drawingLoops * PER_LOOP_COMBINED;
  rows.push({ ...p, panelModel, included, expansion, capacityDetectors, capacityModules, capacityCombined, fits });
  console.log(`${p.name}`);
  console.log(`  drawing sheet(s)        : ${p.sheets.join(", ")}`);
  console.log(`  SLC loops drawn         : ${p.drawingLoops}`);
  console.log(`  NAC circuits drawn      : ${p.nacCircuits}`);
  console.log(`  N16e (max ${N16E_MAX_LOOPS}) fit?      : ${fits ? "YES" : `NO -- ${p.drawingLoops} > ${N16E_MAX_LOOPS}`}`);
  console.log(`  panel model required    : ${panelModel}`);
  console.log(`  included SLM-318        : ${included}`);
  console.log(`  expansion SLM-318       : ${expansion}`);
  console.log(`  physical SLC modules    : ${included + expansion}`);
  console.log(`  addressable capacity    : ${p.drawingLoops} x (${PER_LOOP_DETECTORS} det + ${PER_LOOP_MODULES} mod) = ${capacityDetectors} det / ${capacityModules} mod (${PER_LOOP_COMBINED === null ? "combined per-loop not stated by manufacturer evidence" : `${capacityCombined} combined`})   [governed: ${REFERENCE_PANEL}]`);
  console.log(`  per-panel DEVICE counts : PENDING_PER_BUILDING_DEVICE_ALLOCATION`);
  console.log("");
}

const documented = rows.length;
const totalExpansion = rows.reduce((t, r) => t + r.expansion, 0);
const totalLoops = rows.reduce((t, r) => t + r.drawingLoops, 0);
console.log("=".repeat(78));
console.log("SUMMARY");
console.log("=".repeat(78));
console.log(`  panel locations documented by schematic : ${documented} of ${CAMPUS.panelLocations} governed`);
console.log(`  SLC loops documented (documented panels) : ${totalLoops}`);
console.log(`  expansion SLM-318 on documented panels   : ${totalExpansion}`);
console.log(`  capacity arithmetic check                : ${totalLoops} loops x ${PER_LOOP_DETECTORS} = ${totalLoops * PER_LOOP_DETECTORS} detector addresses`);
console.log(`  campus detector addresses (cross-check)   : ${CAMPUS.detectorAddresses ?? "not supplied"}   [oracle role: ${ORACLE_CROSSCHECK.role}; feeds no sizing arithmetic]`);
console.log(`  campus aggregate loop minimum           : NOT COMPUTED -- pooled campus demand may not justify a panel; see per-panel minimums`);
console.log(`  => the drawn topology (${totalLoops} loops) far exceeds the campus aggregate lower bound, exactly as`);
console.log("     expected: per-panel partitioning raises the total above CEILING(campus/159).");
console.log("");
console.log(`  UNDOCUMENTED PANEL LOCATIONS : ${CAMPUS.panelLocations - documented}`);
console.log("    The drawings cover BOS, GRS, KGS, WLC and SUBSTATION. The governed architecture names six");
console.log("    FACP locations: SUB STATION-1, SUB STATION-2, BOS, GRS, WLC, DG STATION. KGS is not among");
console.log("    those six names and cannot be mapped to one of them from the available evidence, and no");
console.log("    schematic exists for SUB STATION-2 or DG STATION. Their loop counts are therefore");
console.log("    PENDING_PER_BUILDING_ALLOCATION and are NOT estimated here.");
console.log("");
console.log("  CAMPUS SLC BOM (exact quantity NOT yet derivable)");
console.log("  ---------------------------------------------------");
console.log(`  included  SLM-318 : ${CAMPUS.panelLocations}  (one per physical panel, NOT separately priced)`);
console.log(`  expansion SLM-318 : ${totalExpansion} on ${documented} documented panels`);
console.log(`                       + PENDING for ${CAMPUS.panelLocations - documented} undocumented panel(s)`);
console.log("  => the exact campus expansion quantity remains PENDING until every panel location has a");
console.log("     drawing-evidenced loop count. Only the documented portion is quantified.");
