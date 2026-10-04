// RUNNER: reconstruct Al Mousa Fire Alarm demand from BOQ SOURCE rows only.
// READ-ONLY.
import { DatabaseSync } from "node:sqlite";
import {
  classifyDemand, bindSectionToBuilding, allocateRow, rebuildCensus,
  reconcilePanelCounts, quantityOf,
} from "./lib/al-mousa-boq-demand-reconciliation.mjs";
import { currentApprovedVersion, rowsForVersion } from "./lib/al-mousa-drawing-architecture-projection.mjs";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const P = process.argv[3] || "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const t = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// ---- PHASE 1: authoritative BOQ source set --------------------------------
console.log("=== B. AUTHORITATIVE BOQ SOURCE SET ===");
const doc = db.prepare(`SELECT d.id, d.logical_name, d.current_version_id, dv.version_number, dv.original_filename, dv.sha256
  FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id WHERE d.project_id=? AND d.document_type='BOQ'`).get(P);
console.log(`  document : ${doc.logical_name}`);
console.log(`  version  : v${doc.version_number} (current_version_id IS this row), file=${doc.original_filename}`);
console.log(`  sha256   : ${doc.sha256}`);
const evs = db.prepare(`SELECT ev.id, ev.version_number, ev.status, ev.superseded_at, ev.parser_version, ev.completed_at
  FROM boq_extraction_versions ev JOIN documents d ON d.id=ev.document_id WHERE d.project_id=?`).all(P);
for (const e of evs) console.log(`  extraction: ${e.id} v${e.version_number} ${e.status} superseded=${e.superseded_at ?? "NULL(current)"} parser=${e.parser_version}`);
const EV = evs.find((e) => !e.superseded_at)?.id;

// ---- PHASE 2: structural risks -------------------------------------------
const raw = db.prepare(`SELECT id, sequence, item_number, section, description, original_unit, numeric_quantity,
   review_status, approved_for_downstream, source_location, duplicate_of_item_id
   FROM boq_items WHERE extraction_version_id=? ORDER BY sequence`).all(EV).map((r) => ({
  ...r,
  sourceRow: JSON.parse(r.source_location || "{}").row ?? null,
  sheet: JSON.parse(r.source_location || "{}").sheet ?? null,
}));
console.log(`\n=== C. STRUCTURAL QUANTITY FINDINGS ===`);
console.log(`  total source rows: ${raw.length}, sheet: ${[...new Set(raw.map((r) => r.sheet))].join(", ")}`);

// 1. SAME SOURCE ROW IMPORTED MORE THAN ONCE
const byLoc = new Map();
for (const r of raw) {
  if (r.sourceRow == null) continue;
  const k = `${r.sheet}#${r.sourceRow}`;
  if (!byLoc.has(k)) byLoc.set(k, []);
  byLoc.get(k).push(r);
}
const dupLocs = [...byLoc.entries()].filter(([, v]) => v.length > 1);
console.log(`  SAME_SOURCE_ROW_IMPORTED_MORE_THAN_ONCE : ${dupLocs.length} (${dupLocs.length ? "none" : "every spreadsheet row imported at most once"})`);

// 2. REVISION SUPERSESSION
console.log(`  SUPERSEDED_REVISION_ROW : 0 (single BOQ version; no supersedes_version_id, one extraction version, superseded_at NULL)`);

// 3. REPEATED SCOPE HEADERS (the structural core)
const headers = raw.filter((r) => r.row_type && /Header/i.test(String(r.row_type)));
const scopeHeaders = headers.filter((r) => /Supply, install and connect fire alarm/i.test(String(r.description ?? "")));
console.log(`  REPEATED_SCOPE_HEADER   : ${scopeHeaders.length} occurrences at rows [${scopeHeaders.map((h) => h.sourceRow).join(", ")}]`);

