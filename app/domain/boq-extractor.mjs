import { parseCsvRow } from "../boq-csv.mjs";
import { inspectPdfReadiness } from "../document-parsers/pdf-readiness.mjs";
import { parseXlsxWorkbook } from "../document-parsers/xlsx.mjs";
import { parseXlsWorkbook } from "../document-parsers/xls.mjs";

export const BOQ_PARSER_VERSION = "boq-engine-1.0.2";
export const BOQ_RULESET_VERSION = "construction-boq-2026-08-12.2";
export const BOQ_OCR_VERSION = "not-configured";
export const BOQ_ROW_TYPES = ["BOQ Item", "Section Header", "Subsection Header", "Subtotal", "Grand Total", "Note", "Alternative Item", "Optional Item", "Provisional Sum", "Allowance", "Daywork", "Rate-Only Item", "Blank Separator", "Unknown"];
export const BOQ_STAGES = ["Queued", "Loading File", "Detecting Structure", "Reading Sheets", "Reading Pages", "Running OCR", "Detecting Tables", "Mapping Columns", "Extracting Rows", "Validating", "Saving", "Completed", "Needs Review", "Failed", "Cancelled"];

const aliases = {
  itemNumber: ["item", "itemno", "itemnumber", "ref", "boqref", "line", "sn", "no"],
  description: ["description", "itemdescription", "materialdescription", "scope", "equipment", "workdescription"],
  unit: ["unit", "uom", "measure", "unitofmeasure"],
  quantity: ["qty", "quantity", "estimatedquantity", "totalqty"],
  partNumber: ["partno", "partnumber", "model", "productcode", "cataloguenumber", "catno"],
  manufacturer: ["brand", "make", "manufacturer", "approvedmake"],
  specificationReference: ["specification", "specificationreference", "specreference", "specsection"],
  drawingReference: ["drawing", "drawingreference", "drawingref"],
  notes: ["note", "notes", "remarks", "remark"],
  section: ["section", "bill", "package", "system", "trade"],
};
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class BoqExtractionError extends Error {
  constructor(code, userMessage, technicalDetails, suggestedAction, source = {}) {
    super(userMessage); this.name = "BoqExtractionError"; this.code = code; this.userMessage = userMessage; this.technicalDetails = technicalDetails; this.suggestedAction = suggestedAction; this.source = source;
  }
}

export const normalizeUnit = (raw) => {
  const original = text(raw); const key = normalized(original);
  const map = { no: "Each", nos: "Each", each: "Each", ea: "Each", pcs: "Each", pc: "Each", set: "Set", sets: "Set", lot: "Lot", ls: "Lump Sum", lumpsum: "Lump Sum", meter: "m", metre: "m", m: "m", m2: "m²", sqm: "m²", m3: "m³", cbm: "m³", point: "Point", points: "Point", pair: "Pair", roll: "Roll", box: "Box" };
  if (!original) return { original, normalized: null, rule: null, confidence: 0, warning: "Missing unit" };
  if (!map[key]) return { original, normalized: original, rule: "preserve-unrecognized", confidence: 45, warning: "Unit is not in the controlled normalization map" };
  return { original, normalized: map[key], rule: `unit:${key}`, confidence: 98, warning: null };
};

