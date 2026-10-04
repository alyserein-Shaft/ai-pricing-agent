// RUNNER: reconstruct the Al Mousa per-building fire alarm panel inventory from
// approved drawing architecture + BOQ section structure + governed Farenhyt
// catalogue. READ-ONLY.
import { DatabaseSync } from "node:sqlite";
import {
  classifyLoops, rightSizePanel, expansionForPanel,
  aggregateCrossCheck, quantityWatchlist, loadAllPanelCapabilities, loadPanelCapability,
} from "./lib/al-mousa-per-building-panel-reconstruction.mjs";
import { currentApprovedVersion, rowsForVersion } from "./lib/al-mousa-drawing-architecture-projection.mjs";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const P = process.argv[3] || "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const t = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Governed manufacturer capability, read from product_attributes. Nothing here
// is hard-coded for Al Mousa, so a fact corrected for any Farenhyt project is
// reused everywhere.
const CAPABILITIES = loadAllPanelCapabilities(db);
const CAPABILITY_BY_PN = new Map(CAPABILITIES.map((c) => [c.partNumber, c]));
// Kit density is a governed fact about 5815RMK, not a constant in this script.
const KIT = loadPanelCapability(db, "5815RMK");
const LOOP_CARDS_PER_KIT = KIT?.loopCardsPerKit ?? null;
if (!LOOP_CARDS_PER_KIT) console.log("  WARNING: 5815RMK loop_cards_per_kit is not governed; kit quantities will be reported as PENDING\n");
console.log("=== GOVERNED FARENHYT PANEL CAPABILITY (from product_attributes) ===");
for (const c of CAPABILITIES) {
  console.log(`  ${c.partNumber.padEnd(12)} SLC=${c.slcLoopsInBuild} expansion=${c.expansionState} max=${c.expansionMaxCount ?? "?"} (${c.expansionMaxState ?? "?"}) pts=${c.panelPointCapacityIdpSk} det/loop=${c.detectorsPerLoop} flexput=${c.flexputCircuits} @${c.nacCurrentPerCircuitAmps}A/${c.panelTotalOutputAmps}A net=${c.networkPanelLimit} batt=${c.batteryCapacityAh}Ah`);
}
console.log("");

// ---- approved architecture (CURRENT version only) -------------------------
const versions = db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=?").all(P);
const version = currentApprovedVersion(versions);
const rows = rowsForVersion(
  db.prepare(`SELECT a.* FROM drawing_architecture_approved_rows a WHERE a.approved_version_id IN (${versions.map(() => "?").join(",")})`).all(...versions.map((v) => v.id)),
  version.id,
);
const adj = db.prepare("SELECT * FROM drawing_architecture_exception_adjudications WHERE project_id=? AND superseded_at IS NULL").all(P);
const sheetOf = (r) => t(r.source_drawing_number);
const canonOf = (r) => {
  const sheet = sheetOf(r);
  return (r.fact_type === "PANEL_EXISTS" && r.subject === "FACP")
    ? adj.find((a) => a.exception_type === "GENERIC_FACP_IDENTITY" && t(a.source_drawing_number) === sheet)
    : adj.find((a) => String(a.review_case_ids ?? "").includes(r.review_case_id));
};
const canon = (r) => canonOf(r)?.canonical_panel_identity || (r.subject === "MFACP" ? "MFACP" : null);

// Sheet -> panel identity, built ONLY from approved PANEL_EXISTS rows. A loop
// row's subject is a loop id, not a role, so a sheet that hosts exactly one
// approved panel is that panel's owner. A sheet hosting several approved
// panels stays ambiguous and is never guessed.
const sheetOwner = new Map();
const sheetAmbiguous = new Set();
for (const r of rows.filter((x) => x.fact_type === "PANEL_EXISTS")) {
  const id = canon(r);
  const sheet = sheetOf(r);
  if (!id) { sheetAmbiguous.add(sheet); continue; }
  if (sheetOwner.has(sheet)) { sheetAmbiguous.add(sheet); continue; }
  sheetOwner.set(sheet, id);
}
/** Owner of a loop/NAC row: its own identity if adjudicated, else its sheet. */
const owner = (r) => canon(r)
  || (sheetAmbiguous.has(sheetOf(r)) ? null : (sheetOwner.get(sheetOf(r)) ?? null));

