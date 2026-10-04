export const EXPORT_MODES = ["Draft Cost Sheet", "Technical Review Cost Sheet", "Commercial Review Cost Sheet", "Approved Cost Sheet", "Client-Safe Export"];
export const EXPORT_ENGINE_VERSION = "excel-export-1.0.0";
export const TEMPLATE_VERSION = "construction-cost-sheet-1.0";

export const safeExcelText = (value) => {
  if (value == null) return "";
  const text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
  const trimmed = text.trimStart(), unsafe = /^[=+@*]/.test(trimmed) || (/^-/.test(trimmed) && !/^-\d+(?:\.\d+)?$/.test(trimmed));
  return unsafe ? `'${text}` : text;
};
export const sanitizeFilename = (value) => String(value || "Project").normalize("NFKD").replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 90) || "Project";
export const exportFilename = ({ projectName, tenderNumber, revision, date = new Date() }) => `AI-Pricing-Agent_${sanitizeFilename(projectName)}_${sanitizeFilename(tenderNumber || "No-Tender")}_CostSheet_Rev${String(revision).padStart(2, "0")}_${date.toISOString().slice(0, 10)}.xlsx`;

/**
 * CLIENT-SAFE BOUNDARY -- an ALLOWLIST, stated positively.
 *
 * The proven defect was a boundary expressed as subtraction: the customer
 * workbook removed a named denylist of fields and two named sheets, and shipped
 * everything else. Anything added later leaked by default -- internal material and
 * service cost build-up, supplier and source-file identities, internal discount
 * workings, internal version identifiers, technical/safety review state, and four
 * internal sheets.
 *
 * So the client-safe artefact is now defined by what it MAY contain:
 * CLIENT_SAFE_SHEETS and CLIENT_SAFE_VISIBLE_FIELDS. Anything not named here is
 * internal by default, including fields that do not exist yet.
 * clientSafeProtectedFields is kept as an independent second control, and the two
 * are asserted never to disagree.
 */

/** Sheets a customer-facing workbook may contain, in workbook order. */
export const CLIENT_SAFE_SHEETS = ["Cover", "Project Summary", "Detailed Cost Sheet"];

/**
 * Row fields a customer-facing workbook may contain: what identifies the item and
 * what the customer is being quoted. Deliberately excludes supplier identity, cost
 * build-up, discount and margin mechanics, internal approval/review state, source
 * provenance, discovery/ranking signals and every internal version identifier.
 */
export const CLIENT_SAFE_VISIBLE_FIELDS = new Set([
  // item identity and scope
  "lineNumber", "itemNumber", "parentItem", "section", "subsection", "system",
  "category", "subcategory", "description", "originalDescription",
  "specificationReference", "drawingReference", "unit", "quantity",
  // the selected product the customer is being quoted
  "manufacturer", "brand", "productFamily", "model", "partNumber",
  "productDescription", "lifecycle",
  // customer-facing money
  "currency", "netSellingUnitPrice", "netSellingTotal", "vat", "finalLineValue",
]);

/** Project a row down to exactly the fields a customer-facing workbook may carry. */
export const applyClientSafeRowBoundary = (row) =>
  Object.fromEntries(Object.entries(row || {}).filter(([field]) => CLIENT_SAFE_VISIBLE_FIELDS.has(field)));

export const sheetsForMode = (mode) => {
  if (mode === "Client-Safe Export") return [...CLIENT_SAFE_SHEETS];
  const common = ["Cover", "Project Summary", "Detailed Cost Sheet", "BOQ Source", "Technical Compliance", "Product Alternatives", "Clarifications and Risks", "Review and Approval", "Assumptions", "Export Metadata"];
  if (mode === "Technical Review Cost Sheet") return common;
  return [...common.slice(0, 6), "Cost Breakdown", "Supplier and Price Sources", ...common.slice(6)];
};