export const parseQuantity = (raw, formula = null) => {
  const original = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!original && !formula) return { original, numeric: null, type: "Blank", formula: null, confidence: 0, warning: "Missing quantity" };
  if (formula && !original) return { original, numeric: null, type: "Formula", formula, confidence: 35, warning: "Formula has no cached numeric result" };
  if (/^(ls|lump\s*sum)$/i.test(original)) return { original, numeric: null, type: "Lump Sum", formula, confidence: 98, warning: null };
  if (/provisional/i.test(original)) return { original, numeric: null, type: "Provisional", formula, confidence: 80, warning: null };
  const range = original.match(/^\s*(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (range) return { original, numeric: null, type: "Range", formula, range: [Number(range[1]), Number(range[2])], confidence: 90, warning: "Quantity is a range and requires review" };
  const numericValue = typeof raw === "number" ? raw : Number(original.replaceAll(",", ""));
  if (Number.isFinite(numericValue)) return { original, numeric: numericValue, type: formula ? "Formula" : Number.isInteger(numericValue) ? "Integer" : "Decimal", formula, confidence: formula ? 92 : 99, warning: numericValue < 0 ? "Negative quantity" : null };
  return { original, numeric: null, type: "Text", formula, confidence: 35, warning: "Quantity is not numeric" };
};

const detectSystem = (value) => {
  const source = text(value); const rules = [[/fire alarm|fire detection/i, "Fire Alarm"], [/cctv|surveillance/i, "CCTV"], [/access control/i, "Access Control"], [/structured cabling|data outlet|cat\s*6/i, "Structured Cabling"], [/\bups\b|uninterrupt/i, "UPS"], [/\bbms\b|building management/i, "BMS"], [/public address|\bpa system/i, "Public Address"], [/audio visual|\bav\b/i, "AV"], [/electrical|switchgear|cable/i, "Electrical"], [/mechanical|hvac|plumbing/i, "MEP"]];
  const match = rules.find(([pattern]) => pattern.test(source));
  return match ? { value: match[1], sourceType: "Inferred", confidence: 78, explicitlyStated: false } : { value: null, sourceType: "Unknown", confidence: 0, explicitlyStated: false };
};

export const detectHeaders = (rows, maxRows = 25) => {
  let best = null;
  for (let start = 0; start < Math.min(rows.length, maxRows); start += 1) {
    for (const depth of [1, 2, 3]) {
      const slice = rows.slice(start, start + depth); if (!slice.length) continue;
      const width = Math.max(0, ...slice.map((row) => row.values.length));
      const labels = Array.from({ length: width }, (_, col) => normalized(slice.map((row) => row.values[col] ?? "").join(" ")));
      const columns = {}; const claimed = new Set(); let score = 0;
      for (const [field, variants] of Object.entries(aliases)) {
        const column = labels.findIndex((label, index) => !claimed.has(index) && variants.some((variant) => label === variant || label.includes(variant)));
        if (column >= 0) { columns[field] = column; claimed.add(column); score += ["description", "quantity", "unit"].includes(field) ? 3 : 1; }
      }
      const quality = score * 10 - depth * 2;
      if (columns.description !== undefined && score >= 5 && (!best || quality > best.quality)) best = { rowIndex: start, sourceRows: slice.map((row) => row.sourceRow), depth, columns, labels, score, quality, confidence: clamp(45 + score * 6 - (depth - 1) * 3, 0, 99) };
    }
  }
  return best;
};

const refineHeaderMapping = (rows, header) => {
  if (!header || header.columns.description === undefined) return header;
  const sample = rows.slice(header.rowIndex + header.depth, header.rowIndex + header.depth + 40);
  const averageLength = (column) => { const values = sample.map((row) => text(row.values[column])).filter(Boolean); return values.length ? values.reduce((sum, value) => sum + value.length, 0) / values.length : 0; };
  const medianLength = (column) => { const values = sample.map((row) => text(row.values[column]).length).filter(Boolean).sort((a, b) => a - b); return values.length ? values[Math.floor(values.length / 2)] : 0; };
  const descriptionColumn = header.columns.description; const nextColumn = descriptionColumn + 1; const claimed = new Set(Object.values(header.columns));
  if (!claimed.has(nextColumn) && (averageLength(nextColumn) >= Math.max(8, averageLength(descriptionColumn) * 1.8) || medianLength(nextColumn) >= Math.max(8, medianLength(descriptionColumn) * 2))) return { ...header, columns: { ...header.columns, itemNumber: header.columns.itemNumber ?? descriptionColumn, description: nextColumn }, confidence: Math.min(99, header.confidence + 3), mappingEvidence: "Description shifted to adjacent high-text-density column; the labeled header covered an item-code and description pair." };
  return header;
};

export const classifyBoqRowType = ({ values, mapped, quantity, unit }) => {
  const joined = text(values.join(" "));
  if (!joined) return "Blank Separator";
  if (/^notes?$/i.test(unit.original)) return "Note";
  if (/^grand\s+total\b/i.test(joined)) return "Grand Total";
  if (/\bsub\s*total\b|^total\b|\bdivision\s+\d+\s+total\s+amount\b/i.test(joined)) return "Subtotal";
  if (/^note\b|^remarks?\b|^general notes?\b/i.test(joined)) return "Note";
  if (/\bdaywork\b/i.test(joined)) return "Daywork";
  if (/\bprovisional sum\b/i.test(joined)) return "Provisional Sum";
  if (/\ballowance\b/i.test(joined)) return "Allowance";
  if (/\balternative\b|\balternate\b/i.test(joined)) return "Alternative Item";
  if (/\boptional\b/i.test(joined)) return "Optional Item";
  if (/rate\s*only/i.test(joined)) return "Rate-Only Item";
  const scopeText = mapped.description || mapped.itemNumber;
  if (scopeText && !quantity.original && !unit.original && scopeText.length >= 40 && /^(?:supply\b.*\b(?:installation|testing|commissioning)\b|installation\b.*\b(?:testing|commissioning)\b)/i.test(scopeText)) return "Note";
  if (!mapped.description && mapped.itemNumber && !quantity.original && !unit.original) return /^section\b|^\d+(?:\s|$)/i.test(mapped.itemNumber) ? "Section Header" : "Subsection Header";
  if (mapped.description && !quantity.original && !unit.original) return (mapped.itemNumber || mapped.description.match(/^\d+(?:\.\d+)*/)?.[0] || "").split(".").length > 1 ? "Subsection Header" : "Section Header";
  if (mapped.description && (quantity.original || unit.original || mapped.itemNumber)) return "BOQ Item";
  return "Unknown";
};

const matrixRowsFromSheet = (sheet) => sheet.rows.map((row) => {
  const values = Array.from({ length: sheet.maxColumn }, () => ""); const cells = {}; const formulas = {};
  for (const cell of row.cells) { values[cell.column - 1] = cell.value; cells[cell.column - 1] = cell.reference; if (cell.formula) formulas[cell.column - 1] = cell.formula; }
  return { sourceRow: row.sourceRow, values, cells, formulas };
});

const classifySheet = (sheet, header) => {
  const name = sheet.name.toLowerCase();
  if (header) return /cont|continuation/i.test(name) ? "BOQ continuation" : "Primary BOQ";
  if (/summary|cover/i.test(name)) return "Summary";
  if (/cost|rate|price/i.test(name)) return "Cost sheet";
  if (/term|condition/i.test(name)) return "Terms";
  if (/ref|lookup|list/i.test(name)) return "Reference";
  return "Irrelevant";
};

const extractRows = ({ rows, header, sourceSheet = null, sourcePage = null, sourceKind, sequenceOffset = 0 }) => {
  if (!header) return [];
  const items = []; const sectionStack = [];
  for (const row of rows.slice(header.rowIndex + header.depth)) {
    const value = (field) => header.columns[field] === undefined ? "" : row.values[header.columns[field]] ?? "";
    const formula = (field) => header.columns[field] === undefined ? null : row.formulas?.[header.columns[field]] || null;
    const mapped = Object.fromEntries(Object.keys(aliases).map((field) => [field, text(value(field))]));
    const quantity = parseQuantity(value("quantity"), formula("quantity")); const unit = normalizeUnit(value("unit"));
    const type = classifyBoqRowType({ values: row.values, mapped, quantity, unit });
    if (type === "Blank Separator") continue;
    let depth = 0;
    if (["Section Header", "Subsection Header"].includes(type)) {
      const number = mapped.itemNumber || mapped.description.match(/^\d+(?:\.\d+)*/)?.[0] || ""; depth = Math.max(1, number ? number.split(".").length : type === "Subsection Header" ? 2 : 1);
      sectionStack.splice(depth - 1); sectionStack[depth - 1] = mapped.description || mapped.itemNumber;
    }
    const description = mapped.description || (["Section Header", "Subsection Header", "Note", "Subtotal", "Grand Total"].includes(type) ? mapped.itemNumber : "");
    const warnings = [];
    if (!description) warnings.push({ code: "MISSING_DESCRIPTION", message: "Description is missing" });
    if (type === "BOQ Item" && !unit.original) warnings.push({ code: "MISSING_UNIT", message: "Unit is missing" });
    if (type === "BOQ Item" && !quantity.original) warnings.push({ code: "MISSING_QUANTITY", message: "Quantity is missing" });
    if (unit.warning) warnings.push({ code: "UNIT_REVIEW", message: unit.warning });
    if (quantity.warning) warnings.push({ code: "QUANTITY_REVIEW", message: quantity.warning });
    const system = mapped.section ? { value: mapped.section, sourceType: "Extracted", confidence: 95, explicitlyStated: true } : detectSystem(`${sectionStack.join(" ")} ${description}`);
    const completeness = [description, type !== "BOQ Item" || unit.original, type !== "BOQ Item" || quantity.original].filter(Boolean).length;
    let confidence = clamp(Math.round((header.confidence + unit.confidence + quantity.confidence + completeness * 18) / 4), 0, 99);
    if (warnings.length || ["Unknown", "Section Header", "Subsection Header"].includes(type)) confidence = Math.min(confidence, warnings.length ? 74 : 89);
    const sourceCells = Object.fromEntries(Object.entries(header.columns).map(([field, col]) => [field, row.cells?.[col] || null]));
    items.push({
      sequence: sequenceOffset + items.length + 1, itemNumber: mapped.itemNumber || null, parentItemNumber: null, section: sectionStack[0] || mapped.section || null, subsection: sectionStack.slice(1).join(" / ") || null, hierarchyDepth: depth || sectionStack.filter(Boolean).length, sectionPath: sectionStack.filter(Boolean),
      system, category: null, subcategory: null, description: description || null, normalizedDescription: description ? description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : null,
      unit, quantity, manufacturer: mapped.manufacturer || null, brand: mapped.manufacturer || null, model: mapped.partNumber || null, partNumber: mapped.partNumber || null,
      specificationReference: mapped.specificationReference || null, drawingReference: mapped.drawingReference || null, notes: mapped.notes || null, alternates: null, includedAccessories: null, excludedScope: null,
      rowType: type, confidence, confidenceState: confidence >= 90 ? "High Confidence" : confidence >= 70 ? "Medium Confidence" : "Needs Review", reviewStatus: type === "BOQ Item" && confidence >= 90 ? "Pending Approval" : "Needs Review",
      source: { kind: sourceKind, sheet: sourceSheet, page: sourcePage, row: row.sourceRow, cells: sourceCells, rawValues: row.values, formulas: row.formulas || {}, boundingBox: row.boundingBox || null }, warnings,
    });
  }
  return items;
};

const parseCsv = (bytes) => {
  const content = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/); const rows = lines.map((line, index) => ({ sourceRow: index + 1, values: parseCsvRow(line), cells: {}, formulas: {} }));
  const header = detectHeaders(rows); if (!header) throw new BoqExtractionError("BOQ_HEADERS_NOT_FOUND", "BOQ columns could not be identified.", "CSV does not contain a reliable description/quantity/unit header mapping.", "Correct the column headers or map them manually.");
  return { sources: [{ kind: "Sheet", label: "CSV", classification: "Primary BOQ", hidden: false, header }], rows: extractRows({ rows, header, sourceSheet: "CSV", sourceKind: "CSV" }), reviewed: 1, tables: 1, method: "csv-structure" };
};

