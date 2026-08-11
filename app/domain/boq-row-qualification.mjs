export const QUALIFIED_BOQ_ROW_TYPES = ["BOQ Item", "Header", "Note", "Preamble", "General Condition", "Excluded", "Duplicate Candidate"];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function qualifyBoqRow(row) {
  const source = typeof row.source_location === "string" ? JSON.parse(row.source_location || "{}") : (row.source_location || {});
  const previous = clean(row.row_type);
  const description = clean(row.description);
  const itemNumber = clean(row.item_number);
  const sheet = clean(source.sheet);
  const combined = `${itemNumber} ${description}`;

  if (["Section Header", "Subsection Header", "Grand Total"].includes(previous)) return { rowType: "Header", reason: `Parser classified the source row as ${previous}.`, certain: true };
  if (["Subtotal", "Blank Separator"].includes(previous) || /total carried|collection total|grand total/i.test(combined)) return { rowType: "Excluded", reason: "Summary or separator row; it must not become a priced item.", certain: true };
  if (previous === "Note") return { rowType: "Note", reason: "Parser identified an explicit note row.", certain: true };
  if (/^Div(?:ision)?[- ]?1$/i.test(sheet) || /^01(?:\s|[-–])/i.test(itemNumber)) {
    if (/preamble|tender documents|scope of works|bills of quantities/i.test(combined)) return { rowType: "Preamble", reason: "Division 1 tender/preamble language, not a measurable product line.", certain: true };
    return { rowType: "General Condition", reason: "Division 1 contractual or general-requirement row; excluded from product pricing.", certain: true };
  }
  if (["Allowance", "Provisional Sum", "Daywork", "Rate-Only Item", "Alternative Item", "Optional Item"].includes(previous)) return { rowType: "BOQ Item", reason: `${previous} retains measurable BOQ-item status but still requires estimator confirmation.`, certain: false };
  if (previous === "BOQ Item" && description && clean(row.original_unit) && clean(row.original_quantity)) return { rowType: "BOQ Item", reason: "Measurable row contains description, unit and quantity.", certain: true };
  if (previous === "Unknown") return { rowType: "Excluded", reason: "Parser could not establish a safe measurable row type; manual review remains required.", certain: false };
  return { rowType: "Excluded", reason: "No evidence supports downstream BOQ-item treatment.", certain: false };
}
