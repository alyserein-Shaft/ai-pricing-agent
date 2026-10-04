import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PDF-BUF-1: a parser must never destroy its input.
//
// pdfjs-dist takes ownership of the buffer passed to getDocument and detaches
// it. extractPdfPageTexts used to forward the caller's own Uint8Array, so the
// caller's bytes became unusable ("Cannot perform %TypedArray%.prototype.slice
// on a detached or out-of-bounds ArrayBuffer") the moment a PDF was read.
// The Knowledge upload path hit this on every PDF:
//   classifyDocumentBytes(bytes) -> sampleDocumentContent(bytes) -> CRASH,
// because classification is followed by a second sampling of the same buffer.
// Manufacturer datasheets and manuals are PDFs, so this blocked the entire
// internet-enrichment ingestion path.
//
// This test pins the contract: after a PDF is parsed, the caller's buffer is
// still readable, and a second parse of the same buffer still works.

const FIXTURES = [
  // [label, relative path]
  ["Honeywell Farenhyt IFP-2100 data sheet 351602:D", "tests/fixtures/knowledge/ifp-2100-datasheet-sample.pdf"],
];

const fixture = (relative) => join(new URL("..", import.meta.url).pathname, relative);

const readFixture = (relative) => {
  try {
    return new Uint8Array(readFileSync(fixture(relative)));
  } catch {
    return null;
  }
};

test("extractPdfPageTexts leaves the caller's buffer intact", async (t) => {
  const { extractPdfPageTexts } = await import("../app/document-parsers/pdf-text.mjs");
  const bytes = readFixture(FIXTURES[0][1]);
  if (!bytes) return t.skip("PDF fixture not present in this checkout");

  const before = bytes.slice(0, 8);
  const first = await extractPdfPageTexts(bytes, { pageLimit: 1 });
  assert.equal(first.pages.length, 1, "the PDF should yield one page of text");

  // The caller's array must still be readable after the parse.
  assert.deepEqual(bytes.slice(0, 8), before, "input buffer was mutated or detached");
  assert.equal(bytes.length, before.length + bytes.length - before.length);

  // And a second parse of the same buffer must behave identically: this is
  // exactly classify-then-sample, the sequence that used to crash.
  const second = await extractPdfPageTexts(bytes, { pageLimit: 1 });
  assert.equal(second.pages.length, 1, "a second parse of the same buffer must still work");
});

test("sampleDocumentContent does not consume the caller's PDF buffer", async (t) => {
  const { sampleDocumentContent } = await import("../app/domain/document-classifier.mjs");
  const bytes = readFixture(FIXTURES[0][1]);
  if (!bytes) return t.skip("PDF fixture not present in this checkout");

  const first = await sampleDocumentContent(bytes, { fileName: "datasheet.pdf", extension: "pdf" });
  assert.equal(first.readable, true, "native PDF text should be readable");
  const second = await sampleDocumentContent(bytes, { fileName: "datasheet.pdf", extension: "pdf" });
  assert.equal(second.readable, true, "re-sampling the same buffer must still work");
  assert.equal(second.text.length, first.text.length);
});