const parseWorkbook = (workbook) => {
  const sources = []; const extracted = [];
  for (const sheet of workbook.sheets) {
    const rows = matrixRowsFromSheet(sheet); const header = refineHeaderMapping(rows, detectHeaders(rows)); const classification = classifySheet(sheet, header);
    sources.push({ kind: "Sheet", label: sheet.name, classification, hidden: sheet.hidden, mergedRanges: sheet.mergedRanges, frozenRows: sheet.frozenRows, header });
    if (header) extracted.push(...extractRows({ rows, header, sourceSheet: sheet.name, sourceKind: workbook.format, sequenceOffset: extracted.length }));
  }
  if (!extracted.length) throw new BoqExtractionError("BOQ_TABLE_NOT_FOUND", "No BOQ table was found in the workbook.", "No worksheet contained a reliable description/quantity/unit header mapping.", "Review hidden sheets or map the BOQ columns manually.");
  return { sources, rows: extracted, reviewed: workbook.sheets.length, tables: sources.filter((source) => source.header).length, method: workbook.provenance.parser };
};
const parseXlsx = (bytes, metadata) => parseWorkbook(parseXlsxWorkbook(bytes, metadata));
const parseXls = (bytes, metadata) => parseWorkbook(parseXlsWorkbook(bytes, metadata));

