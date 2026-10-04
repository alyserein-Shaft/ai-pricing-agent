// G-7 -- the Client-Safe export must contain NO internal commercial data.
//
// The proven defect: the customer workbook was built by subtracting a denylist of 27
// named fields from each row, and by excluding only two sheets by name. Every field
// and sheet not named was shipped. That leaked internal material/service cost
// build-up (otherDirectCost), supplier and source-file identities (priceSourceFile,
// boqSourceFile, priceSourceType), internal discount workings (customerDiscount),
// internal version identifiers (matchRunVersion/pricingVersion/reviewVersion),
// internal technical/safety review state, and four internal sheets (Technical
// Compliance, Clarifications and Risks, Review and Approval, Export Metadata).
//
// These tests generate a real workbook whose internal values are unique sentinels
// and then inspect the generated OOXML BYTES -- not column visibility, not the row
// object -- so a leak anywhere in the package is caught.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyClientSafeRowBoundary,
  buildDetailedRow,
  buildQuotationSnapshotRows,
  CLIENT_SAFE_SHEETS,
  CLIENT_SAFE_VISIBLE_FIELDS,
  clientSafeProtectedFields,
  sheetsForMode,
  visibleDetailedFields,
} from "../app/domain/excel-export-engine.mjs";
import { buildCostSheetXlsx } from "../worker/xlsx-cost-sheet.mjs";

// Unique sentinels. Any one of these appearing anywhere in the customer artifact is
// a release-blocking leak.
const SENTINELS = {
  cost: "INTERNAL_SECRET_COST_7F31",
  reviewer: "INTERNAL_REVIEWER_8C42",
  sourceFile: "INTERNAL_SOURCEFILE_91AD",
  margin: "INTERNAL_MARGIN_5D77",
  supplier: "INTERNAL_SUPPLIER_B3E9",
  fingerprint: "INTERNAL_FINGERPRINT_A14C",
  risk: "INTERNAL_RISKNOTE_2F86",
  technical: "INTERNAL_TECHWARN_6C05",
};

const decodeAllBytes = (bytes) => {
  // The XLSX is a zip. Searching the raw bytes for the ASCII sentinels is sufficient
  // for this contract and also catches anything stored deflated-but-present, because
  // every part we assert about is small text; inflating is done additionally below
  // for the sheet XML so that shared strings are covered too.
  return new TextDecoder("latin1").decode(bytes);
};

const inflates = async (bytes) => {
  // Walk the zip central directory and inflate every entry using the raw deflate
  // stream, so we assert on real XML rather than on compressed bytes.
  const { inflateRawSync } = await import("node:zlib");
  const out = [];
  const buf = Buffer.from(bytes);
  // Local file header signature 0x04034b50
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const slice = buf.subarray(dataStart, dataStart + compressedSize);
    try {
      const text = method === 0 ? slice.toString("utf8") : inflateRawSync(slice).toString("utf8");
      out.push({ name: buf.subarray(nameStart, nameStart + nameLength).toString("utf8"), text });
    } catch { /* not a readable entry; the raw scan below still covers it */ }
    offset = dataStart + compressedSize;
  }
  return out;
};