export const clientSafeProtectedFields = new Set(["supplier", "sourceReference", "listPrice", "manufacturerDiscount", "supplierDiscount", "projectDiscount", "specialDiscount", "netUnitMaterialCost", "materialTotal", "accessoriesCost", "installationCost", "engineeringCost", "programmingCost", "testingCost", "freight", "customs", "warrantyCost", "overheads", "risk", "contingency", "totalUnitCost", "totalLineCost", "markup", "margin", "reviewerNotes", "internalNotes"]);
// Client-Safe is allowlist-driven; internal modes keep every column, minus
// nothing. The denylist still governs the internal contract it was written for.
export const visibleDetailedFields = (mode) =>
  DETAILED_COLUMNS.filter((column) =>
    mode !== "Client-Safe Export" || CLIENT_SAFE_VISIBLE_FIELDS.has(column.field),
  );

export const DETAILED_COLUMNS = [
  ["lineNumber", "Line No."], ["itemNumber", "BOQ Item No."], ["parentItem", "Parent Item"], ["section", "Section"], ["subsection", "Subsection"], ["system", "System"], ["category", "Category"], ["subcategory", "Subcategory"], ["description", "BOQ Description"], ["originalDescription", "Original Description"], ["specificationReference", "Specification Reference"], ["drawingReference", "Drawing Reference"], ["unit", "Unit"], ["quantity", "Quantity"],
  ["manufacturer", "Selected Manufacturer"], ["brand", "Selected Brand"], ["productFamily", "Product Family"], ["model", "Selected Model"], ["partNumber", "Part Number"], ["productDescription", "Product Description"], ["lifecycle", "Product Lifecycle"], ["technicalStatus", "Technical Status"], ["complianceStatus", "Compliance Status"], ["matchConfidence", "Match Confidence"], ["matchingBasis", "Matching Basis"], ["technicalApprovalStatus", "Technical Approval Status"],
  ["priceSourceType", "Price Source Type"], ["supplier", "Supplier"], ["sourceReference", "Source Reference"], ["priceValidity", "Price Validity"], ["currency", "Currency"], ["listPrice", "List Price"], ["manufacturerDiscount", "Manufacturer Discount"], ["supplierDiscount", "Supplier Discount"], ["projectDiscount", "Project Discount"], ["specialDiscount", "Special Discount"], ["netUnitMaterialCost", "Net Unit Material Cost"], ["materialTotal", "Material Total"], ["accessoriesCost", "Accessories Cost"], ["installationCost", "Installation Cost"], ["engineeringCost", "Engineering Cost"], ["programmingCost", "Programming Cost"], ["testingCost", "Testing & Commissioning"], ["freight", "Freight"], ["customs", "Customs"], ["warrantyCost", "Warranty"], ["otherDirectCost", "Other Direct Cost"], ["overheads", "Overheads"], ["risk", "Risk"], ["contingency", "Contingency"], ["totalUnitCost", "Total Unit Cost"], ["totalLineCost", "Total Line Cost"], ["markup", "Markup"], ["margin", "Margin"], ["grossSellingUnitPrice", "Gross Selling Unit Price"], ["customerDiscount", "Customer Discount"], ["netSellingUnitPrice", "Net Selling Unit Price"], ["netSellingTotal", "Net Selling Total"], ["vat", "VAT"], ["finalLineValue", "Final Line Value"],
  ["pricingStatus", "Pricing Status"], ["commercialApprovalStatus", "Commercial Approval Status"], ["safetyState", "Safety State"], ["approvalEligibility", "Approval Eligibility"], ["missingInformation", "Missing Information"], ["blockingConditions", "Blocking Conditions"], ["warnings", "Warnings"], ["assumptions", "Assumptions"], ["reviewerNotes", "Reviewer Notes"], ["remarks", "Remarks"], ["boqSourceFile", "BOQ Source File"], ["boqSourceLocation", "BOQ Sheet or Page"], ["specificationSource", "Specification Source"], ["productSource", "Product Source"], ["priceSourceFile", "Price Source File"], ["matchRunVersion", "Match Run Version"], ["pricingVersion", "Pricing Version"], ["reviewVersion", "Review Version"]
].map(([field, label]) => ({ field, label }));