const unescapePdf = (value) => value.replace(/\\([()\\])/g, "$1").replace(/\\n/g, " ").replace(/\\r/g, " ");
const parsePdf = (bytes, metadata) => {
  const readiness = inspectPdfReadiness(bytes, metadata);
  if (!readiness.valid) throw new BoqExtractionError(readiness.error.code, readiness.error.message, readiness.error.message, "Upload an authorized readable PDF.");
  if (readiness.requiresOcr) throw new BoqExtractionError("OCR_REQUIRED", "This scanned BOQ requires OCR before rows can be extracted.", "No OCR provider is configured in this local build; no values were invented.", "Configure a bounded OCR provider or review the pages manually.");
  const source = new TextDecoder("latin1").decode(bytes);
  const pages = source.split(/(?=\/Type\s*\/Page\b)/g).slice(1); const allRows = []; const sources = [];
  pages.forEach((page, pageIndex) => {
    const strings = [...page.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj|\[((?:.|\n)*?)\]\s*TJ/g)].flatMap((match) => match[1] ? [unescapePdf(match[1])] : [...(match[2] || "").matchAll(/\(([^()]*)\)/g)].map((part) => unescapePdf(part[1])));
    const lines = strings.flatMap((value) => value.split(/\r?\n/)).map((value) => value.trim()).filter(Boolean);
    const rows = lines.map((line, index) => ({ sourceRow: index + 1, values: line.includes("|") ? line.split("|").map(text) : line.includes("\t") ? line.split("\t").map(text) : line.split(/\s{2,}/).map(text), cells: {}, formulas: {}, boundingBox: null }));
    const header = detectHeaders(rows, 40); sources.push({ kind: "Page", label: `Page ${pageIndex + 1}`, page: pageIndex + 1, classification: header ? "Primary BOQ" : "Irrelevant", header });
    if (header) allRows.push(...extractRows({ rows, header, sourcePage: pageIndex + 1, sourceKind: "PDF", sequenceOffset: allRows.length }));
  });
  if (!allRows.length) throw new BoqExtractionError("PDF_TABLE_NOT_FOUND", "No reliable BOQ table could be reconstructed from the PDF.", "Native text exists but row/column boundaries or headers are ambiguous.", "Review the BOQ pages manually or upload the source Excel workbook.");
  return { sources, rows: allRows, reviewed: readiness.pageCount || pages.length, tables: sources.filter((entry) => entry.header).length, method: "pdf-literal-layout" };
};