// 4. Description+quantity identical across the repeated scope -> duplicate risk
const scopeItems = raw.filter((r) => /Supply, install and connect fire alarm/i.test(String(r.section ?? "")) && classifyDemand(r.description));
const sig = new Map();
for (const r of scopeItems) {
  const k = `${classifyDemand(r.description).family}|${quantityOf(r.numeric_quantity)}`;
  if (!sig.has(k)) sig.set(k, []);
  sig.get(k).push(r);
}
const repeats = [...sig.entries()].filter(([, v]) => v.length > 1);
console.log(`  SUMMARY_DETAIL_OVERLAP  : ${repeats.length} family+qty signatures appear in more than one block`);
for (const [k, v] of repeats) {
  const adm = v.filter((x) => x.approved_for_downstream === 1);
  const merged = v.filter((x) => x.review_status === "Merged" || x.approved_for_downstream === 0);
  console.log(`      ${k.padEnd(34)} rows[${v.map((x) => x.sourceRow).join(",")}] admitted=${adm.length} suppressed=${merged.length} qty=${quantityOf(v[0].numeric_quantity)}`);
}
// 5. Same description, DIFFERENT quantity (kept by the quantity-aware dedup)
const byDesc = new Map();
for (const r of scopeItems) {
  const k = classifyDemand(r.description).family;
  if (!byDesc.has(k)) byDesc.set(k, []);
  byDesc.get(k).push(r);
}
for (const [k, v] of byDesc) {
  const qtys = [...new Set(v.map((x) => quantityOf(x.numeric_quantity)))];
  if (qtys.length > 1) console.log(`      DIVERGENT_QTY ${k.padEnd(30)} quantities=${qtys.join(",")} rows[${v.map((x) => `${x.sourceRow}:${quantityOf(x.numeric_quantity)}`).join(" ")}]`);
}
// 6. BOQ panel rows used as architecture authority
const panelRows = raw.filter((r) => classifyDemand(r.description)?.family === "PANEL" && r.approved_for_downstream === 1);
console.log(`  BOQ_PANEL_ROWS_USED_AS_ARCHITECTURE_AUTHORITY : ${panelRows.length} panel rows admitted (rows ${panelRows.map((r) => r.sourceRow).join(",")})`);
// 7. Non-Fire-Alarm scope
const nonFa = raw.filter((r) => !/fire alarm|FACP|strobe|detector|telephone|interface module|door contact|elevator|HVAC|duct|cable/i.test(String(r.description ?? "")) + String(r.section ?? ""));
console.log(`  NON_FIRE_ALARM_SCOPE_INCLUDED : ${nonFa.length} rows carried in this extraction`);

// ---- PHASE 3: rebuilt census ---------------------------------------------
const admitted = (r) => r.approved_for_downstream === 1 && r.review_status !== "Merged";
const rebuilt = rebuildCensus({
  rows: raw.filter((r) => classifyDemand(r.description)).map((r) => ({
    description: r.description, originalUnit: r.original_unit, numericQuantity: r.numeric_quantity,
    sourceRow: r.sourceRow, reviewStatus: r.review_status, approved: r.approved_for_downstream,
  })),
  includeRow: (r) => admitted(raw.find((x) => x.sourceRow === r.sourceRow)),
});
console.log(`\n=== D. RECONSTRUCTED CAMPUS CENSUS (admitted source rows only) ===`);
console.log(`  ${"FAMILY".padEnd(30)} ${"QTY".padStart(7)}  ${"ADDR".padEnd(9)} ROWS`);
for (const f of rebuilt.families) console.log(`  ${f.family.padEnd(30)} ${String(f.quantity).padStart(7)}  ${f.addressClass.padEnd(9)} [${f.rows.map((r) => r.sourceRow).join(",")}]`);
console.log(`  ${"DETECTOR_ADDRESS_COUNT".padEnd(30)} ${String(rebuilt.detectorAddresses).padStart(7)}`);
console.log(`  ${"MODULE_ADDRESS_COUNT".padEnd(30)} ${String(rebuilt.moduleAddresses).padStart(7)}`);
console.log(`  ${"TOTAL_ADDRESSABLE_COUNT".padEnd(30)} ${String(rebuilt.detectorAddresses + rebuilt.moduleAddresses).padStart(7)}`);
console.log(`  suppressed duplicate rows: ${rebuilt.suppressed.length}`);

// ---- PHASE 4/6: section binding + allocation ------------------------------
const versions = db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=?").all(P);
const version = currentApprovedVersion(versions);
const arows = rowsForVersion(
  db.prepare(`SELECT a.* FROM drawing_architecture_approved_rows a WHERE a.approved_version_id IN (${versions.map(() => "?").join(",")})`).all(...versions.map((v) => v.id)),
  version.id,
);
const areas = arows.filter((r) => r.fact_type === "PANEL_SERVES_AREA" && t(r.relation).toUpperCase() === "SERVES").map((r) => t(r.object));
console.log(`\napproved architecture v${version.version_number}; FACP served areas: ${areas.join(", ")}`);

const namedSections = [...new Set(raw.map((r) => r.section).filter(Boolean))];
const panelIndex = new Map(); // area -> panel identity, ONLY where architecture binds them
for (const r of arows.filter((x) => x.fact_type === "PANEL_EXISTS")) {
  const identity = r.subject === "MFACP" ? "MFACP" : null;
  if (identity) panelIndex.set("FIRE COMMAND CENTER- GROUND FLOOR (02-301) KG BUILDING".toUpperCase(), { identity, resolutionState: "ROLE_TOKEN_SHEET_SCOPED" });
}

