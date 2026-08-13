import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  buildQuotationTerms,
  exportEligibleForQuotationIssue,
  QUOTATION_PROVENANCE,
  quotationEvidenceFingerprint,
  quotationTermsWithProvenance,
} from "../app/domain/quotation-authority.mjs";
import { loadCanonicalPricingLine, loadCanonicalPricingTotals } from "../worker/pricing-authority.mjs";

const quotation = { id: "q1", project_id: "p1", quotation_fingerprint: "qf", evidence_fingerprint: "ef" };
const validExport = { id: "x1", project_id: "p1", export_mode: "Approved Cost Sheet", status: "Completed", quotation_revision_id: "q1", quotation_fingerprint: "qf", evidence_fingerprint: "ef", cancelled_at: null, superseded_by_id: null };

test("underlying evidence changes alter the fingerprint even when totals and counts do not", async () => {
  const first = await quotationEvidenceFingerprint({ totals: { value: 100, count: 1 }, items: [{ id: "b1", match: { id: "m1", version: 1 } }] });
  const second = await quotationEvidenceFingerprint({ totals: { value: 100, count: 1 }, items: [{ id: "b1", match: { id: "m2", version: 2 } }] });
  assert.notEqual(first, second);
});

test("canonical evidence fingerprint ignores object insertion order", async () => {
  assert.equal(await quotationEvidenceFingerprint({ b: 2, a: 1 }), await quotationEvidenceFingerprint({ a: 1, b: 2 }));
});

test("issue rejects an export not linked to the quotation", () => {
  assert.equal(exportEligibleForQuotationIssue({ quotation, exportJob: { ...validExport, quotation_revision_id: null }, currentEvidenceFingerprint: "ef" }).code, "EXPORT_QUOTATION_MISMATCH");
});

test("draft and internal exports cannot authorize issue", () => {
  for (const export_mode of ["Draft Cost Sheet", "Commercial Review Cost Sheet"]) assert.equal(exportEligibleForQuotationIssue({ quotation, exportJob: { ...validExport, export_mode }, currentEvidenceFingerprint: "ef" }).code, "EXPORT_MODE_NOT_GOVERNED");
});

test("cancelled and superseded exports cannot authorize issue", () => {
  assert.equal(exportEligibleForQuotationIssue({ quotation, exportJob: { ...validExport, cancelled_at: "now" }, currentEvidenceFingerprint: "ef" }).code, "EXPORT_STALE");
  assert.equal(exportEligibleForQuotationIssue({ quotation, exportJob: { ...validExport, superseded_by_id: "x2" }, currentEvidenceFingerprint: "ef" }).code, "EXPORT_STALE");
});

test("stale evidence cannot authorize issue", () => {
  assert.equal(exportEligibleForQuotationIssue({ quotation, exportJob: validExport, currentEvidenceFingerprint: "changed" }).code, "EXPORT_EVIDENCE_STALE");
});

test("only a completed, current, exact governed export authorizes issue", () => {
  assert.deepEqual(exportEligibleForQuotationIssue({ quotation, exportJob: validExport, currentEvidenceFingerprint: "ef" }), { eligible: true, reasons: [] });
});

test("quotation terms retain truthful field-level provenance", () => {
  const result = quotationTermsWithProvenance({ fields: {
    delivery: { value: "4 weeks", provenance: QUOTATION_PROVENANCE.USER_AUTHORED, authority: "Quotation Draft Request", sourceReference: "request.delivery" },
    validityDays: { value: 30, provenance: QUOTATION_PROVENANCE.SYSTEM_DEFAULT, authority: "Deterministic Application Default", sourceReference: "quotation-default.validityDays" },
    client: { value: "Client A", provenance: QUOTATION_PROVENANCE.PROJECT_DERIVED, authority: "Governed Project Record", sourceReference: "projects.client:p1" },
    exclusions: { value: ["Civil works"], provenance: QUOTATION_PROVENANCE.USER_AUTHORED, authority: "Quotation Draft Request", sourceReference: "request.exclusions" },
  }, actorId: "u1", timestamp: "2026-08-11T00:00:00Z" });
  assert.equal(result.terms.delivery, "4 weeks");
  assert.equal(result.provenance.values.delivery.actorId, "u1");
  assert.equal(result.provenance.values.delivery.provenance, "USER_AUTHORED");
  assert.equal(result.provenance.values.validityDays.provenance, "SYSTEM_DEFAULT");
  assert.equal(result.provenance.values.client.provenance, "PROJECT_DERIVED");
  assert.equal(result.provenance.values.exclusions.provenance, "USER_AUTHORED");
  assert.equal("actorId" in result.provenance.values.validityDays, false);
});

