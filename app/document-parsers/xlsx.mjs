import { unzipSync } from "fflate";

const decoder = new TextDecoder();
const xml = (archive, path, required = true) => {
  const value = archive[path];
  if (!value && required) throw new Error(`XLSX package is missing ${path}`);
  return value ? decoder.decode(value) : "";
};

const decodeXml = (value = "") => value
  .replaceAll(/<[^>]+>/g, "")
  .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const attr = (source, name) => source.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || "";
const columnNumber = (cellReference) => [...(cellReference.match(/^[A-Z]+/i)?.[0] || "")].reduce((value, letter) => value * 26 + letter.toUpperCase().charCodeAt(0) - 64, 0);
const cellValue = (cellXml, sharedStrings) => {
  const type = attr(cellXml, "t");
  const raw =
    cellXml.match(/<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/)?.[1] ??
    cellXml.match(/<(?:[A-Za-z_][\w.-]*:)?is\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?is>/)?.[1] ??
    "";
  const decoded = decodeXml(raw);
  if (type === "s") return sharedStrings[Number(decoded)] ?? "";
  if (type === "b") return decoded === "1";
  if (type === "inlineStr" || type === "str") return decoded;
  const numeric = Number(decoded);
  return decoded !== "" && Number.isFinite(numeric) ? numeric : decoded;
};
const cellFormula = (cellXml) =>
  decodeXml(
    cellXml.match(
      /<(?:[A-Za-z_][\w.-]*:)?f\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?f>/,
    )?.[1] ?? "",
  );

const workbookSheetPaths = (archive) => {
  const workbook = xml(archive, "xl/workbook.xml");
  const relationships = xml(archive, "xl/_rels/workbook.xml.rels");
  const targets = new Map([...relationships.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/g)].map((match) => [attr(match[1], "Id"), attr(match[1], "Target")]));
  return [...workbook.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/g)].map((match) => {
    const attributes = match[1];
    const target = targets.get(attr(attributes, "r:id"));
    if (!target) throw new Error(`XLSX sheet relationship is missing for ${attr(attributes, "name") || "unnamed sheet"}`);
    const normalized = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
    return { name: decodeXml(attr(attributes, "name")), path: normalized.replaceAll("../", ""), hidden: ["hidden", "veryHidden"].includes(attr(attributes, "state")), state: attr(attributes, "state") || "visible" };
  });
};

const parseSharedStrings = (archive) => {
  const source = xml(archive, "xl/sharedStrings.xml", false);
  return source ? [...source.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/g)].map((match) => decodeXml(match[1])) : [];
};

const parseSheet = (archive, descriptor, sharedStrings) => {
  const source = xml(archive, descriptor.path);
  const rows = [...source.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/g)].map((rowMatch, rowIndex) => {
    const sourceRow = Number(attr(rowMatch[1], "r")) || rowIndex + 1;
    const cells = [...rowMatch[2].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>/g)].map((cellMatch) => {
      const reference = attr(cellMatch[1], "r");
      const completeCell = `<c ${cellMatch[1]}>${cellMatch[2]}</c>`;
      return { reference, column: columnNumber(reference), row: sourceRow, value: cellValue(completeCell, sharedStrings), formula: cellFormula(completeCell) || null, styleIndex: Number(attr(cellMatch[1], "s")) || 0 };
    });
    return { sourceRow, cells };
  });
  const mergedRanges = [...source.matchAll(/<(?:[A-Za-z_][\w.-]*:)?mergeCell\b([^>]*)\/?\s*>/g)].map((match) => attr(match[1], "ref")).filter(Boolean);
  const frozen = source.match(/<(?:[A-Za-z_][\w.-]*:)?pane\b([^>]*)\bstate="frozen"[^>]*\/?\s*>/)?.[1] || "";
  return { name: descriptor.name, sourcePath: descriptor.path, hidden: descriptor.hidden, state: descriptor.state, rows, mergedRanges, frozenRows: Number(attr(frozen, "ySplit")) || 0, frozenColumns: Number(attr(frozen, "xSplit")) || 0, maxRow: Math.max(0, ...rows.map((row) => row.sourceRow)), maxColumn: Math.max(0, ...rows.flatMap((row) => row.cells.map((cell) => cell.column))) };
};

const normalizedHeader = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const headerAliases = {
  system: ["system", "package", "trade"], description: ["description", "itemdescription", "item", "scopeofwork"],
  unit: ["unit", "uom"], quantity: ["quantity", "qty"], technicalReference: ["technicalreference", "specificationreference", "specreference", "specification"],
};

export const detectBoqTable = (sheet) => {
  for (const row of sheet.rows) {
    const byHeader = new Map(row.cells.map((cell) => [normalizedHeader(cell.value), cell.column]));
    const columns = Object.fromEntries(Object.entries(headerAliases).map(([field, aliases]) => [field, aliases.map((alias) => byHeader.get(alias)).find(Boolean) || 0]));
    if (columns.description && columns.unit && columns.quantity) return { sheet: sheet.name, headerRow: row.sourceRow, columns };
  }
  return null;
};

export const extractBoqCandidates = (workbook) => workbook.sheets.flatMap((sheet) => {
  const table = detectBoqTable(sheet);
  if (!table) return [];
  return sheet.rows.filter((row) => row.sourceRow > table.headerRow).map((row) => {
    const valueAt = (column) => row.cells.find((cell) => cell.column === column)?.value ?? "";
    const rawQuantity = valueAt(table.columns.quantity);
    const qty = typeof rawQuantity === "number" ? rawQuantity : Number(String(rawQuantity).replaceAll(",", ""));
    const candidate = { system: String(valueAt(table.columns.system)), description: String(valueAt(table.columns.description)), unit: String(valueAt(table.columns.unit)), quantity: Number.isFinite(qty) ? qty : 0, technicalReference: String(valueAt(table.columns.technicalReference)), source: { sheet: sheet.name, row: row.sourceRow, cells: Object.fromEntries(Object.entries(table.columns).filter(([, column]) => column).map(([field, column]) => [field, row.cells.find((cell) => cell.column === column)?.reference || ""])) }, errors: [] };
    if (!candidate.description.trim()) candidate.errors.push("Description required");
    if (!candidate.unit.trim()) candidate.errors.push("Unit required");
    if (!(candidate.quantity > 0)) candidate.errors.push("Positive numeric quantity required");
    return candidate;
  }).filter((candidate) => candidate.description.trim() || candidate.unit.trim() || candidate.quantity);
});

export const parseXlsxWorkbook = (bytes, { fileName = "workbook.xlsx", sha256 = "" } = {}) => {
  let archive;
  try { archive = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }
  catch { throw new Error("XLSX package is corrupted, encrypted, or not a valid ZIP container"); }
  const sharedStrings = parseSharedStrings(archive);
  const sheets = workbookSheetPaths(archive).map((descriptor) => parseSheet(archive, descriptor, sharedStrings));
  const workbook = { schemaVersion: 1, fileName, sha256, format: "XLSX", sheets, warnings: [], provenance: { parser: "native-openxml", parserVersion: "1" } };
  if (!sheets.length) workbook.warnings.push("Workbook contains no visible worksheet records");
  return workbook;
};
