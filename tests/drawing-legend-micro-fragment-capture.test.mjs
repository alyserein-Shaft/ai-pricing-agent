import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zlibSync } from "fflate";
import { captureLegendGeometry } from "../app/domain/drawing-legend-geometry-engine.mjs";

// Phase 4C RED: T-00-style detector legend condition.
// A governed legend symbol composed of multiple sub-2pt vector fragments
// lives inside the row's symbol cell/band TOGETHER WITH abbreviation text
// (e.g. "H", "S D", "CE M"), so today the row is ineligible for capture:
//   1. sub-2pt fragments never survive parsing/capture filters, and
//   2. the capture fallback requires a structurally EMPTY symbol cell.
// Same positioned-PDF convention as tests/drawing-legend-geometry.test.mjs.
const buildPositionedPdf = (fragments, rects = []) => {
  const chunks = [];
  let offset = 0;
  const push = (text) => { const bytes = strToU8(text); chunks.push(bytes); offset += bytes.length; };
  const esc = (value) => value.replace(/[()\\]/g, "\\$&");
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const objects = [];
  objects.push({ id: 1, offset }); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push({ id: 2, offset }); push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push({ id: 3, offset }); push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 1000] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n");
  const text = fragments.map((fragment) => `BT /F1 12 Tf ${fragment.x} ${fragment.y} Td (${esc(fragment.text)}) Tj ET`).join(" ");
  const shapes = rects.map((rect) => `${rect.x} ${rect.y} ${rect.w} ${rect.h} re f`).join(" ");
  const content = `${shapes} ${text}`;
  const compressed = zlibSync(strToU8(content));
  objects.push({ id: 4, offset }); push(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  chunks.push(compressed); offset += compressed.length;
  push("\nendstream\nendobj\n");
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const entry of objects) xref += `${String(entry.offset).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.length; }
  return merged;
};

// Rotated-legend-style approved row: tiny code-only symbol cell (column 1)
// plus description cell (column 2), no pre-existing geometry.
const rotatedRow = (id, code, codeBox, description) => ({
  id,
  source_page: 1,
  source_row: id,
  symbol_geometry: [],
  bounding_box: { x: codeBox.x, y: codeBox.y - 6, width: codeBox.width + 2, height: 90 },
  abbreviation: code,
  description,
  source_snapshot: {
    cells: [
      {
        id: `${id}-sym`, column_number: 1,
        bounding_box: { ...codeBox },
        raw_content: code, reconstructed_content: code,
        original_fragments: [{ id: `${id}-frag`, text: code, boundingBox: { ...codeBox } }],
      },
      {
        id: `${id}-desc`, column_number: 2,
        boundingBox: undefined,
        bounding_box: { x: codeBox.x, y: codeBox.y + 80, width: codeBox.width, height: 50 },
        raw_content: description, reconstructed_content: description,
        original_fragments: [],
      },
    ],
  },
});

// TEST A — micro-fragment icon: three sub-2pt rects clustered around the
// code position must group into one reviewable candidate.
test("TEST A — micro-fragment icon inside a governed non-empty symbol cell becomes a reviewable candidate", async () => {
  const codeBox = { x: 100, y: 450, width: 10, height: 5 };
  const pdf = buildPositionedPdf(
    [{ text: "H", x: 100, y: 450 }, { text: "HEAT DETECTOR", x: 100, y: 530 }],
    [
      { x: 98.5, y: 448, w: 1.8, h: 1.8 },
      { x: 111, y: 452, w: 1.5, h: 2.2 },
      { x: 104, y: 454.5, w: 2.2, h: 1.2 },
    ],
  );
  const result = await captureLegendGeometry(new Uint8Array(pdf), [rotatedRow("r1", "H", codeBox, "HEAT DETECTOR")]);
  assert.equal(result.missing.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].geometry.length, 3);
  assert.ok(result.candidates[0].geometrySignature.startsWith("geom:"));
});

// TEST B — non-empty symbol cell: abbreviation text in the symbol cell must
// not make an otherwise valid row structurally ineligible (classic wide cell).
test("TEST B — abbreviation text in a wide symbol cell keeps the row eligible for geometry capture", async () => {
  const codeBox = { x: 200, y: 450, width: 80, height: 20 };
  const pdf = buildPositionedPdf(
    [{ text: "S D", x: 200, y: 450 }, { text: "DUCT DETECTOR", x: 300, y: 450 }],
    [
      { x: 205, y: 445, w: 1.9, h: 1.9 },
      { x: 208, y: 447, w: 1.6, h: 2.4 },
      { x: 210.5, y: 445, w: 2.4, h: 1.4 },
      { x: 213, y: 447, w: 1.4, h: 1.8 },
    ],
  );
  const row = rotatedRow("r2", "S D", codeBox, "DUCT DETECTOR");
  const result = await captureLegendGeometry(new Uint8Array(pdf), [row]);
  assert.equal(result.missing.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].geometry.length, 4);
});

// TEST C1 — text-only row: no vector geometry anywhere near the symbol cell
// must stay honestly missing, never a fabricated candidate.
test("TEST C1 — a text-only non-empty symbol cell is still reported missing, not guessed", async () => {
  const codeBox = { x: 100, y: 450, width: 10, height: 5 };
  const pdf = buildPositionedPdf([{ text: "H", x: 100, y: 450 }, { text: "HEAT DETECTOR", x: 100, y: 530 }]);
  const result = await captureLegendGeometry(new Uint8Array(pdf), [rotatedRow("r3", "H", codeBox, "HEAT DETECTOR")]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.missing.length, 1);
});

// TEST C2 — text separation: a vector fragment sitting inside the
// abbreviation glyph box must not become symbol geometry.
test("TEST C2 — vector fragments inside abbreviation glyph boxes are separated from the symbol", async () => {
  const codeBox = { x: 100, y: 450, width: 10, height: 5 };
  const pdf = buildPositionedPdf(
    [{ text: "H", x: 100, y: 450 }, { text: "HEAT DETECTOR", x: 100, y: 530 }],
    [
      { x: 98, y: 449.5, w: 2, h: 2 },
      { x: 106, y: 454, w: 1.6, h: 2.0 },
      { x: 101, y: 451, w: 1.5, h: 1.5 },
    ],
  );
  const result = await captureLegendGeometry(new Uint8Array(pdf), [rotatedRow("r4", "H", codeBox, "HEAT DETECTOR")]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].geometry.length, 2);
});

// TEST D — row boundary safety: geometry near a shared band edge must not
// leak into the neighboring row's candidate.
test("TEST D — neighboring legend-row geometry does not leak across the symbol band edge", async () => {
  const pdf = buildPositionedPdf(
    [
      { text: "H", x: 100, y: 450 }, { text: "HEAT DETECTOR", x: 100, y: 530 },
      { text: "F", x: 130, y: 450 }, { text: "MANUAL STATION", x: 130, y: 530 },
    ],
    [
      { x: 98.5, y: 448, w: 1.8, h: 1.8 },
      { x: 111, y: 452, w: 1.5, h: 2.2 },
      { x: 104, y: 454.5, w: 2.2, h: 1.2 },
      { x: 128.5, y: 448, w: 1.8, h: 1.8 },
      { x: 141, y: 452, w: 1.5, h: 2.2 },
      { x: 134, y: 454.5, w: 2.2, h: 1.2 },
    ],
  );
  const rows = [
    rotatedRow("d1", "H", { x: 100, y: 450, width: 10, height: 5 }, "HEAT DETECTOR"),
    rotatedRow("d2", "F", { x: 130, y: 450, width: 10, height: 5 }, "MANUAL STATION"),
  ];
  const result = await captureLegendGeometry(new Uint8Array(pdf), rows);
  assert.equal(result.candidates.length, 2);
  const first = result.candidates.find((c) => c.rowId === "d1");
  const second = result.candidates.find((c) => c.rowId === "d2");
  assert.equal(first.geometry.length, 3);
  assert.equal(second.geometry.length, 3);
  const firstXs = first.geometry.map((g) => g.boundingBox.x);
  const secondXs = second.geometry.map((g) => g.boundingBox.x);
  assert.ok(Math.max(...firstXs) < 120);
  assert.ok(Math.min(...secondXs) > 120);
});

// TEST E — existing normal symbols: pre-existing parse-time geometry is
// reused byte-identical; empty-cell recovery is unchanged.
test("TEST E — pre-existing geometry reuse and empty-cell recovery are regression safe", async () => {
  const preexisting = [
    { id: "s1", signature: "shape:aa", boundingBox: { x: 1, y: 2, width: 3, height: 4 } },
    { id: "s2", signature: "shape:bb", boundingBox: { x: 5, y: 6, width: 3, height: 4 } },
  ];
  const pdf = buildPositionedPdf([{ text: "placeholder", x: 20, y: 900 }], [{ x: 500, y: 400, w: 30, h: 30 }]);
  const reuseRow = {
    id: "e1", source_page: 1, source_row: 1, symbol_geometry: preexisting,
    bounding_box: null, abbreviation: "CR", description: "CARD READER", source_snapshot: { cells: [] },
  };
  const emptyCellRow = {
    id: "e2", source_page: 1, source_row: 2, symbol_geometry: [],
    bounding_box: null, abbreviation: null, description: null,
    source_snapshot: { cells: [{ id: "cell1", bounding_box: { x: 495, y: 395, width: 40, height: 40 }, reconstructed_content: "", raw_content: "" }] },
  };
  const result = await captureLegendGeometry(new Uint8Array(pdf), [reuseRow, emptyCellRow]);
  const reuse = result.candidates.find((c) => c.rowId === "e1");
  assert.deepEqual(reuse.geometry, preexisting);
  assert.equal(reuse.detectionMethod, "Reused geometry captured during structural parsing for this row");
  const recovered = result.candidates.find((c) => c.rowId === "e2");
  assert.equal(recovered.detectionMethod, "Native PDF vector paths wholly contained in structurally empty symbol cell");
  assert.equal(recovered.geometry.length, 1);
});

// TEST F — governed lifecycle: capture proposes only; review, segmentation,
// publish, and approved-link governance remain intact in source.
test("TEST F — repaired candidates still require review/segmentation/publish governance", async () => {
  const api = await import("node:fs/promises").then((fs) => fs.readFile("worker/drawing-legend-geometry-api.mjs", "utf8"));
  const segmentationApi = await import("node:fs/promises").then((fs) => fs.readFile("worker/symbol-cell-segmentation-api.mjs", "utf8"));
  const symbolApi = await import("node:fs/promises").then((fs) => fs.readFile("worker/drawing-symbol-recognition-api.mjs", "utf8"));
  for (const value of ["confirm", "reject", "reassign", "split-symbols", "merge-fragments", "restore"]) assert.match(api, new RegExp(value));
  assert.match(api, /Missing geometry cannot be approved/);
  assert.match(api, /review_status='Approved'/);
  assert.match(api, /drawing_legend_geometry_approved_versions/);
  assert.match(api, /"Needs Review"/);
  assert.match(segmentationApi, /drawing_legend_geometry_approved_links/);
  assert.match(symbolApi, /APPROVED_SYMBOL_GEOMETRY_REQUIRED/);
  const codeBox = { x: 100, y: 450, width: 10, height: 5 };
  const pdf = buildPositionedPdf(
    [{ text: "H", x: 100, y: 450 }],
    [{ x: 98.5, y: 448, w: 1.8, h: 1.8 }, { x: 111, y: 452, w: 1.5, h: 2.2 }],
  );
  const result = await captureLegendGeometry(new Uint8Array(pdf), [rotatedRow("f1", "H", codeBox, "HEAT DETECTOR")]);
  assert.equal(result.candidates.length, 1);
  assert.ok(!("review_status" in result.candidates[0]), "engine must not pre-approve; review status is set by the governed API layer");
  assert.ok(!Object.keys(result.candidates[0]).some((key) => key.startsWith("approved")), "engine must not publish approved links; publication is a separate governed step");
});
