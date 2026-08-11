import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { BOQ_ROW_TYPES, compareBoqRevisions, extractBoqBytes, normalizeUnit, parseQuantity } from "../app/domain/boq-extractor.mjs";
import { decodeRkNumber } from "../app/document-parsers/xls.mjs";

test("BOQ review loads every persisted extraction page", async () => {
  const fs = await import("node:fs/promises");
  const page = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /loadAllExtractedBoqItems/);
  assert.match(page, /limit=\$\{pageSize\}&page=\$\{page\}/);
  assert.doesNotMatch(page, /boq-extraction\/items\?limit=200/);
});

test("decodes BIFF RK floating and scaled numbers from the high IEEE word", () => {
  const rawFor = (value, scaled = false) => { const buffer = new ArrayBuffer(8); const view = new DataView(buffer); view.setFloat64(0, scaled ? value * 100 : value, true); return (view.getUint32(4, true) & 0xfffffffc) | (scaled ? 1 : 0); };
  assert.equal(decodeRkNumber(rawFor(21)), 21);
  assert.equal(decodeRkNumber(rawFor(12.5, true)), 12.5);
});

const workbook = () => zipSync({
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Fire Alarm BOQ" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>Project Summary</t></si><si><t>Item No.</t></si><si><t>Description</t></si><si><t>Unit</t></si><si><t>Quantity</t></si><si><t>1</t></si><si><t>Fire Detection Devices</t></si><si><t>1.1</t></si><si><t>Addressable smoke detector</t></si><si><t>Nos.</t></si><si><t>Total</t></si></sst>'),
  "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'),
  "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>3</v></c><c r="D1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c></row><row r="3"><c r="A3" t="s"><v>7</v></c><c r="B3" t="s"><v>8</v></c><c r="C3" t="s"><v>9</v></c><c r="D3"><f>5+5</f><v>10</v></c></row><row r="4"><c r="A4" t="s"><v>7</v></c><c r="B4" t="s"><v>8</v></c><c r="C4" t="s"><v>9</v></c><c r="D4"><v>10</v></c></row><row r="5"><c r="B5" t="s"><v>10</v></c></row></sheetData><mergeCells><mergeCell ref="A2:D2"/></mergeCells></worksheet>'),
});

const multiSheetWorkbook = () => zipSync({
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bill A" sheetId="1" r:id="rId1"/><sheet name="Bill B" sheetId="2" r:id="rId2"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>Item</t></si><si><t>Description</t></si><si><t>Unit</t></si><si><t>Quantity</t></si><si><t>1</t></si><si><t>Detector</t></si><si><t>Each</t></si><si><t>2</t></si><si><t>Panel</t></si><si><t>Set</t></si></sst>'),
  "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2"><v>10</v></c></row></sheetData></worksheet>'),
  "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>7</v></c><c r="B2" t="s"><v>8</v></c><c r="C2" t="s"><v>9</v></c><c r="D2"><v>1</v></c></row></sheetData></worksheet>'),
});

