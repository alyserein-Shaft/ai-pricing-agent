import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { extractBoqCandidates, parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";
import { inspectPdfReadiness } from "../app/document-parsers/pdf-readiness.mjs";
import { assessMatchingPublication, classifyDocument, planDocumentProcessing } from "../app/domain/document-intelligence.mjs";

const minimalWorkbook = () => zipSync({
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fire Alarm BOQ" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>System</t></si><si><t>Description</t></si><si><t>Unit</t></si><si><t>Quantity</t></si><si><t>Fire Alarm</t></si><si><t>Addressable smoke detector</t></si><si><t>No</t></si></sst>'),
  "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2"><v>10</v></c></row></sheetData><mergeCells><mergeCell ref="A3:B3"/></mergeCells></worksheet>'),
});

test("native XLSX parser preserves sheets, cells, merged ranges, and provenance", () => {
  const workbook = parseXlsxWorkbook(minimalWorkbook(), { fileName: "BOQ.xlsx", sha256: "a".repeat(64) });
  assert.equal(workbook.sheets[0].name, "Fire Alarm BOQ");
  assert.deepEqual(workbook.sheets[0].mergedRanges, ["A3:B3"]);
  assert.equal(workbook.sheets[0].rows[1].cells[1].reference, "B2");
  assert.equal(workbook.provenance.parser, "native-openxml");
});

test("native XLSX BOQ extraction retains cell-level source references", () => {
  const candidates = extractBoqCandidates(parseXlsxWorkbook(minimalWorkbook()));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].description, "Addressable smoke detector");
  assert.equal(candidates[0].quantity, 10);
  assert.deepEqual(candidates[0].source, { sheet: "Fire Alarm BOQ", row: 2, cells: { system: "A2", description: "B2", unit: "C2", quantity: "D2" } });
});

test("native XLSX parser fails closed for corrupted containers", () => {
  assert.throws(() => parseXlsxWorkbook(strToU8("not a workbook")), /corrupted, encrypted, or not a valid ZIP/);
});

test("PDF readiness routes native-text files without OCR", () => {
  const pdf = strToU8("%PDF-1.7\n1 0 obj <</Type /Page>> endobj\nBT /F1 12 Tf (Hello) Tj ET\n%%EOF");
  const result = inspectPdfReadiness(pdf, { fileName: "spec.pdf" });
  assert.equal(result.valid, true);
  assert.equal(result.requiresOcr, false);
  assert.equal(result.route, "Native PDF layout parser");
});

test("PDF readiness routes image-only files to selective OCR", () => {
  const pdf = strToU8("%PDF-1.7\n1 0 obj <</Type /Page /Subtype /Image>> endobj\n%%EOF");
  const result = inspectPdfReadiness(pdf, { fileName: "scan.pdf" });
  assert.equal(result.requiresOcr, true);
  assert.equal(result.route, "Selective OCR");
});

test("PDF readiness blocks encrypted and non-PDF content", () => {
  assert.equal(inspectPdfReadiness(strToU8("plain text")).error.code, "UNREADABLE_PDF");
  assert.equal(inspectPdfReadiness(strToU8("%PDF-1.7 /Encrypt 1 0 R")).error.code, "PASSWORD_PROTECTED");
});

test("processing plan chooses real adapters and never auto-publishes", () => {
  const plan = planDocumentProcessing({ fileName: "BOQ.xlsx", classification: classifyDocument({ fileName: "BOQ.xlsx" }) });
  assert.deepEqual(plan.adapters, ["native-openxml", "engineering-table", "engineering-validation"]);
  assert.equal(plan.publishToMatching, false);
  assert.equal(plan.needsReview, true);
});

test("recognizes the DWG filename convention as Drawing", () => {
  const result = classifyDocument({
    fileName: "DAR-NPC-JED-TEL-DWG-TD-ML-80109-Rev1.pdf",
  });
  assert.equal(result.type, "Drawing");
  assert.equal(result.basis, "DWG filename convention");
});

test("matching publication requires completed, accepted, source-proven assertions", () => {
  const blocked = assessMatchingPublication({ run: { status: "Completed" }, documentVersionStatus: "Accepted", assertions: [{ reviewStatus: "Accepted" }] });
  assert.equal(blocked.publishable, false);
  const ready = assessMatchingPublication({ run: { status: "Completed" }, documentVersionStatus: "Accepted", assertions: [{ reviewStatus: "Accepted", documentVersionId: "v1", sourceRegion: { sheet: "BOQ", cell: "B2" } }] });
  assert.equal(ready.publishable, true);
});
