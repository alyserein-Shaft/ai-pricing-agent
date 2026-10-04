/**
 * DELIVERY READINESS GATE -- read-only, fail-closed, single tool.
 *
 * Answers one question for the quotation/export delivery lane: may a governed
 * quotation be created for this project on this database right now, and if not,
 * exactly which gate blocks it, how many entities are affected, and which lane
 * owns the next action.
 *
 * Design rules this tool obeys:
 *
 *  - READ-ONLY. The database is opened `readOnly: true`; nothing is written,
 *    migrated, repaired or inferred. There is no repair path in this file.
 *  - FAIL-CLOSED, AND NEVER COLLAPSED. Distinct blockers stay distinct. Every
 *    gate reports its own status, count, blocker codes and owning lane. There is
 *    no generic NOT_READY anywhere in the output.
 *  - CANONICAL READERS ONLY. Gates call the same authority the runtime calls --
 *    loadPresalesWorkflowContext, buildQuotationEvidenceManifest,
 *    loadCanonicalQuotationLines, loadQuotationSnapshotExportData,
 *    exportEligibleForQuotationIssue -- so this tool cannot disagree with the
 *    product about why something is not ready.
 *
 * Usage:
 *   node scripts/delivery-readiness-gate.mjs <sqlite> [projectId] [--json]
 *
 * Exit: 0 every gate PASS, 1 at least one gate BLOCKED, 2 usage/other error.
 */
import { DatabaseSync } from "node:sqlite";

import { loadPresalesWorkflowContext } from "../worker/presales-workflow-api.mjs";
import { buildQuotationEvidenceManifest } from "../worker/quotation-evidence.mjs";
import { projectPanelSizingBlockers, loadCanonicalQuotationLines } from "../worker/quotation-line-authority.mjs";
import { loadQuotationSnapshotExportData } from "../worker/excel-export-api.mjs";
import { exportEligibleForQuotationIssue } from "../app/domain/quotation-authority.mjs";
import {
  CLIENT_SAFE_SHEETS,
  CLIENT_SAFE_VISIBLE_FIELDS,
  applyClientSafeRowBoundary,
  clientSafeProtectedFields,
  sheetsForMode,
  visibleDetailedFields,
} from "../app/domain/excel-export-engine.mjs";
import { countSourceAuthorityViolationsAll } from "./check-live-reconciliation-preconditions.mjs";

const [databasePath, projectArg, ...flags] = process.argv.slice(2);
const asJson = flags.includes("--json");
if (!databasePath || databasePath.startsWith("--")) {
  console.error("usage: node scripts/delivery-readiness-gate.mjs <sqlite> [projectId] [--json]");
  process.exit(2);
}

const raw = new DatabaseSync(databasePath, { readOnly: true });
const has = (table) => Boolean(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
/** Row count for one governed table, or null when the table is absent. */
const count = (sql, { table, values = [] }) => (has(table) ? raw.prepare(sql).get(...values).c : null);

// D1-shaped adapter over the read-only handle. batch() is intentionally absent:
// no gate may write, and a gate that tried to would fail loudly.
const db = {
  prepare(sql) {
    const state = { values: [] };
    const operation = (values) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => { throw new Error("delivery readiness gate is read-only: a handler attempted a write"); },
    });
    return { ...operation([]), bind: (...values) => operation(values) };
  },
  async batch() { throw new Error("delivery readiness gate is read-only: batch() is not available"); },
};

const projectId = projectArg && !projectArg.startsWith("--")
  ? projectArg
  : raw.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get()?.id;
if (!projectId) {
  console.error("no project to evaluate");
  process.exit(2);
}
const project = raw.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
if (!project) {
  console.error(`no such project: ${projectId}`);
  process.exit(2);
}

const gate = (name, { status, count: affected = null, blockers = [], nextLane, evidence = {} }) => ({
  gate: name,
  status,
  affected,
  blockers,
  nextLane: status === "PASS" ? null : nextLane,
  evidence,
});
const blocker = (code, detail, owner) => ({ code, detail, owner });

