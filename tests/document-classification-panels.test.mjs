import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  documentClassificationStatusLine,
  documentTypePanels,
} from "../app/lib/document-status-presentation.mjs";

// Live UI regression fix (2026-09-06). Root cause: each type-specific
// compact status panel (Drawing/BOQ/Technical Specification/Supplier
// Quotation) in the Documents workspace card independently matched on
// `document.document_type === X || document.predicted_type === X` -- the
// compatibility mirror was treated as an ALTERNATIVE current type, not a
// fallback used only when no classification exists. On a document whose
// stale documents.document_type mirror ("BOQ", a leftover from the upload
// bug the Classification Authority sprint fixed) disagreed with its real
// current document_classifications proposal ("Drawing"), BOTH the Drawing
// panel and the BOQ panel matched, and the BOQ (and Technical
// Specification, and Supplier Quotation) panels each rendered their OWN
// hardcoded "Confirmed — BOQ" / "Needs confirmation — BOQ" text --
// unconditionally, regardless of what the real classification said. That
// produced two different "current classification" lines on one card.
//
// Fixed by (1) documentTypePanels: a governed type, once it exists at all
// (predicted_type is not null/undefined), is the ONLY signal deciding which
// panel matches -- the mirror is consulted only when no classification has
// ever run; and (2) documentClassificationStatusLine: the ONE classification
// line every panel renders, replacing each panel's own hardcoded text.

const stale = (predictedType, extra = {}) => ({
  document_type: "BOQ",
  classification_source: "Manual Override",
  predicted_type: predictedType,
  classification_status: "Needs Review",
  ...extra,
});

test("1. stale mirror BOQ + current Drawing proposal -> only the Drawing panel matches, classification text is Drawing only", () => {
  const document = stale("Drawing");
  const panels = documentTypePanels(document);
  assert.equal(panels.isDrawingDocument, true);
  assert.equal(panels.isBoqDocument, false, "the stale BOQ mirror must not also match the BOQ panel");
  assert.equal(panels.isSpecificationDocument, false);
  assert.equal(panels.isSupplierQuoteDocument, false);

  const line = documentClassificationStatusLine(document);
  assert.equal(line.text, "Detected: Drawing · Needs confirmation");
  assert.doesNotMatch(line.text, /BOQ/);
});

test("2. stale mirror BOQ + current Unknown -> UI shows Unknown only, never BOQ", () => {
  const document = stale("Unknown");
  const panels = documentTypePanels(document);
  assert.equal(panels.isBoqDocument, false, "the stale BOQ mirror must not match the BOQ panel for an Unknown current classification");

  const line = documentClassificationStatusLine(document);
  assert.equal(line.text, "Unknown · Review required");
  assert.doesNotMatch(line.text, /BOQ/);
});

test("3. a confirmed classification renders exactly one confirmed type, regardless of a disagreeing stale mirror", () => {
  const document = stale("Drawing", {
    classification_status: "Manually Confirmed",
  });
  const panels = documentTypePanels(document);
  assert.equal(panels.isDrawingDocument, true);
  assert.equal(panels.isBoqDocument, false);

  const line = documentClassificationStatusLine(document);
  assert.equal(line.confirmed, true);
  assert.equal(line.text, "Confirmed: Drawing");
});

test("4. real BOQ extraction evidence keeps the BOQ panel (and its extraction fields) visible even when the current classification is something else", () => {
  // A document that really was extracted as BOQ in the past, then
  // reclassified -- boq_extraction_id is real, historical evidence that
  // must not be hidden, independent of the current type.
  const document = stale("Drawing", { boq_extraction_id: "boqx_real" });
  const panels = documentTypePanels(document);
  assert.equal(panels.isDrawingDocument, true, "the current governed type still shows its own panel");
  assert.equal(panels.isBoqDocument, true, "real extraction evidence keeps the BOQ panel visible");

  // But the classification TEXT itself is still singular and correct --
  // the BOQ panel does not get to claim its own "BOQ" classification text.
  const line = documentClassificationStatusLine(document);
  assert.equal(line.text, "Detected: Drawing · Needs confirmation");
});

test("5. no document card can render a duplicate classification label -- every type panel's Classification line uses the one shared status object, no panel builds its own type-specific text", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // The specific hardcoded strings that used to make each panel an
  // independent, disagreeing source of truth must not exist anywhere any
  // more.
  for (const hardcoded of [
    '"Confirmed — BOQ"',
    '"Needs confirmation — BOQ"',
    '"Confirmed — Technical Specification"',
    '"Needs confirmation — Technical Specification"',
    '"Confirmed — Supplier Quotation"',
    '"Needs confirmation — Supplier Quotation"',
  ]) {
    assert.doesNotMatch(page, new RegExp(hardcoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${hardcoded} must not remain as a hardcoded per-panel classification label`);
  }
  // Every panel's Classification line now reads from the one shared object.
  const classificationLineUses = page.match(/\{classificationStatusLine\.text\}/g) || [];
  assert.ok(classificationLineUses.length >= 4, "all four type-specific panels (Drawing/BOQ/Technical Specification/Supplier Quotation) must render the shared classification status line");
});

test("legitimate BOQ extraction state is not hidden by this fix -- Extraction status and BOQ items count remain in the BOQ panel", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const boqPanelStart = page.indexOf('managed-document-compact-status managed-document-boq-status');
  const boqPanelEnd = page.indexOf("{isSpecificationDocument && (", boqPanelStart);
  const boqPanel = page.slice(boqPanelStart, boqPanelEnd);
  assert.match(boqPanel, /<small>Extraction<\/small>/);
  assert.match(boqPanel, /<small>BOQ items<\/small>/);
  assert.match(boqPanel, /downstreamState\?\.totalCount \?\? 0/);
});

test("documentTypePanels and documentClassificationStatusLine are the single shared source page.tsx uses -- no panel recomputes its own type match inline any more", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /documentTypePanels\(document\)/);
  assert.match(page, /documentClassificationStatusLine\(document\)/);
});
