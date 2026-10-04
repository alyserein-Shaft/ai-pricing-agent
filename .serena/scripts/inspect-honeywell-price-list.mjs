import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "/Users/serein-b/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const source = "/Users/serein-b/Downloads/KSA Honeywell Farenhyt Series Price List -2023.xlsx";
const outDir = "/private/tmp/honeywell-price-list-inspection";
await fs.mkdir(outDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 14000,
  tableMaxRows: 12,
  tableMaxCols: 12,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);

const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 5000 });
console.log(sheets.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
  maxChars: 5000,
});
console.log(formulaErrors.ndjson);

const sheetNames = [...sheets.ndjson.matchAll(/\"name\":\"([^\"]+)\"/g)].map((match) => match[1]);
for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outDir}/${sheetName.replaceAll(/[^a-z0-9]+/gi, "-")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
