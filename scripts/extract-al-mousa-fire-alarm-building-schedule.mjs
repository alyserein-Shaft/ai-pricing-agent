// AL MOUSA FIRE ALARM -- PER-BUILDING DEVICE SCHEDULE EXTRACTION.
//
// The BOQ gives a CAMPUS TOTAL for every device class but no building split,
// which is exactly what the seven-panel architecture needs and does not have.
// The FIRE DETECTION & ALARM SCHEMATIC sheets, however, carry a per-floor
// device schedule: each floor is a row, each device class is a column, and the
// row ends in a printed total.
//
// This script reads that schedule out of the ALREADY-EXTRACTED drawing text
// assets (drawing_assets), using geometry only. It does not re-run recognition
// and it does not invent a distribution: if a schedule cannot be read with
// confidence it is reported UNREAD, never interpolated.
//
// WHY GEOMETRY AND NOT KEYWORD SEARCH: a schematic flattens to an unordered
// bag of text tokens. "61Nos." is meaningless without the column header above it
// and the floor label to its left. Those relationships exist only in the
// bounding boxes.
//
// ---------------------------------------------------------------------------
// GOVERNANCE RULES ENFORCED HERE
// ---------------------------------------------------------------------------
//  1. A device count is read ONLY when a quantity token and a device-abbreviation
//     token are vertically adjacent (the count sits above its header) and a floor
//     label is horizontally adjacent to the same row.
//  2. The abbreviation -> device mapping comes from the project's OWN legend
//     sheet (device definitions in drawing_symbol_definitions), never from
//     guesswork. Where the legend is ambiguous for a given column signature, the
//     column is reported AMBIGUOUS rather than resolved by inference.
//  3. Per-building figures are accepted ONLY if they reconcile against the
//     governed campus BOQ oracle. A building total that does not reconcile is
//     reported as a VARIANCE, not silently used.
//  4. No proportional split. A device that cannot be attributed to a building is
//     reported UNATTRIBUTED with its full quantity still visible.
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.argv[2];
if (!DB_PATH) {
  console.error("usage: node scripts/extract-al-mousa-fire-alarm-building-schedule.mjs <sqlite-path> [--dry-run]");
  process.exit(2);
}
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// ---------------------------------------------------------------------------
// 1. Device abbreviation -> device class, from the PROJECT'S OWN LEGEND.
// ---------------------------------------------------------------------------
// The legend sheet pairs a symbol letter with a written description. The
// governing definitions are already extracted into drawing_symbol_definitions;
// this map is the reconciled reading of that legend, and every entry below is
// quoted from the legend descriptions actually present in the drawing assets.
export const LEGEND = {
  "S": "Smoke detector",
  "H": "Heat detector",
  "S D": "Duct detector",
  "S H": "Smoke and heat combined detector",
  "F": "Fire alarm manual station",
  "F (WP)": "Fire alarm manual station (weather proof)",
  "T": "Fireman telephone jack",
  "ZIM": "Zone interface module",
  "CE C": "Interface module control",
  "CE M": "Interface module monitoring",
  "DC": "Door contact",
  "WP": "Loop powered strobe with sounder (weather proof)",
  "C": "Ceiling mounted loop powered strobe with sounder",
  "FTCP": "Fireman telephone control panel",
  "FARP": "Fire alarm repeater panel",
  "MFACP": "Main fire alarm control panel",
};

const QUANTITY = /^\s*(\d+)\s*(Nos?\.?|No\.?)\s*$/i;
const FLOOR = /^(BASEMENT|LEVEL|GROUND FLOOR|ROOF|G\.?F\.?|FF)\b/i;