const duplicateKey = (item) => [item.itemNumber || "", item.normalizedDescription || "", item.quantity.original, item.unit.normalized || "", item.section || ""].join("|");
export const finalizeExtraction = (parsed, metadata = {}) => {
  const seen = new Map();
  for (const item of parsed.rows) {
    const key = duplicateKey(item); const previous = seen.get(key);
    if (item.rowType === "BOQ Item" && previous) { item.warnings.push({ code: "POSSIBLE_DUPLICATE", message: `Possible duplicate of sequence ${previous.sequence}` }); item.duplicateOfSequence = previous.sequence; item.reviewStatus = "Needs Review"; item.confidence = Math.min(item.confidence, 69); item.confidenceState = "Needs Review"; }
    else if (item.rowType === "BOQ Item") seen.set(key, item);
  }
  const validItems = parsed.rows.filter((row) => row.rowType === "BOQ Item"); const reviewRows = parsed.rows.filter((row) => row.reviewStatus === "Needs Review");
  return { parserVersion: BOQ_PARSER_VERSION, rulesetVersion: BOQ_RULESET_VERSION, ocrVersion: BOQ_OCR_VERSION, extractionMethod: parsed.method, sources: parsed.sources, rows: parsed.rows, summary: { sourcesReviewed: parsed.reviewed, tablesDetected: parsed.tables, sectionsDetected: parsed.rows.filter((row) => ["Section Header", "Subsection Header"].includes(row.rowType)).length, totalRowsDetected: parsed.rows.length, validBoqItems: validItems.length, sectionHeaders: parsed.rows.filter((row) => /Section Header/.test(row.rowType)).length, totalsAndSubtotals: parsed.rows.filter((row) => /Total/.test(row.rowType)).length, itemsNeedingReview: reviewRows.length, missingQuantities: validItems.filter((row) => !row.quantity.original).length, missingUnits: validItems.filter((row) => !row.unit.original).length, possibleDuplicates: parsed.rows.filter((row) => row.duplicateOfSequence).length, failedRows: parsed.rows.filter((row) => row.rowType === "Unknown").length, averageConfidence: parsed.rows.length ? Math.round(parsed.rows.reduce((sum, row) => sum + row.confidence, 0) / parsed.rows.length) : 0 }, metadata };
};

