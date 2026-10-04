/**
 * §6 image preparation + §9 project evidence retrieval.
 * READ-ONLY. Uses the CORRECTED viewport-transform rendering.
 * Benchmark truth is NOT placed into any evidence payload.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadSheet, renderPage } from "../out/coords/authoritative-coords.mjs";
import { PROJECT_ID } from "./benchmark-drawing-ai.mjs";

const DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const db = new DatabaseSync(DB, { readOnly: true });
const OUT = "out/benchmark/cases";
mkdirSync(OUT, { recursive: true });
const MAX_B64 = Number(process.env.MAX_B64 || 170_000); // project cap is 180,000

const SHEETS = {
  BOS: { like: "%BOS-DR-T-93%", name: "2401232-PC-BOS-DR-T-93-ZZZ-005.pdf" },
  GRS: { like: "%GRS-DR-T-93%", name: "2401232-PC-GRS-DR-T-93-ZZZ-005.pdf" },
  KGS: { like: "%KGS-DR-T-93%", name: "2401232-PC-KGS-DR-T-93-ZZZ-005 (1).pdf" },
  WLC: { like: "%WLC-DR-T-93%", name: "2401232-PC-WLC-DR-T-93-ZZZ-005 (3).pdf" },
  LEGEND: { like: "%AMS-DR-T-00-ZZZ-002%", name: "2401232-PC-AMS-DR-T-00-ZZZ-002.pdf" },
};

// ---- project evidence, retrieved programmatically (no conclusions) --------
function legendEvidence() {
  return db.prepare(`
    SELECT abbreviation, description, structural_confidence, source_page, source_row
    FROM drawing_structure_approved_rows
    WHERE description LIKE '%DETECTOR%' OR description LIKE '%MANUAL STATION%'
       OR description LIKE '%TELEPHONE%' OR description LIKE '%INTERFACE MODULE%'
       OR description LIKE '%STROBE%' OR description LIKE '%DOOR CONTACT%'
    GROUP BY abbreviation, description ORDER BY source_row`).all();
}
function symbolDefEvidence() {
  return db.prepare(`
    SELECT abbreviation, description, review_status, confidence
    FROM drawing_symbol_definitions
    WHERE review_status='Approved' AND (description LIKE '%DETECTOR%' OR description LIKE '%MANUAL%'
      OR description LIKE '%TELEPHONE%' OR description LIKE '%INTERFACE MODULE%' OR description LIKE '%STROBE%')
    GROUP BY abbreviation, description`).all();
}
function noteEvidence() {
  const rows = db.prepare(`SELECT text_content FROM drawing_assets
    WHERE text_content LIKE '%TELEPHONE%' OR text_content LIKE '%CEILING MOUNTED%'
       OR text_content LIKE '%MULTISENSOR%' OR text_content LIKE '%MULTI-SENSOR%'
    GROUP BY text_content`).all();
  return rows.map(r => r.text_content);
}

// ---- image rendering with ink validation ---------------------------------
async function makeImage(sheetKey, x, y, w, h, label) {
  const sh = await loadSheet(SHEETS[sheetKey].like);
  let S = Number(process.env.SCALE || 4);
  let canvas = await renderPage(sh.page, sh.vp1, S);
  let buf = crop(canvas, x, y, w, h, S);
  // Shrink until under the project's inline-image ceiling.
  while (buf.toString("base64").length > MAX_B64 && S > 1) {
    S -= 0.5;
    buf = crop(canvas, x, y, w, h, S);
  }
  const metrics = await inkMetrics(buf);
  const file = `${OUT}/${label}.png`;
  writeFileSync(file, buf);
  await sh.pdf.destroy();
  return { file, b64Chars: buf.toString("base64").length, scale: S, ...metrics, sheet: SHEETS[sheetKey].name };
}
function crop(canvas, x, y, w, h, S) {
  const c = createCanvas(Math.max(1, Math.round(w * S)), Math.max(1, Math.round(h * S)));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas,
    Math.max(0, Math.round(x * S)), Math.max(0, Math.round(y * S)),
    Math.min(Math.round(w * S), canvas.width), Math.min(Math.round(h * S), canvas.height),
    0, 0, c.width, c.height);
  return c.toBuffer("image/png");
}
async function inkMetrics(buf) {
  // Decode the produced PNG and measure real ink, so a blank crop can never
  // reach a model as if it were evidence.
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let ink = 0; const lum = [];
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    lum.push(v); if (v < 245) ink++;
  }
  const n = lum.length || 1;
  const mean = lum.reduce((a, b) => a + b, 0) / n;
  const vari = lum.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    width: img.width, height: img.height,
    inkFraction: +(ink / n).toFixed(5),
    variance: +vari.toFixed(1),
    drawingInkPresent: ink / n > 0.0008 && vari > 20,
  };
}

// ---- build the four cases -------------------------------------------------
const legend = legendEvidence();
const syms = symbolDefEvidence();
const notes = noteEvidence();

console.log("=== PROJECT EVIDENCE RETRIEVED (no conclusions) ===");
console.log(`  governed legend rows: ${legend.length}`);
for (const l of legend) console.log(`    ${String(l.abbreviation).padEnd(6)} | ${l.description} | conf=${l.structural_confidence} row=${l.source_row}`);
console.log(`  approved symbol definitions: ${syms.length}`);
for (const s of syms) console.log(`    ${String(s.abbreviation).padEnd(6)} | ${s.description}`);
console.log(`  drawing notes: ${notes.length}`);
for (const n of notes.slice(0, 12)) console.log(`    ${JSON.stringify(String(n).slice(0, 120))}`);

console.log("\n=== CASE IMAGES ===");
const cases = [
  // CASE A - T device symbol cluster in plan context (GRS)
  { id: "A-T-device", sheet: "GRS", x: 2232, y: 557, w: 227, h: 92 },
  // CASE B - the "S" + "C" schedule cell (BOS S@854 / C@863)
  { id: "B-Splus-modifier", sheet: "BOS", x: 846, y: 1525, w: 60, h: 24 },
  // CASE B context - wider view of the same schedule row
  { id: "B-context-row", sheet: "BOS", x: 700, y: 1524, w: 440, h: 38 },
  // CASE C - the "S" + "H" schedule cell (BOS S@927 / H@936)
  { id: "C-combined-cell", sheet: "BOS", x: 919, y: 1525, w: 60, h: 24 },
  // CASE C cross-doc - the governing legend detector block
  { id: "C-legend-detectors", sheet: "LEGEND", x: 935, y: 558, w: 340, h: 120 },
  // CASE D - the unknown two-letter token cell (BOS S@816 / HC@825)
  { id: "D-unknown-token", sheet: "BOS", x: 806, y: 1525, w: 66, h: 24 },
];
const built = [];
for (const c of cases) {
  const meta = await makeImage(c.sheet, c.x, c.y, c.w, c.h, c.id);
  built.push({ ...c, ...meta });
  console.log(`  ${c.id.padEnd(22)} ${meta.width || ""}${meta.file} b64=${meta.b64Chars} scale=${meta.scale}`);
}

writeFileSync(`${OUT}/evidence.json`, JSON.stringify({
  projectId: PROJECT_ID,
  governedLegendRows: legend,
  approvedSymbolDefinitions: syms,
  drawingNotes: notes,
  images: built,
}, null, 2));
console.log(`\nwrote ${OUT}/evidence.json`);