const loopsByPanel = new Map();
for (const r of rows.filter((x) => x.fact_type === "SLC_LOOP_EXISTS")) {
  const id = owner(r) || `UNRESOLVED@${sheetOf(r)}`;
  if (!loopsByPanel.has(id)) loopsByPanel.set(id, []);
  loopsByPanel.get(id).push(r);
}
const nacByPanel = new Map();
for (const r of rows.filter((x) => x.fact_type === "NAC_CIRCUIT_EXISTS")) {
  const id = owner(r) || `UNRESOLVED@${sheetOf(r)}`;
  nacByPanel.set(id, (nacByPanel.get(id) ?? 0) + 1);
}

// ---- served areas ----------------------------------------------------------
const serves = rows.filter((x) => x.fact_type === "PANEL_SERVES_AREA" && t(x.relation).toUpperCase() === "SERVES");
const areas = serves.map((r) => t(r.object));
const topology = rows.find((x) => x.fact_type === "FIRE_ALARM_NETWORK_TOPOLOGY");
const panelExists = rows.filter((x) => x.fact_type === "PANEL_EXISTS");

console.log(`PROJECT ${P}`);
console.log(`approved architecture v${version.version_number} (${version.status}), ${rows.length} facts`);
console.log(`\nAPPROVED CAMPUS TOPOLOGY: ${topology ? t(topology.object) : "none"}`);
console.log(`=> ${areas.length} approved FACP served areas: ${areas.join(", ")}`);

// ---- BOQ sections ----------------------------------------------------------
const sections = db.prepare(`SELECT section, COUNT(*) itemCount, SUM(numeric_quantity) quantity FROM boq_items
  WHERE project_id=? AND approved_for_downstream=1 AND numeric_quantity IS NOT NULL GROUP BY section`).all(P);
const items = db.prepare(`SELECT id, description, section, numeric_quantity quantity FROM boq_items
  WHERE project_id=? AND approved_for_downstream=1 AND numeric_quantity IS NOT NULL`).all(P);

// ---- D. panel inventory ----------------------------------------------------
console.log("\n=== D. PHYSICAL PANEL INVENTORY ===");
const inventory = [];
for (const r of panelExists) {
  const id = canon(r);
  const lrows = loopsByPanel.get(id) || (id ? [] : loopsByPanel.get(`UNRESOLVED@${sheetOf(r)}`) || []);
  const sheet = sheetOf(r);
  inventory.push({
    panelId: id || `UNRESOLVED_FACP@${sheet}`,
    role: r.subject,
    identityResolved: Boolean(id),
    sheet,
    loops: classifyLoops({
      drawnLoops: lrows.length || null,
      source: lrows.length ? "SLC_LOOP_EXISTS (approved)" : null,
      sheet: lrows.length ? sheet : null,
      page: lrows[0]?.source_page ?? null,
      ambiguous: lrows.length > 1 && new Set(lrows.map((x) => sheetOf(x))).size > 1,
    }),
    nacCircuits: nacByPanel.get(id) ?? nacByPanel.get(`UNRESOLVED@${sheetOf(r)}`) ?? null,
  });
}
// Panels whose only approved evidence is a served area (no PANEL_EXISTS row).
for (const r of serves) {
  const area = t(r.object);
  const key = `AREA_ONLY:${area}`;
  if (inventory.some((p) => p.panelId === key)) continue;
  inventory.push({
    panelId: key,
    role: "FACP",
    identityResolved: false,
    sheet: null,
    servedArea: area,
    loops: classifyLoops({ drawnLoops: null }),
    nacCircuits: null,
  });
}
console.log(`  panel identity (resolved)          : ${inventory.filter((p) => p.identityResolved).length}`);
console.log(`  panel identity (UNRESOLVED)        : ${inventory.filter((p) => !p.identityResolved).length}`);
for (const p of inventory) {
  console.log(`   ${p.identityResolved ? "OK " : "?? "} ${p.panelId.padEnd(28)} role=${p.role.padEnd(5)} loops=${String(p.loops.drawnLoops ?? "PENDING").padStart(7)} (${p.loops.state}) nac=${p.nacCircuits ?? "PENDING"} sheet=${p.sheet ?? "-"}`);
}

