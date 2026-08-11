import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import {
  CLASSIFICATION_TAXONOMY, DOWNSTREAM_ROUTES, classifyDocumentBytes, classifySample, hasDwgFilenameMarker, validateAiClassification,
} from "../app/domain/document-classifier.mjs";

const minimalWorkbook = () => zipSync({
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BOQ" sheetId="1" r:id="rId1"/><sheet name="Cost Summary" sheetId="2" r:id="rId2"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>Item No</t></si><si><t>Description</t></si><si><t>Unit</t></si><si><t>Quantity</t></si><si><t>Smoke detector</t></si><si><t>No</t></si><si><t>Internal Cost</t></si><si><t>Margin</t></si><si><t>Selling Price</t></si></sst>'),
  "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="D2"><v>10</v></c></row></sheetData></worksheet>'),
  "xl/worksheets/sheet2.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>6</v></c><c r="B1" t="s"><v>7</v></c><c r="C1" t="s"><v>8</v></c></row></sheetData></worksheet>'),
});

const classifyText = (text, fileName = "document.csv") => classifyDocumentBytes(strToU8(text), { extension: fileName.split(".").pop(), fileName });

test("supports the complete extensible Task 4 taxonomy and routing map", () => {
  for (const type of ["BOQ", "Technical Specification", "Drawing", "Product Catalogue", "Product Datasheet", "Price List", "Supplier Quotation", "Cost Sheet", "RFQ", "Tender Document", "Compliance Document", "Clarification", "Approved Vendor List", "Previous Project Reference", "Project Email", "Commercial Offer", "Technical Offer", "Contract", "Other", "Unknown"]) assert.ok(CLASSIFICATION_TAXONOMY.includes(type));
  assert.equal(DOWNSTREAM_ROUTES.BOQ, "BOQ Extraction");
  assert.equal(DOWNSTREAM_ROUTES["Supplier Quotation"], "Supplier Quote Extraction");
});

test("classifies a real BOQ CSV from content and structure", () => {
  const result = classifyText("Item No,Description,Unit,Quantity\n1,Smoke detector,No,20\n2,Panel,No,1", "unhelpful.csv");
  assert.equal(result.primaryType, "BOQ");
  assert.ok(result.confidence >= 80);
  assert.ok(result.evidence.some((item) => item.label === "Quantity field"));
});

test("classifies specification, quotation, price list, RFQ, compliance and email content", () => {
  const cases = [
    ["Technical Specification", "SECTION 28 46 00 PART 1 GENERAL PART 2 PRODUCTS PART 3 EXECUTION SUBMITTALS TESTING AND COMMISSIONING"],
    ["Supplier Quotation", "Quotation No Q-220 Supplier Customer Validity Payment Terms Delivery Unit Price Subtotal VAT Grand Total"],
    ["Price List", "Part Number Product Description List Price Currency Discount Effective Date"],
    ["RFQ", "REQUEST FOR QUOTATION Requested Items Required Response Date Quantity Delivery Location Please Quote"],
    ["Compliance Document", "Requirement Reference Comply Not Comply Deviation Offered Model Remarks"],
    ["Project Email", "From: engineer@example.com\nTo: estimator@example.com\nSubject: Project clarification\nSent: today\nAttachments: boq.xlsx"],
  ];
  for (const [expected, content] of cases) assert.equal(classifyText(content, "neutral.csv").primaryType, expected);
});

test("keeps cause-and-effect sheets in the drawing route", () => {
  const result = classifyText("FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX SYSTEM INPUTS SYSTEM OUTPUTS", "2401232-PC-AMS-DR-T-94-ZZZ-001.csv");
  assert.equal(result.primaryType, "Drawing");
  assert.equal(result.downstreamRoute, "Drawing Analysis");
  assert.ok(result.evidence.some((item) => item.label === "Cause-and-effect drawing matrix"));
});

test("classifies files containing DWG in the filename as drawings", () => {
  const sample = {
    readable: false,
    extractionQuality: 0,
    extractionMethod: "pdf-readiness",
    text: "",
    segments: [],
    warnings: ["Content could not be read"],
  };
  const result = classifySample(sample, {
    fileName: "DAR-NPC-JED-TEL-DWG-TD-ML-80109-Rev1.pdf",
  });
  assert.equal(result.primaryType, "Drawing");
  assert.equal(result.status, "Classified");
  assert.equal(result.manualReviewRequired, false);
  assert.equal(result.downstreamRoute, "Drawing Analysis");
  assert.ok(
    result.evidence.some((item) => item.label === "DWG filename token"),
  );
  assert.equal(hasDwgFilenameMarker("plan-DWG-rev1.pdf"), true);
  assert.equal(hasDwgFilenameMarker("productdwgdata.pdf"), true);
});

