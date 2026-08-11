export const parseCsvRow = (line) => {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  cells.push(value.trim());
  return cells;
};

export const parseGenericBoqCsv = (text, fileName, hash) => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { fileName, hash, candidates: [], ignoredPriceColumns: [], fatalError: "CSV requires a header and at least one BOQ row" };
  const rawHeaders = parseCsvRow(lines[0]);
  const headers = rawHeaders.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const column = (aliases) => headers.findIndex((header) => aliases.includes(header));
  const systemIndex = column(["system", "package", "trade"]);
  const descriptionIndex = column(["description", "itemdescription", "item"]);
  const unitIndex = column(["unit", "uom"]);
  const quantityIndex = column(["quantity", "qty"]);
  const technicalIndex = column(["technicalreference", "specificationreference", "specreference"]);
  const missingHeaders = [[systemIndex, "System"], [descriptionIndex, "Description"], [unitIndex, "Unit"], [quantityIndex, "Quantity"]].filter(([index]) => Number(index) < 0).map(([, label]) => label);
  if (missingHeaders.length) return { fileName, hash, candidates: [], ignoredPriceColumns: [], fatalError: `Missing required header${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}` };
  const ignoredPriceColumns = rawHeaders.filter((header, index) => /price|rate|cost|amount|total/i.test(header) && index !== quantityIndex);
  const candidates = lines.slice(1).map((line, rowIndex) => {
    const cells = parseCsvRow(line);
    const system = cells[systemIndex] || "";
    const item = cells[descriptionIndex] || "";
    const unit = cells[unitIndex] || "";
    const rawQuantity = cells[quantityIndex] || "";
    const qty = Number(rawQuantity.replaceAll(",", ""));
    const technicalReference = technicalIndex >= 0 ? cells[technicalIndex] || "" : "";
    const errors = [!system && "System required", !item && "Description required", !unit && "Unit required", (!Number.isFinite(qty) || qty <= 0) && "Positive numeric quantity required"].filter(Boolean);
    return { rowNumber: rowIndex + 2, system, item, unit, qty: Number.isFinite(qty) ? qty : 0, technicalReference, errors };
  });
  return { fileName, hash, candidates, ignoredPriceColumns, fatalError: candidates.length ? "" : "No BOQ rows found" };
};

export const createBoqTemplateCsv = () => {
  const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return [
    ["System", "Description", "Unit", "Quantity", "Technical Reference"],
    ["Fire Detection & Alarm", "Addressable smoke detector", "No", "1", "Specification section / drawing reference"],
  ].map((row) => row.map(csvCell).join(",")).join("\n");
};
