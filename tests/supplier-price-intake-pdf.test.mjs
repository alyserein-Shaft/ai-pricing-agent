import test from "node:test";
import assert from "node:assert/strict";
import { extractSupplierQuotePdfPages } from "../app/domain/supplier-price-pdf.mjs";
import { supplierPriceEligibility } from "../app/domain/supplier-price-intake.mjs";

const pages = [{
  page: 1,
  extractionQuality: 0.95,
  lines: [
    "Company Sahabeh Shabkat For Information Technology",
    "Quotation number: SO26-06-15-02",
    "Date: 23/06/2026 10:34",
    "Model رقم الصنف Description الوصف Unit Price السعر Total اإلجمالى",
    "CAT 6A 100 OHMS U/UTP LSZH 4 PAIR CABLE (500 M",
    "UU004891568 SAR 945.00 SAR 80,325.00",
    "RL 85",
    "1",
    "DRUM) GREEN",
    "Currency: All Prices are in SAR (Saudi Riyals).",
    "Quotation Validity: 10 Days oe subject to Prior Sales",
  ],
}];

const result = extractSupplierQuotePdfPages(pages);
const line = result.rows.find(row => row.rowType === "SUPPLIER_LINE");

test("PDF supplier quote extracts authoritative metadata", () => {
  assert.equal(result.metadata.quotationReference, "SO26-06-15-02");
  assert.equal(result.metadata.issueDate, "2026-06-23");
  assert.equal(result.metadata.validUntil, "2026-07-03");
  assert.equal(result.metadata.currency, "SAR");
});

test("PDF supplier line extracts model quantity and commercial value", () => {
  assert.equal(line.partNumber, "UU004891568");
  assert.equal(line.unit, "RL");
  assert.equal(line.quantity, 85);
  assert.equal(line.unitPrice, 945);
  assert.equal(line.currency, "SAR");
  assert.match(line.description, /CAT 6A/i);
});

test("PDF supplier line preserves page and line provenance", () => {
  assert.equal(line.sheet, "PDF page 1");
  assert.equal(line.rowNumber, 6);
  assert.equal(line.raw.page, 1);
  assert.equal(line.raw.line, 6);
  assert.equal(line.raw.totalPrice, 80325);
});

test("expired PDF quote remains usable for discovery but blocked from costing", () => {
  const eligibility = supplierPriceEligibility({
    rowType: "SUPPLIER_LINE",
    productId: "product1",
    mappingActorId: "estimator1",
    mappingBasis: "EXACT_CANONICAL_MODEL",
    currency: line.currency,
    netUnitPrice: line.netUnitPrice,
    supplier: result.metadata.supplier,
    quotationReference: result.metadata.quotationReference,
    documentId: "document1",
    documentVersionId: "version1",
    issueDate: result.metadata.issueDate,
    validUntil: result.metadata.validUntil,
    reviewStatus: "Approved",
    downstreamUse: "Costing Eligible",
  }, { at: new Date("2026-08-12T00:00:00Z") });

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("EXPIRED"));
});