// ---------------------------------------------------------------- 0. context
const context = await loadPresalesWorkflowContext(db, project);
const manifest = await buildQuotationEvidenceManifest(db, projectId).catch((error) => ({
  manifest: null,
  fingerprint: null,
  error,
}));
const workflowBlockers = (stageId) =>
  (context.workflow.blockers || []).filter((b) => b.stageId === stageId);

// ------------------------------------------------- A. LIVE SCHEMA / RECONCILIATION
// REPAIRED 2026-10-03 (P0 0019 reconciliation).
//
// This gate previously counted `requirement_id IS NULL` and blocked on 520 rows,
// asserting that "the active-head reconciliation rebuilds [them] with
// requirement_id NOT NULL". BOTH halves of that were wrong:
//
//   * the repaired 0019 does NOT rebuild them with requirement_id NOT NULL --
//     that constraint was itself the defect, and enforcing it would have
//     destroyed 5,636 rows;
//   * all 520 rows are VALID device-identity observations under the canonical
//     XOR source-authority model (migrations 0009/0010/0011): requirement_source
//     IN ('DrawingDeviceIdentity','BOQDeviceIdentity') with requirement_id NULL
//     and device_identity_ref populated.
//
// So the gate blocked forever on correct data while the real hazard -- a genuine
// source-authority violation -- went unflagged. It now gates on the XOR
// invariant. The raw NULL count is retained as a diagnostic only, and is never
// a blocker: backfilling those rows would fabricate a technical_requirements
// foreign key out of a drawing or BOQ identity.
const sourceAuthority = countSourceAuthorityViolationsAll(databasePath);
const reconciliationGate = gate("LIVE_RECONCILIATION_READY", {
  status: sourceAuthority.total === 0 ? "PASS" : "BLOCKED",
  count: sourceAuthority.total,
  blockers: sourceAuthority.total === 0
    ? []
    : [
      blocker(
        "SOURCE_AUTHORITY_VIOLATIONS",
        `${sourceAuthority.perTable
          .map((t) => `${t.table} (${t.rows} of ${t.total})`)
          .join(", ")} violate the XOR source-authority invariant: a valid row has EITHER ` +
          "requirement_id populated (specification-sourced) OR device_identity_ref populated " +
          "(device-identity observation), never both and never neither. " +
          "This tool does not repair them.",
        "requirement-intelligence",
      ),
    ],
  nextLane: sourceAuthority.total === 0 ? null : "requirement-intelligence",
  evidence: {
    invariant: "exactly one of requirement_id / device_identity_ref is populated",
    perTable: sourceAuthority.perTable,
    diagnosticOnly: sourceAuthority.perTable.map((t) => ({
      table: t.table,
      validDeviceIdentityRows: t.rawNullRequirementId,
      note: "NULL requirement_id is the DESIGNED representation for a device-identity observation; never backfilled",
    })),
  },
});

const requirementGate = gate("REQUIREMENT_INTELLIGENCE_READY", {
  status: workflowBlockers("requirements").length === 0 ? "PASS" : "BLOCKED",
  count: workflowBlockers("requirements").length,
  blockers: workflowBlockers("requirements").map((b) => blocker("REQUIREMENTS_NOT_APPROVED", b.message, b.owner || "Technical Reviewer")),
  nextLane: "requirement-intelligence",
});

// ------------------------------------------------------- B. TECHNICAL AUTHORITY
const technicalApprovals = count(
  "SELECT count(*) c FROM safety_approval_requests WHERE project_id=? AND approval_type='Technical' AND status='Approved'",
  { table: "safety_approval_requests", values: [projectId] },
);
const currentSelections = count(
  "SELECT count(*) c FROM product_match_candidates c JOIN product_match_runs r ON r.id=c.match_run_id WHERE r.project_id=? AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM product_match_runs r2 WHERE r2.boq_item_id=r.boq_item_id AND r2.superseded_at IS NULL) AND c.rank=1",
  { table: "product_match_candidates", values: [projectId] },
);
const technicalBlockers = [
  ...workflowBlockers("extraction").map((b) => blocker("BOQ_REVIEW_OPEN", b.message, b.owner || "Estimator")),
  ...workflowBlockers("selection").map((b) => blocker("SELECTION_AUTHORITY_OPEN", b.message, b.owner || "Technical Reviewer")),
  ...workflowBlockers("technical").map((b) => blocker("TECHNICAL_REVIEW_OPEN", b.message, b.owner || "Technical Reviewer")),
];
const technicalGate = gate("TECHNICAL_SELECTION_READY", {
  status: technicalBlockers.length === 0 ? "PASS" : "BLOCKED",
  count: technicalBlockers.length,
  blockers: technicalBlockers,
  nextLane: "technical-review",
  evidence: { currentTechnicalApprovals: technicalApprovals, currentRank1Selections: currentSelections },
});