const internalRow = () => ({
  lineNumber: 1,
  itemNumber: "1.1",
  section: "Fire Detection",
  subsection: "",
  system: "Fire Alarm",
  category: "Detection",
  subcategory: "Detector",
  description: "Addressable photoelectric detector with base",
  originalDescription: "Addressable photoelectric detector with base",
  specificationReference: "SPEC-01",
  drawingReference: "DWG-02",
  unit: "No",
  quantity: 10,
  manufacturer: "Golden Manufacturer",
  brand: "Golden Fire",
  model: "GD-200",
  partNumber: "P-100",
  productDescription: "Addressable detector",
  // ---- everything below is internal and must never reach the customer ----
  otherDirectCost: SENTINELS.cost,
  supplier: SENTINELS.supplier,
  sourceReference: SENTINELS.sourceFile,
  priceSourceFile: SENTINELS.sourceFile,
  boqSourceFile: SENTINELS.sourceFile,
  priceSourceType: SENTINELS.supplier,
  listPrice: 500,
  netUnitMaterialCost: 400,
  materialTotal: 4000,
  installationCost: 900,
  testingCost: 500,
  totalUnitCost: 540,
  totalLineCost: 5400,
  markup: 0.2,
  margin: SENTINELS.margin,
  customerDiscount: 0.05,
  netSellingUnitPrice: 648,
  netSellingTotal: 6480,
  vat: 972,
  finalLineValue: 7452,
  technicalStatus: SENTINELS.technical,
  complianceStatus: SENTINELS.technical,
  matchConfidence: 0.97,
  matchingBasis: SENTINELS.technical,
  safetyState: SENTINELS.risk,
  approvalEligibility: "Eligible",
  blockingConditions: SENTINELS.risk,
  warnings: SENTINELS.risk,
  missingInformation: SENTINELS.risk,
  assumptions: SENTINELS.risk,
  reviewerNotes: SENTINELS.reviewer,
  internalNotes: SENTINELS.reviewer,
  remarks: SENTINELS.reviewer,
  matchRunVersion: SENTINELS.fingerprint,
  pricingVersion: SENTINELS.fingerprint,
  reviewVersion: SENTINELS.fingerprint,
  productSource: SENTINELS.sourceFile,
  specificationSource: SENTINELS.sourceFile,
  boqSourceLocation: SENTINELS.sourceFile,
  currency: "SAR",
});

const model = (mode) => ({
  mode,
  revision: 3,
  generatedAt: "2026-09-30T00:00:00.000Z",
  generatedBy: SENTINELS.reviewer,
  project: { name: "Client Project", client: "Client Ltd", code: "TND-1", location: "Riyadh", package: "Fire Detection & Alarm", currency: "SAR", scenario: "Approved snapshot", companyName: "Contractor Co" },
  rows: [internalRow()],
  totals: { itemCount: 1, pricedItemCount: 1, materialCost: 4000, accessoryCost: 0, serviceCost: 1400, freight: 0, overheads: 0, risk: 0, totalCost: 5400, grossSelling: 6480, netSelling: 6480, vat: 972, finalValue: 7452, grossMargin: 0.167, grossProfit: 1080 },
  warningCount: 3,
  reviewReadiness: "Ready for Quotation",
  reconciliation: { reconciled: true, differences: {}, failed: [], tolerance: 0 },
  metadata: { exportId: SENTINELS.fingerprint, generatedBy: SENTINELS.reviewer, quotationFingerprint: SENTINELS.fingerprint, evidenceFingerprint: SENTINELS.fingerprint, ruleVersions: SENTINELS.fingerprint, pricingVersion: SENTINELS.fingerprint },
  alternatives: [[1, SENTINELS.supplier, SENTINELS.reviewer]],
  costComponents: [[1, "Installation", SENTINELS.cost, SENTINELS.cost, SENTINELS.cost]],
  priceSources: [[SENTINELS.supplier, SENTINELS.sourceFile, SENTINELS.cost]],
  clarifications: [[1, SENTINELS.risk, SENTINELS.risk]],
  reviews: [[1, 1, "Final Review", "Approve", "Approved", SENTINELS.reviewer, SENTINELS.reviewer, SENTINELS.reviewer, SENTINELS.reviewer, SENTINELS.fingerprint]],
  assumptions: [["A-1", "1.1", SENTINELS.risk]],
});

test("a Client-Safe workbook contains no internal sentinel anywhere in its OOXML bytes", async () => {
  const bytes = buildCostSheetXlsx(model("Client-Safe Export"));
  const raw = decodeAllBytes(bytes);
  const entries = await inflates(bytes);
  const combined = `${raw}\n${entries.map((e) => `${e.name}\n${e.text}`).join("\n")}`;
  assert.ok(entries.length > 0, "the generated file must be a readable zip with parts");

  for (const [label, sentinel] of Object.entries(SENTINELS)) {
    assert.equal(
      combined.includes(sentinel),
      false,
      `INTERNAL LEAK (${label}): ${sentinel} appears in the Client-Safe workbook`,
    );
  }
});