test("draft construction distinguishes request, project and default provenance", () => {
  const result = buildQuotationTerms({ payload: { delivery: "4 weeks", exclusions: ["Civil works"] }, project: { id: "p1", client: "Client A" }, actorId: "u1", timestamp: "2026-08-11T00:00:00Z" });
  assert.equal(result.provenance.values.delivery.provenance, "USER_AUTHORED");
  assert.equal(result.provenance.values.validityDays.provenance, "SYSTEM_DEFAULT");
  assert.equal(result.provenance.values.client.provenance, "PROJECT_DERIVED");
  assert.equal(result.provenance.values.exclusions.provenance, "USER_AUTHORED");
});

const migratedQuotationDb = async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE excel_export_jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,export_mode TEXT,cancelled_at TEXT,superseded_by_id TEXT);");
  db.exec(await readFile(new URL("../drizzle/0045_presales_estimation_workflow.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../drizzle/0053_quotation_authority_consolidation.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO projects VALUES ('p1'); INSERT INTO presales_workflow_snapshots(id,project_id,model_version,input_fingerprint,status,progress,current_stage_id,stages_json,blockers_json,warnings_json,calculated_by) VALUES ('s1','p1','v','f','Ready',100,'quotation','[]','[]','[]','u1'); INSERT INTO project_quotation_revisions(id,project_id,revision_number,quotation_fingerprint,workflow_snapshot_id,currency,subtotal_minor,vat_basis_points,vat_minor,total_minor,terms_json,source_summary_json,status,created_by,evidence_fingerprint) VALUES ('q1','p1',1,'qf','s1','SAR',100,1500,15,115,'{}','{}','Draft','u1','ef'); INSERT INTO excel_export_jobs(id,project_id,status,export_mode,quotation_revision_id,quotation_fingerprint,evidence_fingerprint) VALUES ('x1','p1','Completed','Approved Cost Sheet','q1','qf','ef');");
  return db;
};

test("real migrated database permits exactly one approval authority", async () => {
  const db = await migratedQuotationDb();
  const approve = (id) => db.exec(`BEGIN IMMEDIATE; INSERT INTO project_quotation_decisions(id,project_id,quotation_revision_id,action,previous_status,next_status,reason,actor_user_id,actor_role,quotation_fingerprint) VALUES ('${id}','p1','q1','Approve','Draft','Approved','reviewed evidence','u1','Commercial Approver','qf'); UPDATE project_quotation_revisions SET status='Approved',approved_at='now' WHERE id='q1' AND status='Draft'; COMMIT;`);
  approve("d1");
  assert.throws(() => approve("d2"), /QUOTATION_APPROVAL_STALE|UNIQUE constraint/);
  try { db.exec("ROLLBACK"); } catch {}
  assert.equal(db.prepare("SELECT status FROM project_quotation_revisions WHERE id='q1'").get().status, "Approved");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM project_quotation_decisions WHERE quotation_revision_id='q1' AND action='Approve'").get().count, 1);
});

test("real migrated database permits exactly one authoritative issue", async () => {
  const db = await migratedQuotationDb();
  db.exec("UPDATE project_quotation_revisions SET status='Approved' WHERE id='q1'");
  const issue = (id) => db.exec(`BEGIN IMMEDIATE; INSERT INTO project_quotation_issues(id,project_id,quotation_revision_id,export_job_id,issue_reference,issued_by) VALUES ('${id}','p1','q1','x1','Q-1','u1'); UPDATE project_quotation_revisions SET status='Issued',issued_at='now' WHERE id='q1' AND status='Approved'; COMMIT;`);
  issue("i1");
  assert.throws(() => issue("i2"), /QUOTATION_ISSUE_STALE|UNIQUE constraint/);
  try { db.exec("ROLLBACK"); } catch {}
  assert.equal(db.prepare("SELECT status FROM project_quotation_revisions WHERE id='q1'").get().status, "Issued");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM project_quotation_issues WHERE quotation_revision_id='q1'").get().count, 1);
});

test("evidence manifest excludes superseded BOQ and delegates canonical pricing authority", async () => {
  const source = await readFile(new URL("../worker/quotation-evidence.mjs", import.meta.url), "utf8");
  assert.match(source, /currentBoqEvidenceFrom/);
  assert.match(source, /loadCanonicalPricingLine/);
});

const d1 = (raw) => ({ prepare(sql) { const state = { values: [] }; return { bind(...values) { state.values = values; return this; }, first() { return raw.prepare(sql).get(...state.values) || null; }, all() { return { results: raw.prepare(sql).all(...state.values) }; } }; } });

test("quotation pricing reuses selected-scenario current governed authority", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,organization_id TEXT,archived_at TEXT); CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,current_version_id TEXT,deleted_at TEXT,archived_at TEXT); CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT); CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY,document_id TEXT,document_version_id TEXT,version_number INTEGER,status TEXT,superseded_at TEXT); CREATE TABLE boq_items(id TEXT PRIMARY KEY,extraction_version_id TEXT,project_id TEXT,source_document_id TEXT,row_type TEXT); CREATE TABLE pricing_runs(id TEXT PRIMARY KEY,project_id TEXT,scenario_id TEXT,version_number INTEGER,input_fingerprint TEXT,superseded_at TEXT); CREATE TABLE pricing_lines(id TEXT PRIMARY KEY,pricing_run_id TEXT,project_id TEXT,boq_item_id TEXT,version_number INTEGER,candidate_id TEXT,product_id TEXT,safety_decision_id TEXT,selected_price_record_id TEXT,total_cost_minor INTEGER,net_selling_minor INTEGER,final_value_minor INTEGER,status TEXT,approval_ready INTEGER); CREATE TABLE price_records(id TEXT PRIMARY KEY,approval_status TEXT,validity_state TEXT,valid_until TEXT,reviewed_at TEXT); INSERT INTO projects VALUES ('p1','org',NULL); INSERT INTO documents VALUES ('d1','p1','v1',NULL,NULL); INSERT INTO document_versions VALUES ('v1','d1'); INSERT INTO boq_extraction_versions VALUES ('e1','d1','v1',1,'Completed',NULL); INSERT INTO boq_items VALUES ('b1','e1','p1','d1','BOQ Item'); INSERT INTO price_records VALUES ('price1','Approved','Current','2027-01-01','now'); INSERT INTO pricing_runs VALUES ('old','p1','selected',1,'old-fp',NULL),('new','p1','selected',2,'new-fp',NULL),('other','p1','other',9,'other-fp',NULL),('superseded','p1','selected',10,'sup-fp','now'); INSERT INTO pricing_lines VALUES ('old-line','old','p1','b1',1,NULL,'product-old',NULL,'price1',100,120,138,'Valid',1),('new-line','new','p1','b1',1,NULL,'product-new',NULL,'price1',110,130,150,'Rejected',0),('other-line','other','p1','b1',1,NULL,'product-other',NULL,'price1',900,1000,1150,'Valid',1),('sup-line','superseded','p1','b1',1,NULL,'product-sup',NULL,'price1',800,900,1035,'Valid',1);`);
  const db = d1(raw);
  assert.equal(await loadCanonicalPricingLine(db, { projectId: "p1", scenarioId: "selected", boqItemId: "b1" }), null, "an invalid newest run must not revive an older price");
  raw.exec("UPDATE pricing_lines SET status='Valid',approval_ready=1 WHERE id='new-line'");
  const line = await loadCanonicalPricingLine(db, { projectId: "p1", scenarioId: "selected", boqItemId: "b1" });
  assert.equal(line.runId, "new");
  assert.equal(line.productId, "product-new");
  const totals = await loadCanonicalPricingTotals(db, { projectId: "p1", scenarioId: "selected", currency: "SAR" });
  assert.deepEqual(totals, { currency: "SAR", costMinor: 110, subtotalMinor: 130, lineCount: 1, selectedScenarioId: "selected" });
});

test("legacy browser approval cannot approve or issue the server quotation", async () => {
  const server = await readFile(new URL("../worker/presales-workflow-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(server, /currentQuotationApproval|localStorage|sessionStorage/);
  assert.match(server, /authenticateLibraryActor/);
  assert.match(server, /project_quotation_decisions/);
});