// ------------------------------------------------------------ C. PANEL SIZING
const panelBlockers = await projectPanelSizingBlockers(db, projectId);
const panelAuthority = manifest.manifest?.panelSizingAuthority ?? null;
const panelGate = gate("PANEL_SIZING_READY", {
  status: panelBlockers.length === 0 ? "PASS" : "BLOCKED",
  count: panelBlockers.length,
  blockers: panelBlockers.map((code) => blocker(code, `Fire Alarm panel-sizing authority: ${code}`, "fire-alarm-sizing")),
  nextLane: "fire-alarm-sizing",
  evidence: {
    required: panelAuthority?.required ?? null,
    sourceAvailable: panelAuthority?.sourceAvailable ?? null,
    currentSnapshot: panelAuthority?.current
      ? { id: panelAuthority.current.id, version_number: panelAuthority.current.version_number, status: panelAuthority.current.status }
      : null,
  },
});

// ---------------------------------------------------------- D. COMMERCIAL PRICING
const scenario = context.totals.selectedScenarioId;
const pricingRuns = count("SELECT count(*) c FROM pricing_runs WHERE project_id=?", { table: "pricing_runs", values: [projectId] });
const currentRuns = count(
  "SELECT count(*) c FROM pricing_runs WHERE project_id=? AND superseded_at IS NULL",
  { table: "pricing_runs", values: [projectId] },
);
const pricingLines = count("SELECT count(*) c FROM pricing_lines WHERE project_id=?", { table: "pricing_lines", values: [projectId] });
const approvalReadyLines = count(
  "SELECT count(*) c FROM pricing_lines WHERE project_id=? AND approval_ready=1",
  { table: "pricing_lines", values: [projectId] },
);
const pricedLinesMissingMoney = count(
  "SELECT count(*) c FROM pricing_lines WHERE project_id=? AND (net_selling_minor IS NULL OR net_material_unit_minor IS NULL)",
  { table: "pricing_lines", values: [projectId] },
);
const commercialApprovals = count(
  "SELECT count(*) c FROM pricing_approvals WHERE project_id=? AND approval_type='Commercial Price' AND status='Approved'",
  { table: "pricing_approvals", values: [projectId] },
);
const lineAuthority = await loadCanonicalQuotationLines(db, {
  projectId,
  scenarioId: scenario,
  currency: context.totals.currency,
});
const pricingBlockers = [];
if (!scenario) pricingBlockers.push(blocker("NO_SELECTED_PRICING_SCENARIO", "No current selected pricing scenario, so no governed price can exist.", "commercial-pricing"));
if (pricingRuns === 0) pricingBlockers.push(blocker("NO_PRICING_RUN", "The project has no pricing run.", "commercial-pricing"));
else if (currentRuns === 0) pricingBlockers.push(blocker("PRICING_RUNS_ALL_SUPERSEDED", "Every pricing run for this project is superseded.", "commercial-pricing"));
if (pricingLines > 0 && approvalReadyLines === 0) pricingBlockers.push(blocker("NO_APPROVAL_READY_LINES", `${pricingLines} pricing line(s) exist and none is approval_ready=1.`, "commercial-pricing"));
if (pricingLines > 0 && pricedLinesMissingMoney > 0) pricingBlockers.push(blocker("PRICING_MONEY_INCOMPLETE", `${pricedLinesMissingMoney} pricing line(s) have no net selling or material cost, so an export row would read "Missing Price".`, "commercial-pricing"));
if (commercialApprovals === 0) pricingBlockers.push(blocker("NO_COMMERCIAL_PRICE_APPROVAL", "No current Approved 'Commercial Price' approval exists, so no quotation line can be materialized.", "commercial-pricing"));
for (const blockerCode of lineAuthority.blockers || []) {
  pricingBlockers.push(blocker(blockerCode, "Canonical quotation-line authority refused the project.", "commercial-pricing"));
}
const pricingGate = gate("COMMERCIAL_PRICING_READY", {
  status: pricingBlockers.length === 0 ? "PASS" : "BLOCKED",
  count: pricingBlockers.length,
  blockers: pricingBlockers,
  nextLane: "commercial-pricing",
  evidence: {
    selectedScenarioId: scenario,
    pricingRuns,
    currentPricingRuns: currentRuns,
    pricingLines,
    approvalReadyLines,
    pricedLinesMissingMoney,
    commercialPriceApprovals: commercialApprovals,
  },
});

