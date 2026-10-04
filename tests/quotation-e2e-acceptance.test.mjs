/**
 * ISOLATED END-TO-END ACCEPTANCE for the existing governed quotation workflow.
 *
 * Proves the REAL exported route handler -- handlePresalesWorkflowApi, the only
 * quotation-line materialization path -- completes the governed lifecycle
 * quotation/draft -> quotation/approve -> quotation/issue when valid commercial
 * authority is present, without any authority function being bypassed and
 * without touching the canonical live D1.
 *
 * Everything runs against an in-memory SQLite built from the REAL applied
 * migration chain (drizzle-active), seeded with the smallest valid governed
 * fixture: one project, one BOQ item, one current product selection, one
 * current pricing run, one approval_ready pricing line with persisted money,
 * one current Approved 'Commercial Price' approval, one valid source product
 * and a valid price/provenance lineage. No SQL mock, no hand-written schema,
 * no production commercial rule is altered, and no second writer is added.
 *
 * The fixture helpers below (migration-chain loader, schema-aware seeder, D1
 * shim, single-user env) are copied verbatim from
 * tests/mvp-bom-5-p9a-product-quotation-regression.test.mjs so that the two
 * suites exercise the same isolated shape without either file depending on the
 * other. That suite stays the draft-focused regression; this suite adds the
 * approve/issue lifecycle, the fail-closed staleness proof and the governed
 * export prerequisite.
 *
 * Success is never inferred from a 2xx: every provenance field is read back out
 * of the inserted rows.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { handlePresalesWorkflowApi } from "../worker/presales-workflow-api.mjs";
import {
  OWNER,
  PROJECT,
  REASON,
  activeChain,
  assertQuotationSchemaContract,
  d1,
  decisionsOf,
  draft,
  draftRevision,
  envFor,
  issuesOf,
  jobsOf,
  json,
  linesOf,
  post,
  revisionsOf,
  seedGovernedExport,
  seedReadyProductProject,
} from "./helpers/governed-quotation-fixture.mjs";
test("ACCEPTANCE A -- quotation/draft writes exactly one revision, one decision and one fully-provenanced PRODUCT line", async () => {
  const raw = await seedReadyProductProject();

  const response = await draft(raw);
  const body = await json(response);
  assert.equal(response.status, 201, JSON.stringify(body));

  const revisions = revisionsOf(raw);
  assert.equal(revisions.length, 1, "exactly one project_quotation_revision");
  const revision = revisions[0];
  assert.equal(revision.project_id, PROJECT);
  assert.equal(revision.status, "Draft");
  assert.match(revision.quotation_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(revision.evidence_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(revision.approved_at, null, "a Draft is not approved");
  assert.equal(revision.issued_at, null, "a Draft is not issued");

  const decisions = decisionsOf(raw);
  assert.equal(decisions.length, 1, "exactly one decision records the draft");
  assert.equal(decisions[0].action, "Create Draft");
  assert.equal(decisions[0].quotation_revision_id, revision.id);
  assert.equal(decisions[0].previous_status, null);
  assert.equal(decisions[0].next_status, "Draft");
  assert.equal(decisions[0].quotation_fingerprint, revision.quotation_fingerprint);
  assert.equal(decisions[0].actor_user_id, OWNER);

  const lines = linesOf(raw);
  assert.equal(lines.length, 1, "exactly one project_quotation_line");
  const [line] = lines;

  // Required, NOT NULL, no-default columns from migration 0015.
  assert.equal(line.source_type, "PRODUCT");
  assert.equal(line.source_product_id, "prod1");
  assert.equal(line.boq_item_id, "boq1");
  assert.equal(line.candidate_id, "pmc1");
  // Pricing lineage, taken from governed upstream -- never from the request.
  assert.equal(line.pricing_run_id, "prun1");
  assert.equal(line.pricing_run_version, 1);
  assert.equal(line.pricing_line_id, "plin1");
  assert.equal(line.pricing_line_version, 1);
  assert.equal(line.pricing_input_fingerprint, "run-fp1");
  // Commercial approval lineage.
  assert.equal(line.commercial_approval_id, "pa1");
  assert.equal(line.commercial_approval_version, 1);
  // Quantity, money and currency preserved from governed pricing.
  assert.equal(line.quantity, "4");
  assert.equal(line.unit, "EA");
  assert.equal(line.currency, "SAR");
  assert.equal(line.total_cost_minor, 4000);
  assert.equal(line.net_selling_minor, 10000);
  // Provenance snapshot is populated, not an empty placeholder.
  const snapshot = JSON.parse(line.source_snapshot_json);
  assert.equal(snapshot.authorityVersion, "quotation-line-authority-1.0.0");
  assert.equal(snapshot.pricingRunId, "prun1");
  assert.equal(snapshot.pricingLineId, "plin1");
  assert.equal(snapshot.commercialApprovalId, "pa1");
  assert.equal(snapshot.safetyDecisionId, "sd1");
  assert.equal(snapshot.priceRecordId, null);

  // Totals reconcile with the lines actually written.
  assert.equal(revision.subtotal_minor, 10000);
  assert.equal(revision.vat_basis_points, 1500);
  assert.equal(revision.vat_minor, 1500);
  assert.equal(revision.total_minor, 11500);
});

/* ------------------------------------------------------------------ *
 * B. idempotency -- a repeated identical draft changes nothing
 * ------------------------------------------------------------------ */

