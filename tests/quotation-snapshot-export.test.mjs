import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { reconcileQuotationSnapshotExport } from "../app/domain/excel-export-engine.mjs";
import { loadExportData, loadQuotationSnapshotExportData } from "../worker/excel-export-api.mjs";
import { validateExportReadiness } from "../app/domain/excel-export-engine.mjs";

const PROJECT_ID = "project-quotation-snapshot-export";

const digest = async (value) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))),
).map((value) => value.toString(16).padStart(2, "0")).join("");

const quotationFingerprint = async (revision, lines) => digest({
  evidenceFingerprint: revision.evidence_fingerprint,
  totals: {
    currency: revision.currency,
    costMinor: lines.reduce((sum, line) => sum + line.total_cost_minor, 0),
    subtotalMinor: lines.reduce((sum, line) => sum + line.net_selling_minor, 0),
    lineCount: lines.length,
    selectedScenarioId: "scenario-snapshot",
  },
  quotationLineAuthority: {
    version: "quotation-line-authority-1.0.0",
    lineCount: lines.length,
    lines: lines.map((line) => ({
      boqItemId: line.boq_item_id,
      pricingRunId: line.pricing_run_id,
      pricingRunVersion: line.pricing_run_version,
      pricingLineId: line.pricing_line_id,
      pricingLineVersion: line.pricing_line_version,
      commercialApprovalId: line.commercial_approval_id,
      commercialApprovalVersion: line.commercial_approval_version,
      productId: line.product_id,
      quantity: line.quantity,
      netSellingMinor: line.net_selling_minor,
    })),
  },
  vatBasisPoints: revision.vat_basis_points,
  terms: JSON.parse(revision.terms_json),
});

