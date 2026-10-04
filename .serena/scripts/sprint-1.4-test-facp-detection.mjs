#!/usr/bin/env node
/**
 * Sprint 1.4 -- test the confirmed FACP legend shape signatures against the
 * real, unmodified vector geometry of ONE representative FAS layout
 * (Cluster 2, Level 0), reusing the exact same extraction approach as
 * app/domain/drawing-symbol-recognition-engine.mjs's pageGeometry(). Reports
 * every match with its real drawing coordinates, confidence, and provenance
 * -- no manual hand-count, no assumption about how many matches "should"
 * exist.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.4-test-facp-detection.mjs <db-path>");
const raw = new DatabaseSync(dbPath, { readOnly: true });
const PROJECT_ID = "project_c8d6ffe8-a781-4bdf-94aa-a40eea873920";
const LAYOUT_PATH = "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/FAS/DWG/Layout/BV-BSW-127-0000-OMR-DWG-EL-2LG-1223090-A.pdf";

const canvasMod = await import("@napi-rs/canvas");
globalThis.DOMMatrix = canvasMod.DOMMatrix;
globalThis.ImageData = canvasMod.ImageData;
globalThis.Path2D = canvasMod.Path2D;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const confirmedFacp = raw.prepare(`
  SELECT f.entity_id, f.predicate, f.value FROM engineering_facts f
  WHERE f.project_id=? AND f.entity_type='Fire Alarm Legend Symbol' AND f.entity_id='fas_legend_symbol_facp' AND f.status='Active'
`).all(PROJECT_ID);
const facpFacts = Object.fromEntries(confirmedFacp.map((r) => [r.predicate, r.value]));
const facpSignatures = new Set(JSON.parse(facpFacts.shape_signatures));
console.log("Confirmed FACP signatures under test:", [...facpSignatures]);
console.log("Legend confidence class:", facpFacts.confidence_class);

const buf = readFileSync(LAYOUT_PATH);
const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true, useSystemFonts: true, isEvalSupported: false }).promise;
const page = await pdf.getPage(1);
const viewport = page.getViewport({ scale: 1 });

const OPS = pdfjs.OPS;
const round = (v, p = 2) => Math.round(Number(v || 0) * 10 ** p) / 10 ** p;
const multiply = (m, n) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
const point = (m, x, y) => ({ x: m[0]*x+m[2]*y+m[4], y: m[1]*x+m[3]*y+m[5] });
const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); };
const flatten = (value) => ArrayBuffer.isView(value) ? [...value] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === "number" ? [value] : [];
const signature = (operators, coordinates, bounds) => { const width = Math.max(.001, bounds[2]-bounds[0]), height = Math.max(.001, bounds[3]-bounds[1]), coords = flatten(coordinates), normalized = []; for (let i = 0; i < coords.length; i += 3) normalized.push(round((coords[i]-bounds[0])/width,1), round((coords[i+1]-bounds[1])/height,1), coords[i+2] ?? null); return `shape:${hash(JSON.stringify([operators, normalized, round(width/height,1)]))}`; };

const list = await page.getOperatorList();
const shapes = []; const stack = []; let matrix = [1, 0, 0, 1, 0, 0];
for (let i = 0; i < list.fnArray.length; i++) {
  const fn = list.fnArray[i], args = list.argsArray[i] || [];
  if (fn === OPS.save) stack.push([...matrix]);
  else if (fn === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
  else if (fn === OPS.transform) matrix = multiply(matrix, args);
  else if (fn === OPS.constructPath) {
    const bounds = Array.from(args[2] || []).map(Number);
    if (bounds.length < 4 || !bounds.every(Number.isFinite)) continue;
    const corners = [point(matrix,bounds[0],bounds[1]), point(matrix,bounds[2],bounds[1]), point(matrix,bounds[2],bounds[3]), point(matrix,bounds[0],bounds[3])];
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
    if (box.width < 2 || box.height < 2 || box.width > 220 || box.height > 220) continue;
    const sig = signature(args[0], args[1], bounds);
    if (facpSignatures.has(sig)) shapes.push({ box, sig });
  }
}

console.log(`\nTotal shape occurrences on this layout page matching a confirmed FACP signature: ${shapes.length}`);
console.log("(FACP's confirmed icon is a 3-part compound shape -- 3 occurrences of the SAME part at the SAME position = 1 real FACP instance, so group by position.)");

const grouped = new Map();
for (const s of shapes) {
  const key = `${round(s.box.x, 0)}:${round(s.box.y, 0)}`;
  const g = grouped.get(key) || { parts: new Set(), box: s.box, count: 0 };
  g.parts.add(s.sig); g.count++;
  grouped.set(key, g);
}
console.log(`\nDistinct spatial clusters (candidate real FACP instances): ${grouped.size}`);
let idx = 0;
for (const [key, g] of grouped) {
  idx++;
  const partsMatched = g.parts.size;
  const confidence = partsMatched === facpSignatures.size ? 85 : Math.round(85 * partsMatched / facpSignatures.size);
  console.log(`  Instance ${idx}: raw PDF coords (${key}), parts matched ${partsMatched}/${facpSignatures.size}, confidence ${confidence}%`);
}
if (grouped.size === 0) console.log("  NONE FOUND on this layout page.");
