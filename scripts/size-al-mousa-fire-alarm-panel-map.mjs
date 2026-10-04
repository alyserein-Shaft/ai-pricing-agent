// AL MOUSA FIRE ALARM -- FINAL PANEL MAP, PERSONA AND LOOP-MODULE BOM.
//
// KGS IDENTITY, RESOLVED
// ----------------------
// The panel map previously carried an unresolved conflict: the drawings named
// BOS, GRS, KGS, WLC and SUBSTATION, while the approved architecture named six
// FACP locations (SUB STATION-1, SUB STATION-2, BOYS SCHOOL, GIRLS SCHOOL,
// WELCOME CENTER, DG STATION) and no KGS.
//
// The drawings answer it directly, on four independent sheets:
//   - 2401232- PC- AMS- DR- T-93-ZZZ-001 (OVERALL FIRE ALARM PANEL NETWORK
//     DIAGRAM): "FIRE COMMAND CENTER - GROUND FLOOR, KGS BUILDING", and
//     "THE FIRE ALARM CONTROL PANEL (FACP) OF EACH BUILDING SHALL BE CONNECTED
//     TO THE CAMPUS-WIDE MAIN FIRE ALARM [CONTROL PANEL]".
//   - 2401232- PC- WLC- DR- T-93-ZZZ-005: "TO MFACP @ FCC ROOM KGS BUILDING".
//   - 2401232- PC- BOS- DR- T-93-ZZZ-005 and 2401232- PC- AMS- DR- T-93-ZZZ-002:
//     "FROM MFACP @KGS BUILDING".
//   - 2401232- PC- KGS- DR- T-91-ZZZ-002 (FCC ROOM DETAILS) draws the
//     "MAIN FIRE ALARM CONTROL PANEL (MFACP)" in the KGS Fire Command Room,
//     alongside the firefighter telephone and IP/PSTN telephones.
//
// => KGS IS THE FIRE COMMAND CENTRE: the location of the campus MFACP.
//
// That is exactly why KGS never appeared among the six FACP names: the MFACP is
// the seventh panel, and it is not a building FACP. KGS additionally has its own
// building FACP (its own FIRE DETECTION & ALARM SCHEMATIC, 6 SLC loops), fed by
// the MFACP in the same building.
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/size-al-mousa-fire-alarm-panel-map.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const N16E_MAX_LOOPS = 3;
const N16X_MAX_LOOPS = 10;
const PANEL_LOCATIONS = 7;          // governed: 1 MFACP + 6 FACP
// CURRENT new-order SKU. The V11 launch guide states: "N16-XUPG is being phased
// out over next 6 months ... For all new orders recommended to use N16-XUPG2".
// N16-XUPG is retained as the LEGACY alternative, available from existing CLSS
// accounts only, and its historical evidence is preserved rather than deleted.
const N16_XUPG = "N16-XUPG2";       // CURRENT new-order persona upgrade licence, per panel
const N16_XUPG_LEGACY = "N16-XUPG"; // legacy / existing-CLSS-account alternative
const PMB_TOTAL_AMPS = 6.0;
const PMB_PERSONA = { N16e: 1, N16x: 3 };

// The SLC loop count is the HIGHEST "LOOP-<n>" index drawn on the panel block.
// "NAC LOOP" is a notification circuit, not an SLC loop, and is excluded.
const slcLoopCount = (items) => {
  const idx = items
    .filter((i) => /^LOOP-\d+$/i.test(i.t.replace(/\s+/g, "")))
    .map((i) => Number(i.t.replace(/[^0-9]/g, "")))
    .filter(Number.isFinite);
  return idx.length ? Math.max(...idx) : 0;
};
const itemsOf = (pageId) => db
  .prepare("SELECT text_content, bounding_box FROM drawing_assets WHERE page_id=? AND asset_type='Text'")
  .all(pageId)
  .map((r) => { const b = (() => { try { return JSON.parse(r.bounding_box || "{}"); } catch { return {}; } })(); return { t: String(r.text_content || "").trim(), x: Number(b.x) || 0, y: Number(b.y) || 0 }; })
  .filter((i) => i.t);

