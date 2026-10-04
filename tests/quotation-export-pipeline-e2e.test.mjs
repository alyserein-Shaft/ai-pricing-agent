/**
 * END-TO-END PROOF of the governed export -> quotation issue pipeline, run
 * against the schema the ACTIVE migration chain actually produces.
 *
 * The acceptance suite (quotation-e2e-acceptance.test.mjs) satisfies the export
 * prerequisite by writing the job row directly, because at the time the chain
 * could not produce the binding columns. This suite instead drives the REAL
 * export handler -- handleExcelExportApi -- so the whole delivery path is proven
 * end to end with nothing stubbed:
 *
 *   quotation/draft -> quotation/approve -> POST /api/excel-exports
 *     (a real governed export, built and stored by the real code path)
 *   -> quotation/issue
 *
 * It proves the export-to-quotation binding is writable AND readable at
 * runtime, which is the thing migration 0019 had silently removed.
 *
 * One commercial rule is respected: pricing readiness, the Commercial Price
 * approval and the approval authority are all fixture state, produced by the
 * governed fixture -- no production pricing rule is changed or bypassed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { handleExcelExportApi } from "../worker/excel-export-api.mjs";
import { exportEligibleForQuotationIssue, GOVERNED_EXPORT_MODES } from "../app/domain/quotation-authority.mjs";
import {
  OWNER,
  PROJECT,
  REASON,
  decisionsOf,
  draft,
  envFor,
  issuesOf,
  json,
  post,
  revisionsOf,
  seedReadyProductProject,
} from "./helpers/governed-quotation-fixture.mjs";

const requestExport = (raw, body) =>
  handleExcelExportApi(
    new Request(`https://localhost/api/excel-exports/projects/${PROJECT}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": body.idempotencyKey },
      body: JSON.stringify(body),
    }),
    envFor(raw),
  );

/** Draft + approve through the real handler, returning the approved revision. */
const draftAndApprove = async (raw) => {
  const draftBody = await json(await draft(raw));
  assert.equal(draftBody.quotation.status, "Draft");
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

test("a governed export is refused before the quotation is approved", async () => {
  const raw = await seedReadyProductProject();
  await draft(raw);
  const body = await json(
    await requestExport(raw, { mode: "Approved Cost Sheet", idempotencyKey: "export-early" }),
  );
  assert.ok(body.error, "an unapproved quotation must not authorize a governed export");
  assert.equal(body.error.code, "APPROVED_QUOTATION_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM excel_export_jobs").get().c, 0);
});

test("an approved quotation authorizes a real governed export bound to it", async () => {
  const raw = await seedReadyProductProject();
  const revision = await draftAndApprove(raw);

  const response = await requestExport(raw, { mode: "Approved Cost Sheet", idempotencyKey: "export-1" });
  const body = await json(response);
  assert.equal(body.failed, undefined, `the export must not fail: ${JSON.stringify(body.error || {})}`);
  assert.ok(body.jobId, "the export handler must return the created job");

  const job = raw.prepare("SELECT * FROM excel_export_jobs WHERE id=?").get(body.jobId);
  assert.ok(GOVERNED_EXPORT_MODES.has(job.export_mode));
  assert.ok(["Completed", "Completed with Warnings"].includes(job.status), `unexpected status ${job.status}`);
  // The three binding columns the issue gate reads, written by the real path.
  assert.equal(job.quotation_revision_id, revision.id);
  assert.equal(job.quotation_fingerprint, revision.quotation_fingerprint);
  assert.equal(job.evidence_fingerprint, revision.evidence_fingerprint);

  // The gate itself must accept the export the real path produced.
  assert.equal(
    exportEligibleForQuotationIssue({
      exportJob: job,
      quotation: revision,
      currentEvidenceFingerprint: revision.evidence_fingerprint,
    }).eligible,
    true,
  );

  // And the workbook was really produced and stored.
  const file = raw
    .prepare("SELECT object_key,sha256,byte_size FROM excel_export_files WHERE export_job_id=?")
    .get(body.jobId);
  assert.ok(file, "the export must record its stored workbook");
  assert.ok(Number(file.byte_size) > 0, "the stored workbook must not be empty");
});

test("the full pipeline completes: approved quotation -> governed export -> issue", async () => {
  const raw = await seedReadyProductProject();
  const revision = await draftAndApprove(raw);

  const body = await json(
    await requestExport(raw, { mode: "Approved Cost Sheet", idempotencyKey: "export-pipeline" }),
  );
  const job = raw.prepare("SELECT * FROM excel_export_jobs WHERE id=?").get(body.jobId);

  const issueBody = await json(
    await post(raw, "quotation/issue", {
      quotationRevisionId: revision.id,
      exportJobId: job.id,
      reason: REASON,
    }),
  );
  assert.equal(issueBody.status, "Issued");
  assert.equal(issueBody.quotationRevisionId, revision.id);
  assert.ok(issueBody.issuedAt, "the issue must record when it was issued");

  const issued = revisionsOf(raw)[0];
  assert.equal(issued.status, "Issued");
  assert.ok(issued.issued_at, "the issue timestamp must be recorded");
  assert.equal(issuesOf(raw).length, 1);
  const issue = issuesOf(raw)[0];
  assert.equal(issue.quotation_revision_id, revision.id);
  assert.equal(issue.export_job_id, job.id);
  assert.equal(issue.issued_by, OWNER);
  assert.equal(issue.transmission_method, "Controlled Export");

  // The decision ledger must show the whole governed history in order.
  assert.deepEqual(
    decisionsOf(raw).map((d) => [d.action, d.next_status]),
    [["Create Draft", "Draft"], ["Approve", "Approved"], ["Issue", "Issued"]],
  );
});

test("an export created for a superseded evidence set cannot issue the quotation", async () => {
  const raw = await seedReadyProductProject();
  const revision = await draftAndApprove(raw);
  const body = await json(
    await requestExport(raw, { mode: "Approved Cost Sheet", idempotencyKey: "export-stale" }),
  );
  const jobId = body.jobId;

  // Evidence moves after the export was produced; the issue gate must close.
  raw.prepare("UPDATE boq_items SET updated_at='2026-06-01T00:00:00.000Z' WHERE id='boq1'").run();

  const issueBody = await json(
    await post(raw, "quotation/issue", {
      quotationRevisionId: revision.id,
      exportJobId: jobId,
      reason: REASON,
    }),
  );
  assert.equal(issueBody.error.code, "GOVERNED_EXPORT_REQUIRED");
  assert.deepEqual(issueBody.error.reasons, ["EXPORT_EVIDENCE_STALE"]);
  assert.equal(revisionsOf(raw)[0].status, "Approved", "a blocked issue must leave the revision Approved");
  assert.equal(issuesOf(raw).length, 0);
});