test("native DWG sources classify as drawings without engineering interpretation", () => {
  const result = classifyDocumentBytes(new TextEncoder().encode("AC1024\0\0\0binary"), { extension: "dwg", fileName: "DAR-NPC-JED-TEL-DWG-TD-ML-80101-Rev1.dwg" });
  assert.equal(result.primaryType, "Drawing");
  assert.equal(result.status, "Classified");
  assert.equal(result.downstreamRoute, "Drawing Analysis");
});

test("uses actual PDF page content and preserves page-level evidence", () => {
  const pdf = strToU8("%PDF-1.7\n1 0 obj <</Type /Page>> stream BT (Item No Description Unit Quantity) Tj ET endstream endobj\n2 0 obj <</Type /Page>> stream BT (Quotation No Supplier Validity Payment Terms Grand Total VAT) Tj ET endstream endobj\n%%EOF");
  const result = classifyDocumentBytes(pdf, { extension: "pdf", fileName: "package.pdf" });
  assert.equal(result.mixed, true);
  assert.deepEqual(result.segments.map((segment) => segment.primaryType), ["BOQ", "Supplier Quotation"]);
  assert.ok(result.manualReviewRequired);
  assert.ok(result.confidence < 80);
});

test("classifies Excel worksheets independently and detects mixed workbooks", () => {
  const result = classifyDocumentBytes(minimalWorkbook(), { extension: "xlsx", fileName: "package.xlsx" });
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments.map((segment) => segment.sheetName), ["BOQ", "Cost Summary"]);
  assert.equal(result.segments[0].primaryType, "BOQ");
  assert.equal(result.segments[1].primaryType, "Cost Sheet");
  assert.equal(result.mixed, true);
});

test("never awards high confidence from filename or declared type alone", () => {
  const sample = { readable: true, extractionQuality: 0.95, text: "unrelated generic content", segments: [{ kind: "section", label: "Body", text: "unrelated generic content", structure: {} }], structure: {} };
  const result = classifySample(sample, { fileName: "SUPPLIER_QUOTATION_PRICE_LIST_BOQ.csv", declaredType: "Supplier Quotation" });
  assert.ok(result.confidence < 40 || result.primaryType === "Unknown");
  assert.notEqual(result.confidenceState, "High Confidence");
});

test("routes unreadable scans and legacy containers to actionable manual review", () => {
  const image = classifyDocumentBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { extension: "png", fileName: "scan.png" });
  assert.equal(image.primaryType, "Unknown");
  assert.equal(image.error.code, "OCR_REQUIRED");
  assert.equal(image.status, "Needs Review");
  const legacy = classifyDocumentBytes(new Uint8Array([0xd0, 0xcf]), { extension: "doc", fileName: "legacy.doc" });
  assert.equal(legacy.error.code, "UNREADABLE_CONTENT");
});

test("detects mixed semantic sections and stores ranked alternatives", () => {
  const result = classifySample({ readable: true, extractionQuality: 0.9, text: "Item No Description Unit Quantity Quotation No Validity Grand Total VAT", segments: [{ kind: "page", label: "Page 1", pageFrom: 1, pageTo: 1, text: "Item No Description Unit Quantity", structure: {} }, { kind: "page", label: "Page 2", pageFrom: 2, pageTo: 2, text: "Quotation No Supplier Customer Validity Payment Terms Grand Total VAT", structure: {} }], structure: {} }, { fileName: "package.pdf" });
  assert.equal(result.mixed, true);
  assert.ok(result.secondaryTypes.includes("BOQ"));
  assert.ok(result.alternatives.length >= 1);
});

test("validates AI escalation outputs before they can be persisted", () => {
  assert.equal(validateAiClassification({ primaryType: "BOQ", confidence: 90, evidence: [{ label: "Quantity" }], alternatives: [], modelVersion: "model-1", promptVersion: "prompt-1" }).valid, true);
  assert.equal(validateAiClassification({ primaryType: "Invented", confidence: 200, evidence: [], alternatives: [] }).valid, false);
});

test("connects automatic queue execution, classification APIs, persistence and decision-only routing", async () => {
  const worker = await readFile(new URL("../worker/classification-api.mjs", import.meta.url), "utf8");
  const upload = await readFile(new URL("../worker/document-api.mjs", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(upload, /scheduleAutomaticClassification\(env, ctx/);
  for (const operation of ["start", "status", "result", "evidence", "confirm", "override", "rerun", "history", "page", "sheet"]) assert.match(worker, new RegExp(operation));
  assert.match(worker, /status: "Decision Only"|\'Decision Only\'/);
  assert.match(worker, /Human classification confirmation required/);
  for (const entity of ["documentClassifications", "classificationCandidates", "classificationEvidence", "classificationSegments", "classificationOverrides", "classificationModelVersions", "downstreamRoutingHandoffs"]) assert.match(schema, new RegExp(`export const ${entity}`));
});