export const extractBoqBytes = (bytes, metadata = {}) => {
  const extension = String(metadata.extension || metadata.fileName?.split(".").pop() || "").toLowerCase();
  if (extension === "xls") return finalizeExtraction(parseXls(bytes, metadata), metadata);
  if (extension === "csv") return finalizeExtraction(parseCsv(bytes), metadata);
  if (extension === "xlsx") return finalizeExtraction(parseXlsx(bytes, metadata), metadata);
  if (extension === "pdf") return finalizeExtraction(parsePdf(bytes, metadata), metadata);
  throw new BoqExtractionError("UNSUPPORTED_BOQ_FORMAT", "This BOQ format is not supported by the extraction worker.", `Unsupported extension: ${extension || "unknown"}.`, "Upload XLS, XLSX, CSV, or a readable PDF.");
};

export const compareBoqRevisions = (previousRows, currentRows) => {
  const key = (row) => row.itemNumber || `${row.normalizedDescription}|${row.section || ""}`;
  const before = new Map(previousRows.filter((row) => row.rowType === "BOQ Item").map((row) => [key(row), row])); const after = new Map(currentRows.filter((row) => row.rowType === "BOQ Item").map((row) => [key(row), row]));
  const changes = [];
  for (const [identity, row] of after) { const old = before.get(identity); if (!old) changes.push({ type: "Added", identity, current: row }); else { const fields = ["description", "itemNumber"].filter((field) => old[field] !== row[field]); if (old.quantity?.original !== row.quantity?.original) fields.push("quantity"); if (old.unit?.original !== row.unit?.original) fields.push("unit"); if (fields.length) changes.push({ type: "Changed", identity, fields, previous: old, current: row }); } }
  for (const [identity, row] of before) if (!after.has(identity)) changes.push({ type: "Removed", identity, previous: row });
  return { added: changes.filter((change) => change.type === "Added").length, removed: changes.filter((change) => change.type === "Removed").length, changed: changes.filter((change) => change.type === "Changed").length, changes };
};