// Role and identity, each with the sheet that establishes it.
//
// The MFACP is a SEPARATE panel from the KGS building FACP. It is drawn on the
// FCC Room Details sheet, which shows room contents and equipment rather than a
// loop schedule, so its SLC loop count is NOT established by the drawing set.
// That is reported as PENDING rather than borrowed from the KGS building FACP.
const PANELS = [
  { key: "MFACP-KGS", name: "KGS FIRE COMMAND CENTRE", role: "MFACP", re: null, loopsDrawn: null, sheetNo: "2401232- PC- KGS- DR- T-91-ZZZ-002 (FCC ROOM DETAILS)",
    identityEvidence: "'MAIN FIRE ALARM CONTROL PANEL (MFACP)' drawn in the KGS Fire Command Room; 'FIRE COMMAND CENTER - GROUND FLOOR, KGS BUILDING' on the network diagram; 'TO MFACP @ FCC ROOM KGS BUILDING' from the WLC schematic" },
  { key: "BOS", name: "BOYS SCHOOL", role: "FACP", re: /- ?BOS-/, sheetNo: "2401232- PC- BOS- DR- T-93-ZZZ-005",
    identityEvidence: "sheet code BOS; 'FROM MFACP @KGS BUILDING' ties it to the campus star" },
  { key: "GRS", name: "GIRLS SCHOOL", role: "FACP", re: /- ?GRS-/, sheetNo: "2401232- PC- GRS- DR- T-93-ZZZ-005",
    identityEvidence: "sheet code GRS; the network diagram states the FACP of each building connects to the campus MFACP" },
  { key: "KGS-FACP", name: "KGS -- building FACP", role: "FACP", re: /- ?KGS-.*T-93-ZZZ-005/, sheetNo: "2401232- PC- KGS- DR- T-93-ZZZ-005",
    identityEvidence: "KGS has its own FIRE DETECTION & ALARM SCHEMATIC in addition to hosting the campus MFACP in its Fire Command Room" },
  { key: "WLC", name: "WELCOME CENTER", role: "FACP", re: /- ?WLC-/, sheetNo: "2401232- PC- WLC- DR- T-93-ZZZ-005",
    identityEvidence: "sheet code WLC; 'TO MFACP @ FCC ROOM KGS BUILDING' ties it to the MFACP" },
  { key: "AMS-SUB", name: "SUBSTATION (MV switchgear room)", role: "FACP", re: /- ?AMS-.*T-93-ZZZ-002/, sheetNo: "2401232- PC- AMS- DR- T-93-ZZZ-002",
    identityEvidence: "sheet title 'SUBSTATION FIRE DETECTION AND ALARM SCHEMATIC'; note '@ MV SWGR ROOM SUBSTATION-1'" },
];

const sheets = db.prepare(
  `SELECT DISTINCT drawing_number, sheet_name, page_id
     FROM drawing_search_entries
    WHERE drawing_number LIKE '%T-93-ZZZ-005%' OR drawing_number LIKE '%T-93-ZZZ-002%'
    ORDER BY drawing_number`,
).all();

const resolved = [];
for (const p of PANELS) {
  // A panel whose loop count is not drawn anywhere is still a real, identified
  // panel. It is carried with loops = null and sized as PENDING, never dropped
  // and never given an assumed loop count.
  const loops = p.re ? (() => {
    const sheet = sheets.find((s) => p.re.test(s.drawing_number));
    return sheet ? slcLoopCount(itemsOf(sheet.page_id)) : null;
  })() : null;
  resolved.push({ ...p, loops });
}

console.log("=".repeat(78));
console.log("KGS IDENTITY -- RESOLVED FROM PROJECT EVIDENCE");
console.log("=".repeat(78));
console.log("  KGS IS THE FIRE COMMAND CENTRE, i.e. the location of the campus MFACP.");
console.log("  It is NOT one of the six building FACP names, and that is the whole reason the earlier");
console.log("  map looked inconsistent. KGS additionally carries its OWN building FACP.");
console.log("  Evidence:");
console.log("    - OVERALL FIRE ALARM PANEL NETWORK DIAGRAM: 'FIRE COMMAND CENTER - GROUND FLOOR, KGS BUILDING'");
console.log("    - FCC ROOM DETAILS (KGS T-91-ZZZ-002) draws the 'MAIN FIRE ALARM CONTROL PANEL (MFACP)'");
console.log("    - WLC schematic: 'TO MFACP @ FCC ROOM KGS BUILDING'");
console.log("    - BOS and SUBSTATION schematics: 'FROM MFACP @KGS BUILDING'");
console.log("    - Drawing-set building index: 'BOS GRS WLC KGS AMS' (5 buildings; AMS is the substation)");
console.log("");
console.log("  RESIDUAL GAP, reported not forced:");
console.log("    The approved architecture names six FACP locations. Five are now identified by drawing");
console.log("    (BOYS, GIRLS, KGS, WELCOME CENTER, SUBSTATION). The sixth -- which the architecture lists");
console.log("    among SUB STATION-1, SUB STATION-2 and DG STATION -- has NO schematic in the approved");
console.log("    drawing set and cannot be identified from available evidence. It is left UNRESOLVED.");
console.log("");