const legacyWorkbook = () => {
  const record = (id, data = new Uint8Array()) => { const output = new Uint8Array(4 + data.length); const view = new DataView(output.buffer); view.setUint16(0, id, true); view.setUint16(2, data.length, true); output.set(data, 4); return output; };
  const join = (...parts) => { const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { output.set(part, at); at += part.length; } return output; };
  const label = (row, column, value) => { const data = new Uint8Array(9 + value.length); const view = new DataView(data.buffer); view.setUint16(0, row, true); view.setUint16(2, column, true); view.setUint16(6, value.length, true); data[8] = 0; data.set(new TextEncoder().encode(value), 9); return record(0x0204, data); };
  const number = (row, column, value) => { const data = new Uint8Array(14); const view = new DataView(data.buffer); view.setUint16(0, row, true); view.setUint16(2, column, true); view.setFloat64(6, value, true); return record(0x0203, data); };
  const sheet = join(label(0,0,"Item"), label(0,1,"Description"), label(0,2,"Unit"), label(0,3,"Quantity"), label(1,0,"1"), label(1,1,"Legacy detector"), label(1,2,"Each"), number(1,3,12), record(0x000a));
  const boundData = new Uint8Array(8 + 6); const boundView = new DataView(boundData.buffer); const globalLength = 4 + boundData.length + 4; boundView.setUint32(0, globalLength, true); boundData[6] = 6; boundData[7] = 0; boundData.set(new TextEncoder().encode("Sheet1"), 8); const stream = join(record(0x0085, boundData), record(0x000a), sheet);
  const bytes = new Uint8Array(512 + 10 * 512); const view = new DataView(bytes.buffer); bytes.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]); view.setUint16(24, 0x3e, true); view.setUint16(26, 3, true); view.setUint16(28, 0xfffe, true); view.setUint16(30, 9, true); view.setUint16(32, 6, true); view.setUint32(44, 1, true); view.setInt32(48, 0, true); view.setUint32(56, 4096, true); view.setInt32(60, -2, true); view.setInt32(68, -2, true); for (let at = 76; at < 512; at += 4) view.setInt32(at, -1, true); view.setInt32(76, 9, true);
  const directory = bytes.subarray(512, 1024); const directoryView = new DataView(directory.buffer, directory.byteOffset); const entry = (offset, name, type, start, size) => { for (let index = 0; index < name.length; index += 1) directoryView.setUint16(offset + index * 2, name.charCodeAt(index), true); directoryView.setUint16(offset + name.length * 2, 0, true); directoryView.setUint16(offset + 64, (name.length + 1) * 2, true); directory[offset + 66] = type; directory[offset + 67] = 1; directoryView.setInt32(offset + 68, -1, true); directoryView.setInt32(offset + 72, -1, true); directoryView.setInt32(offset + 76, -1, true); directoryView.setInt32(offset + 116, start, true); directoryView.setBigUint64(offset + 120, BigInt(size), true); }; entry(0, "Root Entry", 5, -2, 0); entry(128, "Workbook", 2, 1, 4096);
  bytes.set(stream, 512 + 512); const fatView = new DataView(bytes.buffer, 512 + 9 * 512, 512); for (let at = 0; at < 128; at += 1) fatView.setInt32(at * 4, -1, true); fatView.setInt32(0, -2, true); for (let sector = 1; sector < 8; sector += 1) fatView.setInt32(sector * 4, sector + 1, true); fatView.setInt32(8 * 4, -2, true); fatView.setInt32(9 * 4, -3, true); return bytes;
};

test("normalizes controlled units and preserves unknown units", () => {
  assert.equal(normalizeUnit("Nos.").normalized, "Each");
  assert.equal(normalizeUnit("LS").normalized, "Lump Sum");
  assert.equal(normalizeUnit("custom coil").warning, "Unit is not in the controlled normalization map");
});

test("parses numeric, formula, range, lump-sum and blank quantities without inventing zero", () => {
  assert.deepEqual(parseQuantity("", null).numeric, null);
  assert.equal(parseQuantity(12.5).type, "Decimal");
  assert.equal(parseQuantity(10, "5+5").formula, "5+5");
  assert.equal(parseQuantity("1-3").type, "Range");
  assert.equal(parseQuantity("Lump Sum").type, "Lump Sum");
});

test("extracts real XLSX sheets, formulas, hierarchy, totals, duplicates and source evidence", () => {
  const result = extractBoqBytes(workbook(), { extension: "xlsx", fileName: "real-boq.xlsx", documentId: "doc1", projectId: "p1" });
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[1].hidden, true);
  assert.equal(result.summary.validBoqItems, 2);
  assert.equal(result.rows[0].rowType, "Section Header");
  assert.equal(result.rows[1].quantity.formula, "5+5");
  assert.equal(result.rows[1].source.cells.description, "B3");
  assert.equal(result.rows[2].warnings.some((warning) => warning.code === "POSSIBLE_DUPLICATE"), true);
  assert.equal(result.rows.at(-1).rowType, "Subtotal");
});

test("assigns globally unique sequences across every workbook sheet", () => {
  const result = extractBoqBytes(multiSheetWorkbook(), { extension: "xlsx", fileName: "multi-sheet.xlsx" });
  assert.deepEqual(result.rows.map((row) => row.sequence), [1, 2]);
  assert.deepEqual(result.rows.map((row) => row.source.sheet), ["Bill A", "Bill B"]);
});