const fixture = async ({ status = "Approved" } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE project_quotation_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      quotation_fingerprint TEXT NOT NULL,
      currency TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      vat_basis_points INTEGER NOT NULL,
      vat_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      terms_json TEXT NOT NULL,
      source_summary_json TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_fingerprint TEXT NOT NULL,
      evidence_manifest_json TEXT NOT NULL,
      superseded_at TEXT
    );
    CREATE TABLE project_quotation_lines (
      id TEXT PRIMARY KEY,
      quotation_revision_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      item_number TEXT,
      description TEXT,
      unit TEXT NOT NULL,
      quantity TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      manufacturer_name TEXT NOT NULL,
      part_number TEXT NOT NULL,
      product_description TEXT NOT NULL,
      pricing_run_id TEXT NOT NULL,
      pricing_run_version INTEGER NOT NULL,
      pricing_line_id TEXT NOT NULL,
      pricing_line_version INTEGER NOT NULL,
      pricing_input_fingerprint TEXT NOT NULL,
      commercial_approval_id TEXT NOT NULL,
      commercial_approval_version INTEGER NOT NULL,
      currency TEXT NOT NULL,
      total_cost_minor INTEGER NOT NULL,
      net_selling_minor INTEGER NOT NULL,
      source_snapshot_json TEXT NOT NULL
    );
  `);

  const revision = {
    id: "quotation-approved-7",
    project_id: PROJECT_ID,
    revision_number: 7,
    quotation_fingerprint: "",
    currency: "SAR",
    subtotal_minor: 35000,
    vat_basis_points: 1500,
    vat_minor: 5250,
    total_minor: 40250,
    terms_json: JSON.stringify({ client: "Snapshot Client", delivery: "4-6 weeks" }),
    source_summary_json: JSON.stringify({
      quotationHeader: {
        projectName: "Snapshot Project",
        client: "Snapshot Client",
        tenderNumber: "SNAP-7",
        location: "Riyadh",
        packageName: "Fire Detection & Alarm",
        currency: "SAR",
        quotationDate: "2026-09-20T00:00:00.000Z",
      },
      pricingLineCount: 2,
      quotationLineCount: 2,
      quotationLineAuthorityVersion: "quotation-line-authority-1.0.0",
      reconciliation: { lineCountMatched: true, subtotalMatched: true, subtotalMinor: 35000 },
      evidenceFingerprint: "evidence-current",
    }),
    status,
    evidence_fingerprint: "evidence-current",
    evidence_manifest_json: JSON.stringify({ selectedPricingScenario: { id: "scenario-snapshot" } }),
    superseded_at: null,
  };
  const lines = [
    {
      id: "quotation-line-1", quotation_revision_id: revision.id, project_id: PROJECT_ID,
      boq_item_id: "boq-snapshot-1", sequence: 1, item_number: "FA-01",
      description: "Snapshot detector", unit: "EA", quantity: "2",
      candidate_id: "candidate-snapshot-1", product_id: "product-snapshot-1",
      manufacturer_name: "Snapshot Manufacturer", part_number: "SNAP-001",
      product_description: "Immutable detector snapshot", pricing_run_id: "pricing-run-snapshot",
      pricing_run_version: 4, pricing_line_id: "pricing-line-snapshot-1", pricing_line_version: 2,
      pricing_input_fingerprint: "pricing-input-1", commercial_approval_id: "commercial-approval-1",
      commercial_approval_version: 3, currency: "SAR", total_cost_minor: 12500,
      net_selling_minor: 25000, source_snapshot_json: JSON.stringify({ priceRecordId: "price-1" }),
    },
    {
      id: "quotation-line-2", quotation_revision_id: revision.id, project_id: PROJECT_ID,
      boq_item_id: "boq-snapshot-2", sequence: 2, item_number: "FA-02",
      description: "Snapshot controller", unit: "EA", quantity: "1",
      candidate_id: "candidate-snapshot-2", product_id: "product-snapshot-2",
      manufacturer_name: "Snapshot Manufacturer", part_number: "SNAP-002",
      product_description: "Immutable controller snapshot", pricing_run_id: "pricing-run-snapshot",
      pricing_run_version: 4, pricing_line_id: "pricing-line-snapshot-2", pricing_line_version: 2,
      pricing_input_fingerprint: "pricing-input-2", commercial_approval_id: "commercial-approval-2",
      commercial_approval_version: 3, currency: "SAR", total_cost_minor: 17500,
      net_selling_minor: 10000, source_snapshot_json: JSON.stringify({ priceRecordId: "price-2" }),
    },
  ];
  revision.quotation_fingerprint = await quotationFingerprint(revision, lines);

  const insertRevision = raw.prepare(`INSERT INTO project_quotation_revisions VALUES (${Array(15).fill("?").join(",")})`);
  insertRevision.run(
    revision.id, revision.project_id, revision.revision_number, revision.quotation_fingerprint,
    revision.currency, revision.subtotal_minor, revision.vat_basis_points, revision.vat_minor,
    revision.total_minor, revision.terms_json, revision.source_summary_json, revision.status,
    revision.evidence_fingerprint, revision.evidence_manifest_json, revision.superseded_at,
  );
  const insertLine = raw.prepare(`INSERT INTO project_quotation_lines VALUES (${Array(25).fill("?").join(",")})`);
  for (const line of lines) insertLine.run(...Object.values(line));

  const db = {
    prepare(sql) {
      const state = { values: [] };
      return {
        bind(...values) { state.values = values; return this; },
        first: async () => raw.prepare(sql).get(...state.values) || null,
        all: async () => ({ results: raw.prepare(sql).all(...state.values) }),
        run: async () => raw.prepare(sql).run(...state.values),
      };
    },
  };

  return { db, raw, revision, lines };
};

test("quotation-snapshot-export builds approved workbook rows and totals only from immutable revision lines", async () => {
  const { db, raw } = await fixture();

  const data = await loadExportData(db, PROJECT_ID, "Approved Cost Sheet", { currentEvidenceFingerprint: "evidence-current" });

  assert.equal(data.quotation.id, "quotation-approved-7");
  assert.deepEqual(data.rows.map((row) => [row.itemNumber, row.description, row.manufacturer, row.netSellingTotal, row.finalLineValue]), [
    ["FA-01", "Snapshot detector", "Snapshot Manufacturer", 250, 287.5],
    ["FA-02", "Snapshot controller", "Snapshot Manufacturer", 100, 115],
  ]);
  assert.equal(data.totals.totalCost, 300);
  assert.equal(data.totals.netSelling, 350);
  assert.equal(data.totals.vat, 52.5);
  assert.equal(data.totals.finalValue, 402.5);
  assert.equal(data.reconciliation.reconciled, true);
  assert.equal(data.reconciliation.fingerprintMatches, true);
  assert.equal(validateExportReadiness({ mode: "Approved Cost Sheet", rows: data.rows, reviewReadiness: "Ready for Quotation" }).permitted, true);
  assert.equal(data.quotationRevisionId, "quotation-approved-7");

  raw.close();
});

test("quotation-snapshot-export client-safe mode removes protected commercial fields from the same snapshot", async () => {
  const { db, raw } = await fixture();

  const data = await loadQuotationSnapshotExportData(db, PROJECT_ID, "Client-Safe Export", "evidence-current");

  assert.equal(data.rows.length, 2);
  assert.equal("totalLineCost" in data.rows[0], false);
  assert.equal("supplier" in data.rows[0], false);
  assert.equal(data.rows[0].netSellingTotal, 250);
  assert.equal(data.totals.finalValue, 402.5);

  raw.close();
});

test("quotation-snapshot-export fails closed when stored quotation fingerprint does not match immutable lines", async () => {
  const { db, raw } = await fixture();
  raw.prepare("UPDATE project_quotation_lines SET product_id='tampered-product' WHERE id='quotation-line-1'").run();

  await assert.rejects(
    loadQuotationSnapshotExportData(db, PROJECT_ID, "Approved Cost Sheet", "evidence-current"),
    (error) => error?.code === "QUOTATION_FINGERPRINT_MISMATCH",
  );

  raw.close();
});

test("quotation-snapshot-export fails closed when stored revision reconciliation metadata is inconsistent", async () => {
  const { db, raw, revision } = await fixture();
  const sourceSummary = JSON.parse(revision.source_summary_json);
  sourceSummary.reconciliation.subtotalMinor = 34999;
  raw.prepare("UPDATE project_quotation_revisions SET source_summary_json=? WHERE id=?").run(JSON.stringify(sourceSummary), revision.id);

  await assert.rejects(
    loadQuotationSnapshotExportData(db, PROJECT_ID, "Approved Cost Sheet", "evidence-current"),
    (error) => error?.code === "QUOTATION_SNAPSHOT_METADATA_MISMATCH",
  );

  raw.close();
});

test("quotation-snapshot-export fails closed for stale, non-approved, or missing revisions", async () => {
  const stale = await fixture();
  await assert.rejects(
    loadQuotationSnapshotExportData(stale.db, PROJECT_ID, "Approved Cost Sheet", "evidence-changed"),
    (error) => error?.code === "QUOTATION_EVIDENCE_STALE",
  );
  stale.raw.close();

  const draft = await fixture({ status: "Draft" });
  await assert.rejects(
    loadQuotationSnapshotExportData(draft.db, PROJECT_ID, "Approved Cost Sheet", "evidence-current"),
    (error) => error?.code === "APPROVED_QUOTATION_REQUIRED",
  );
  draft.raw.close();

  const missing = await fixture();
  missing.raw.exec("DELETE FROM project_quotation_revisions");
  await assert.rejects(
    loadQuotationSnapshotExportData(missing.db, PROJECT_ID, "Client-Safe Export", "evidence-current"),
    (error) => error?.code === "APPROVED_QUOTATION_REQUIRED",
  );
  missing.raw.close();
});

test("quotation-snapshot-export reconciliation independently detects workbook total drift", () => {
  const reconciliation = reconcileQuotationSnapshotExport({
    revision: { subtotal_minor: 35000, vat_basis_points: 1500, vat_minor: 5250, total_minor: 40250 },
    snapshotTotals: { lineCount: 2, totalCostMinor: 30000, subtotalMinor: 35000, vatMinor: 5250, totalMinor: 40250 },
    workbookTotals: { itemCount: 2, pricedItemCount: 2, totalCost: 300, netSelling: 350, vat: 52.5, finalValue: 402.49 },
    fingerprintMatches: true,
  });

  assert.equal(reconciliation.reconciled, false);
  assert.deepEqual(reconciliation.failed, ["finalValue"]);
  assert.equal(reconciliation.differences.finalValue, -0.01);
});
