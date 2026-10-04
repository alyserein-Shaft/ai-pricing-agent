import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zlibSync } from "fflate";

// Phase 7C RED: text-tag eligibility must be orthogonal to geometry
// eligibility. Today a definition carrying ANY surviving shape signature
// LOSES its text signature (fallback ternary), so literal/composed Text Tag
// passes skip it entirely. Generalized synthetic abbreviations only
// (QQ/ZZ/RR) -- no benchmark classes, coordinates, or documents.
import { recognizeDrawingSymbols } from "../app/domain/drawing-symbol-recognition-engine.mjs";
import { captureLegendGeometry } from "../app/domain/drawing-legend-geometry-engine.mjs";

const buildPositionedPdf = (fragments, rects = [], polygons = []) => {
  const chunks = [];
  let offset = 0;
  const push = (text) => { const bytes = strToU8(text); chunks.push(bytes); offset += bytes.length; };
  const esc = (value) => value.replace(/[()\\]/g, "\\$&");
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const objects = [];
  objects.push({ id: 1, offset }); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push({ id: 2, offset }); push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push({ id: 3, offset }); push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 3000] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n");
  const text = fragments.map((f) => `BT /F1 12 Tf ${f.x} ${f.y} Td (${esc(f.text)}) Tj ET`).join(" ");
  const shapes = rects.map((r) => `${r.x} ${r.y} ${r.w} ${r.h} re f`).join(" ");
  const polygonOps = polygons.map((points) => `${points[0].x} ${points[0].y} m ${points.slice(1).map((p) => `${p.x} ${p.y} l`).join(" ")} h f`).join(" ");
  const content = `${shapes} ${polygonOps} ${text}`;
  const compressed = zlibSync(strToU8(content));
  objects.push({ id: 4, offset }); push(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  chunks.push(compressed); offset += compressed.length;
  push("\nendstream\nendobj\n");
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const entry of objects) xref += `${String(entry.offset).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.length; }
  return merged;
};
const pentagon = (cx, cy, r) => [0, 1, 2, 3, 4].map((i) => { const angle = -Math.PI / 2 + i * (2 * Math.PI / 5); return { x: Math.round((cx + r * Math.cos(angle)) * 100) / 100, y: Math.round((cy + r * Math.sin(angle)) * 100) / 100 }; });

// A hand-forged capture-shaped fragment with a 16-value coordinate stream
// (structurally distinctive: survives generic-primitive filtering).
const forgedFragment = (dx, dy) => ({
  operators: [],
  coordinates: [0, dx, dy, 1, dx + 10, dy, 1, dx + 10, dy + 10, 1, dx, dy + 10, 1, dx + 5, dy + 5, 4],
  sourceBounds: [dx, dy, dx + 10, dy + 10],
  transform: [1, 0, 0, 1, 0, 0],
  fill: null,
  stroke: null,
  boundingBox: { x: dx, y: dy, width: 10, height: 10 },
});
const rowOf = (abbreviation, geometry) => ({
  id: `row_${String(abbreviation || "none").replace(/\s+/g, "")}`,
  source_page: 1,
  sourceDocumentId: "doc_legend",
  abbreviation,
  description: "SYNTHETIC WIDGET",
  symbol_geometry: geometry,
  bounding_box: {},
  structural_confidence: 88,
});
const run = (targetPdf, rows) => recognizeDrawingSymbols(new Uint8Array(targetPdf), {
  targetDocumentId: "doc_target",
  approvedStructuralRows: rows,
});
const targetWithQQ = buildPositionedPdf([{ text: "QQ", x: 900, y: 900 }]);

// CASE A: literal text + surviving shape => BOTH channels eligible.
test("A: geometry-bearing definition keeps its literal text signature", async () => {
  const result = await run(targetWithQQ, [rowOf("QQ", [forgedFragment(100, 100)])]);
  const definition = result.definitions.find((d) => d.abbreviation === "QQ");
  assert.ok(definition, "definition exists");
  assert.ok(definition.shapeSignatures.some((s) => s.startsWith("shape:")), "shape channel retained");
  assert.ok(definition.shapeSignatures.includes("text:QQ"), "text channel retained alongside geometry");
  const tag = result.occurrences.find((o) => o.matchType === "Text Tag" && o.matchedDefinitionKey === definition.definitionKey);
  assert.ok(tag, "literal tag occurrence emitted for geometry-bearing definition");
  assert.equal(tag.confidence, 84);
  assert.equal(tag.shapeSignature, "text:QQ");
});

// CASE B: compound text + surviving shape => composed Text Tag eligible.
test("B: geometry-bearing compound definition keeps composed text eligibility", async () => {
  const target = buildPositionedPdf([{ text: "QQ", x: 500, y: 500 }, { text: "RR", x: 506, y: 509 }]);
  const result = await run(target, [rowOf("QQ RR", [forgedFragment(100, 100)])]);
  const definition = result.definitions.find((d) => d.abbreviation === "QQ RR");
  assert.ok(definition.shapeSignatures.includes("text:QQ RR"), "composed text signature retained");
  const tag = result.occurrences.find((o) => o.matchType === "Text Tag" && o.matchedDefinitionKey === definition.definitionKey);
  assert.ok(tag, "composed tag occurrence emitted for geometry-bearing compound definition");
  assert.equal(tag.nearbyText, "QQ RR");
});

// CASE C: geometry-only definition gains no fabricated text signature.
test("C: abbreviation-less geometry definition stays text-free", async () => {
  const result = await run(targetWithQQ, [rowOf(null, [forgedFragment(100, 100)])]);
  const definition = result.definitions[0];
  assert.ok(definition.shapeSignatures.every((s) => !s.startsWith("text:")), "no text signature without an abbreviation");
});

// CASE D: text-only definition behavior unchanged.
test("D: text-only definition keeps exact legacy fallback", async () => {
  const result = await run(targetWithQQ, [rowOf("QQ", [])]);
  const definition = result.definitions.find((d) => d.abbreviation === "QQ");
  assert.deepEqual(definition.shapeSignatures, ["text:QQ"], "fallback byte-identical");
});

// CASE E: geometry matching still works when both channels exist.
test("E: identical displaced geometry still Exact-matches with text present", async () => {
  const codeBox = { x: 100, y: 450, width: 10, height: 5 };
  const legendRow = {
    id: "row_zz", source_page: 1, source_row: "9", symbol_geometry: [],
    bounding_box: { x: codeBox.x, y: codeBox.y - 6, width: codeBox.width + 2, height: 90 },
    abbreviation: "ZZ", description: "SYNTHETIC WIDGET",
    source_snapshot: { cells: [{ id: "zz-sym", column_number: 1, bounding_box: { ...codeBox }, raw_content: "ZZ", reconstructed_content: "ZZ", original_fragments: [{ id: "zz-f", text: "ZZ", boundingBox: { ...codeBox } }] }] },
  };
  const legendPdf = buildPositionedPdf([{ text: "ZZ", x: 100, y: 450 }], [], [pentagon(104, 452, 4), pentagon(112, 452, 4)]);
  const captured = await captureLegendGeometry(new Uint8Array(legendPdf), [legendRow]);
  assert.equal(captured.missing.length, 0, "pentagon fixture must capture");
  const target = buildPositionedPdf([{ text: "ZZ", x: 900, y: 450 }], [], [pentagon(904, 452, 4), pentagon(912, 452, 4)]);
  const result = await run(target, [{ ...rowOf("ZZ", captured.candidates[0].geometry), source_page: 1 }]);
  const definition = result.definitions.find((d) => d.abbreviation === "ZZ");
  assert.ok(result.occurrences.some((o) => o.matchType === "Exact" && o.matchedDefinitionKey === definition.definitionKey), "geometry channel intact");
  assert.ok(result.occurrences.some((o) => o.matchType === "Text Tag" && o.matchedDefinitionKey === definition.definitionKey), "text channel added, not substituted");
});

// CASE F: no matching text => no tag from the text channel.
test("F: wrong nearby text never classifies through the text channel", async () => {
  const target = buildPositionedPdf([{ text: "QZ", x: 900, y: 900 }]);
  const result = await run(target, [rowOf("QQ", [forgedFragment(100, 100)])]);
  assert.equal(result.occurrences.filter((o) => o.matchType === "Text Tag").length, 0, "exact text equality still required");
});

// CASE G: all-generic geometry keeps the legacy text-only fallback.
test("G: generic-primitive geometry still falls back to text-only", async () => {
  const trivial = [{ operators: [], coordinates: [0, 0, 0, 1, 2, 2], sourceBounds: [0, 0, 2, 2], transform: [1, 0, 0, 1, 0, 0], fill: null, stroke: null, boundingBox: { x: 0, y: 0, width: 2, height: 2 } }];
  const result = await run(targetWithQQ, [rowOf("QQ", trivial)]);
  const definition = result.definitions.find((d) => d.abbreviation === "QQ");
  assert.deepEqual(definition.shapeSignatures, ["text:QQ"], "generic guard behavior unchanged");
});
