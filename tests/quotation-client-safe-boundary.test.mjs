/**
 * The client-safe boundary, tested as a PROPERTY of the approved quotation path
 * rather than of one hand-built workbook model.
 *
 * tests/excel-export-client-safe.test.mjs proves the boundary on a synthetic
 * workbook. This suite proves the same boundary holds for the rows the governed
 * snapshot export actually produces, from a real approved revision created
 * through the real handler, all the way to the generated workbook bytes.
 *
 * It is also the only place that asserts the two independent client-safe
 * controls (the allowlist and the denylist) cannot drift apart, and that a
 * client-safe export still carries a valid, reconcilable quotation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import {
  CLIENT_SAFE_SHEETS,
  CLIENT_SAFE_VISIBLE_FIELDS,
  applyClientSafeRowBoundary,
  buildQuotationSnapshotRows,
  clientSafeProtectedFields,
  sheetsForMode,
  visibleDetailedFields,
} from "../app/domain/excel-export-engine.mjs";
import { buildCostSheetXlsx } from "../worker/xlsx-cost-sheet.mjs";
import {
  PROJECT,
  REASON,
  decisionsOf,
  draft,
  envFor,
  json,
  post,
  revisionsOf,
  seedReadyProductProject,
  storedObjects,
} from "./helpers/governed-quotation-fixture.mjs";
import { handleExcelExportApi } from "../worker/excel-export-api.mjs";

const draftsAndApproves = async (raw) => {
  await draft(raw);
  const revision = revisionsOf(raw)[0];
  const approved = await json(
    await post(raw, "quotation/approve", {
      quotationRevisionId: revision.id,
      quotationFingerprint: revision.quotation_fingerprint,
      reason: REASON,
    }),
  );
  assert.equal(approved.status, "Approved");
  return revisionsOf(raw)[0];
};

const exportWith = (raw, mode) =>
  handleExcelExportApi(
    new Request(`https://localhost/api/excel-exports/projects/${PROJECT}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `key-${mode}` },
      body: JSON.stringify({ mode, idempotencyKey: `key-${mode}` }),
    }),
    envFor(raw),
  );

const workbookText = async (bytes) => {
  const buf = Buffer.from(bytes);
  const out = [];
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
    const method = buf.readUInt16LE(offset + 8);
    const size = buf.readUInt16LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const slice = buf.subarray(start, start + size);
    out.push({ name, text: method === 0 ? slice.toString("utf8") : inflateRawSync(slice).toString("utf8") });
    offset = start + size;
  }
  return out;
};

test("a real Client-Safe export carries only the permitted sheets", async () => {
  const raw = await seedReadyProductProject();
  await draftsAndApproves(raw);
  const response = await exportWith(raw, "Client-Safe Export");
  const body = await response.json();
  assert.equal(response.status, 201, `client-safe export failed: ${JSON.stringify(body)}`);
  const job = raw.prepare("SELECT * FROM excel_export_jobs WHERE id=?").get(body.jobId);
  assert.deepEqual(sheetsForMode("Client-Safe Export"), [...CLIENT_SAFE_SHEETS]);

  const stored = storedObjects(raw);
  assert.ok(stored.length > 0, "the export must have stored its workbook");
  const parts = await workbookText(stored[0][1]);
  const declared = [...(parts.find((p) => p.name === "xl/workbook.xml")?.text || "").matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(declared, [...CLIENT_SAFE_SHEETS]);
  for (const forbidden of ["BOQ Source", "Technical Compliance", "Cost Breakdown", "Supplier and Price Sources", "Review and Approval", "Export Metadata", "Product Alternatives", "Clarifications and Risks", "Assumptions"]) {
    assert.equal(declared.includes(forbidden), false, `client-safe workbook must not contain "${forbidden}"`);
  }
});

test("a real Client-Safe export still reconciles with the approved quotation", async () => {
  const raw = await seedReadyProductProject();
  const revision = await draftsAndApproves(raw);
  const response = await exportWith(raw, "Client-Safe Export");
  const body = await response.json();
  assert.equal(response.status, 201, `client-safe export failed: ${JSON.stringify(body)}`);
  const job = raw.prepare("SELECT * FROM excel_export_jobs WHERE id=?").get(body.jobId);
  assert.equal(job.status, "Completed");
  assert.equal(job.quotation_revision_id, revision.id);
  assert.equal(job.quotation_fingerprint, revision.quotation_fingerprint);
  assert.equal(job.evidence_fingerprint, revision.evidence_fingerprint);
});

test("snapshot rows carry customer-facing money and nothing internal in Client-Safe mode", async () => {
  const raw = await seedReadyProductProject();
  const revision = await draftsAndApproves(raw);
  const lines = raw
    .prepare("SELECT * FROM project_quotation_lines WHERE quotation_revision_id=? ORDER BY sequence")
    .all(revision.id);
  assert.ok(lines.length > 0);

  const internal = buildQuotationSnapshotRows({ revision, lines, mode: undefined });
  const clientSafe = buildQuotationSnapshotRows({ revision, lines, mode: "Client-Safe Export" });

  for (const field of ["total_cost_minor", "net_selling_minor", "pricing_run_version", "commercial_approval_id", "source_snapshot_json"]) {
    assert.ok(field in lines[0], `fixture precondition: the stored line should carry ${field}`);
  }
  // Customer-facing money survives the boundary.
  assert.equal(clientSafe[0].netSellingTotal, internal[0].netSellingTotal);
  assert.equal(clientSafe[0].finalLineValue, internal[0].finalLineValue);
  assert.ok(clientSafe[0].description, "the description must survive");
  assert.ok(clientSafe[0].partNumber, "the part number must survive");
  // Internal money and internal identity do not.
  for (const internal_field of ["totalLineCost", "totalUnitCost", "netUnitMaterialCost", "materialTotal", "pricingVersion", "matchRunVersion", "reviewVersion", "commercialApprovalStatus", "safetyState", "warnings"]) {
    assert.equal(internal_field in clientSafe[0], false, `${internal_field} must not reach a client-safe row`);
  }
});

test("the allowlist and the denylist are independent and cannot disagree", () => {
  for (const field of clientSafeProtectedFields) {
    assert.equal(CLIENT_SAFE_VISIBLE_FIELDS.has(field), false, `${field} is protected but allowlisted`);
  }
  const visible = visibleDetailedFields("Client-Safe Export").map((column) => column.field);
  for (const field of visible) assert.ok(CLIENT_SAFE_VISIBLE_FIELDS.has(field));
  assert.ok(visible.length > 0, "the client-safe sheet must still show customer-facing columns");
  assert.ok(visibleDetailedFields("Commercial Review Cost Sheet").length > visible.length);
});

test("an unknown field can never reach a client-safe artefact", () => {
  const row = applyClientSafeRowBoundary({ description: "Detector", netSellingTotal: 100, aBrandNewInternalField: "SECRET", pricingVersion: "v9" });
  assert.deepEqual(row, { description: "Detector", netSellingTotal: 100 });
});

test("an internal mode keeps every sheet and every column", async () => {
  const internalSheets = sheetsForMode("Commercial Review Cost Sheet");
  for (const sheet of [...CLIENT_SAFE_SHEETS, "Cost Breakdown", "Supplier and Price Sources", "Review and Approval", "Export Metadata"]) {
    assert.ok(internalSheets.includes(sheet), `internal mode must keep "${sheet}"`);
  }
  const bytes = buildCostSheetXlsx({
    mode: "Commercial Review Cost Sheet",
    revision: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatedBy: "INTERNAL_USER_SENTINEL",
    project: { name: "P", client: "C", code: "T", location: "R", package: "Fire", currency: "SAR", scenario: "s" },
    rows: [{ lineNumber: 1, description: "Detector", supplier: "INTERNAL_SUPPLIER_SENTINEL", netSellingTotal: 100, finalLineValue: 115 }],
    totals: { itemCount: 1, pricedItemCount: 1, materialCost: 0, serviceCost: 0, totalCost: 0, netSelling: 100, vat: 15, finalValue: 115 },
    warningCount: 0,
    reviewReadiness: "Ready for Quotation",
    reconciliation: { reconciled: true, differences: {}, failed: [] },
    metadata: { quotationFingerprint: "INTERNAL_FINGERPRINT_SENTINEL" },
  });
  const all = (await workbookText(bytes)).map((p) => p.text).join("\n");
  assert.ok(all.includes("INTERNAL_USER_SENTINEL"), "internal modes must keep the preparer");
  assert.ok(all.includes("INTERNAL_FINGERPRINT_SENTINEL"), "internal modes must keep export metadata");
});

test("a client-safe export of a project with no approved quotation is refused, not faked", async () => {
  const raw = await seedReadyProductProject();
  await draft(raw);
  const response = await exportWith(raw, "Client-Safe Export");
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "APPROVED_QUOTATION_REQUIRED");
  assert.equal(raw.prepare("SELECT count(*) c FROM excel_export_jobs").get().c, 0);
});

test("client-safe rows never write a quotation decision, and issue history is unchanged", async () => {
  const raw = await seedReadyProductProject();
  await draftsAndApproves(raw);
  await exportWith(raw, "Client-Safe Export");
  assert.deepEqual(
    decisionsOf(raw).map((d) => [d.action, d.next_status]),
    [["Create Draft", "Draft"], ["Approve", "Approved"]],
  );
});