console.log("=".repeat(78));
console.log("FINAL PANEL MAP");
console.log("=".repeat(78));
console.log(`governed physical panel locations: ${PANEL_LOCATIONS}  (1 MFACP + 6 FACP)`);
console.log("");
const rows = [];
for (const p of resolved) {
  const identified = p.loops !== null && p.loops > 0;
  const fits = identified ? p.loops <= N16E_MAX_LOOPS : null;
  const persona = identified ? (fits ? "N16e" : "N16x") : "PENDING";
  const xupg = identified ? (fits ? 0 : 1) : null;
  const included = 1;                                   // always one per physical panel
  const additional = identified ? Math.max(0, p.loops - 1) : null;
  rows.push({ ...p, persona, xupg, included, additional, fits, identified });
  console.log(`${p.name}   [${p.role}]`);
  console.log(`  sheet                    : ${p.sheetNo}`);
  console.log(`  identity evidence        : ${p.identityEvidence}`);
  console.log(`  SLC loops drawn          : ${identified ? p.loops : "NOT DRAWN -- PENDING"}`);
  console.log(`  physical hardware        : N16 x1 (the persona is a licence on the same hardware, not a different box)`);
  if (identified) {
    console.log(`  persona required         : ${persona}${fits ? "" : `  (${p.loops} loops > N16e max ${N16E_MAX_LOOPS})`}`);
    console.log(`  ${N16_XUPG} licences     : ${xupg}${xupg ? "" : "  (not required -- an N16e covers this panel without a licence)"}`);
    console.log(`  power supplies                 : 1 base PMB  (persona max ${PMB_PERSONA[persona]}, NOT auto-filled to the max)`);
    console.log(`  base NAC capacity              : ${(1 * PMB_TOTAL_AMPS).toFixed(1)} A  (4 NAC x 1.5 A)`);
    console.log(`  additional internal PMB headroom: ${((PMB_PERSONA[persona] - 1) * PMB_TOTAL_AMPS).toFixed(1)} A  (requires a calculated circuit load, never assumed)`);
    console.log(`  SLM-318 included         : ${included}`);
    console.log(`  SLM-318 additional       : ${additional}`);
    console.log(`  physical SLC modules     : ${included + additional}`);
  } else {
    console.log(`  persona required         : PENDING -- no schematic draws this panel's loop schedule, so neither the`);
    console.log(`                             N16e/N16x choice nor the licence quantity can be established. The MFACP`);
    console.log(`                             must exceed 3 loops to supervise the campus, but that is inference, not`);
    console.log(`                             evidence, and a licence is not priced against an inference.`);
    console.log(`  SLM-318 included         : 1`);
    console.log(`  SLM-318 additional       : PENDING`);
  }
  console.log("");
}

const documented = rows.filter((r) => r.identified);
const identifiedNoLoops = rows.filter((r) => !r.identified);
const xupgTotal = documented.reduce((t, r) => t + r.xupg, 0);
const additionalTotal = documented.reduce((t, r) => t + r.additional, 0);
const unidentifiedPanels = PANEL_LOCATIONS - rows.length;

console.log("=".repeat(78));
console.log("AGGREGATE -- DOCUMENTED vs UNRESOLVED");
console.log("=".repeat(78));
console.log("  IDENTIFIED WITH A DRAWN LOOP SCHEDULE");
console.log(`    panels                      : ${documented.length}`);
console.log(`    included SLM-318            : ${documented.reduce((t, r) => t + r.included, 0)}`);
console.log(`    additional SLM-318          : ${additionalTotal}`);
console.log(`    ${N16_XUPG} persona licences : ${xupgTotal}   (one per panel needing more than ${N16E_MAX_LOOPS} loops)`);
console.log(`    legacy ${N16_XUPG_LEGACY} alt   : available from existing CLSS accounts only; NOT used for new procurement`);
console.log("");
console.log("  IDENTIFIED BUT LOOP COUNT NOT DRAWN");
console.log(`    panels                      : ${identifiedNoLoops.length}  (${identifiedNoLoops.map((r) => `${r.name} [${r.role}]`).join("; ")})`);
console.log(`    included SLM-318            : ${identifiedNoLoops.reduce((t, r) => t + r.included, 0)}   (always one per physical panel)`);
console.log(`    additional SLM-318          : PENDING`);
console.log(`    ${N16_XUPG} persona licences : PENDING`);
console.log("");
console.log("  UNIDENTIFIED (no schematic and no identified location)");
console.log(`    panels                      : ${unidentifiedPanels}`);
console.log(`    included SLM-318            : ${unidentifiedPanels}   (one per physical panel, always)`);
console.log(`    additional SLM-318          : PENDING`);
console.log(`    ${N16_XUPG} persona licences : PENDING -- a licence may NOT be priced against an unresolved panel identity`);
console.log("");
console.log("  CAMPUS TOTALS");
// The included base module is a property of the HARDWARE, not of the loop
// schedule: every physical N16 ships with exactly one SLM-318. So this figure is
// exact for ALL seven governed locations, including the ones whose loop count
// is unknown, and it is never separately priced.
const includedCampus = PANEL_LOCATIONS;
console.log(`    physical N16 panels         : ${PANEL_LOCATIONS}`);
console.log(`    included SLM-318            : ${includedCampus}   (one per physical panel -- exact for all ${PANEL_LOCATIONS}, NEVER separately priced)`);
console.log(`    additional SLM-318          : ${additionalTotal} documented + PENDING for ${PANEL_LOCATIONS - documented.length} panel(s)`);
console.log(`    ${N16_XUPG} licences         : ${xupgTotal} documented + PENDING`);
console.log("");
console.log("  MAXIMUM CAPABILITY IS NOT REQUIRED QUANTITY");
for (const r of documented) {
  console.log(`    ${r.name.padEnd(30)} required ${String(r.loops).padStart(2)} modules  (N16x capability would be ${N16X_MAX_LOOPS}) -- capability is NOT ordered`);
}
