import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { strToU8, zlibSync } from "fflate";
import { recognizeDrawingSymbols, textItemCanonicalBox } from "../app/domain/drawing-symbol-recognition-engine.mjs";
import { parseDrawingStructure } from "../app/domain/drawing-structural-parser.mjs";
import { mapCanonicalBoxToViewport } from "../app/domain/drawing-coordinate-mapper.mjs";

// Phase 8A-UX-R3 (2026-09-24): TextTag occurrence geometry for rotated text.
//
// A pdf.js text item reports its baseline origin as transform[4..5], its
// advance `width` along the text's own run direction (a,b) and its font
// `height` along the up direction (c,d). The recognition engine used to
// write {x:e, y:f, width, height} -- correct only for 0-degree text. On the
// /Rotate 90 WLC sheet every text run is drawn at 90 degrees in user space,
// so each TextTag box sat on the wrong side of its baseline with width and
// height swapped. The canonical box must be the axis-aligned bounds of the
// transformed run in the SAME unrotated user space the vector shapes and
// drawing-coordinate-mapper.mjs already use.

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);

// Independent reference: apply the text matrix to the run/up extents in text
// space and take the axis-aligned bounds of the four resulting corners.
const referenceBox = ([a, b, c, d, e, f], width, height) => {
  const u = width / Math.hypot(a, b);
  const v = height / Math.hypot(c, d);
  const corners = [
    [0, 0],
    [u, 0],
    [0, v],
    [u, v],
  ].map(([s, t]) => [a * s + c * t + e, b * s + d * t + f]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

const assertBox = (actual, expected, label) => {
  for (const key of ["x", "y", "width", "height"]) near(actual[key], expected[key], `${label} ${key}`);
};

test("0-degree text keeps exactly the legacy box (control)", () => {
  const box = textItemCanonicalBox([8, 0, 0, 8, 100, 200], 20, 8);
  assert.deepEqual(box, { x: 100, y: 200, width: 20, height: 8 });
});

test("90-degree text: real WLC 'F' tag item covers its glyph run and swaps extents", () => {
  const transform = [0, 6.0492, -8.1103, 0, 1215.7195, 1140.2401];
  const box = textItemCanonicalBox(transform, 3.6961, 8.1103);
  assertBox(box, referenceBox(transform, 3.6961, 8.1103), "wlc");
  near(box.x, 1215.7195 - 8.1103, "glyphs extend toward -x from the baseline");
  near(box.width, 8.1103, "width is the font height");
  near(box.height, 3.6961, "height is the advance");
  // inside the unrotated WLC page (view [0,0,2384,3370])
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 2384 && box.y + box.height <= 3370);
  // The baseline anchor stays on the box edge it belongs to.
  near(box.x + box.width, 1215.7195, "baseline x");
  near(box.y, 1140.2401, "run start y");
});

test("180-degree and 270-degree text are handled by the same transform semantics", () => {
  const t180 = [-8, 0, 0, -8, 500, 600];
  assertBox(textItemCanonicalBox(t180, 20, 8), { x: 480, y: 592, width: 20, height: 8 }, "180");
  assertBox(textItemCanonicalBox(t180, 20, 8), referenceBox(t180, 20, 8), "180 ref");
  const t270 = [0, -8, 8, 0, 300, 400];
  assertBox(textItemCanonicalBox(t270, 20, 8), { x: 300, y: 380, width: 8, height: 20 }, "270");
  assertBox(textItemCanonicalBox(t270, 20, 8), referenceBox(t270, 20, 8), "270 ref");
  // origin normalization is applied once, to the anchor only
  assertBox(textItemCanonicalBox(t270, 20, 8, 50, 60), { x: 250, y: 320, width: 8, height: 20 }, "270 origin");
});

test("corrected canonical box maps onto the glyph in pdf.js /Rotate 90 viewport space", () => {
  // pdf.js viewport for view [0,0,W,H] at rotation 90, scale 1: transform
  // [0,1,1,0,0,0] -> (vx, vy) = (y, x). Map the glyph corners directly and
  // compare with the viewer's own canonical -> viewport mapping of the box.
  const W = 2384, H = 3370;
  const transform = [0, 6.0492, -8.1103, 0, 1215.7195, 1140.2401];
  const ref = referenceBox(transform, 3.6961, 8.1103);
  const expected = { left: ref.y, top: ref.x, width: ref.height, height: ref.width };
  const mapped = mapCanonicalBoxToViewport(textItemCanonicalBox(transform, 3.6961, 8.1103), { pageWidth: W, pageHeight: H }, { scale: 1, rotation: 90 });
  for (const key of ["left", "top", "width", "height"]) near(mapped[key], expected[key], `viewport ${key}`);
});

// Positioned multi-page PDF with a per-fragment text matrix and per-page
// /Rotate, same construction as tests/drawing-symbol-recognition-engine.test.mjs.
// TextTag occurrences are only sought off the legend's own page, so the
// legend sits on page 1 and the tags on page 2.
const buildPdf = (pages) => {
  const chunks = [];
  let offset = 0;
  const push = (text) => { const bytes = strToU8(text); chunks.push(bytes); offset += bytes.length; };
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const offsets = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  offsets.push(offset); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets.push(offset); push(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach(({ fragments, rects = [], rotate = 0 }, i) => {
    const pageId = pageIds[i];
    offsets.push(offset);
    push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 3000] /Rotate ${rotate} /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${pageId + 1} 0 R >>\nendobj\n`);
    const text = fragments
      .map((f) => (f.matrix ? `BT /F1 12 Tf ${[...f.matrix, f.x, f.y].join(" ")} Tm (${f.text}) Tj ET` : `BT /F1 12 Tf ${f.x} ${f.y} Td (${f.text}) Tj ET`))
      .join(" ");
    const shapes = rects.map((r) => `${r.x} ${r.y} ${r.w} ${r.h} re f`).join(" ");
    const compressed = zlibSync(strToU8(`${shapes} ${text}`));
    offsets.push(offset); push(`${pageId + 1} 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
    chunks.push(compressed); offset += compressed.length;
    push("\nendstream\nendobj\n");
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const entry of offsets) xref += `${String(entry).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const merged = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let cursor = 0;
  for (const c of chunks) { merged.set(c, cursor); cursor += c.length; }
  return merged;
};
const approvedRowsFrom = (structure) =>
  structure.legendRows.map((row, index) => ({ id: `approvedRow${index}`, source_page: row.sourcePage, symbol_geometry: row.symbolGeometry, bounding_box: row.boundingBox, abbreviation: row.abbreviation, description: row.description, notes: row.notes, structural_confidence: row.confidence }));

for (const rotate of [0, 90]) {
  test(`engine TextTag occurrence box covers a 90-degree tag on a /Rotate ${rotate} page; 0-degree tag unchanged`, async () => {
    const pdf = buildPdf([
      {
        fragments: [{ text: "SYMBOL", x: 2900, y: 600 }, { text: "AB", x: 150, y: 560 }, { text: "SOME DEVICE", x: 150, y: 500 }, { text: "DESCRIPTION", x: 2900, y: 470 }],
        rects: [{ x: 145, y: 540, w: 10, h: 10 }],
      },
      {
        rotate,
        fragments: [{ text: "AB", x: 2000, y: 1500 }, { text: "AB", x: 2200, y: 2200, matrix: [0, 1, -1, 0] }],
      },
    ]);
    const structure = await parseDrawingStructure(new Uint8Array(pdf));
    const result = await recognizeDrawingSymbols(new Uint8Array(pdf), { approvedStructuralRows: approvedRowsFrom(structure) });
    const tags = result.occurrences.filter((o) => o.matchType === "Text Tag");
    const upright = tags.find((o) => o.occurrenceKey.includes(":2000:1500"));
    const rotated = tags.find((o) => o.occurrenceKey.includes(":2200:2200"));
    assert.ok(upright && rotated, "both tags must still be recognised (matching unchanged)");
    // upright: baseline at (2000,1500), runs +x, glyphs above
    near(upright.boundingBox.x, 2000, "upright x");
    near(upright.boundingBox.y, 1500, "upright y");
    assert.ok(upright.boundingBox.width > upright.boundingBox.height);
    // rotated 90: runs +y, glyphs extend toward -x of the baseline
    near(rotated.boundingBox.x, 2200 - 12, "rotated x (font height toward -x)");
    near(rotated.boundingBox.width, 12, "rotated width = font height");
    near(rotated.boundingBox.y, 2200, "rotated y");
    near(rotated.boundingBox.height, upright.boundingBox.width, "rotated height = advance");
    assert.equal(rotated.boundingBox.pageWidth, 3000);
  });
}

test("matching inputs (text anchor/extent used by nearby, adjacency, legend bands, keys) are not changed", () => {
  const source = fs.readFileSync(new URL("../app/domain/drawing-symbol-recognition-engine.mjs", import.meta.url), "utf8");
  assert.match(source, /x:Number\(item\.transform\?\.\[4\]\|\|0\)-originX,y:Number\(item\.transform\?\.\[5\]\|\|0\)-originY,width:Number\(item\.width\|\|0\),height:Number\(item\.height\|\|0\)/);
  assert.match(source, /baseKey=`\$\{page\.pageNumber\}:text:\$\{definition\.abbreviation\}:\$\{text\.x\}:\$\{text\.y\}`/);
});

test("composed-tag identity key and legend-band decision keep the legacy anchor box; only boundingBox uses glyph geometry", () => {
  const source = fs.readFileSync(new URL("../app/domain/drawing-symbol-recognition-engine.mjs", import.meta.url), "utf8");
  assert.match(source, /const box=boxOfBoxes\(run\.map\(t=>\(\{x:t\.x,y:t\.y,width:t\.width,height:t\.height\}\)\)\),glyphBox=boxOfBoxes\(run\.map\(t=>t\.box\)\);if\(inLocalLegendBand\(pageLegendBands,box\.y\+box\.height\/2\)\)continue;const baseKey=`\$\{page\.pageNumber\}:text-composed:\$\{definition\.abbreviation\}:\$\{box\.x\}:\$\{box\.y\}`/);
  assert.match(source, /boundingBox:\{\.\.\.glyphBox,pageWidth:page\.width,pageHeight:page\.height\}/);
  assert.match(source, /boundingBox:\{\.\.\.text\.box,pageWidth:page\.width,pageHeight:page\.height\}/);
});
