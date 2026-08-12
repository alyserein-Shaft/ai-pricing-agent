import { parseXlsxWorkbook } from "../document-parsers/xlsx.mjs";

export const PROJECT_CONTEXT_PARSER_VERSION =
  "project-context-xlsx-1.0.0";

const clean = (value) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const normalize = (key, value) => {
  const text = clean(value);
  if (key === "contact_email") return text.toLowerCase();
  if (key === "contact_phone") return text.replace(/[^\d+]/g, "");
  return text;
};

const cellMapFor = (sheet) =>
  new Map(
    (sheet.rows || []).flatMap((row) =>
      (row.cells || []).map((cell) => [
        cell.reference,
        {
          value: cell.value,
          row: row.sourceRow,
          reference: cell.reference,
        },
      ]),
    ),
  );

const authoritativeSheet = (workbook) =>
  (workbook.sheets || []).find((sheet) => {
    const cells = cellMapFor(sheet);
    return /lead qualification checklist/i.test(
      clean(cells.get("A1")?.value),
    );
  }) || null;

const FIELD_RULES = Object.freeze([
  ["lead_score", "B2", "F2"],
  ["project_name", "A5", "B5"],
  ["project_status", "A6", "B6"],
  ["project_category", "A7", "B7"],
  ["contact_name", "D5", "E5"],
  ["company_name", "D6", "E6"],
  ["company_role", "D7", "E7"],
  ["contact_email", "A8", "E8"],
  ["contact_phone", "A9", "E9"],
  ["project_location", "A10", "E10"],
  ["commercial_instruction", "B12", "E12"],
  ["quoted_before", "A14", "B14"],
  ["decision_maker", "D20", "E20"],
  ["scope", "A23", "B23"],
  ["timeline", "C23", "E23"],
]);

const AVAILABILITY_RULES = Object.freeze([
  ["low_current_available", "A30", "B30"],
  ["drawings_available", "A31", "B31"],
  ["specifications_available", "A32", "B32"],
  ["vendor_list_available", "A33", "B33"],
  ["boq_available", "A34", "B34"],
  ["control_systems_available", "A35", "B35"],
  ["io_list_available", "A36", "B36"],
  ["equipment_list_available", "A37", "B37"],
  ["riser_diagrams_available", "A38", "B38"],
]);

const isMarkedAvailable = (value) =>
  /^(?:x|yes|available|✓|✔)$/i.test(clean(value));

const missingKeys = Object.freeze([
  "project_name",
  "project_status",
  "project_category",
  "contact_name",
  "company_name",
  "company_role",
  "contact_email",
  "contact_phone",
  "project_location",
  "budget_range",
  "decision_maker",
  "scope",
  "timeline",
]);

const factFromCells = ({
  key,
  labelCell,
  valueCell,
  cells,
  sheet,
  value,
  requiresAiInterpretation = false,
}) => {
  const label = cells.get(labelCell);
  const source = cells.get(valueCell);
  const resolved = clean(value ?? source?.value);
  if (!resolved) return null;

  return {
    key,
    label: clean(label?.value) || key,
    value: resolved,
    normalizedValue: normalize(key, resolved),
    origin: "EXTRACTED",
    confidence: 100,
    reviewStatus: "Needs Review",
    requiresAiInterpretation,
    source: {
      sheet: sheet.name,
      row: source?.row ?? label?.row ?? null,
      cell: valueCell,
      labelCell,
    },
  };
};

export const extractProjectContextWorkbook = (
  workbook,
  metadata = {},
) => {
  const sheet = authoritativeSheet(workbook);
  if (!sheet) {
    const error = new Error(
      "Lead Qualification project context sheet was not found.",
    );
    error.code = "PROJECT_CONTEXT_SHEET_NOT_FOUND";
    throw error;
  }

  const cells = cellMapFor(sheet);
  const facts = [];

  for (const [key, labelCell, valueCell] of FIELD_RULES) {
    const fact = factFromCells({
      key,
      labelCell,
      valueCell,
      cells,
      sheet,
      requiresAiInterpretation:
        key === "commercial_instruction",
    });
    if (fact) facts.push(fact);
  }

  for (const [key, labelCell, valueCell] of AVAILABILITY_RULES) {
    const raw = cells.get(valueCell)?.value;
    if (!isMarkedAvailable(raw)) continue;
    const fact = factFromCells({
      key,
      labelCell,
      valueCell,
      cells,
      sheet,
      value: "Available",
    });
    if (fact) facts.push(fact);
  }

  const seenNarratives = new Set();
  const deduplicated = facts.filter((fact) => {
    if (fact.key !== "commercial_instruction") return true;
    const fingerprint = fact.normalizedValue.toLowerCase();
    if (seenNarratives.has(fingerprint)) return false;
    seenNarratives.add(fingerprint);
    return true;
  });

  const present = new Set(deduplicated.map((fact) => fact.key));
  const missingFields = missingKeys.filter((key) => !present.has(key));

  return {
    parser: workbook.provenance?.parser || "native-openxml",
    parserVersion: PROJECT_CONTEXT_PARSER_VERSION,
    projectId: metadata.projectId || null,
    documentId: metadata.documentId || null,
    documentVersionId: metadata.documentVersionId || null,
    fileName: metadata.fileName || null,
    sourceSheet: sheet.name,
    status: "Needs Review",
    facts: deduplicated,
    missingFields,
    summary: {
      extractedFacts: deduplicated.length,
      approvedFacts: 0,
      needsReview: deduplicated.length,
      aiInterpretationRequired: deduplicated.filter(
        (fact) => fact.requiresAiInterpretation,
      ).length,
      missingFields: missingFields.length,
    },
  };
};

export const extractProjectContextBytes = (
  bytes,
  metadata = {},
) => {
  const extension = clean(metadata.extension).toLowerCase();
  if (extension !== "xlsx") {
    const error = new Error(
      "The Project Context MVP extractor currently requires XLSX.",
    );
    error.code = "PROJECT_CONTEXT_FORMAT_UNSUPPORTED";
    throw error;
  }

  const workbook = parseXlsxWorkbook(bytes, {
    fileName: metadata.fileName || "project-context.xlsx",
  });

  return extractProjectContextWorkbook(workbook, metadata);
};