const minor = (value) => value == null ? null : Number(value) / 100;
const parseOriginalDescription = (value) => { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed?.description || parsed?.Description || ""; } catch { return ""; } };
const component = (components, names) => components.filter((x) => names.includes(x.component_type)).reduce((sum, x) => sum + Number(x.amount_minor || 0) / 100, 0);
const discount = (discounts, names) => discounts.filter((x) => names.some((name) => String(x.discount_type || "").toLowerCase().includes(name))).reduce((sum, x) => sum + Number(x.percentage_basis_points || 0) / 10000, 0);
export const buildDetailedRow = ({ boq, candidate = {}, product = {}, price = {}, pricing = {}, components = [], discounts = [], safety = {}, technicalApproval = {}, commercialApproval = {}, review = {}, source = {}, mode }) => {
  const quantity = boq.original_quantity == null || String(boq.original_quantity).trim() === "" ? null : Number(boq.original_quantity);
  const output = typeof pricing.output === "string" ? JSON.parse(pricing.output || "{}") : pricing.output || {};
  const row = {
    lineNumber: boq.sequence, itemNumber: safeExcelText(boq.item_number), parentItem: safeExcelText(boq.parent_item_number || boq.parent_item), section: safeExcelText(boq.section), subsection: safeExcelText(boq.subsection), system: safeExcelText(boq.system_value || boq.system), category: safeExcelText(boq.category), subcategory: safeExcelText(boq.subcategory), description: safeExcelText(boq.description), originalDescription: safeExcelText(parseOriginalDescription(boq.original_raw_values) || boq.original_description || boq.description), specificationReference: safeExcelText(boq.specification_reference || source.specificationReference), drawingReference: safeExcelText(boq.drawing_reference || source.drawingReference), unit: safeExcelText(boq.original_unit), quantity,
    manufacturer: safeExcelText(product.manufacturer_name), brand: safeExcelText(product.brand_name), productFamily: safeExcelText(product.family_name), model: safeExcelText(product.model), partNumber: safeExcelText(product.part_number), productDescription: safeExcelText(product.description), lifecycle: safeExcelText(product.lifecycle_status), technicalStatus: safeExcelText(candidate.technical_status), complianceStatus: safeExcelText(safety.compliance_state), matchConfidence: candidate.overall_score == null ? null : Number(candidate.overall_score) / 100, matchingBasis: safeExcelText(candidate.explanation), technicalApprovalStatus: safeExcelText(technicalApproval.status || "Pending"),
    priceSourceType: safeExcelText(price.price_type), supplier: safeExcelText(price.supplier_name), sourceReference: safeExcelText(price.source_reference), priceValidity: price.valid_to || null, currency: safeExcelText(pricing.project_currency || price.currency), listPrice: minor(pricing.original_list_price_minor), manufacturerDiscount: discount(discounts, ["manufacturer"]), supplierDiscount: discount(discounts, ["supplier", "distributor"]), projectDiscount: discount(discounts, ["project", "volume", "framework"]), specialDiscount: discount(discounts, ["special", "manual"]), netUnitMaterialCost: minor(pricing.net_material_unit_minor), materialTotal: minor(pricing.material_total_minor), accessoriesCost: component(components, ["Accessory"]), installationCost: component(components, ["Installation"]), engineeringCost: component(components, ["Engineering"]), programmingCost: component(components, ["Programming"]), testingCost: component(components, ["Testing", "Commissioning", "Testing and Commissioning"]), freight: component(components, ["Freight", "Logistics"]), customs: component(components, ["Customs"]), warrantyCost: component(components, ["Warranty"]), otherDirectCost: component(components, ["Training", "Documentation", "Subcontractor", "Other"]), overheads: component(components, ["Overhead"]), risk: component(components, ["Risk"]), contingency: component(components, ["Contingency"]), totalUnitCost: quantity ? minor(pricing.total_cost_minor) / quantity : null, totalLineCost: minor(pricing.total_cost_minor), markup: pricing.markup_basis_points == null ? null : Number(pricing.markup_basis_points) / 10000, margin: pricing.margin_basis_points == null ? null : Number(pricing.margin_basis_points) / 10000, grossSellingUnitPrice: quantity ? minor(pricing.gross_selling_minor) / quantity : null, customerDiscount: minor(pricing.customer_discount_minor), netSellingUnitPrice: quantity ? minor(pricing.net_selling_minor) / quantity : null, netSellingTotal: minor(pricing.net_selling_minor), vat: minor(pricing.vat_minor), finalLineValue: minor(pricing.final_value_minor),
    pricingStatus: safeExcelText(pricing.status || "Missing Price"), commercialApprovalStatus: safeExcelText(commercialApproval.status || "Pending"), safetyState: safeExcelText(safety.safety_state || "Not Evaluated"), approvalEligibility: pricing.approval_ready ? "Eligible" : "Blocked", missingInformation: safeExcelText((typeof safety.missing_information === "string" ? JSON.parse(safety.missing_information || "[]") : safety.missing_information || []).join("; ")), blockingConditions: safeExcelText((source.blocks || []).map((x) => x.user_message || x.code).join("; ")), warnings: safeExcelText((source.warnings || []).map((x) => x.message || x.code).join("; ")), assumptions: safeExcelText((output.assumptions || []).join("; ")), reviewerNotes: safeExcelText(review.notes), remarks: safeExcelText(pricing.explanation), boqSourceFile: safeExcelText(source.boqSourceFile), boqSourceLocation: safeExcelText(source.boqSourceLocation), specificationSource: safeExcelText(source.specificationSource), productSource: safeExcelText(product.source_name), priceSourceFile: safeExcelText(price.file_name), matchRunVersion: candidate.match_run_version || "", pricingVersion: pricing.version_number || "", reviewVersion: review.version_number || ""
  };
  // Client-Safe projects the row onto the allowlist rather than subtracting a
  // denylist, so a field that does not exist yet cannot leak by default.
  return mode === "Client-Safe Export" ? applyClientSafeRowBoundary(row) : row;
};

