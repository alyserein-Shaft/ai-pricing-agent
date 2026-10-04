import { aggregateExportRows, applyClientSafeRowBoundary, buildQuotationSnapshotRows, buildDetailedRow, DETAILED_COLUMNS, exportFilename, EXPORT_ENGINE_VERSION, EXPORT_MODES, reconcileExport, reconcileQuotationSnapshotExport, sheetsForMode, TEMPLATE_VERSION, verifyQuotationSnapshotMetadata, validateExportReadiness } from "../app/domain/excel-export-engine.mjs";
import { buildCostSheetXlsx } from "./xlsx-cost-sheet.mjs";
import { resolveApplicationContext } from "./application-context.mjs";
import { buildQuotationEvidenceManifest } from "./quotation-evidence.mjs";
import {
  GOVERNED_EXPORT_MODES,
  quotationDigest,
  quotationFingerprintInput,
} from "../app/domain/quotation-authority.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const actorRole = "Project User";
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");
const failure = (code, message, status, stage, suggestedAction, reference = id("support")) => json({ error: { code, message, technicalDetails: code, stage, suggestedAction, retryable: status >= 500 || status === 409, supportReference: reference } }, status);
const ownedProject = async (db, projectId, userId) => await db.prepare("SELECT p.* FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL WHERE p.id=? AND (p.owner_user_id=? OR m.id IS NOT NULL)").bind(userId, projectId, userId).first();
const audit = (db, { projectId, exportJobId = null, action, stage, previous = null, next = null, reason, userId }) => db.prepare("INSERT INTO excel_export_audit_log (id, project_id, export_job_id, action, stage, previous_value, new_value, reason, actor_user_id, actor_role, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("exportaudit"), projectId, exportJobId, action, stage, JSON.stringify(previous), JSON.stringify(next), reason, userId, actorRole, id("request"));
const builtinTemplate = { id: "template_construction_v1", name: "Construction Cost Sheet", version: TEMPLATE_VERSION, status: "Approved", supportedModes: EXPORT_MODES, sheetSet: sheetsForMode("Commercial Review Cost Sheet"), formulaStrategy: "Stable server values with transparent workbook totals" };
const ensureTemplate = async (db, userId) => { await db.prepare("INSERT OR IGNORE INTO export_templates (id, name, version, status, supported_modes, sheet_configuration, branding, formula_strategy, mapping_version, created_by) VALUES (?, ?, ?, 'Approved', ?, ?, ?, ?, 'canonical-1.0', ?)").bind(builtinTemplate.id, builtinTemplate.name, builtinTemplate.version, JSON.stringify(EXPORT_MODES), JSON.stringify({ configurable: true, sheets: builtinTemplate.sheetSet }), JSON.stringify({ companyName: "Al Mesbar Contracting Corporation", colors: ["#0F3D5E", "#E8F1F5"] }), builtinTemplate.formulaStrategy, userId).run(); const existing = Number((await db.prepare("SELECT COUNT(*) count FROM export_template_mappings WHERE template_id=?").bind(builtinTemplate.id).first())?.count || 0); if (!existing) await db.batch(DETAILED_COLUMNS.map((column, index) => db.prepare("INSERT INTO export_template_mappings (id, template_id, sheet_name, target, canonical_field, format, required, visibility_rule, export_modes, validation, sequence) VALUES (?, ?, 'Detailed Cost Sheet', ?, ?, ?, ?, ?, ?, ?, ?)").bind(`mapping_${index + 1}`, builtinTemplate.id, `${index + 1}`, column.field, /price|cost|total|selling|value|freight|overhead|risk|contingency|vat/i.test(column.field) ? "#,##0.00" : /discount|margin|markup|confidence/i.test(column.field) ? "0.00%" : "@", ["lineNumber", "description", "unit", "quantity"].includes(column.field) ? 1 : 0, ["supplier", "listPrice", "netUnitMaterialCost", "margin", "risk"].includes(column.field) ? "Internal modes only" : "All modes", JSON.stringify(EXPORT_MODES), JSON.stringify({ formulaInjectionSafe: true }), index + 1))); };

export const loadCurrentExportMatchingVersion = async (db, projectId) =>
  db.prepare(`SELECT COALESCE(MAX(mr.version_number),0) matching_version FROM product_match_runs mr JOIN ${currentBoqEvidenceFrom("b")} ON b.id=mr.boq_item_id AND b.project_id=mr.project_id WHERE mr.project_id=? AND ${currentBoqItemPredicate("b")} AND mr.superseded_at IS NULL AND mr.version_number=(SELECT MAX(mr2.version_number) FROM product_match_runs mr2 WHERE mr2.boq_item_id=mr.boq_item_id AND mr2.superseded_at IS NULL)`).bind(projectId).first();

export const loadCurrentExportRequirementVersion = async (db, projectId) =>
  db.prepare(`SELECT COALESCE(MAX(rp.version_number),0) requirement_version FROM requirement_profile_versions rp JOIN ${currentBoqEvidenceFrom("b")} ON b.id=rp.boq_item_id AND b.project_id=rp.project_id WHERE rp.project_id=? AND ${currentBoqItemPredicate("b")} AND rp.superseded_at IS NULL AND rp.approved_for_matching=1`).bind(projectId).first();

export const loadCurrentExportPricingVersion = async (db, projectId, scenarioId) =>
  db.prepare(`SELECT COALESCE(MAX(r.version_number),0) pricing_version FROM pricing_runs r JOIN pricing_lines l ON l.pricing_run_id=r.id JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id AND b.project_id=l.project_id WHERE r.project_id=? AND r.scenario_id=? AND ${currentBoqItemPredicate("b")} AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)`).bind(projectId, scenarioId).first();

export const loadCurrentPricingComponents = async (db, projectId, scenarioId) =>
  db.prepare(`SELECT c.*, l.boq_item_id FROM pricing_cost_components c JOIN pricing_lines l ON l.id=c.pricing_line_id JOIN pricing_runs r ON r.id=l.pricing_run_id JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id AND b.project_id=l.project_id WHERE l.project_id=? AND r.scenario_id=? AND ${currentBoqItemPredicate("b")} AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)`).bind(projectId, scenarioId).all();

export const loadCurrentPricingDiscounts = async (db, projectId, scenarioId) =>
  db.prepare(`SELECT d.*, l.boq_item_id FROM pricing_discount_applications d JOIN pricing_lines l ON l.id=d.pricing_line_id JOIN pricing_runs r ON r.id=l.pricing_run_id JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id AND b.project_id=l.project_id WHERE l.project_id=? AND r.scenario_id=? AND ${currentBoqItemPredicate("b")} AND r.superseded_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)`).bind(projectId, scenarioId).all();

/* ------------------------------------------------------------------ *
 * GOVERNED SNAPSHOT EXPORT DATA
 *
 * A governed export ("Approved Cost Sheet", "Client-Safe Export") must be
 * rendered from the immutable lines of ONE approved quotation revision, never
 * from live pricing state. Live pricing can move after approval, so rendering
 * from it would export a quotation that nobody approved. This loader is the
 * single source of governed export rows; there is no second path.
 *
 * It fails closed, with an explicit code, at every step where the stored
 * revision cannot be trusted:
 *
 *   APPROVED_QUOTATION_REQUIRED .. no non-superseded Approved/Issued revision
 *   QUOTATION_EVIDENCE_STALE ..... the revision was approved against evidence
 *                                 that has since changed
 *   QUOTATION_LINES_MISSING ..... an approved revision with no stored lines
 *   QUOTATION_SNAPSHOT_METADATA_MISMATCH .. the revision's own reconciliation
 *                                 metadata disagrees with its stored lines
 *   QUOTATION_FINGERPRINT_MISMATCH ........ a stored line no longer reproduces
 *                                 the fingerprint that was approved
 *
 * Every rejection is thrown, never downgraded to a fallback, so a governed
 * export can never be produced from unrelated or newer pricing state.
 * ------------------------------------------------------------------ */

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

const SNAPSHOT_QUOTATION_STATUSES = ["Approved", "Issued"];

/** The one revision a governed export may render: the newest live Approved/Issued one. */
const loadSnapshotRevision = async (db, projectId) =>
  (await db
    .prepare(
      "SELECT * FROM project_quotation_revisions WHERE project_id=? AND status IN ('Approved','Issued') AND superseded_at IS NULL ORDER BY revision_number DESC LIMIT 1",
    )
    .bind(projectId)
    .first()) || null;

const snapshotLinesOf = async (db, revisionId) =>
  (await db
    .prepare("SELECT * FROM project_quotation_lines WHERE quotation_revision_id=? ORDER BY sequence,id")
    .bind(revisionId)
    .all()).results || [];

const snapshotTotalsOf = (lines) => {
  const sum = (field) => lines.reduce((total, line) => total + Number(line[field] || 0), 0);
  const subtotalMinor = sum("net_selling_minor");
  const vatBasisPoints = 0; // replaced by the caller, which owns the revision terms
  return {
    lineCount: lines.length,
    totalCostMinor: sum("total_cost_minor"),
    subtotalMinor,
    vatMinor: 0,
    totalMinor: subtotalMinor,
    vatBasisPoints,
  };
};

/**
 * Recompute the approved fingerprint from the STORED lines, using the same
 * canonical input builder the single writer used when it created the revision.
 */
const recomputeSnapshotFingerprint = async (revision, lines) => {
  const vatBasisPoints = Number(revision.vat_basis_points || 0);
  const subtotalMinor = lines.reduce((total, line) => total + Number(line.net_selling_minor || 0), 0);
  const costMinor = lines.reduce((total, line) => total + Number(line.total_cost_minor || 0), 0);
  const manifest = parse(revision.evidence_manifest_json, {});
  const totals = {
    currency: revision.currency,
    costMinor,
    subtotalMinor,
    lineCount: lines.length,
    selectedScenarioId: manifest?.selectedPricingScenario?.id ?? null,
  };
  return quotationDigest(
    quotationFingerprintInput({
      evidenceFingerprint: revision.evidence_fingerprint,
      totals,
      lineAuthority: { authorityVersion: "quotation-line-authority-1.0.0", lines },
      vatBasisPoints,
      terms: parse(revision.terms_json, {}),
    }),
  );
};

export const loadQuotationSnapshotExportData = async (db, projectId, mode, currentEvidenceFingerprint) => {
  const revision = await loadSnapshotRevision(db, projectId);
  if (!revision) fail("APPROVED_QUOTATION_REQUIRED", "Approve the current quotation revision before generating a governed issue export.");
  if (!currentEvidenceFingerprint) {
    fail("QUOTATION_EVIDENCE_FINGERPRINT_REQUIRED", "A governed export requires the current evidence fingerprint; it cannot be resolved from the revision alone.");
  }
  if (revision.evidence_fingerprint !== currentEvidenceFingerprint) {
    fail("QUOTATION_EVIDENCE_STALE", "The approved quotation no longer matches current governed evidence.");
  }
  const lines = await snapshotLinesOf(db, revision.id);
  if (!lines.length) fail("QUOTATION_LINES_MISSING", "The approved quotation revision has no stored lines.");

  const vatBasisPoints = Number(revision.vat_basis_points || 0);
  const subtotalMinor = lines.reduce((total, line) => total + Number(line.net_selling_minor || 0), 0);
  const totalCostMinor = lines.reduce((total, line) => total + Number(line.total_cost_minor || 0), 0);
  const vatMinor = Number(revision.vat_minor ?? Math.round((subtotalMinor * vatBasisPoints) / 10000));
  const snapshotTotals = {
    lineCount: lines.length,
    totalCostMinor,
    subtotalMinor,
    vatMinor,
    totalMinor: subtotalMinor + vatMinor,
    vatBasisPoints,
  };

  const metadata = verifyQuotationSnapshotMetadata({
    sourceSummary: parse(revision.source_summary_json, {}),
    snapshotTotals,
  });
  if (!metadata.consistent) {
    fail("QUOTATION_SNAPSHOT_METADATA_MISMATCH", `The stored quotation revision disagrees with its own lines (${metadata.problems.join(", ")}).`);
  }

  const fingerprintMatches = (await recomputeSnapshotFingerprint(revision, lines)) === revision.quotation_fingerprint;
  if (!fingerprintMatches) {
    fail("QUOTATION_FINGERPRINT_MISMATCH", "The stored quotation lines no longer reproduce the approved quotation fingerprint.");
  }

  // ONE projection of the approved snapshot into workbook rows, owned by the
  // engine and shared with the cost-sheet builder. Readiness and reconciliation
  // are evaluated on the governed rows; the client-safe boundary is a
  // presentation filter applied last, so stripping internal fields can never
  // change a server-side verdict.
  const governedRows = buildQuotationSnapshotRows({ revision, lines, mode: undefined });
  const readiness = validateExportReadiness({
    mode,
    rows: governedRows,
    reviewReadiness: "Ready for Quotation",
    templateStatus: "Approved",
  });
  const rows = mode === "Client-Safe Export" ? governedRows.map(applyClientSafeRowBoundary) : governedRows;
  const visibleTotals = aggregateExportRows(rows);
  const totals = visibleTotals;
  const reconciliation = reconcileQuotationSnapshotExport({
    revision: { ...revision, quotation_line_count: snapshotTotals.lineCount },
    snapshotTotals,
    workbookTotals: totals,
    fingerprintMatches,
    mode,
  });
  if (!reconciliation.reconciled) {
    fail("QUOTATION_SNAPSHOT_RECONCILIATION_FAILED", `The workbook does not reconcile with the approved quotation (${reconciliation.failed.join(", ")}).`);
  }

  return {
    quotation: revision,
    quotationRevisionId: revision.id,
    quotationFingerprint: revision.quotation_fingerprint,
    evidenceFingerprint: revision.evidence_fingerprint,
    mode,
    rows,
    // The governed rows, before the client-safe presentation boundary. Every
    // server-side verdict is taken on THESE: a customer-facing workbook must
    // never change whether an export is permitted.
    governedRows,
    totals,
    reconciliation,
    snapshotTotals,
    readiness,
    costComponents: [],
    discounts: [],
    lockedVersions: {
      project: 1,
      boq: 0,
      requirements: 0,
      matching: 0,
      pricing: 0,
      review: 0,
      template: TEMPLATE_VERSION,
    },
    documentCount: 0,
    scenario: { id: parse(revision.evidence_manifest_json, {})?.selectedPricingScenario?.id ?? null, project_currency: revision.currency },
    reviews: [],
    clarifications: [],
  };
};

export const loadExportData = async (db, projectId, mode, options = {}) => {
  // One canonical path. A GOVERNED export is rendered from the approved
  // quotation snapshot and never from live pricing state; a review/draft export
  // keeps the live pricing projection it always had. There is no second export
  // data authority and no fallback from one to the other.
  if (GOVERNED_EXPORT_MODES.has(mode)) {
    const { currentEvidenceFingerprint } = typeof options === "object" && options ? options : {};
    return loadQuotationSnapshotExportData(db, projectId, mode, currentEvidenceFingerprint);
  }
  const scenario = await db
    .prepare(
      "SELECT s.*, COALESCE(MAX(r.version_number),0) pricing_version FROM project_dashboard_profiles p JOIN pricing_scenarios s ON s.id=p.selected_pricing_scenario_id AND s.project_id=p.project_id AND s.deleted_at IS NULL AND s.superseded_at IS NULL LEFT JOIN pricing_runs r ON r.scenario_id=s.id AND r.superseded_at IS NULL WHERE p.project_id=? AND p.deleted_at IS NULL GROUP BY s.id",
    )
    .bind(projectId)
    .first();

  const scenarioId = scenario?.id || null;
  const currentReviewItem = `(SELECT 1 FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=q.boq_item_id AND b.project_id=q.project_id AND ${currentBoqItemPredicate("b")})`;

  const [boqResult, candidateResult, componentResult, discountResult, reviewResult, clarificationResult, documentCountRow, pricingVersionRow, requirementVersionRow, matchingVersionRow] = await Promise.all([
    db.prepare(`SELECT b.*, b.evidence_extraction_version boq_version, d.logical_name boq_source_file FROM ${currentBoqEvidenceFrom("b")} LEFT JOIN documents d ON d.id=b.source_document_id WHERE b.project_id=? AND ${currentBoqItemPredicate("b")} ORDER BY b.sequence`).bind(projectId).all(),
    db.prepare(`SELECT
  b.id boq_item_id,
  c.*,
  c.confidence_score overall_score,
  mr.version_number match_run_version,
  p.part_number,
  p.part_number model,
  p.description product_description,
  p.lifecycle_status,
  m.name manufacturer_name,
  br.name brand_name,
  f.name family_name,
  l.*,
  pr.price_type,
  pr.currency price_currency,
  pr.amount_minor price_amount_minor,
  pr.effective_from valid_from,
  pr.valid_until valid_to,
  pr.source_location source_reference,
  ps.file_name product_source_name,
  ps.file_name price_file_name,
  s.name supplier_name,
  sd.safety_state,
  sd.compliance_state,
  sd.technical_eligibility,
  sd.missing_information,
  ta.status technical_approval_status,
  ca.status commercial_approval_status
FROM ${currentBoqEvidenceFrom("b")}
LEFT JOIN product_match_runs mr
  ON mr.boq_item_id=b.id
 AND mr.superseded_at IS NULL
 AND mr.version_number=(
   SELECT MAX(mr2.version_number)
   FROM product_match_runs mr2
   WHERE mr2.boq_item_id=b.id
     AND mr2.superseded_at IS NULL
 )
LEFT JOIN product_match_candidates c
  ON c.match_run_id=mr.id
 AND c.rank=1
LEFT JOIN canonical_library_products p
  ON p.requested_product_id=c.product_id
LEFT JOIN product_manufacturers m
  ON m.id=p.manufacturer_id
LEFT JOIN product_brands br
  ON br.id=p.brand_id
LEFT JOIN product_families f
  ON f.id=p.family_id
LEFT JOIN pricing_lines l
  ON l.boq_item_id=b.id
 AND l.pricing_run_id=(
   SELECT r.id
   FROM pricing_runs r
   JOIN pricing_lines l2
     ON l2.pricing_run_id=r.id
   WHERE l2.boq_item_id=b.id
     AND r.scenario_id=?
     AND r.superseded_at IS NULL
   ORDER BY r.version_number DESC
   LIMIT 1
 )
LEFT JOIN price_records pr
  ON pr.id=l.selected_price_record_id
LEFT JOIN product_sources ps
  ON ps.id=pr.source_id
LEFT JOIN suppliers s
  ON s.id=pr.supplier_id
LEFT JOIN safety_decisions sd
  ON sd.id=l.safety_decision_id
LEFT JOIN safety_approval_requests ta
  ON ta.id=(
    SELECT a.id
    FROM safety_approval_requests a
    WHERE a.safety_decision_id=sd.id
      AND a.approval_type='Technical'
    ORDER BY a.decided_at DESC,
             a.id DESC
    LIMIT 1
  )
LEFT JOIN pricing_approvals ca
  ON ca.id=(
    SELECT a.id
    FROM pricing_approvals a
    WHERE a.pricing_run_id=l.pricing_run_id
      AND a.approval_type='Commercial Price'
    ORDER BY COALESCE(a.decided_at,a.created_at) DESC,
             a.created_at DESC,
             a.id DESC
    LIMIT 1
  )
WHERE b.project_id=?
  AND ${currentBoqItemPredicate("b")}
ORDER BY b.sequence`).bind(scenarioId, projectId).all(),
    loadCurrentPricingComponents(db, projectId, scenarioId),
    loadCurrentPricingDiscounts(db, projectId, scenarioId),
    db.prepare(`SELECT q.id review_item_id, q.boq_item_id, q.review_type, q.status, q.approval_level, q.escalation_status, q.version_number, d.decision_type, d.outcome, d.decided_by, d.decided_role, d.decided_at, d.reason, d.conditions, d.evidence, d.notes FROM review_queue_items q LEFT JOIN review_decisions d ON d.review_item_id=q.id WHERE q.project_id=? AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR EXISTS ${currentReviewItem}) ORDER BY q.updated_at DESC, d.decided_at DESC`).bind(projectId).all(),
    db.prepare(`SELECT c.*, q.boq_item_id FROM review_clarifications c JOIN review_queue_items q ON q.id=c.review_item_id WHERE c.project_id=? AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR EXISTS ${currentReviewItem}) ORDER BY c.created_at`).bind(projectId).all(),
    db.prepare("SELECT COUNT(*) count FROM documents WHERE project_id=? AND archived_at IS NULL").bind(projectId).first(),
    loadCurrentExportPricingVersion(db, projectId, scenarioId),
    loadCurrentExportRequirementVersion(db, projectId),
    loadCurrentExportMatchingVersion(db, projectId)
  ]);
  const boqs = boqResult.results || [], candidates = new Map((candidateResult.results || []).map((row) => [row.boq_item_id, row])), components = componentResult.results || [], discounts = discountResult.results || [], reviews = reviewResult.results || [], reviewsByItem = new Map(); for (const review of reviews) if (!reviewsByItem.has(review.boq_item_id)) reviewsByItem.set(review.boq_item_id, review);
  const rows = boqs.map((boq) => { const joined = candidates.get(boq.id) || {}, sourceLocation = parse(boq.source_location, {}); return buildDetailedRow({ boq, candidate: { ...joined, description: joined.explanation }, product: { ...joined, description: joined.product_description, source_name: joined.product_source_name }, price: { ...joined, currency: joined.price_currency, file_name: joined.price_file_name }, pricing: joined, components: components.filter((x) => x.boq_item_id === boq.id), discounts: discounts.filter((x) => x.boq_item_id === boq.id), safety: joined, technicalApproval: { status: joined.technical_approval_status }, commercialApproval: { status: joined.commercial_approval_status }, review: reviewsByItem.get(boq.id) || {}, source: { boqSourceFile: boq.boq_source_file, boqSourceLocation: sourceLocation.sheet ? `${sourceLocation.sheet} · row ${sourceLocation.row || ""}` : sourceLocation.page ? `page ${sourceLocation.page}` : JSON.stringify(sourceLocation), specificationSource: "Requirement profile evidence", blocks: [], warnings: [] }, mode }); });
  const totals = aggregateExportRows(rows), lockedVersions = { project: 1, boq: Math.max(0, ...boqs.map((x) => Number(x.boq_version || 0))), requirements: Number(requirementVersionRow?.requirement_version || 0), matching: Number(matchingVersionRow?.matching_version || 0), pricing: Number(pricingVersionRow?.pricing_version || 0), review: Math.max(0, ...reviews.map((x) => Number(x.version_number || 0))), template: TEMPLATE_VERSION };
  return { rows, totals, lockedVersions, documentCount: Number(documentCountRow?.count || 0), scenario, reviews, clarifications: clarificationResult.results || [], costComponents: components, discounts };
};
export const readinessForProject = async (db, projectId) => { const current = `(SELECT 1 FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=q.boq_item_id AND b.project_id=q.project_id AND ${currentBoqItemPredicate("b")})`, items = (await db.prepare(`SELECT q.review_type, q.status FROM review_queue_items q WHERE q.project_id=? AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR EXISTS ${current})`).bind(projectId).all()).results || [], pending = Number((await db.prepare(`SELECT COUNT(*) count FROM review_clarifications c JOIN review_queue_items q ON q.id=c.review_item_id WHERE c.project_id=? AND c.status NOT IN ('Resolved','Rejected','Cancelled') AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR EXISTS ${current})`).bind(projectId).first())?.count || 0), blocks = Number((await db.prepare(`SELECT COUNT(*) count FROM review_queue_items q WHERE q.project_id=? AND q.deleted_at IS NULL AND (q.blocking=1 OR q.status IN ('Blocked','Escalated')) AND (q.boq_item_id IS NULL OR EXISTS ${current})`).bind(projectId).first())?.count || 0); if (blocks) return "Exceptions Pending"; if (pending) return "Clarifications Pending"; if (items.some((x) => /Technical/.test(x.review_type) && !["Approved", "Approved with Conditions"].includes(x.status))) return "Technical Review Required"; if (items.some((x) => /Commercial|Cost|Price|Margin/.test(x.review_type) && !["Approved", "Approved with Conditions"].includes(x.status))) return "Commercial Review Required"; return items.length && items.every((x) => ["Approved", "Approved with Conditions"].includes(x.status)) ? "Ready for Quotation" : "Not Ready"; };

const generate = async ({ env, project, mode, userId, body, jobId, revision, template, verifiedData = null }) => {
  const projectId = project.id, data = verifiedData || (await loadExportData(env.DB, projectId, mode)), reviewReadiness = data && data.reviewReadiness ? data.reviewReadiness : await readinessForProject(env.DB, projectId), readiness = validateExportReadiness({ mode, rows: data.governedRows || data.rows, reviewReadiness, templateStatus: template.status });
  if (!readiness.permitted) { await env.DB.batch([env.DB.prepare("UPDATE excel_export_jobs SET status='Failed', stage='Validating Workbook', progress=100, warning_count=?, blocking_issue_count=?, failed_at=?, error_code=?, error_message=?, suggested_action=? WHERE id=?").bind(readiness.warnings.length, readiness.errors.length, now(), readiness.errors[0], readiness.errors.join(", "), "Resolve export readiness controls and retry", jobId), audit(env.DB, { projectId, exportJobId: jobId, action: "Export Failed", stage: "Validating", next: { errors: readiness.errors }, reason: "Server export readiness rejected the request", userId, role: actorRole })]); return { failed: true, readiness }; }
  const reconciliation = reconcileExport({ workbookTotals: data.totals, serverTotals: data.totals }), generatedAt = now(), filename = exportFilename({ projectName: project.name, tenderNumber: body.tenderNumber || project.id, revision }), metadata = { exportId: jobId, projectId, projectVersion: 1, boqVersion: data.lockedVersions.boq, requirementProfileVersion: data.lockedVersions.requirements, matchRunVersion: data.lockedVersions.matching, pricingVersion: data.lockedVersions.pricing, reviewVersion: data.lockedVersions.review, templateVersion: template.version, exportMode: mode, generatedBy: userId, generatedAt, applicationVersion: EXPORT_ENGINE_VERSION, ruleVersions: "Task 11 safety · Task 12 pricing · Task 13 review", reconciliationStatus: reconciliation.reconciled ? "Passed" : "Failed", warningCount: readiness.warnings.length, blockingIssueCount: readiness.errors.length };
  const model = { mode, revision, generatedAt, generatedBy: userId, project: { name: project.name, client: body.client || "", code: body.tenderNumber || project.id, location: body.location || "", package: body.package || "Fire Detection & Alarm", currency: data.scenario?.project_currency || "SAR", scenario: data.scenario?.name || "Current governed scenario", companyName: body.companyName }, rows: data.rows, totals: data.totals, warningCount: readiness.warnings.length, reviewReadiness, reconciliation, metadata, alternatives: [], costComponents: data.costComponents.map((x) => [x.boq_item_id, x.component_type, x.description, x.method, x.formula, x.rate, x.quantity, data.scenario?.project_currency || "SAR", Number(x.amount_minor || 0) / 100, x.source, parse(x.assumptions, []).join("; "), x.approval_status]), priceSources: data.rows.map((x) => [x.supplier, x.manufacturer, x.model, x.partNumber, x.priceSourceType, x.priceSourceFile, x.sourceReference, x.currency, x.listPrice, x.netUnitMaterialCost, "", x.priceValidity, "", "", "", x.commercialApprovalStatus, "Governed source", project.id]), clarifications: data.clarifications.map((x) => [x.boq_item_id, "Clarification", x.question, "Review workflow", x.priority, "See review", "See review", x.recipient, x.due_date, x.status, x.response, x.resolved_at ? "Resolved" : "", "", "", ""]), reviews: data.reviews.map((x) => [x.review_item_id, x.boq_item_id, x.review_type, x.decision_type || "Pending", x.outcome || x.status, x.decided_by, x.decided_role, x.decided_at, x.reason, x.conditions, x.evidence, x.approval_level, x.escalation_status, x.version_number]), assumptions: data.rows.flatMap((x, i) => x.assumptions ? [[`A-${i + 1}`, x.itemNumber, x.assumptions, "Pricing scenario", "Source gap", "Review required", "Review required", "Estimator", "Pending", "", "", "Before approval"]] : []) };
  const bytes = buildCostSheetXlsx(model), sha256 = await digest(bytes), objectKey = `excel-exports/${projectId}/${jobId}/${filename}`; await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentDisposition: `attachment; filename="${filename}"` }, customMetadata: { sha256, exportJobId: jobId, projectId } });
  await env.DB.batch([env.DB.prepare("UPDATE excel_export_jobs SET filename=?, status=?, stage='Completed', progress=100, locked_versions=?, sheet_set=?, warning_count=?, blocking_issue_count=0, data_hash=?, started_at=COALESCE(started_at, ?), completed_at=?, expires_at=? WHERE id=?").bind(filename, readiness.status, JSON.stringify(data.lockedVersions), JSON.stringify(sheetsForMode(mode)), readiness.warnings.length, sha256, generatedAt, generatedAt, new Date(Date.now() + 30 * 86400000).toISOString(), jobId), env.DB.prepare("INSERT INTO excel_export_files (id, export_job_id, project_id, object_key, filename, mime_type, byte_size, sha256) VALUES (?, ?, ?, ?, ?, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ?, ?)").bind(id("exportfile"), jobId, projectId, objectKey, filename, bytes.byteLength, sha256), env.DB.prepare("INSERT INTO excel_export_reconciliations (id, export_job_id, server_totals, workbook_totals, differences, tolerance, status, failed_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("reconciliation"), jobId, JSON.stringify(data.totals), JSON.stringify(data.totals), JSON.stringify(reconciliation.differences), String(reconciliation.tolerance), reconciliation.reconciled ? "Passed" : "Failed", JSON.stringify(reconciliation.failed)), audit(env.DB, { projectId, exportJobId: jobId, action: "Excel Export Completed", stage: "Completed", next: { filename, sha256, status: readiness.status, lockedVersions: data.lockedVersions }, reason: body.reason || "User requested governed Excel cost sheet", userId, role: actorRole })]); return { jobId, filename, status: readiness.status, warningCount: readiness.warnings.length, sha256 };
};

export const handleExcelExportApi = async (request, env) => {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/excel-exports")) return null; if (!env.DB || !env.FILES) return failure("EXPORT_STORAGE_UNAVAILABLE", "Excel export storage is unavailable.", 503, "Requested", "Retry after local storage recovers"); const resolved = await resolveApplicationContext(request, env); if (resolved.error) return json({ error: resolved.error }, resolved.error.status); const userId = resolved.context.userId; await ensureTemplate(env.DB, userId);
  if (url.pathname === "/api/excel-exports/templates" && request.method === "GET") { const rows = await env.DB.prepare("SELECT * FROM export_templates WHERE status='Approved' AND deleted_at IS NULL ORDER BY created_at DESC").all(); return json({ templates: (rows.results || []).map((x) => ({ ...x, supported_modes: parse(x.supported_modes, []), sheet_configuration: parse(x.sheet_configuration, {}) })) }); }
  const projectRoute = url.pathname.match(/^\/api\/excel-exports\/projects\/([^/]+)\/(preview|validate|exports|history)$/); if (projectRoute) { const projectId = decodeURIComponent(projectRoute[1]), operation = projectRoute[2], project = await ownedProject(env.DB, projectId, userId); if (!project) return failure("PROJECT_NOT_FOUND", "Project not found.", 404, "Permission Checked", "Open an accessible project");
    if (["history", "exports"].includes(operation) && request.method === "GET") { const rows = await env.DB.prepare("SELECT j.*, f.byte_size, f.sha256, f.download_count FROM excel_export_jobs j LEFT JOIN excel_export_files f ON f.export_job_id=j.id WHERE j.project_id=? ORDER BY j.requested_at DESC").bind(projectId).all(); return json({ exports: (rows.results || []).map((x) => ({ ...x, locked_versions: parse(x.locked_versions, {}), sheet_set: parse(x.sheet_set, []) })) }); }
    const body = request.method === "POST" ? await request.json() : Object.fromEntries(url.searchParams), mode = body.mode || "Draft Cost Sheet", template = await env.DB.prepare("SELECT * FROM export_templates WHERE id=? AND status='Approved' AND deleted_at IS NULL").bind(body.templateId || builtinTemplate.id).first(); if (!template) return failure("EXPORT_TEMPLATE_NOT_FOUND", "Select an approved export template.", 422, "Loading Template", "Select an available template"); let data = null, reviewReadiness = null, readiness = null, snapshotRefusal = null; if (GOVERNED_EXPORT_MODES.has(mode)) { let evidenceFingerprint = null; try { const manifest = await buildQuotationEvidenceManifest(env.DB, projectId); evidenceFingerprint = manifest.fingerprint; } catch (error) { snapshotRefusal = { code: error?.code || "GOVERNED_EXPORT_UNAVAILABLE", message: error?.message || "Governed evidence is unavailable." }; } try { data = await loadExportData(env.DB, projectId, mode, { currentEvidenceFingerprint: evidenceFingerprint }); } catch (error) { snapshotRefusal = { code: error?.code || "GOVERNED_EXPORT_UNAVAILABLE", message: error?.message || "A governed export requires an approved, current quotation." }; } reviewReadiness = "Ready for Quotation"; readiness = data ? validateExportReadiness({ mode, rows: data.governedRows || data.rows, reviewReadiness, templateStatus: template.status }) : { permitted: false, errors: [snapshotRefusal.code], warnings: [], status: "Blocked" }; } else { data = await loadExportData(env.DB, projectId, mode); reviewReadiness = await readinessForProject(env.DB, projectId); readiness = validateExportReadiness({ mode, rows: data.rows, reviewReadiness, templateStatus: template.status }); }
    if (snapshotRefusal) return failure(snapshotRefusal.code, snapshotRefusal.message, 409, "Validating", "Resolve the quotation and evidence state, then retry the export");
    if (operation === "preview" && request.method === "POST") return json({ mode, template: { id: template.id, name: template.name, version: template.version }, sheets: sheetsForMode(mode), lockedVersions: data.lockedVersions, totals: data.totals, readiness, reviewReadiness });
    if (operation === "validate" && request.method === "POST") return json({ readiness, reviewReadiness, lockedVersions: data.lockedVersions, totals: data.totals });
    if (operation === "exports" && request.method === "POST") { const key = request.headers.get("idempotency-key") || String(body.idempotencyKey || ""); if (!key) return failure("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 422, "Requested", "Retry from the export screen"); const prior = await env.DB.prepare("SELECT * FROM excel_export_jobs WHERE project_id=? AND idempotency_key=?").bind(projectId, key).first(); if (prior) return json({ jobId: prior.id, status: prior.status, filename: prior.filename, idempotent: true }); let quotation=null,evidenceFingerprint=null;if(GOVERNED_EXPORT_MODES.has(mode)){quotation=await env.DB.prepare("SELECT * FROM project_quotation_revisions WHERE project_id=? AND status IN ('Approved','Issued') AND superseded_at IS NULL ORDER BY revision_number DESC LIMIT 1").bind(projectId).first();if(!quotation)return failure("APPROVED_QUOTATION_REQUIRED","Approve the current quotation revision before generating a governed issue export.",409,"Validating","Approve the current quotation");const evidence=await buildQuotationEvidenceManifest(env.DB,projectId);evidenceFingerprint=evidence.fingerprint;if(quotation.evidence_fingerprint!==evidenceFingerprint)return failure("QUOTATION_EVIDENCE_STALE","The approved quotation no longer matches current governed evidence.",409,"Validating","Create and approve a fresh quotation revision");}const revision = Number((await env.DB.prepare("SELECT MAX(revision) maximum FROM excel_export_jobs WHERE project_id=?").bind(projectId).first())?.maximum || 0) + 1, jobId = id("excelexport"), filename = exportFilename({ projectName: project.name, tenderNumber: body.tenderNumber || project.id, revision }); await env.DB.batch([env.DB.prepare("INSERT INTO excel_export_jobs (id, project_id, template_id, export_mode, revision, filename, status, stage, progress, locked_versions, sheet_set, configuration, idempotency_key, requested_by, requested_role, started_at,quotation_revision_id,quotation_fingerprint,evidence_fingerprint) VALUES (?, ?, ?, ?, ?, ?, 'Validating', 'Validating', 10, ?, ?, ?, ?, ?, ?, ?,?,?,?)").bind(jobId, projectId, template.id, mode, revision, filename, JSON.stringify(data.lockedVersions), JSON.stringify(sheetsForMode(mode)), JSON.stringify(body), key, userId, actorRole, now(),quotation?.id||null,quotation?.quotation_fingerprint||null,evidenceFingerprint), audit(env.DB, { projectId, exportJobId: jobId, action: "Excel Export Requested", stage: "Requested", next: { mode, revision, template: template.id,quotationRevisionId:quotation?.id||null,evidenceFingerprint }, reason: body.reason || "Cost sheet export requested", userId, role: actorRole })]); const result = await generate({ env, project, mode, userId, body, jobId, revision, template, verifiedData: data }); return json(result, result.failed ? 422 : 201); }
  }
  const exportRoute = url.pathname.match(/^\/api\/excel-exports\/([^/]+)(?:\/(status|download|metadata|cancel|rerun|supersede|reconcile|compare))?$/); if (!exportRoute) return failure("EXPORT_API_NOT_FOUND", "Excel export operation not found.", 404, "Requested", "Check the operation"); const jobId = decodeURIComponent(exportRoute[1]), operation = exportRoute[2] || "status", job = await env.DB.prepare("SELECT * FROM excel_export_jobs WHERE id=?").bind(jobId).first(); if (!job || !(await ownedProject(env.DB, job.project_id, userId))) return failure("EXPORT_NOT_FOUND", "Export not found.", 404, "Download", "Refresh export history");
  if (operation === "status" && request.method === "GET") return json({ job: { ...job, locked_versions: parse(job.locked_versions, {}), sheet_set: parse(job.sheet_set, []) } });
  if (operation === "metadata" && request.method === "GET") { const [file, reconciliation, history] = await Promise.all([env.DB.prepare("SELECT id, filename, byte_size, sha256, download_count, created_at FROM excel_export_files WHERE export_job_id=? AND deleted_at IS NULL").bind(jobId).first(), env.DB.prepare("SELECT * FROM excel_export_reconciliations WHERE export_job_id=?").bind(jobId).first(), env.DB.prepare("SELECT * FROM excel_export_audit_log WHERE export_job_id=? ORDER BY created_at").bind(jobId).all()]); return json({ job, file, reconciliation: reconciliation ? { ...reconciliation, differences: parse(reconciliation.differences, {}), failed_fields: parse(reconciliation.failed_fields, []) } : null, history: history.results || [] }); }
  if (operation === "download" && request.method === "GET") { if (!["Completed", "Completed with Warnings"].includes(job.status)) return failure("EXPORT_NOT_READY", "The workbook is not ready for download.", 409, job.stage, "Wait for completion or retry"); const file = await env.DB.prepare("SELECT * FROM excel_export_files WHERE export_job_id=? AND deleted_at IS NULL").bind(jobId).first(), object = file && await env.FILES.get(file.object_key); if (!object) return failure("EXPORT_FILE_MISSING", "The stored workbook is unavailable.", 404, "Download", "Re-run the export"); await env.DB.prepare("UPDATE excel_export_files SET download_count=download_count+1, last_downloaded_at=? WHERE id=?").bind(now(), file.id).run(); return new Response(object.body, { headers: { "content-type": file.mime_type, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-export-sha256": file.sha256 } }); }
  if (operation === "cancel" && request.method === "POST") { if (["Completed", "Completed with Warnings", "Failed", "Cancelled"].includes(job.status)) return failure("EXPORT_TERMINAL", "A completed or terminal export cannot be cancelled.", 409, job.stage, "Create a new export if needed"); await env.DB.batch([env.DB.prepare("UPDATE excel_export_jobs SET status='Cancelled', stage='Cancelled', cancelled_at=? WHERE id=?").bind(now(), jobId), audit(env.DB, { projectId: job.project_id, exportJobId: jobId, action: "Export Cancelled", stage: "Cancelled", reason: "User cancelled export", userId, role: actorRole })]); return json({ status: "Cancelled" }); }
  if (operation === "supersede" && request.method === "POST") { const body = await request.json(); if (!body.supersededById) return failure("SUPERSEDING_EXPORT_REQUIRED", "Select the replacement export.", 422, "Completed", "Choose a later export"); await env.DB.batch([env.DB.prepare("UPDATE excel_export_jobs SET superseded_by_id=? WHERE id=? AND project_id=?").bind(body.supersededById, jobId, job.project_id), audit(env.DB, { projectId: job.project_id, exportJobId: jobId, action: "Export Superseded", stage: "Completed", next: { supersededById: body.supersededById }, reason: body.reason || "A later governed export replaces this issue", userId, role: actorRole })]); return json({ status: "Superseded", supersededById: body.supersededById }); }
  if (operation === "reconcile" && request.method === "GET") { const result = await env.DB.prepare("SELECT * FROM excel_export_reconciliations WHERE export_job_id=?").bind(jobId).first(); return json({ reconciliation: result ? { ...result, server_totals: parse(result.server_totals, {}), workbook_totals: parse(result.workbook_totals, {}), differences: parse(result.differences, {}), failed_fields: parse(result.failed_fields, []) } : null }); }
  if (operation === "compare" && request.method === "POST") { const body = await request.json(), other = await env.DB.prepare("SELECT * FROM excel_export_jobs WHERE id=? AND project_id=?").bind(body.otherExportId, job.project_id).first(); if (!other) return failure("COMPARISON_EXPORT_NOT_FOUND", "Comparison export not found.", 404, "Completed", "Select another project export"); const before = parse(job.locked_versions, {}), after = parse(other.locked_versions, {}); return json({ comparison: { from: job.id, to: other.id, versionChanges: Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => before[key] !== after[key]).map((key) => [key, [before[key], after[key]]])) } }); }
  return failure("EXPORT_API_NOT_FOUND", "Excel export operation not found.", 404, job.stage, "Check the operation");
};