test("ACCEPTANCE B -- an identical repeated draft is idempotent: no duplicate line, no second active Draft", async () => {
  const raw = await seedReadyProductProject();

  const first = await json(await draft(raw));
  assert.equal(first.idempotent, false);
  const second = await json(await draft(raw));
  assert.equal(second.idempotent, true, "the fingerprint contract makes the repeat idempotent");
  assert.equal(second.quotation.id, first.quotation.id, "the same revision is returned");

  assert.equal(revisionsOf(raw).length, 1, "no duplicate revision");
  assert.equal(linesOf(raw).length, 1, "no duplicate quotation line");
  const activeDrafts = raw
    .prepare("SELECT COUNT(*) n FROM project_quotation_revisions WHERE project_id=? AND status='Draft' AND superseded_at IS NULL")
    .get(PROJECT).n;
  assert.equal(Number(activeDrafts), 1, "exactly one active Draft");
  assert.equal(decisionsOf(raw).length, 1, "the repeat records no second decision");
});

/* ------------------------------------------------------------------ *
 * C. staleness -- approve must fail closed on stale evidence
 * ------------------------------------------------------------------ */

test("ACCEPTANCE C -- evidence that changed after the draft makes quotation/approve fail closed with QUOTATION_STALE", async () => {
  const raw = await seedReadyProductProject();
  await json(await draft(raw));
  const before = draftRevision(raw);

  // Mutate ONLY the isolated fixture: the BOQ item is touched after the draft,
  // which the evidence manifest deliberately fingerprints (itemUpdatedAt).
  raw.prepare("UPDATE boq_items SET updated_at='2099-01-01T00:00:00.000Z' WHERE id='boq1'").run();

  const response = await post(raw, "quotation/approve", {
    quotationRevisionId: before.id,
    quotationFingerprint: before.quotation_fingerprint,
    reason: "Attempt approval over stale evidence",
  });
  const body = await json(response);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "QUOTATION_STALE");

  assert.equal(draftRevision(raw).status, "Draft", "a stale approval must not advance the revision");
  assert.equal(draftRevision(raw).approved_at, null);
  assert.equal(decisionsOf(raw).length, 1, "a failed approval records no decision");
});