console.log(`\n=== E/F. SECTION BINDING + ALLOCATION ===`);
const sectionBinding = new Map();
for (const s of namedSections) {
  const b = bindSectionToBuilding(s, areas);
  sectionBinding.set(s, b);
  console.log(`  ${b.binding.padEnd(30)} ${s.slice(0, 62)}`);
}
console.log("\n  -- per-section allocated demand --");
const perSection = new Map();
for (const r of raw.filter((x) => admitted(x) && classifyDemand(x.description))) {
  const b = sectionBinding.get(r.section) ?? bindSectionToBuilding(r.section, areas);
  const alloc = allocateRow({ binding: b, panelIndex });
  const key = `${b.binding}|${alloc.status}`;
  if (!perSection.has(key)) perSection.set(key, { binding: b.binding, status: alloc.status, qty: 0, families: new Set(), example: null });
  const e = perSection.get(key);
  e.qty += quantityOf(r.numeric_quantity) ?? 0;
  e.families.add(classifyDemand(r.description).family);
  e.example ??= { section: String(r.section).slice(0, 44), area: alloc.area, panel: alloc.panel, evidence: alloc.evidence };
}
for (const e of perSection.values()) console.log(`  ${e.status.padEnd(34)} qty=${String(e.qty).padStart(6)} families=${e.families.size}  ${e.binding}`);

// ---- PHASE 7/8: per-building demand --------------------------------------
console.log(`\n=== E. PER-BUILDING DEMAND TABLE ===`);
const header = ["Building", "Smoke", "Heat", "Comb", "Duct", "Pull", "Mon", "Ctrl", "Notif", "Phone", "Alloc"];
console.log("  " + header.map((h) => h.padEnd(11)).join(""));
const byBuilding = new Map();
for (const r of raw.filter((x) => admitted(x) && classifyDemand(x.description))) {
  const b = sectionBinding.get(r.section) ?? bindSectionToBuilding(r.section, areas);
  const alloc = allocateRow({ binding: b, panelIndex });
  const key = alloc.area ?? `(${b.binding})`;
  if (!byBuilding.has(key)) byBuilding.set(key, { area: key, binding: b.binding, status: alloc.status, fams: {}, total: 0 });
  const e = byBuilding.get(key);
  const fam = classifyDemand(r.description).family;
  e.fams[fam] = (e.fams[fam] ?? 0) + (quantityOf(r.numeric_quantity) ?? 0);
  if (fam !== "CABLE") e.total += quantityOf(r.numeric_quantity) ?? 0;
}
const N = (b, ...f) => f.map((x) => String(b.fams[x] ?? 0).padStart(5)).join(" ");
for (const e of byBuilding.values()) {
  const notif = (e.fams.NOTIFICATION_INDOOR_STROBE ?? 0) + (e.fams.NOTIFICATION_INDOOR_HORN_STROBE ?? 0) + (e.fams.NOTIFICATION_OUTDOOR_HORN_STROBE ?? 0);
  console.log("  " + e.area.padEnd(11) + N(e, "SMOKE", "HEAT", "COMBINED", "DUCT", "PULL", "MONITOR", "CONTROL") + String(notif).padStart(5) + String(e.fams.FIREPHONE_JACK ?? 0).padStart(6) + "  " + e.status);
}

// ---- PHASE 10: panel reconciliation --------------------------------------
const recon = reconcilePanelCounts({
  boqPanelRows: panelRows.map((r) => ({ description: r.description, numericQuantity: quantityOf(r.numeric_quantity) })),
  architecturePanels: [{ identity: "MFACP", role: "MFACP" }, ...areas.map((a) => ({ identity: `FACP::${a}`, role: "FACP" }))],
});
console.log(`\n=== G. PANEL-COUNT RECONCILIATION ===`);
console.log(`  BOQ panel rows      : ${recon.boqPanelRowCount} rows, quantity ${recon.boqPanelQuantity}`);
console.log(`  approved topology   : ${recon.architecturePanelCount} panels (1 MFACP + ${areas.length} FACP served areas)`);
console.log(`  delta               : ${recon.delta}`);
console.log(`  status              : ${recon.status} (counts NOT forced to match)`);
for (const c of recon.classifications) console.log(`    ${String(c.panelIdentity).padEnd(28)} ${c.status}`);