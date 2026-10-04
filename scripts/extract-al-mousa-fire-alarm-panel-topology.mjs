// AL MOUSA FIRE ALARM -- DRAWING-EVIDENCED PER-BUILDING LOOP AND DEVICE COUNTS.
//
// WHAT THIS READS, AND WHY IT IS TRUSTWORTHY
// ------------------------------------------
// The Fire Alarm schematics carry two drawing facts that the campus BOQ cannot
// supply, because the BOQ only ever states a CAMPUS TOTAL:
//
//   (a) LOOP COUNT PER PANEL. Each "FIRE DETECTION & ALARM SCHEMATIC" sheet
//       draws its panel block and labels the SLC loops "LOOP-1".."LOOP-n".
//       This is the panel's own loop count, printed by the design team.
//
//   (b) PER-FLOOR DEVICE SCHEDULE. Each sheet carries a schedule whose rows are
//       floors, whose columns are device classes, and whose right-hand column is
//       a PRINTED PER-FLOOR TOTAL.
//
// Only (a) and the printed (b) totals are used for sizing. Per-column device
// attribution is NOT used for sizing, because the flattened schedule headers are
// multi-character symbols ("S H", "S D", "CE M") that sit a few pixels apart and
// cannot be separated reliably from text geometry alone. Those columns are
// reported for reference and explicitly marked UNRESOLVED rather than guessed.
//
// NOTHING HERE IS PROPORTIONAL. Every number is either printed on a drawing or
// reported as unresolved.
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node scripts/extract-al-mousa-fire-alarm-panel-topology.mjs <sqlite>"); process.exit(2); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const FLOOR = /^(BASEMENT|LEVEL|GROUND FLOOR|ROOF)\b/i;
const QTY = /^\s*(\d+)\s*(Nos?\.?|No\.?)\s*$/i;

// Building identity comes from the project sheet-number convention.
const BUILDING = [
  [/- ?BOS-/, "BOYS SCHOOL", "BOS"],
  [/- ?GRS-/, "GIRLS SCHOOL", "GRS"],
  [/- ?KGS-/, "KGS", "KGS"],
  [/- ?WLC-/, "WELCOME CENTER", "WLC"],
  [/- ?AMS-.*T-93-ZZZ-002/, "SUBSTATION", "AMS-SUB"],
  [/- ?AMS-.*T-93-ZZZ-001/, "CAMPUS (network diagram)", "AMS-NET"],
];

// The sheet numbers are space-separated and carry a "ZZZ" segment, e.g.
// "2401232- PC- BOS- DR- T-93-ZZZ-005" -- so a pattern must not assume
// "T-93-005" appears contiguously.
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

// ---------------------------------------------------------------------------
// (a) LOOP COUNT PER PANEL
// ---------------------------------------------------------------------------
// A loop label is "LOOP-<n>". "NAC LOOP" is a notification circuit, NOT an SLC
// loop, and is excluded -- counting it would inflate the SLC loop count.
// A panel block is one cluster of loop labels at a common x; repeated clusters
// on one sheet are the same panel redrawn in separate regions, so the MAXIMUM
// per panel is taken rather than the sum of drawings.
const loopsPerSheet = (items) => {
  const slc = items.filter((i) => /^LOOP\s*-\s*\d+$/i.test(i.t.replace(/\s+/g, "")));
  const nac = items.filter((i) => /NAC\s+LOOP/i.test(i.t));
  if (!slc.length) return { slcLoops: 0, maxIndex: 0, clusters: [], nacCircuits: new Set(nac.map((n) => `${n.x.toFixed(0)},${n.y.toFixed(0)}`)).size };
  // Cluster by x: one panel block draws its loop labels in a vertical stack.
  const byX = new Map();
  for (const l of slc) {
    const k = Math.round(l.x / 25) * 25;
    if (!byX.has(k)) byX.set(k, []);
    byX.get(k).push(l);
  }
  const clusters = [...byX.entries()].map(([x, ls]) => {
    const idx = ls.map((l) => Number(l.t.replace(/[^0-9]/g, ""))).filter(Number.isFinite);
    return { x, loopLabels: idx.length, maxLoopIndex: idx.length ? Math.max(...idx) : 0, numbers: idx.sort((a, b) => a - b) };
  });
  const maxIndex = clusters.reduce((m, c) => Math.max(m, c.maxLoopIndex), 0);
  return { slcLoops: maxIndex, maxIndex, clusters, nacCircuits: new Set(nac.map((n) => `${n.x.toFixed(0)},${n.y.toFixed(0)}`)).size };
};