// ------------------------------------------------ E. CANONICAL QUOTATION AUTHORITY
const existingQuotation = count(
  "SELECT count(*) c FROM project_quotation_revisions WHERE project_id=? AND superseded_at IS NULL",
  { table: "project_quotation_revisions", values: [projectId] },
);
const quotationBlockers = [];
if (!context.workflow.readyForQuotation) {
  for (const b of workflowBlockers("quotation")) {
    quotationBlockers.push(blocker("QUOTATION_GATE_CLOSED", b.message, b.owner || "Commercial Approver"));
  }
  if (!quotationBlockers.length) {
    quotationBlockers.push(blocker("WORKFLOW_NOT_READY", "The presales workflow is not ready for quotation.", "Technical Reviewer"));
  }
}
if (!lineAuthority.ready) {
  quotationBlockers.push(
    blocker(
      "QUOTATION_LINE_AUTHORITY_BLOCKED",
      `Canonical quotation lines are not ready: ${(lineAuthority.blockers || []).join(", ") || "unknown reason"}`,
      "commercial-pricing",
    ),
  );
}
const quotationGate = gate("CANONICAL_QUOTATION_READY", {
  status: quotationBlockers.length === 0 ? "PASS" : "BLOCKED",
  count: quotationBlockers.length,
  blockers: quotationBlockers,
  nextLane: "quotation-approval",
  evidence: {
    workflowReadyForQuotation: context.workflow.readyForQuotation,
    lineAuthorityReady: lineAuthority.ready,
    lineAuthorityVersion: lineAuthority.authorityVersion,
    lineCount: lineAuthority.lines.length,
    liveQuotationRevisions: existingQuotation,
    evidenceFingerprint: context.sourceFingerprint,
  },
});

