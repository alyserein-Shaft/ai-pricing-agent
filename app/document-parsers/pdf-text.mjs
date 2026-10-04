// Shared, low-level PDF text extraction primitive built on pdfjs-dist -- the
// same real, correct PDF parser already used by app/domain/specification-extractor.mjs,
// app/domain/drawing-intake-engine.mjs and app/domain/drawing-structural-parser.mjs.
// This module intentionally does nothing beyond "open a PDF and return each
// page's text items with coordinates": no clause/section segmentation, no
// specification-specific error wrapping. Consumers needing that (the full
// specification extractor) layer it on top; consumers needing only lightweight,
// correct text sampling (document classification) use this directly instead of
// hand-rolling a second, inferior parser.
//
// Document Intelligence S1 Closure (B-1): the classifier's previous PDF
// sampler read literal `(...)Tj` text operators directly off the RAW,
// undecoded file bytes. That only works for the rare uncompressed PDF --
// any normal FlateDecode-compressed content stream (the overwhelming
// majority of real PDFs, including every real Technical Specification,
// Supplier Quotation and Commercial Offer this was tested against) has its
// text operators inside compressed binary the old regex could not see,
// producing either an empty match (Unknown classification) or spurious
// matches against compressed binary noise (degenerate near-tied scores).
// pdfjs decompresses and tokenizes correctly regardless of compression.

export const PDF_TEXT_ENGINE_VERSION = "pdf-text-sampler-1.0.0";

const ensurePdfJsGlobals = () => {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = class DOMMatrix { constructor(values = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = values; } multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } };
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D { addPath() {} };
};

const text = (value) => String(value ?? "").replace(/[\t ]+/g, " ").trim();

// pdfjs-dist requires a plain Uint8Array and rejects a Node.js Buffer (a
// Uint8Array subclass) with "Please provide binary data as `Uint8Array`,
// rather than `Buffer`." `bytes instanceof Uint8Array` is true for a Buffer
// too, so that check alone is not enough -- view-wrap to strip the subclass.
export const asPlainUint8Array = (bytes) => {
  if (bytes instanceof Uint8Array) return bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Uint8Array(bytes);
};

const reconstructLines = (items) => {
  const rows = new Map();
  for (const item of items) {
    if (!("str" in item) || !text(item.str)) continue;
    const y = Math.round(Number(item.transform?.[5] || 0) * 2) / 2;
    const row = rows.get(y) || [];
    row.push({ x: Number(item.transform?.[4] || 0), value: text(item.str) });
    rows.set(y, row);
  }
  return [...rows.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, row]) => row.sort((left, right) => left.x - right.x).map((entry) => entry.value).join(" ").replace(/\s+([,.;:])/g, "$1").trim())
    .filter(Boolean);
};

/**
 * Opens a PDF with pdfjs and returns each page's reconstructed text lines
 * (row-grouped by Y coordinate, ordered left-to-right within a row, top of
 * page first) plus the raw positioned text items for callers that need
 * coordinates (e.g. geometry-aware title-block parsing). Never throws for
 * "no text found" -- callers decide what an empty result means for their
 * use case (classification treats it as image-only; specification
 * extraction treats it as OCR-required).
 */
export const extractPdfPageTexts = async (bytes, { pageLimit = null, includeItems = false } = {}) => {
  ensurePdfJsGlobals();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs takes OWNERSHIP of the buffer handed to getDocument: it transfers
  // the ArrayBuffer, which DETACHES it. Passing the caller's own array
  // therefore silently destroyed the caller's bytes, so any caller that
  // classified a PDF and then reused the same buffer (the Knowledge upload
  // path: classifyDocumentBytes -> sampleDocumentContent; the document
  // classifier re-samples for text) failed with "Cannot perform
  // %TypedArray%.prototype.slice on a detached or out-of-bounds
  // ArrayBuffer" -- i.e. PDFs could not be ingested at all. A parser must
  // never invalidate its input, so pdfjs gets a private copy.
  const data = new Uint8Array(asPlainUint8Array(bytes));
  const document = await getDocument({ data, disableWorker: true, useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const pageCount = document.numPages;
    const limit = pageLimit ? Math.min(pageCount, Math.max(1, pageLimit)) : pageCount;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false });
      const lines = reconstructLines(content.items);
      const entry = { page: pageNumber, lines, width: viewport.width, height: viewport.height };
      if (includeItems) entry.items = content.items.filter((item) => "str" in item && text(item.str)).map((item) => ({ text: text(item.str), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) }));
      pages.push(entry);
      page.cleanup();
    }
    return { pageCount, pages };
  } finally {
    await document.destroy();
  }
};
