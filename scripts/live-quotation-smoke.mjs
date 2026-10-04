/**
 * READ-ONLY smoke check: does this database serve the governed quotation and
 * export path at all? Used by the live reconciliation runbook as its last gate.
 *
 * It proves three things without writing anything:
 *   1. project facts, the evidence manifest and the pricing authority load;
 *   2. the governed snapshot export loader can read the quotation tables and
 *      fails closed with the documented code when no approved revision exists;
 *   3. the export-to-issue gate evaluates against the stored schema.
 *
 * Usage: node scripts/live-quotation-smoke.mjs <sqlite> [projectId]
 */
import { DatabaseSync } from "node:sqlite";
import { loadPresalesWorkflowContext } from "../worker/presales-workflow-api.mjs";
import { loadQuotationSnapshotExportData } from "../worker/excel-export-api.mjs";
import { exportEligibleForQuotationIssue } from "../app/domain/quotation-authority.mjs";

const path = process.argv[2];
const projectId = process.argv[3] || null;
const raw = new DatabaseSync(path, { readOnly: true });
const db = {
  prepare(sql) {
    const state = { values: [] };
    const op = (args) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...op([]), bind: (...args) => op(args) };
  },
  async batch() { throw new Error("read-only smoke check: batch is not available"); },
};

const targets = projectId
  ? [projectId]
  : raw.prepare("SELECT id FROM projects ORDER BY id LIMIT 3").all().map((r) => r.id);

let failures = 0;
for (const id of targets) {
  const project = raw.prepare("SELECT * FROM projects WHERE id=?").get(id);
  if (!project) continue;
  const context = await loadPresalesWorkflowContext(db, project);
  console.log(`  ${id}  facts=${context.workflow.derivedStatus}  readyForQuotation=${context.workflow.readyForQuotation}  currency=${context.totals.currency}`);
  try {
    await loadQuotationSnapshotExportData(db, id, "Approved Cost Sheet", context.sourceFingerprint);
    console.log(`  ${id}  snapshot loader: produced data`);
  } catch (error) {
    const expected = [
      "APPROVED_QUOTATION_REQUIRED",
      "QUOTATION_EVIDENCE_STALE",
      "QUOTATION_LINES_MISSING",
      "QUOTATION_SNAPSHOT_METADATA_MISMATCH",
      "QUOTATION_FINGERPRINT_MISMATCH",
      "QUOTATION_EVIDENCE_FINGERPRINT_REQUIRED",
    ];
    if (!expected.includes(error.code)) {
      console.error(`  ${id}  UNEXPECTED loader failure: ${error.code} ${error.message}`);
      failures += 1;
    } else {
      console.log(`  ${id}  snapshot loader fails closed: ${error.code}`);
    }
  }
  const probe = exportEligibleForQuotationIssue({
    exportJob: { project_id: id, export_mode: "Approved Cost Sheet", status: "Completed", quotation_revision_id: "q", quotation_fingerprint: "f", evidence_fingerprint: context.sourceFingerprint, cancelled_at: null, superseded_by_id: null },
    quotation: { project_id: id, id: "q", quotation_fingerprint: "f", evidence_fingerprint: context.sourceFingerprint },
    currentEvidenceFingerprint: context.sourceFingerprint,
  });
  console.log(`  ${id}  issue gate evaluates: ${JSON.stringify(probe)}`);
}
console.log(failures === 0 ? "QUOTATION_SMOKE = PASS" : `QUOTATION_SMOKE = FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