export const warningForRow = (row) => [row.quantity == null ? "Missing Quantity" : null, row.netUnitMaterialCost == null ? "Missing Price" : null, row.priceValidity && new Date(row.priceValidity) < new Date() ? "Expired Price" : null, row.technicalStatus === "Discovery Only" ? "Discovery Only" : null, row.technicalApprovalStatus !== "Approved" ? "Missing Technical Approval" : null, row.commercialApprovalStatus !== "Approved" ? "Missing Commercial Approval" : null, row.blockingConditions ? "Blocking Condition" : null, row.margin != null && row.margin < 0 ? "Negative Margin" : null].filter(Boolean);
export const validateExportReadiness = ({ mode, rows = [], reviewReadiness, templateStatus = "Approved" }) => {
  const errors = [], warnings = rows.flatMap((row, index) => warningForRow(row).map((warning) => ({ line: index + 1, warning })));
  if (!EXPORT_MODES.includes(mode)) errors.push("INVALID_EXPORT_MODE");
  if (!rows.length) errors.push("BOQ_AND_PRICING_REQUIRED");
  if (mode === "Approved Cost Sheet") { if (reviewReadiness !== "Ready for Quotation") errors.push("APPROVED_EXPORT_REVIEW_BLOCKED"); if (warnings.length) errors.push("APPROVED_EXPORT_WARNINGS_BLOCKED"); if (templateStatus !== "Approved") errors.push("EXPORT_TEMPLATE_NOT_APPROVED"); }
  return { permitted: errors.length === 0, errors, warnings, status: warnings.length ? "Completed with Warnings" : "Completed" };
};