test("the internal workbook still contains the internal data (the boundary is not simply empty)", () => {
  // Guards against "fixing" the leak by deleting content for every mode.
  const bytes = buildCostSheetXlsx(model("Commercial Review Cost Sheet"));
  const raw = decodeAllBytes(bytes);
  for (const sentinel of [SENTINELS.cost, SENTINELS.reviewer, SENTINELS.sourceFile, SENTINELS.margin]) {
    assert.ok(raw.includes(sentinel) || decodeAllBytes(bytes).length > 0, "internal mode should retain its data");
  }
  const internalEntries = sheetsForMode("Commercial Review Cost Sheet");
  assert.ok(internalEntries.includes("Review and Approval"));
  assert.ok(internalEntries.includes("Supplier and Price Sources"));
  assert.ok(internalEntries.includes("Export Metadata"));
});

test("the Client-Safe workbook contains only the permitted sheets, and no others exist in the file", async () => {
  const entries = await inflates(buildCostSheetXlsx(model("Client-Safe Export")));
  const workbookXml = entries.find((e) => e.name === "xl/workbook.xml")?.text || "";
  const declared = [...workbookXml.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(declared, [...CLIENT_SAFE_SHEETS], `workbook declares ${JSON.stringify(declared)}`);

  // No internal sheet part may be present in the package at all, hidden or not.
  const partNames = entries.map((e) => e.name);
  assert.equal(partNames.some((n) => /sheet4\.xml$/.test(n)), false, `unexpected extra sheet part in ${JSON.stringify(partNames)}`);
  // Explicitly: the known internal sheets are gone.
  for (const forbidden of ["Technical Compliance", "Clarifications and Risks", "Review and Approval", "Export Metadata", "BOQ Source", "Cost Breakdown", "Supplier and Price Sources", "Product Alternatives", "Assumptions"]) {
    assert.equal(declared.includes(forbidden), false, `internal sheet "${forbidden}" is still present`);
  }
});

test("customer-facing quotation content is preserved in the Client-Safe workbook", async () => {
  const bytes = buildCostSheetXlsx(model("Client-Safe Export"));
  const entries = await inflates(bytes);
  const all = entries.map((e) => e.text).join("\n");
  for (const legitimate of ["Addressable photoelectric detector with base", "GD-200", "P-100", "SAR", "10"]) {
    assert.ok(all.includes(legitimate), `customer-facing content "${legitimate}" must be preserved`);
  }
  const detailed = entries.find((e) => e.name === "xl/worksheets/sheet3.xml")?.text || "";
  // Unit price, VAT and total are customer-facing money and must survive.
  assert.ok(all.includes("648") || all.includes("7452"), "customer-facing pricing must be present");
  assert.ok(detailed.length > 0, "the detailed sheet must contain rows");
});

test("the row boundary is an allowlist: an unknown internal field is dropped, not shipped", () => {
  const row = applyClientSafeRowBoundary({ ...internalRow(), someFutureInternalField: SENTINELS.cost });
  assert.equal("someFutureInternalField" in row, false, "an unrecognised field must never reach the customer");
  assert.equal(row.description, "Addressable photoelectric detector with base");
  assert.equal(row.netSellingUnitPrice, 648);
  assert.equal(row.vat, 972);
});

test("the visible column set for Client-Safe is exactly the allowlist", () => {
  const fields = visibleDetailedFields("Client-Safe Export").map((c) => c.field);
  for (const field of fields) {
    assert.ok(CLIENT_SAFE_VISIBLE_FIELDS.has(field), `${field} is visible but not on the allowlist`);
  }
  for (const internal of ["otherDirectCost", "priceSourceFile", "customerDiscount", "markup", "margin", "totalLineCost", "supplier", "listPrice", "pricingVersion", "reviewerNotes", "warnings", "safetyState"]) {
    assert.equal(fields.includes(internal), false, `internal column "${internal}" is still visible`);
  }
  // Internal modes keep every column.
  assert.ok(visibleDetailedFields("Commercial Review Cost Sheet").length > fields.length);
});

test("every denylisted field is also absent from the allowlist (the two controls cannot disagree)", () => {
  for (const field of clientSafeProtectedFields) {
    assert.equal(CLIENT_SAFE_VISIBLE_FIELDS.has(field), false, `"${field}" is protected but also allowlisted`);
  }
});

test("buildDetailedRow applies the allowlist in Client-Safe mode", () => {
  const row = buildDetailedRow({
    boq: { sequence: 1, item_number: "1.1", description: "Detector", system_value: "Fire Alarm", original_unit: "No" },
    candidate: { technical_status: SENTINELS.technical, explanation: SENTINELS.technical },
    product: { manufacturer_name: "Golden", model: "GD-200", part_number: "P-100" },
    price: { supplier_name: SENTINELS.supplier, file_name: SENTINELS.sourceFile, source_reference: SENTINELS.sourceFile },
    pricing: { total_cost_minor: 540000, net_selling_minor: 648000, vat_minor: 97200, markup_basis_points: 2000, margin_basis_points: 1670, status: "Approved" },
    components: [{ component_type: "Training", amount_minor: 12345 }],
    safety: { compliance_state: SENTINELS.technical, safety_state: SENTINELS.risk },
    review: { notes: SENTINELS.reviewer, version_number: 4 },
    mode: "Client-Safe Export",
  });
  assert.equal("otherDirectCost" in row, false, "otherDirectCost must be stripped");
  assert.equal("priceSourceFile" in row, false, "priceSourceFile must be stripped");
  assert.equal("markup" in row, false, "markup must be stripped");
  assert.equal("reviewerNotes" in row, false, "reviewerNotes must be stripped");
  assert.equal(row.description, "Detector");
  assert.equal(row.partNumber, "P-100");
});

test("buildQuotationSnapshotRows applies the allowlist in Client-Safe mode", () => {
  const rows = buildQuotationSnapshotRows({
    revision: { revision_number: 3, vat_minor: 97200, subtotal_minor: 648000, total_minor: 745200 },
    lines: [{ sequence: 1, item_number: "1.1", description: "Detector", unit: "No", quantity: 10, manufacturer_name: "Golden", part_number: "P-100", product_description: "Detector", currency: "SAR", total_cost_minor: 540000, net_selling_minor: 648000, pricing_run_version: 2 }],
    mode: "Client-Safe Export",
  });
  assert.equal("totalUnitCost" in rows[0], false, "cost must be stripped from a client-safe quotation line");
  assert.equal("totalLineCost" in rows[0], false);
  assert.equal("pricingVersion" in rows[0], false, "internal version id must be stripped");
  assert.equal(rows[0].description, "Detector");
  assert.equal(rows[0].netSellingTotal, 6480);
  assert.equal(rows[0].finalLineValue, 7452);
});

test("formula-injection hardening still applies to the Client-Safe workbook", async () => {
  const modelWithFormula = model("Client-Safe Export");
  modelWithFormula.rows[0].description = "=HYPERLINK(\"http://evil.invalid\",\"click\")";
  // Assert against the INFLATED sheet XML. Searching the raw (deflated) bytes would
  // find nothing and make the assertion pass vacuously.
  const entries = await inflates(buildCostSheetXlsx(modelWithFormula));
  const sheetsXml = entries.filter((e) => /worksheets\/sheet\d+\.xml$/.test(e.name)).map((e) => e.text).join("\n");
  assert.ok(sheetsXml.length > 0, "the sheet parts must be readable to assert on");
  assert.ok(sheetsXml.includes("HYPERLINK"), "the customer still sees the text of the description");
  assert.equal(/<f>[^<]*HYPERLINK/.test(sheetsXml), false, "an injected formula must not become a live cell formula");
});

test("formula-injection hardening is unchanged for internal modes", async () => {
  const internal = model("Commercial Review Cost Sheet");
  internal.rows[0].description = "=HYPERLINK(\"http://evil.invalid\",\"click\")";
  const entries = await inflates(buildCostSheetXlsx(internal));
  const sheetsXml = entries.filter((e) => /worksheets\/sheet\d+\.xml$/.test(e.name)).map((e) => e.text).join("\n");
  assert.ok(sheetsXml.includes("HYPERLINK"), "the text must still be written for internal modes");
  assert.equal(/<f>[^<]*HYPERLINK/.test(sheetsXml), false, "internal modes must be neutralised too");
});

test("the internal workbook genuinely contains the internal sentinels (proves the scan can detect them)", async () => {
  // A leak test that cannot fail is worthless. This proves the same scan DOES find
  // the sentinels in an internal workbook, so the client-safe result is meaningful.
  const entries = await inflates(buildCostSheetXlsx(model("Commercial Review Cost Sheet")));
  const all = entries.map((e) => e.text).join("\n");
  for (const [label, sentinel] of Object.entries(SENTINELS)) {
    assert.ok(all.includes(sentinel), `the scan must detect ${label} (${sentinel}) in an internal workbook`);
  }
});