// ---- E/F. right-sizing + expansion ----------------------------------------
console.log("\n=== E/F. RIGHT-SIZING + LOOP EXPANSION ===");
const sized = [];
for (const p of inventory) {
  const rs = rightSizePanel({
    panelId: p.panelId,
    loops: p.loops,
    capabilities: CAPABILITIES,
    detectorDemand: null,
    moduleDemand: null,
    nacCircuits: p.nacCircuits,
  });
  // Expansion hardware is determinate only when the evidence leaves exactly
  // ONE admissible family. If two families remain admissible the panel model is
  // still open and 6815/5815RMK quantities are not determinate -- IFP-75 has
  // no evidenced expansion path at all, so the family choice gates the hardware.
  const determinate = rs.candidates.length === 1;
  const exp = determinate
    ? expansionForPanel({
      panelId: p.panelId, drawnLoops: p.loops.drawnLoops,
      panelPn: rs.candidates[0], capability: CAPABILITY_BY_PN.get(rs.candidates[0]),
      loopCardsPerKit: LOOP_CARDS_PER_KIT ?? 2,
    })
    : expansionForPanel({ panelId: p.panelId, drawnLoops: p.loops.drawnLoops, panelPn: null, capability: null, loopCardsPerKit: LOOP_CARDS_PER_KIT ?? 2 });
  sized.push({ ...p, rightSizing: rs, expansion: exp });
  console.log(`   ${p.panelId}`);
  console.log(`      admissible   : ${rs.candidates.join(", ") || "none"}${determinate ? "   (exactly one -> expansion determinate)" : ""}`);
  console.log(`      right-sizing : ${rs.status}  selected=${rs.selected ?? "NONE"}`);
  console.log(`      expansion    : status=${exp.status} required=${exp.requiredLoops ?? "PENDING"} included=${exp.includedLoops ?? "?"} 6815=${exp.loopCards ?? "PENDING"} 5815RMK=${exp.kits ?? "PENDING"}${exp.provenMaximum != null ? ` (proven max ${exp.provenMaximum})` : ""}`);
  if (rs.blockers.length) console.log(`      blockers     : ${rs.blockers[0]}`);
}

// ---- J. aggregate vs installed -------------------------------------------
const ag = aggregateCrossCheck({ panels: inventory, campusLoopMinimum: 10 });
console.log("\n=== J. AGGREGATE vs PER-PANEL ===");
console.log(`   campus theoretical loop floor        : ${ag.campusLoopMinimum}`);
console.log(`   drawn loops on evidenced sheets      : ${ag.drawnLoopTotalOnEvidencedSheets}`);
console.log(`   aggregate method cards               : ${ag.aggregateMethodCards}`);
console.log(`   per-panel method cards (evidenced)   : ${ag.perPanelMethodCards}`);
console.log(`   divergence                           : ${ag.divergence > 0 ? "+" : ""}${ag.divergence} cards`);

// ---- K. quantity watchlist -------------------------------------------------
const wl = quantityWatchlist({ sections, items: [...items, { areas }] });
console.log("\n=== K. QUANTITY RECONCILIATION WATCHLIST ===");
for (const w of wl) {
  console.log(`   [${w.severity}] ${w.family}`);
  if (w.description) console.log(`      ${w.description}  x${w.occurrences} across ${w.sections.length} sections`);
  if (w.section) console.log(`      section: ${w.section}`);
  if (w.area) console.log(`      area: ${w.area}`);
  if (w.sections && w.family === "SUMMARY_DETAIL_OVERLAP") console.log(`      ${w.sections.map((s) => `${s.section} (${s.items} items, qty ${s.quantity})`).join("\n      ")}`);
  console.log(`      note: ${w.note}`);
}

// ---- I. NAC / RPS ---------------------------------------------------------
console.log("\n=== I. NAC / RPS PER BUILDING ===");
for (const p of sized) {
  console.log(`   ${p.panelId.padEnd(28)} documented NAC circuits=${p.nacCircuits ?? "PENDING"} device allocation=UNKNOWN candela=UNKNOWN routing=UNKNOWN -> RPS_FINAL_QUANTITY_PENDING_BUILDING_NAC_ALLOCATION`);
}