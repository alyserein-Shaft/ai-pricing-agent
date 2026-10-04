/**
 * Phase 1 residual J -- non-governed Excel export quantity.
 *
 * The non-governed export path (`buildDetailedRow`) read the RAW extracted
 * `boq.original_quantity` and then used it as the DIVISOR for three derived
 * commercial figures: `totalUnitCost`, `grossSellingUnitPrice` and
 * `netSellingUnitPrice`.
 *
 * That is not a display preference. The pricing line those totals come from is
 * computed on the GOVERNED quantity -- the one `currentSelectedQuantity`
 * resolves, which is a drawing-derived count, a pack-size expansion or an
 * engineer override wherever a Quantity Source Decision exists. Dividing a
 * governed line total by the raw quantity produces a unit price wrong by
 * exactly the ratio between the two, in a column a reader treats as a price.
 * Where a pack of 2 means a governed 10 against a raw 5, every unit price in the
 * sheet is doubled.
 *
 * The governed quotation-snapshot path (`buildQuotationSnapshotRows`) was
 * already correct: it reads `line.quantity` off the immutable approved
 * snapshot. This suite pins both, so the two paths cannot drift apart again.
 *
 * :memory: only. No Golden, no canonical D1, no configured migration target.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { buildDetailedRow, buildQuotationSnapshotRows, resolveExportQuantity, validateExportReadiness, warningForRow } from "../app/domain/excel-export-engine.mjs";
import { currentSelectedQuantity } from "../worker/quantity-source-decision-api.mjs";

const approved = {
  pricingStatus: "Draft Price", technicalStatus: "Technically Compliant",
  technicalApprovalStatus: "Approved", commercialApprovalStatus: "Approved",
  blockingConditions: "", netUnitMaterialCost: 80, materialTotal: 80,
  accessoriesCost: 0, installationCost: 0, engineeringCost: 0, programmingCost: 0,
  testingCost: 0, otherDirectCost: 0, freight: 0, customs: 0, overheads: 0,
  risk: 0, contingency: 0, totalLineCost: 100, grossSellingUnitPrice: 20,
  customerDiscount: 0, netSellingTotal: 200, vat: 30, finalLineValue: 230,
};

test("the governed quantity is the divisor, not the raw extracted quantity", () => {
  // Governed 10 (a pack-size expansion), raw 5. The pricing line totals are for 10.
  const row = buildDetailedRow({
    boq: { sequence: 1, original_quantity: 5, numeric_quantity: 5, description: "Smoke Detector" },
    governedQuantity: { value: 10, source: "Engineer Override", status: "VALID", decisionId: "qd1" },
    pricing: { output: "{}", total_cost_minor: 100000, net_selling_minor: 200000, gross_selling_minor: 200000, material_total_minor: 80000 },
    mode: "Draft Cost Sheet",
  });
  assert.equal(row.quantity, 10, "the sheet shows the quantity the money was computed on");
  assert.equal(row.totalUnitCost, 100, "1000.00 / 10 governed units, not 1000.00 / 5 raw units");
  assert.equal(row.netSellingUnitPrice, 200, "2000.00 / 10 governed units");
  assert.equal(row.netSellingTotal, 2000, "the line total is untouched -- it was never derived from the raw quantity");
  assert.equal(row.grossSellingUnitPrice * row.quantity, 2000, "unit price x governed quantity reconciles to the line total");
});

test("the raw/governed discrepancy is stated in the sheet, not silently resolved", () => {
  const row = buildDetailedRow({
    boq: { sequence: 1, original_quantity: 5, numeric_quantity: 5 },
    governedQuantity: { value: 10, source: "Drawing", status: "VALID" },
    pricing: { output: "{}", total_cost_minor: 100000, net_selling_minor: 200000 },
    mode: "Draft Cost Sheet",
  });
  assert.match(row.warnings, /Quantity differs from the raw extracted quantity/);
  assert.match(row.warnings, /raw 5, governed 10/);
});

test("a quantity discrepancy blocks an Approved Cost Sheet rather than shipping quietly", () => {
  const row = buildDetailedRow({
    boq: { sequence: 1, original_quantity: 5, numeric_quantity: 5 },
    governedQuantity: { value: 10, source: "Drawing", status: "VALID" },
    pricing: { output: "{}", status: "Approved Quotation Snapshot", net_unit_material_minor: 80000 },
    mode: "Approved Cost Sheet",
  });
  assert.ok(warningForRow(row).length, "the discrepancy surfaces as a row warning");
  const readiness = validateExportReadiness({ mode: "Approved Cost Sheet", rows: [row], reviewReadiness: "Ready for Quotation", templateStatus: "Approved" });
  assert.equal(readiness.permitted, false, "an unreviewed quantity discrepancy must not reach an approved sheet");
  assert.ok(readiness.errors.includes("APPROVED_EXPORT_WARNINGS_BLOCKED"));
});

test("a STALE quantity decision fails closed instead of falling back to raw evidence", () => {
  const resolved = resolveExportQuantity(
    { original_quantity: 5, numeric_quantity: 5 },
    { value: 10, source: "Drawing", status: "STALE", decisionId: "qd1" },
  );
  assert.equal(resolved.quantity, null, "an unverified quantity decision is not a number to fall back from");
  assert.equal(resolved.authority, "STALE");
  const row = buildDetailedRow({ boq: { sequence: 1, original_quantity: 5, numeric_quantity: 5 }, governedQuantity: { value: 10, source: "Drawing", status: "STALE" }, pricing: { output: "{}", total_cost_minor: 100000, net_selling_minor: 200000 }, mode: "Draft Cost Sheet" });
  assert.equal(row.quantity, null);
  assert.equal(row.netSellingUnitPrice, null, "no unit price is derived from an unverified quantity");
  assert.equal(row.netSellingTotal, 2000, "the line total is still shown; only the per-unit derivation is withheld");
  assert.ok(warningForRow(row).includes("Missing Quantity"));
});

test("with no decision at all the normalized BOQ quantity is preferred over the raw one", () => {
  const resolved = resolveExportQuantity({ original_quantity: "5", numeric_quantity: 6 }, null);
  assert.equal(resolved.quantity, 6, "normalized beats raw");
  assert.equal(resolved.authority, "BOQ Normalized Quantity");
});

test("a legacy caller with no numeric_quantity still gets the raw value, labelled as unverified", () => {
  const resolved = resolveExportQuantity({ original_quantity: "5" }, null);
  assert.equal(resolved.quantity, 5, "backward compatible: zero behaviour change for a row with nothing else");
  assert.match(resolved.authority, /unverified/);
});

test("the governed quotation-snapshot path reads the immutable approved quantity", () => {
  const rows = buildQuotationSnapshotRows({
    revision: { revision_number: 3, vat_minor: 3000, vat_basis_points: 1500 },
    lines: [{ sequence: 1, item_number: "1", description: "Smoke Detector", unit: "EA", quantity: 10, net_selling_minor: 200000, total_cost_minor: 100000, currency: "SAR", pricing_run_version: 2 }],
    mode: "Draft Cost Sheet",
  });
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].netSellingUnitPrice, 200, "2000.00 / the snapshot's own quantity");
  assert.equal(rows[0].netSellingTotal, 2000);
});

// ---------------------------------------------------------------------------
// The export API must actually resolve the governed decision per BOQ item.
// ---------------------------------------------------------------------------
const activeDatabase = () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}${migration}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { ...result, meta: { changes: Number(result.changes || 0) } };
      },
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

test("the export path resolves the same governed quantity the commercial stages use", async () => {
  const raw = activeDatabase();
  const run = (sql, ...values) => raw.prepare(sql).run(...values);
  run("INSERT INTO organizations (id, name) VALUES ('org', 'Org')");
  run("INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1', 'Qty', 'u1', 'org')");
  run("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', 'boq.pdf', 'u1')");
  run("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('v1', 'd1', 1, 'boq.pdf', 'boq.stored', 'pdf', 'application/pdf', 4, 'sum1', 'projects/boq.pdf', 'u1')");
  run("INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES ('e1', 'd1', 'v1', 1, 'Completed', 'p', 'r', 'o', 'u1')");
  run("INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, sequence, section_path, row_type, original_quantity, numeric_quantity, original_unit, normalized_unit, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values) VALUES ('b1', 'e1', 'p1', 'd1', 1, 'S1', 'BOQ Item', 5, 5, 'EA', 'EA', 0.95, 'High', 'Approved', '{}', '{}', '{}')");
  const db = d1(raw);

  const withoutDecision = await currentSelectedQuantity(db, { id: "b1", numeric_quantity: 5, original_quantity: 5 });
  assert.equal(withoutDecision.value, 5, "with no decision the normalized BOQ quantity governs");

  // A governed override: the pack contains 2, so 5 lines is 10 devices.
  raw.prepare("INSERT INTO boq_quantity_source_decisions (id, project_id, boq_item_id, source, boq_quantity, selected_quantity, reason, decided_by) VALUES ('qd1', 'p1', 'b1', 'Engineer Override', 5, 10, 'Manufacturer pack contains 2 devices per line.', 'u1')").run();
  const withDecision = await currentSelectedQuantity(db, { id: "b1", numeric_quantity: 5, original_quantity: 5 });
  assert.equal(withDecision.value, 10);
  assert.equal(withDecision.status, "VALID");

  // And the export engine, handed that same decision, prices per governed unit.
  const row = buildDetailedRow({
    boq: { sequence: 1, original_quantity: 5, numeric_quantity: 5 },
    governedQuantity: withDecision,
    pricing: { output: "{}", total_cost_minor: 100000, net_selling_minor: 200000, gross_selling_minor: 200000 },
    mode: "Draft Cost Sheet",
  });
  assert.equal(row.quantity, 10);
  assert.equal(row.netSellingUnitPrice, 200);
  raw.close();
});