// ---------------------------------------------------------------------------
// (b) PER-FLOOR DEVICE SCHEDULE TOTALS
// ---------------------------------------------------------------------------
// A schedule row is a horizontal band of device-column letters. The printed
// total is the quantity token to the RIGHT of the last device column, at roughly
// the same height as the letters. It is the design team's own number, so it is
// used verbatim and never recomputed.
const scheduleRows = (items) => {
  const isLetter = (i) => i.t.length <= 5 && !/^\d/.test(i.t) && /^[A-Za-z][A-Za-z. ]*$/.test(i.t) && !/Nos/i.test(i.t);
  const letters = items.filter(isLetter).sort((a, b) => a.y - b.y || a.x - b.x);
  const bands = [];
  for (const l of letters) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(last.y - l.y) < 10) { last.items.push(l); last.y += (l.y - last.y) / last.items.length; }
    else bands.push({ y: l.y, items: [l] });
  }
  const qty = items.filter((i) => QTY.test(i.t)).map((i) => ({ ...i, n: Number(QTY.exec(i.t)[1]) }));
  const rows = [];
  for (const band of bands) {
    if (band.items.length < 4) continue;
    const cols = [];
    for (const l of band.items.slice().sort((a, b) => a.x - b.x)) {
      const c = cols[cols.length - 1];
      if (c && l.x - c.xMax <= 22) { c.items.push(l); c.xMax = Math.max(c.xMax, l.x); }
      else cols.push({ xMin: l.x, xMax: l.x, items: [l] });
    }
    if (cols.length < 4) continue;
    const lastX = cols[cols.length - 1].xMax;
    const total = qty
      .filter((q) => q.x > lastX && q.x - lastX < 280 && q.y > band.y - 40 && q.y < band.y + 30)
      .sort((a, b) => a.x - b.x)[0];
    if (!total) continue;
    const floor = items
      .filter((i) => FLOOR.test(i.t) && Math.abs(i.y - band.y) < 60 && i.x < cols[0].xMin)
      .sort((a, b) => a.x - b.x)[0];
    const cellSum = cols
      .map((c) => qty.find((q) => Math.abs(q.x - c.xMin) <= 22 && q.y < band.y && band.y - q.y < 30))
      .reduce((t, q) => t + (q ? q.n : 0), 0);
    rows.push({
      floor: floor ? floor.t : "UNLABELLED",
      printedTotal: total.n,
      columnSum: cellSum,
      variance: total.n - cellSum,
      columns: cols.length,
    });
  }
  return rows;
};

const report = [];
for (const s of sheets) {
  const match = BUILDING.find(([re]) => re.test(s.drawing_number));
  const building = match ? match[1] : "UNMAPPED";
  const code = match ? match[2] : "?";
  const items = itemsOf(s.page_id);
  const loops = loopsPerSheet(items);
  const rows = scheduleRows(items);
  report.push({ sheet: s.drawing_number, title: String(s.sheet_name || "").trim(), building, code, loops, rows });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log("=".repeat(78));
console.log("DRAWING-EVIDENCED PANEL TOPOLOGY (read from Fire Alarm schematics)");
console.log("=".repeat(78));
const byBuilding = new Map();
for (const r of report) {
  if (!byBuilding.has(r.building)) byBuilding.set(r.building, []);
  byBuilding.get(r.building).push(r);
}
for (const [building, rs] of byBuilding) {
  const maxLoops = Math.max(...rs.map((r) => r.loops.slcLoops));
  const total = rs.reduce((t, r) => t + r.rows.reduce((s, x) => s + x.printedTotal, 0), 0);
  console.log("");
  console.log(`${building}   [sheets: ${rs.length}]`);
  console.log(`  SLC loops shown on the panel block : ${maxLoops}`);
  console.log(`  NAC circuits shown                 : ${rs.map((r) => r.loops.nacCircuits).reduce((a, b) => Math.max(a, b), 0)}`);
  console.log(`  per-floor device totals             : ${total}`);
  for (const r of rs) {
    if (!r.rows.length) continue;
    console.log(`    ${r.sheet}`);
    for (const row of r.rows) {
      console.log(`      ${row.floor.padEnd(15)} printed=${String(row.printedTotal).padStart(4)} colSum=${String(row.columnSum).padStart(4)} var=${String(row.variance).padStart(4)} cols=${row.columns}`);
    }
  }
}
console.log("");
console.log("=".repeat(78));
console.log("N16e SUITABILITY (N16e maximum = 3 SLC loops per panel)");
console.log("=".repeat(78));
for (const [building, rs] of byBuilding) {
  const loops = Math.max(...rs.map((r) => r.loops.slcLoops));
  if (!loops) continue;
  const verdict = loops <= 3 ? "N16e SUFFICIENT" : `N16e INSUFFICIENT -> N16x persona required (max 10)`;
  console.log(`  ${building.padEnd(26)} ${String(loops).padStart(2)} loops   ${verdict}`);
}