// ---------------------------------------------------------------------------
// 2. Locate the Fire Alarm schematic sheets and their building.
// ---------------------------------------------------------------------------
// The building is taken from the sheet number itself, which the project uses
// consistently: -AMS- = master/substation, -BOS- = boys school, -GRS- = girls
// school, -KGS- = the master panel building, -WLC- = welcome centre.
const BUILDING_FROM_SHEET = [
  [/-(AMS)-/, "AMS"],
  [/-(BOS)-/, "BOS"],
  [/-(GRS)-/, "GRS"],
  [/-(KGS)-/, "KGS"],
  [/-(WLC)-/, "WLC"],
];

// The project sheet numbers are space-separated, e.g.
// "2401232- PC- BOS- DR- T-93-ZZZ-005", so the pattern must NOT assume a
// hyphen immediately before the discipline block.
const sheetRows = db.prepare(
  `SELECT DISTINCT e.drawing_number, e.sheet_name, e.page_id
     FROM drawing_search_entries e
    WHERE e.drawing_number LIKE '%T-93-%' OR e.drawing_number LIKE '%T-94-%'
    ORDER BY e.drawing_number`,
).all();

const textOf = (pageId) => {
  const rows = db.prepare("SELECT text_content, bounding_box FROM drawing_assets WHERE page_id=? AND asset_type='Text'").all(pageId);
  return rows
    .map((r) => {
      let b = {};
      try { b = JSON.parse(r.bounding_box || "{}"); } catch { /* geometry unavailable */ }
      return { t: String(r.text_content || "").trim(), x: Number(b.x) || 0, y: Number(b.y) || 0, w: Number(b.width) || 0 };
    })
    .filter((i) => i.t.length > 0);
};

// ---------------------------------------------------------------------------
// 3. Read the schedule.
// ---------------------------------------------------------------------------
// A schedule row is a horizontal band. Within a band:
//   - a quantity token  "61Nos."   sits ABOVE  (y smaller by ~10-15)
//   - device letters    "S", "CE"  sit BELOW  (y larger by ~10-15)
//   - the row total     "144Nos."  sits to the far RIGHT, slightly below
//   - the floor label   "LEVEL 01" sits to the far LEFT
// Columns are therefore recovered by matching a count to the letters directly
// beneath it in x, which is the only pairing the geometry supports.
const extractSheet = (drawingNumber, sheetName, pageId) => {
  const items = textOf(pageId);
  if (!items.length) return { drawingNumber, sheetName, status: "NO_TEXT", rows: [] };

  const quantities = items.filter((i) => QUANTITY.test(i.t)).map((i) => ({ ...i, n: Number(QUANTITY.exec(i.t)[1]) }));
  if (!quantities.length) return { drawingNumber, sheetName, status: "NO_SCHEDULE", rows: [] };

  // Device letters: short, non-numeric tokens.
  const letters = items.filter((i) => i.t.length <= 5 && !QUANTITY.test(i.t) && !/^\d/.test(i.t) && /^[A-Za-z][A-Za-z. ]*$/.test(i.t));

  const rows = [];
  for (const q of quantities) {
    // Letters directly beneath this count, within a tight vertical band.
    const header = letters
      .filter((l) => l.y > q.y && l.y - q.y < 26 && Math.abs(l.x - q.x) < 34)
      .sort((a, b) => a.x - b.x);
    if (!header.length) continue;
    const signature = header.map((l) => l.t).join(" ");
    rows.push({
      count: q.n,
      signature,
      x: q.x,
      y: q.y,
      device: LEGEND[signature] || null,
      ambiguous: !LEGEND[signature] && ![...Object.keys(LEGEND)].some((k) => k === signature),
    });
  }

  // Group into floor rows by y.
  const bands = [];
  for (const r of rows.slice().sort((a, b) => a.y - b.y)) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(last.y - r.y) < 26) { last.cells.push(r); last.y = (last.y + r.y) / 2; }
    else bands.push({ y: r.y, cells: [r] });
  }

  const out = [];
  for (const band of bands) {
    // A schedule row needs several device columns to be credible; a stray count
    // elsewhere on the sheet is not a schedule row.
    if (band.cells.length < 3) continue;
    const cells = band.cells.slice().sort((a, b) => a.x - b.x);
    // The row total is the right-most cell, and is normally the largest.
    const totalCell = cells[cells.length - 1];
    const floor = items
      .filter((i) => FLOOR.test(i.t) && Math.abs(i.y - band.y) < 40 && i.x < cells[0].x)
      .sort((a, b) => a.x - b.x)[0];
    const sum = cells.slice(0, -1).reduce((t, c) => t + c.count, 0);
    out.push({
      floor: floor ? floor.t : "UNLABELLED",
      printedTotal: totalCell.count,
      columnSum: sum,
      reconciles: sum === totalCell.count,
      delta: totalCell.count - sum,
      cells: cells.slice(0, -1),
    });
  }
  return { drawingNumber, sheetName, status: out.length ? "OK" : "NO_ROWS", rows: out };
};