test("reads legacy XLS BOQs through the safe native parser without executing macros", () => {
  const result = extractBoqBytes(legacyWorkbook(), { extension: "xls", fileName: "legacy-boq.xls" });
  assert.equal(result.extractionMethod, "native-biff-ole-readonly");
  assert.equal(result.summary.validBoqItems, 1);
  assert.equal(result.rows[0].description, "Legacy detector");
  assert.equal(result.rows[0].quantity.numeric, 12);
});

test("extracts CSV content and retains blank quantity as missing", () => {
  const csv = "Item,Description,Unit,Quantity\n1,Panel,Set,2\n2,Repeater,Each,";
  const result = extractBoqBytes(new TextEncoder().encode(csv), { extension: "csv" });
  assert.equal(result.rows[1].quantity.numeric, null);
  assert.equal(result.rows[1].warnings.some((warning) => warning.code === "MISSING_QUANTITY"), true);
  assert.equal(result.rows[1].confidenceState, "Needs Review");
});

test("fails safely for scanned PDF when OCR is not configured", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n/Type /Page /Subtype /Image");
  assert.throws(() => extractBoqBytes(pdf, { extension: "pdf" }), (error) => error.code === "OCR_REQUIRED" && /no values were invented/i.test(error.technicalDetails));
});

test("extracts a native-text PDF table without flattening page provenance", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n/Type /Page\nBT (Item  Description  Unit  Quantity) Tj (1  Addressable detector  Each  12) Tj ET");
  const result = extractBoqBytes(pdf, { extension: "pdf", fileName: "boq.pdf" });
  assert.equal(result.summary.validBoqItems, 1);
  assert.equal(result.rows[0].source.page, 1);
  assert.equal(result.rows[0].description, "Addressable detector");
});

test("supports every required row type", () => {
  for (const type of ["BOQ Item", "Section Header", "Subsection Header", "Subtotal", "Grand Total", "Note", "Alternative Item", "Optional Item", "Provisional Sum", "Allowance", "Daywork", "Rate-Only Item", "Blank Separator", "Unknown"]) assert.ok(BOQ_ROW_TYPES.includes(type));
});

test("compares revisions without overwriting history", () => {
  const row = (itemNumber, description, quantity) => ({ itemNumber, description, normalizedDescription: description.toLowerCase(), section: "A", rowType: "BOQ Item", quantity: { original: quantity }, unit: { original: "Each" } });
  const comparison = compareBoqRevisions([row("1", "Panel", "1"), row("2", "Detector", "10")], [row("1", "Panel", "2"), row("3", "Module", "4")]);
  assert.deepEqual({ added: comparison.added, removed: comparison.removed, changed: comparison.changed }, { added: 1, removed: 1, changed: 1 });
});

test("wires classification, persistent APIs, audit, review actions and approved downstream access", async () => {
  const worker = await (await import("node:fs/promises")).readFile(new URL("../worker/boq-extraction-api.mjs", import.meta.url), "utf8");
  const index = await (await import("node:fs/promises")).readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  for (const contract of ["scheduleAutomaticBoqExtraction", "boq_extraction_versions", "boq_items", "boq_review_decisions", "approved-items", "merge|split", "restore", "compare", "content-disposition"]) assert.match(worker, new RegExp(contract));
  assert.match(index, /handleBoqExtractionApi\(request, env, ctx\)/);
});

test("renders the canonical BOQ review table with governed in-app actions", async () => {
  const page = await (await import("node:fs/promises")).readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const migration = await (await import("node:fs/promises")).readFile(new URL("../drizzle/0027_restore_engineering_knowledge_conflicts.sql", import.meta.url), "utf8");
  assert.match(page, /BOQ ITEMS NEEDING REVIEW/);
  assert.match(page, /SECTION \/ HEADER RECORDS/);
  assert.match(page, /Possible duplicate · review required/);
  assert.match(page, /GOVERNED BOQ REVIEW/);
  assert.match(page, /submitBoqReviewAction/);
  assert.doesNotMatch(page, /90 source rows normalized to 21 review candidates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `engineering_knowledge_conflicts`/);
});
