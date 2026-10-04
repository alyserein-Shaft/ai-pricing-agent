import test from "node:test";
import assert from "node:assert/strict";

// Phase 4D RED (Branch 2, bucket E): multi-token legend abbreviations
// ("QQ RR" here -- generalized, no benchmark classes or coordinates) whose
// target-sheet tokens print as separate proximate items can never classify:
// the text-tag pass requires whole-string equality against single items,
// while all-generic micro-icon geometry is text-only by design and single
// simple target shapes cannot Approximate-match multi-fragment definitions.
// Split-token composition is the only channel that can classify them.
import { recognizeDrawingSymbols } from "../app/domain/drawing-symbol-recognition-engine.mjs";
import { strToU8, zlibSync } from "fflate";

const buildPositionedPdf = (fragments) => {
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
  const compressed = zlibSync(strToU8(text));
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

const textRow = (abbreviation) => ({
  id: `row_${abbreviation.replace(/\s+/g, "")}`,
  source_page: 1,
  abbreviation,
  description: "COMPOUND WIDGET",
  symbol_geometry: [],
  bounding_box: {},
  structural_confidence: 96,
  sourceDocumentId: "doc_t00",
});

// A proximate diagonal token pair (mirroring subscript-style qualifier
// placement) plus a lonely first-token far from any second token.
const targetPdf = buildPositionedPdf([
  { text: "QQ", x: 500, y: 500 },
  { text: "RR", x: 506, y: 509 },
  { text: "QQ", x: 900, y: 900 },
]);

test("multi-token abbreviations compose proximate split tokens into one Text Tag occurrence", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPdf), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [textRow("QQ RR")],
  });
  const tags = result.occurrences.filter((o) => o.matchType === "Text Tag");
  assert.equal(tags.length, 1, "exactly one composed tag: the proximate pair composes, the lonely token must not");
  const tag = tags[0];
  assert.equal(tag.matchedDefinitionKey, result.definitions[0].definitionKey);
  assert.equal(tag.shapeSignature, "text:QQ RR", "composed tags share the text-tag signature namespace");
  assert.equal(tag.nearbyText, "QQ RR", "the composed text equals the abbreviation");
  assert.equal(tag.confidence, 84, "composed tags ride the unchanged Text Tag confidence");
  assert.match(tag.matchBasis, /compos/i, "composition must be disclosed in the match basis, never silent");
  assert.ok(tag.boundingBox.x <= 500 && tag.boundingBox.x + tag.boundingBox.width >= 506, "the composed box must union both member tokens");
  assert.equal(tag.pageNumber, 1);
});

// Single-token behavior is byte-identical: no composition attempted, no
// extra occurrences, literal matching untouched.
test("single-token abbreviations never compose", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPdf), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [textRow("QQ")],
  });
  const tags = result.occurrences.filter((o) => o.matchType === "Text Tag");
  assert.equal(tags.length, 2, "both literal QQ items match; nothing composed");
  for (const tag of tags) assert.doesNotMatch(tag.matchBasis, /compos/i);
});

// Order matters: reversed tokens must not compose into the abbreviation.
test("reversed token order does not compose", async () => {
  const reversed = buildPositionedPdf([
    { text: "RR", x: 500, y: 500 },
    { text: "QQ", x: 506, y: 509 },
  ]);
  const result = await recognizeDrawingSymbols(new Uint8Array(reversed), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [textRow("QQ RR")],
  });
  assert.equal(result.occurrences.filter((o) => o.matchType === "Text Tag").length, 0, "exact ordered join only -- no fuzzy text matching");
});