test("ACCEPTANCE C2 -- withdrawing the commercial approval also blocks approval, closed", async () => {
  const raw = await seedReadyProductProject();
  await json(await draft(raw));
  const before = draftRevision(raw);

  // The commercial authority the quotation was built on is withdrawn. The
  // decision row itself is updated rather than deleted, because the persisted
  // quotation line references it and that reference must stay intact.
  raw.prepare("UPDATE pricing_approvals SET status='Rejected' WHERE id='pa1'").run();

  const response = await post(raw, "quotation/approve", {
    quotationRevisionId: before.id,
    quotationFingerprint: before.quotation_fingerprint,
    reason: "Attempt approval after commercial withdrawal",
  });
  const body = await json(response);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "QUOTATION_STALE");
  assert.equal(draftRevision(raw).status, "Draft");
  assert.equal(decisionsOf(raw).length, 1, "no decision is written for a blocked approval");
});

/* ------------------------------------------------------------------ *
 * D. approval -- succeeds through the governed path on current evidence
 * ------------------------------------------------------------------ */

test("ACCEPTANCE D -- with current evidence quotation/approve succeeds and records the governed decision", async () => {
  const raw = await seedReadyProductProject();
  await json(await draft(raw));
  const revision = draftRevision(raw);

  const response = await post(raw, "quotation/approve", {
    quotationRevisionId: revision.id,
    quotationFingerprint: revision.quotation_fingerprint,
    reason: REASON,
  });
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "Approved");
  assert.equal(body.quotationRevisionId, revision.id);
  assert.equal(body.idempotent, false);

  const approved = draftRevision(raw);
  assert.equal(approved.status, "Approved");
  assert.ok(approved.approved_at, "approved_at is stamped");
  assert.equal(approved.evidence_fingerprint, revision.evidence_fingerprint, "no evidence drift");

  const decisions = decisionsOf(raw);
  assert.equal(decisions.length, 2);
  const approveDecision = decisions.find((d) => d.action === "Approve");
  assert.ok(approveDecision, "the governed approval decision is recorded");
  assert.equal(approveDecision.quotation_revision_id, revision.id);
  assert.equal(approveDecision.previous_status, "Draft");
  assert.equal(approveDecision.next_status, "Approved");
  assert.equal(approveDecision.quotation_fingerprint, revision.quotation_fingerprint);
  assert.equal(approveDecision.reason, REASON);
  assert.equal(approveDecision.actor_user_id, OWNER);
  assert.equal(approveDecision.actor_role, "Project User");
});

/* ------------------------------------------------------------------ *
 * E. issue -- blocked until a governed export exists, then succeeds
 * ------------------------------------------------------------------ */

