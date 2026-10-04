// SYNTHETIC XLSX WRITER -- test-only fixture authoring.
//
// WHY THIS EXISTS
// ---------------
// The document-structure benchmark must feed the REAL native parser
// (app/document-parsers/xlsx.mjs -> extractBoqBytes) genuine XLSX BYTES with
// genuine <mergeCells> markup. A JSON mock of a table would not exercise the
// parser at all -- it would test the mock. So fixtures are authored as real
// OOXML packages.
//
// The project's own declared dependency `fflate` is used to zip them, which is
// the same library the parser unzips with, so writer and reader cannot drift on
// compression details.
//
// DATA POLICY
// -----------
// Everything here is FABRICATED. Model numbers, project names, quantities,
// manufacturers and prices are invented for this benchmark and appear in no
// project, supplier or commercial source. There is deliberately no code path
// here that reads a project document, a database, or any file outside this
// directory. See synthetic-privacy-guard.mjs, which enforces that at the
// command boundary.
import { zipSync, strToU8 } from "fflate";

const esc = (v) => String(v)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const colName = (n) => {
  let s = "";
  let v = n;
  while (v > 0) { const r = (v - 1) % 26; s = String.fromCharCode(65 + r) + s; v = Math.floor((v - 1) / 26); }
  return s;
};

/**
 * Build real XLSX bytes from a declared sheet.
 *
 * @param {object} sheet
 * @param {Array<Array<any>>} sheet.rows  row-major; null/undefined = empty cell
 * @param {string[]} [sheet.merges]       e.g. ["A1:A7"] -- REAL <mergeCells>
 * @param {string} [sheet.name]
 * @returns {Uint8Array}
 */
export function buildSyntheticXlsx({ rows, merges = [], name = "Synthetic" }) {
  const shared = [];
  const sharedIndex = new Map();
  const sid = (text) => {
    if (!sharedIndex.has(text)) { sharedIndex.set(text, shared.length); shared.push(text); }
    return sharedIndex.get(text);
  };

  const rowXml = rows.map((cells, r) => {
    const parts = [];
    cells.forEach((cell, c) => {
      if (cell === null || cell === undefined || cell === "") return; // genuinely empty
      const ref = `${colName(c + 1)}${r + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        parts.push(`<c r="${ref}"><v>${cell}</v></c>`);
      } else {
        parts.push(`<c r="${ref}" t="s"><v>${sid(String(cell))}</v></c>`);
      }
    });
    return parts.length ? `<row r="${r + 1}">${parts.join("")}</row>` : "";
  }).join("");

  // A merged cell's anchor holds the value; the covered cells are simply absent.
  // This is exactly how Excel writes a merge, and it is the structure that
  // defeats naive extraction in the real world.
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";

  // PRESENTATION ONLY. Column widths and a uniform font size are set so a
  // RENDERED image of this workbook is legible: without explicit widths every
  // viewer falls back to a default and CLIPS long description text, which would
  // make the case untestable for ANY vision system. This changes no cell value,
  // no merge and no expected output -- it is the workbook's layout metadata
  // only, and it is what a real authoring tool would have written anyway.
  const width = 26;
  const colMeta = Array.from({ length: Math.max(1, ...rows.map((r) => r.length)) },
    (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${colMeta}</cols><sheetData>${rowXml}</sheetData>${mergeXml}</worksheet>`;

  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("")}</sst>`;

  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

  return zipSync({
    "[Content_Types].xml": strToU8(ct),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(wb),
    "xl/_rels/workbook.xml.rels": strToU8(wbRels),
    "xl/sharedStrings.xml": strToU8(sst),
    "xl/worksheets/sheet1.xml": strToU8(sheet1),
  }, { level: 6 });
}