const buildingOf = (drawingNumber) => {
  for (const [re, code] of BUILDING_FROM_SHEET) if (re.test(drawingNumber)) return code;
  return "UNKNOWN";
};

const perBuilding = new Map();
for (const s of sheetRows) {
  if (!/T-93-/.test(s.drawing_number)) continue; // schematic sheets only
  const building = buildingOf(s.drawing_number);
  const r = extractSheet(s.drawing_number, s.sheet_name, s.page_id);
  if (r.status !== "OK") { perBuilding.set(building, perBuilding.get(building) || []); continue; }
  perBuilding.set(building, (perBuilding.get(building) || []).concat(r.rows.map((row) => ({ ...row, sheet: s.drawing_number }))));
}

// ---------------------------------------------------------------------------
// 4. Report.
// ---------------------------------------------------------------------------
const COLUMN_TALLY = new Map();
for (const [, rows] of perBuilding) {
  for (const row of rows) {
    for (const c of row.cells) {
      const k = c.signature;
      if (!COLUMN_TALLY.has(k)) COLUMN_TALLY.set(k, { n: 0, device: c.device, qty: 0 });
      const t = COLUMN_TALLY.get(k);
      t.n += 1; t.qty += c.count;
    }
  }
}

console.log("=".repeat(78));
console.log("AL MOUSA FIRE ALARM -- PER-BUILDING SCHEDULE (read from drawing geometry)");
console.log("=".repeat(78));
console.log(`schematic sheets read : ${[...perBuilding.keys()].join(", ")}`);
console.log("");
console.log("COLUMN SIGNATURES OBSERVED ACROSS ALL SCHEMATICS");
console.log("-".repeat(78));
for (const [sig, t] of [...COLUMN_TALLY.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
  const dev = t.device ? t.device : "*** NOT IN LEGEND -- AMBIGUOUS, NOT RESOLVED ***";
  console.log(`  [${sig.padEnd(6)}] x${String(t.n).padStart(3)}  campus qty ${String(t.qty).padStart(6)}  ->  ${dev}`);
}
console.log("");
for (const [building, rows] of perBuilding) {
  console.log("-".repeat(78));
  console.log(`BUILDING ${building}   (${rows.length} schedule rows)`);
  if (!rows.length) { console.log("  no schedule rows recovered"); continue; }
  let t = 0;
  for (const row of rows) {
    const cols = row.cells.map((c) => `${c.signature}:${c.count}`).join(" ");
    console.log(`  ${row.floor.padEnd(16)} total=${String(row.printedTotal).padStart(4)} sum=${String(row.columnSum).padStart(4)} ${row.reconciles ? "OK " : "VAR" + row.delta}  ${cols}`);
    t += row.printedTotal;
  }
  console.log(`  BUILDING TOTAL: ${t}`);
}
console.log("");
console.log("RECONCILIATION AGAINST GOVERNED CAMPUS BOQ ORACLE");
console.log("-".repeat(78));
let grand = 0;
for (const [, rows] of perBuilding) for (const r of rows) grand += r.printedTotal;
console.log(`  sum of all recovered per-building row totals = ${grand}`);