test("ACCEPTANCE E -- quotation/issue is blocked until a governed completed export exists, then issues", async () => {
  const raw = await seedReadyProductProject();
  await json(await draft(raw));
  const revision = draftRevision(raw);
  await post(raw, "quotation/approve", {
    quotationRevisionId: revision.id,
    quotationFingerprint: revision.quotation_fingerprint,
    reason: REASON,
  });
  assert.equal(draftRevision(raw).status, "Approved");

  // E1: no export job at all.
  const blocked = await post(raw, "quotation/issue", {
    quotationRevisionId: revision.id,
    reason: REASON,
  });
  const blockedBody = await json(blocked);
  assert.equal(blocked.status, 409);
  assert.equal(blockedBody.error.code, "GOVERNED_EXPORT_REQUIRED");
  assert.deepEqual(blockedBody.error.reasons, ["GOVERNED_EXPORT_REQUIRED"]);
  assert.equal(draftRevision(raw).status, "Approved", "a blocked issue does not issue the revision");
  assert.equal(issuesOf(raw).length, 0);

  // E2: an export exists but is not completed -- still blocked.
  await seedGovernedExport(raw, revision, { status: "Running" });
  const stillBlocked = await json(
    await post(raw, "quotation/issue", { quotationRevisionId: revision.id, exportJobId: "export1", reason: REASON }),
  );
  assert.equal(stillBlocked.error.code, "GOVERNED_EXPORT_REQUIRED");
  assert.deepEqual(stillBlocked.error.reasons, ["EXPORT_NOT_COMPLETED"]);
  assert.equal(draftRevision(raw).status, "Approved");

  // E3: an ungoverned export mode -- still blocked.
  raw.prepare("UPDATE excel_export_jobs SET status='Completed',export_mode='Raw Dump' WHERE id='export1'").run();
  const ungoverned = await json(
    await post(raw, "quotation/issue", { quotationRevisionId: revision.id, exportJobId: "export1", reason: REASON }),
  );
  assert.equal(ungoverned.error.code, "GOVERNED_EXPORT_REQUIRED");
  assert.deepEqual(ungoverned.error.reasons, ["EXPORT_MODE_NOT_GOVERNED"]);

  // E4: the governed condition satisfied inside this fixture only.
  raw.prepare("UPDATE excel_export_jobs SET export_mode='Approved Cost Sheet' WHERE id='export1'").run();
  const response = await post(raw, "quotation/issue", {
    quotationRevisionId: revision.id,
    exportJobId: "export1",
    reason: REASON,
  });
  const body = await json(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "Issued");

  const issued = draftRevision(raw);
  assert.equal(issued.status, "Issued");
  assert.ok(issued.issued_at, "issued_at is stamped");

  const issues = issuesOf(raw);
  assert.equal(issues.length, 1, "exactly one issue record");
  assert.equal(issues[0].quotation_revision_id, revision.id);
  assert.equal(issues[0].export_job_id, "export1");
  assert.equal(issues[0].issued_by, OWNER);
  assert.equal(issues[0].transmission_method, "Controlled Export");
  assert.match(issues[0].issue_reference, /^Q-p9a-project-R1$/);

  const decisions = decisionsOf(raw);
  assert.equal(decisions.length, 3);
  const issueDecision = decisions.find((d) => d.action === "Issue");
  assert.ok(issueDecision, "the governed issue decision is recorded");
  assert.equal(issueDecision.quotation_revision_id, revision.id);
  assert.equal(issueDecision.previous_status, "Approved");
  assert.equal(issueDecision.next_status, "Issued");

  // E5: a repeat issue is idempotent.
  const repeat = await json(
    await post(raw, "quotation/issue", { quotationRevisionId: revision.id, exportJobId: "export1", reason: REASON }),
  );
  assert.equal(repeat.idempotent, true);
  assert.equal(issuesOf(raw).length, 1);
});

test("ACCEPTANCE E2 -- an export bound to a different evidence fingerprint cannot issue the quotation", async () => {
  const raw = await seedReadyProductProject();
  await json(await draft(raw));
  const revision = draftRevision(raw);
  await post(raw, "quotation/approve", {
    quotationRevisionId: revision.id,
    quotationFingerprint: revision.quotation_fingerprint,
    reason: REASON,
  });
  await seedGovernedExport(raw, revision);
  // The export was produced against evidence that is no longer current.
  raw.prepare("UPDATE excel_export_jobs SET evidence_fingerprint='stale-fingerprint' WHERE id='export1'").run();

  const body = await json(
    await post(raw, "quotation/issue", { quotationRevisionId: revision.id, exportJobId: "export1", reason: REASON }),
  );
  assert.equal(body.error.code, "GOVERNED_EXPORT_REQUIRED");
  assert.deepEqual(body.error.reasons, ["EXPORT_EVIDENCE_STALE"]);
  assert.equal(draftRevision(raw).status, "Approved");
  assert.equal(issuesOf(raw).length, 0);
});

test("ACCEPTANCE F -- issue is refused before approval", async () => {
  const raw = await seedReadyProductProject();
  await json(await draft(raw));
  const revision = draftRevision(raw);
  await seedGovernedExport(raw, revision);

  const body = await json(
    await post(raw, "quotation/issue", { quotationRevisionId: revision.id, exportJobId: "export1", reason: REASON }),
  );
  assert.equal(body.error.code, "QUOTATION_NOT_APPROVED");
  assert.equal(draftRevision(raw).status, "Draft");
  assert.equal(issuesOf(raw).length, 0);
});
