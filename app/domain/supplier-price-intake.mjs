import { parseXlsxWorkbook } from "../document-parsers/xlsx.mjs";
import { parseXlsWorkbook } from "../document-parsers/xls.mjs";

export const SUPPLIER_PRICE_INTAKE_VERSION = "supplier-price-intake-1.0.0";
export const SUPPLIER_ROW_TYPES = ["SUPPLIER_LINE", "HEADER", "SECTION", "NOTE", "SUBTOTAL", "TOTAL", "UNKNOWN"];

const text = value => String(value ?? "").replace(/\s+/g, " ").trim();
export const normalizeIdentity = value => text(value).toUpperCase().replace(/[\s._/\\-]+/g, "");
const headerKey = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const number = value => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/[,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const date = value => {
  if (!value && value !== 0) return null;
  if (typeof value === "number" && value > 20_000 && value < 80_000) return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
};

const aliases = {
  itemNumber: ["item", "itemno", "lineno", "sno", "no"], manufacturer: ["manufacturer", "make", "brand"],
  partNumber: ["model", "modelno", "partnumber", "partno", "partcode", "sku", "productcode"],
  description: ["description", "itemdescription", "productdescription", "product", "materialdescription"],
  unit: ["unit", "uom"], quantity: ["quantity", "qty"], currency: ["currency", "curr"],
  listPrice: ["listprice", "msrp", "unitlistprice"], unitPrice: ["unitprice", "price", "rate"],
  discount: ["discount", "discountpercent", "disc"], netUnitPrice: ["netunitprice", "netprice", "netrate", "finalunitprice"],
  issueDate: ["issuedate", "quotedate", "date"], validUntil: ["validuntil", "validitydate", "expirydate", "expirationdate"],
  quotationReference: ["quotationreference", "quoteref", "quotationno", "quoteno", "reference"], supplier: ["supplier", "vendor", "company"],
};

const findHeader = sheet => {
  let best = null;
  for (const row of sheet.rows) {
    const cells = new Map(row.cells.map(cell => [headerKey(cell.value), cell.column]));
    const columns = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, names.map(name => cells.get(name)).find(Boolean) || 0]));
    const score = [columns.description, columns.partNumber, columns.unitPrice, columns.netUnitPrice, columns.quantity, columns.currency].filter(Boolean).length;
    if (score >= 2 && (!best || score > best.score)) best = { row: row.sourceRow, columns, score };
  }
  return best;
};

const metadataFromSheet = sheet => {
  const joined = sheet.rows.slice(0, 20).map(row => row.cells.map(cell => text(cell.value)).join(" | ")).join("\n");
  const capture = pattern => joined.match(pattern)?.[1]?.trim() || null;
  return {
    supplier: capture(/(?:supplier|vendor|company)\s*[:|]\s*([^|\n]+)/i),
    quotationReference: capture(/(?:quotation|quote|reference|ref\.?)(?:\s*(?:no|number))?\s*[:|]\s*([^|\n]+)/i),
    currency: capture(/currency\s*[:|]\s*([A-Z]{3})/i)?.toUpperCase() || null,
    issueDate: date(capture(/(?:issue|quote)\s*date\s*[:|]\s*([^|\n]+)/i)),
    validUntil: date(capture(/(?:valid\s*(?:until|to)|expiry)\s*[:|]\s*([^|\n]+)/i)),
  };
};

export const classifySupplierRow = values => {
  const joined = values.map(text).filter(Boolean).join(" ");
  if (!joined) return "UNKNOWN";
  const normalized = headerKey(joined);
  if (/grandtotal|^total/.test(normalized)) return "TOTAL";
  if (/subtotal/.test(normalized)) return "SUBTOTAL";
  if (/^(note|terms|paymentterms|deliveryterms)/.test(normalized)) return "NOTE";
  const headers = Object.values(aliases).flat();
  if (values.filter(value => headers.includes(headerKey(value))).length >= 2) return "HEADER";
  return "UNKNOWN";
};

const parseCsv = (bytes, fileName) => {
  const source = new TextDecoder().decode(bytes);
  const rows = source.split(/\r?\n/).map((line, index) => ({ sourceRow: index + 1, cells: line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((value, column) => ({ column: column + 1, value: value.replace(/^\"|\"$/g, "").replace(/\"\"/g, "\"") })) }));
  return { sheets: [{ name: "CSV", rows }], provenance: { parser: "native-csv", parserVersion: "1" }, fileName };
};