// --------------------------------------------------------- F. EXPORT INFRASTRUCTURE
const exportBlockers = [];
try {
  // The snapshot loader must be callable and must fail closed with a documented
  // code when there is no approved revision -- never with a raw crash.
  await loadQuotationSnapshotExportData(db, projectId, "Approved Cost Sheet", context.sourceFingerprint);
} catch (error) {
  const expected = new Set([
    "APPROVED_QUOTATION_REQUIRED",
    "QUOTATION_EVIDENCE_STALE",
    "QUOTATION_EVIDENCE_FINGERPRINT_REQUIRED",
    "QUOTATION_LINES_MISSING",
    "QUOTATION_SNAPSHOT_METADATA_MISMATCH",
    "QUOTATION_FINGERPRINT_MISMATCH",
    "QUOTATION_SNAPSHOT_RECONCILIATION_FAILED",
  ]);
  if (!expected.has(error.code)) {
    exportBlockers.push(blocker("EXPORT_AUTHORITY_UNAVAILABLE", `The governed snapshot loader failed unexpectedly: ${error.code || error.message}`, "export-infrastructure"));
  }
}
// The client-safe boundary must be internally consistent and must still show the
// customer something. This is the same control the export suite asserts.
if (JSON.stringify(sheetsForMode("Client-Safe Export")) !== JSON.stringify(CLIENT_SAFE_SHEETS)) {
  exportBlockers.push(blocker("CLIENT_SAFE_SHEETS_DRIFT", "sheetsForMode does not return the client-safe sheet allowlist.", "export-infrastructure"));
}
for (const field of clientSafeProtectedFields) {
  if (CLIENT_SAFE_VISIBLE_FIELDS.has(field)) {
    exportBlockers.push(blocker("CLIENT_SAFE_BOUNDARY_CONFLICT", `"${field}" is both protected and allowlisted.`, "export-infrastructure"));
  }
}
if (visibleDetailedFields("Client-Safe Export").length === 0) {
  exportBlockers.push(blocker("CLIENT_SAFE_EMPTY", "The client-safe detailed sheet would be empty.", "export-infrastructure"));
}
if (Object.keys(applyClientSafeRowBoundary({ description: "d", someNewInternalField: 1 })).join() !== "description") {
  exportBlockers.push(blocker("CLIENT_SAFE_BOUNDARY_LEAK", "An unrecognised field survived the client-safe boundary.", "export-infrastructure"));
}
const gateEvaluation = exportEligibleForQuotationIssue({
  exportJob: { project_id: projectId, export_mode: "Approved Cost Sheet", status: "Completed", quotation_revision_id: "probe", quotation_fingerprint: "probe", evidence_fingerprint: context.sourceFingerprint, cancelled_at: null, superseded_by_id: null },
  quotation: { project_id: projectId, id: "probe", quotation_fingerprint: "probe", evidence_fingerprint: context.sourceFingerprint },
  currentEvidenceFingerprint: context.sourceFingerprint,
});
if (!gateEvaluation.eligible) {
  exportBlockers.push(blocker("ISSUE_GATE_UNUSABLE", `The issue gate refused a well-formed governed export: ${gateEvaluation.reasons.join(", ")}`, "export-infrastructure"));
}
const exportGate = gate("EXPORT_READY", {
  status: exportBlockers.length === 0 ? "PASS" : "BLOCKED",
  count: exportBlockers.length,
  blockers: exportBlockers,
  nextLane: "export-infrastructure",
  evidence: {
    clientSafeSheets: CLIENT_SAFE_SHEETS,
    clientSafeVisibleFields: CLIENT_SAFE_VISIBLE_FIELDS.size,
    approvedCostSheetSheets: sheetsForMode("Approved Cost Sheet").length,
    snapshotAuthorityReachable: true,
    issueGateAcceptsGovernedExport: gateEvaluation.eligible,
  },
});

// ------------------------------------------------------------------- result
const gates = [reconciliationGate, requirementGate, technicalGate, panelGate, pricingGate, quotationGate, exportGate];
const blocked = gates.filter((g) => g.status === "BLOCKED");
const result = {
  database: databasePath,
  project: { id: project.id, name: project.name, system_domain: project.system_domain ?? null },
  currency: context.totals.currency,
  evidenceFingerprint: context.sourceFingerprint,
  workflowStatus: context.workflow.derivedStatus ?? null,
  readyForQuotation: context.workflow.readyForQuotation,
  gates,
  ready: blocked.length === 0,
  blockedGates: blocked.map((g) => g.gate),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 1));
} else {
  console.log(`delivery readiness  ${databasePath}`);
  console.log(`project             ${project.id}  ${project.name}${project.system_domain ? `  [${project.system_domain}]` : ""}`);
  console.log(`evidence fingerprint ${context.sourceFingerprint}`);
  console.log("");
  for (const g of gates) {
    console.log(`${g.status === "PASS" ? "PASS   " : "BLOCKED"} ${g.gate}${g.status === "BLOCKED" ? `  (${g.affected})` : ""}`);
    for (const b of g.blockers) console.log(`         - ${b.code}: ${b.detail}`);
    if (g.status === "BLOCKED") console.log(`         next lane: ${g.nextLane}`);
  }
  console.log("");
  console.log(result.ready ? "DELIVERY_READY = YES" : `DELIVERY_READY = NO (${blocked.length} gate(s) blocked)`);
}

raw.close();
process.exit(result.ready ? 0 : 1);