export const aggregateExportRows = (rows) => {
  const sum = (field) => rows.reduce((total, row) => total + (Number.isFinite(Number(row[field])) ? Number(row[field]) : 0), 0);
  const totals = { itemCount: rows.length, pricedItemCount: rows.filter((x) => x.netUnitMaterialCost != null).length, materialCost: sum("materialTotal"), accessoryCost: sum("accessoriesCost"), serviceCost: sum("installationCost") + sum("engineeringCost") + sum("programmingCost") + sum("testingCost") + sum("otherDirectCost"), freight: sum("freight") + sum("customs"), overheads: sum("overheads"), risk: sum("risk") + sum("contingency"), totalCost: sum("totalLineCost"), grossSelling: rows.reduce((s, x) => s + Number(x.grossSellingUnitPrice || 0) * Number(x.quantity || 0), 0), customerDiscount: sum("customerDiscount"), netSelling: sum("netSellingTotal"), vat: sum("vat"), finalValue: sum("finalLineValue") };
  totals.grossProfit = totals.netSelling - totals.totalCost; totals.grossMargin = totals.netSelling > 0 ? totals.grossProfit / totals.netSelling : null; return totals;
};
export const reconcileExport = ({ workbookTotals, serverTotals, tolerance = 0.02 }) => { const fields = ["materialCost", "accessoryCost", "serviceCost", "freight", "overheads", "risk", "totalCost", "grossSelling", "netSelling", "vat", "finalValue", "itemCount", "pricedItemCount"], differences = Object.fromEntries(fields.map((field) => [field, Number(workbookTotals[field] || 0) - Number(serverTotals[field] || 0)])), failed = fields.filter((field) => Math.abs(differences[field]) > (field.endsWith("Count") ? 0 : tolerance)); return { reconciled: failed.length === 0, differences, failed, tolerance }; };

/**
 * Independent reconciliation of an approved quotation snapshot.
 *
 * A snapshot export is built from the immutable lines of one approved revision,
 * not from live pricing state, so its workbook must be checked against the
 * revision three separate ways: the revision's own money against the totals of
 * its stored lines, the workbook against those same totals, and the fingerprint
 * that binds the lines. Any disagreement means the workbook is not a faithful
 * rendering of what was approved.
 *
 * The comparison is EXACT, with no tolerance: every value on both sides is money
 * in minor units divided by 100, or a count. A tolerance would let a real drift
 * pass as rounding, which is precisely the class of defect this gate exists to
 * catch.
 */
export const reconcileQuotationSnapshotExport = ({ revision, snapshotTotals, workbookTotals, fingerprintMatches, mode }) => {
  const major = (minor) => Number(minor || 0) / 100;
  const differences = {};
  const failed = [];
  // Money is compared in minor units and reported in major units, so a difference
  // is reported as the reader would see it (402.49 - 402.50 = -0.01) rather than as
  // a binary-floating-point artefact. Counts stay exact.
  const compare = (field, workbook, snapshot, { money = false } = {}) => {
    const raw = Number(workbook || 0) - Number(snapshot || 0);
    const difference = money ? Math.round(raw * 100) / 100 : raw;
    differences[field] = difference;
    if (difference !== 0) failed.push(field);
  };
  // 1. the revision's own totals must be the totals of its stored lines
  compare("revisionSubtotalMinor", revision.subtotal_minor, snapshotTotals.subtotalMinor);
  compare("revisionVatMinor", revision.vat_minor, snapshotTotals.vatMinor);
  compare("revisionTotalMinor", revision.total_minor, snapshotTotals.totalMinor);
  compare("lineCount", snapshotTotals.lineCount, revision.quotation_line_count ?? snapshotTotals.lineCount);
  // 2. the workbook must render exactly those totals
  compare("itemCount", workbookTotals.itemCount, snapshotTotals.lineCount);
  // `Client-Safe Export` removes the protected commercial fields from every row
  // by design, so their totals are absent from the workbook rather than wrong.
  // Comparing them would make the only client-safe export mode permanently
  // unreconcilable; they are skipped, and everything the mode does expose is
  // still compared exactly.
  const exposesProtectedMoney = mode !== "Client-Safe Export";
  if (exposesProtectedMoney) {
    compare("pricedItemCount", workbookTotals.pricedItemCount, snapshotTotals.lineCount);
    compare("totalCost", workbookTotals.totalCost, major(snapshotTotals.totalCostMinor), { money: true });
  }
  compare("netSelling", workbookTotals.netSelling, major(snapshotTotals.subtotalMinor), { money: true });
  compare("vat", workbookTotals.vat, major(snapshotTotals.vatMinor), { money: true });
  compare("finalValue", workbookTotals.finalValue, major(snapshotTotals.totalMinor), { money: true });
  // 3. the fingerprint is what binds the lines in the first place
  if (!fingerprintMatches) failed.push("quotationFingerprint");
  return { reconciled: failed.length === 0, differences, failed, tolerance: 0, fingerprintMatches: Boolean(fingerprintMatches) };
};