export const extractSupplierQuote = (bytes, { extension = "xlsx", fileName = "supplier-quote.xlsx" } = {}) => {
  const lower = extension.toLowerCase();
  const workbook = lower === "xlsx" ? parseXlsxWorkbook(bytes, { fileName }) : lower === "xls" ? parseXlsWorkbook(bytes, { fileName }) : lower === "csv" ? parseCsv(bytes, fileName) : (() => { throw new Error("Only XLS, XLSX and CSV supplier quotations are supported by the structured MVP extractor."); })();
  const rows = [];
  const metadata = { supplier: null, quotationReference: null, currency: null, issueDate: null, validUntil: null };
  for (const sheet of workbook.sheets) {
    const header = findHeader(sheet);
    Object.assign(metadata, Object.fromEntries(Object.entries(metadataFromSheet(sheet)).map(([key, value]) => [key, metadata[key] || value])));
    for (const row of sheet.rows) {
      const raw = Object.fromEntries(row.cells.map(cell => [cell.column, cell.value]));
      const values = row.cells.map(cell => cell.value);
      if (!header || row.sourceRow <= header.row) { rows.push({ rowType: classifySupplierRow(values), sheet: sheet.name, rowNumber: row.sourceRow, raw }); continue; }
      const at = field => raw[header.columns[field]] ?? null;
      const candidate = {
        itemNumber: text(at("itemNumber")) || null, manufacturer: text(at("manufacturer")) || null,
        partNumber: text(at("partNumber")) || null, description: text(at("description")) || null,
        unit: text(at("unit")) || null, quantity: number(at("quantity")), currency: (text(at("currency")) || metadata.currency || "").toUpperCase() || null,
        listPrice: number(at("listPrice")), unitPrice: number(at("unitPrice")), discount: number(at("discount")), netUnitPrice: number(at("netUnitPrice")),
        issueDate: date(at("issueDate")) || metadata.issueDate, validUntil: date(at("validUntil")) || metadata.validUntil,
        supplier: text(at("supplier")) || metadata.supplier, quotationReference: text(at("quotationReference")) || metadata.quotationReference,
      };
      const commercialPrice = candidate.netUnitPrice ?? candidate.unitPrice;
      const rowType = (candidate.description || candidate.partNumber) && commercialPrice !== null ? "SUPPLIER_LINE" : classifySupplierRow(values) === "UNKNOWN" && values.filter(value => text(value)).length === 1 ? "SECTION" : classifySupplierRow(values);
      rows.push({ ...candidate, rowType, sheet: sheet.name, rowNumber: row.sourceRow, raw, reviewStatus: "Needs Review" });
    }
  }
  return { parser: workbook.provenance?.parser || "structured-workbook", parserVersion: workbook.provenance?.parserVersion || "1", metadata, rows };
};

export const exactProductCandidates = (line, products = [], supplierProducts = []) => {
  if (!line?.partNumber) return [];
  const needle = normalizeIdentity(line.partNumber);
  const supplierIds = new Set(supplierProducts.filter(link => normalizeIdentity(link.supplier_product_code) === needle && link.product_id).map(link => link.product_id));
  return products.filter(product => normalizeIdentity(product.part_number) === needle || normalizeIdentity(product.normalized_part_number) === needle || supplierIds.has(product.id)).map(product => ({ productId: product.id, basis: supplierIds.has(product.id) ? "EXACT_SUPPLIER_PRODUCT" : line.manufacturer && product.manufacturer && normalizeIdentity(line.manufacturer) === normalizeIdentity(product.manufacturer) ? "MANUFACTURER_EXACT_MODEL" : "EXACT_CANONICAL_MODEL" }));
};

export const supplierPriceEligibility = (line, { at = new Date() } = {}) => {
  const blockers = [];
  if (line.rowType !== "SUPPLIER_LINE") blockers.push("NOT_SUPPLIER_LINE");
  if (!line.productId || !line.mappingActorId || !line.mappingBasis) blockers.push("UNMAPPED");
  if (!line.currency) blockers.push("MISSING_CURRENCY");
  if (!((line.netUnitPrice ?? line.unitPrice) > 0)) blockers.push("INVALID_PRICE");
  if (!line.supplierId && !line.supplier) blockers.push("MISSING_SUPPLIER");
  if (!line.quotationReference) blockers.push("MISSING_QUOTATION_REFERENCE");
  if (!line.documentId || !line.documentVersionId) blockers.push("MISSING_SOURCE");
  if (!line.issueDate) blockers.push("MISSING_ISSUE_DATE");
  if (!line.validUntil) blockers.push("MISSING_VALIDITY");
  else if (new Date(`${line.validUntil}T23:59:59Z`) < at) blockers.push("EXPIRED");
  if (line.reviewStatus !== "Approved") blockers.push(line.reviewStatus === "Rejected" ? "REJECTED" : "APPROVAL_REQUIRED");
  if (line.downstreamUse !== "Costing Eligible") blockers.push("NOT_COSTING_APPROVED");
  return { eligible: blockers.length === 0, blockers };
};