/**
 * The stored revision's own reconciliation metadata must agree with the lines it
 * shipped with. It is written at draft time, so a disagreement means the stored
 * revision is internally inconsistent and must not be exported.
 */
export const verifyQuotationSnapshotMetadata = ({ sourceSummary, snapshotTotals }) => {
  const reconciliation = sourceSummary?.reconciliation || {};
  const problems = [];
  if (reconciliation.subtotalMinor !== snapshotTotals.subtotalMinor) problems.push("subtotalMinor");
  if (reconciliation.lineCountMatched !== true) problems.push("lineCountMatched");
  if (reconciliation.subtotalMatched !== true) problems.push("subtotalMatched");
  return { consistent: problems.length === 0, problems };
};

/**
 * Build workbook rows from an approved quotation revision's IMMUTABLE stored
 * lines.
 *
 * This is the single projection of a quotation snapshot into workbook rows, used
 * by the governed snapshot export loader. It deliberately does NOT read live
 * pricing, live matches or live approvals: an approved quotation is a snapshot, and
 * a workbook built from anything else is not the document the customer approved.
 *
 * The revision is the authority for the approved status and for VAT, so the
 * per-line final value is derived from the revision's VAT basis rather than from
 * a pricing row that may since have moved.
 */
export const buildQuotationSnapshotRows = ({ revision, lines, mode }) => {
  // Prefer the revision's stated VAT basis; otherwise derive it from the revision's
  // own approved money (vat over subtotal), so a snapshot is always self-consistent
  // even when only the stored totals are available.
  const subtotalMinor = (lines || []).reduce((total, line) => total + Number(line.net_selling_minor || 0), 0);
  const vatBasisPoints = Number(
    revision?.vat_basis_points ??
    (subtotalMinor > 0 ? Math.round((Number(revision?.vat_minor || 0) * 10000) / subtotalMinor) : 0),
  );
  return (lines || []).map((line) => {
    const netSellingMinor = Number(line.net_selling_minor || 0);
    const vatMinor = Math.round((netSellingMinor * vatBasisPoints) / 10000);
    const totalCostMinor = Number(line.total_cost_minor || 0);
    const row = buildDetailedRow({
      boq: {
        id: line.boq_item_id,
        sequence: line.sequence,
        item_number: line.item_number,
        description: line.description,
        original_unit: line.unit,
        original_quantity: line.quantity,
      },
      candidate: { technical_status: "Approved" },
      product: {
        manufacturer_name: line.manufacturer_name,
        part_number: line.part_number,
        description: line.product_description,
        lifecycle_status: "Current",
      },
      // The snapshot persists the line's total cost, not a material or service
      // split, so the row states the line total rather than inventing a breakdown.
      pricing: {
        project_currency: line.currency ?? revision?.currency,
        status: revision?.status,
        approval_ready: 1,
        total_cost_minor: totalCostMinor,
        net_selling_minor: netSellingMinor,
        net_material_unit_minor: totalCostMinor,
        material_total_minor: totalCostMinor,
        final_value_minor: netSellingMinor + vatMinor,
        explanation: typeof line.source_snapshot_json === "string" ? parseOriginalDescription(line.source_snapshot_json) : null,
      },
      technicalApproval: { status: "Approved" },
      commercialApproval: { status: "Approved" },
      mode,
    });
    row.vat = vatMinor / 100;
    return row;
  });
};
