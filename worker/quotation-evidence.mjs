import { QUOTATION_AUTHORITY_VERSION, quotationEvidenceFingerprint } from "../app/domain/quotation-authority.mjs";
import { loadCanonicalPricingLine } from "./pricing-authority.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";

const rows = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];

// Same Fire Alarm domain test the quotation-line authority uses, so the manifest
// and the line gate can never disagree about whether panel sizing is required.
const FIRE_ALARM_DOMAIN = /fire\s*alarm/i;

/**
 * The panel-sizing authority a Fire Alarm quotation rests on.
 *
 * `projectPanelSizingBlockers` in worker/quotation-line-authority.mjs decides
 * whether a Fire Alarm project may be quoted at all, but that verdict was not
 * part of the evidence manifest, so it was invisible to the export freshness
 * gate: producing, superseding or never producing a panel-sizing snapshot could
 * not invalidate an export, and an approved Fire Alarm architecture could change
 * after approval while the export kept carrying the old panel authority.
 *
 * `fire_alarm_panel_sizing_snapshots` is append-only with BEFORE UPDATE/DELETE
 * abort triggers, so the head row's identity fully determines the sizing that
 * was approved and carrying that identity is sufficient. Absence is reported,
 * never papered over: an environment whose chain predates the table reports
 * sourceAvailable=false rather than silently behaving as if no authority were
 * needed.
 */
async function loadPanelSizingAuthority(db, project) {
  const required = FIRE_ALARM_DOMAIN.test(String(project?.system_domain || ""));
  if (!required) return { required: false, sourceAvailable: true, current: null };
  try {
    const current = await db
      .prepare(
        "SELECT id,version_number,status,input_fingerprint,engine_version,created_at FROM fire_alarm_panel_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1",
      )
      .bind(project.id)
      .first();
    return { required: true, sourceAvailable: true, current: current || null };
  } catch (error) {
    if (String(error).includes("no such table")) {
      return { required: true, sourceAvailable: false, current: null };
    }
    throw error;
  }
}

export async function buildQuotationEvidenceManifest(db, projectId) {
  const project = await db.prepare("SELECT id,name,organization_id,system_domain,initial_status,updated_at FROM projects WHERE id=? AND archived_at IS NULL").bind(projectId).first();
  if (!project) throw Object.assign(new Error("Project not found."), { code: "PROJECT_NOT_FOUND" });
  const profile = await db.prepare("SELECT selected_pricing_scenario_id,currency FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL").bind(projectId).first();
  const scenario = profile?.selected_pricing_scenario_id ? await db.prepare("SELECT id,version_number,project_currency,status FROM pricing_scenarios WHERE id=? AND project_id=? AND superseded_at IS NULL AND deleted_at IS NULL").bind(profile.selected_pricing_scenario_id, projectId).first() : null;
  const boq = await rows(db, `SELECT b.id itemId,b.extraction_version_id extractionVersionId,b.evidence_extraction_version extractionVersion,b.updated_at itemUpdatedAt
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.project_id=? AND ${currentBoqItemPredicate("b")} ORDER BY b.id`, projectId);
  const items = [];
  for (const item of boq) {
    const requirement = await db.prepare("SELECT id,version_number,input_fingerprint FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(item.itemId).first();
    const match = await db.prepare("SELECT id,version_number,input_fingerprint FROM product_match_runs WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(item.itemId).first();
    const safety = await db.prepare(`SELECT s.id,s.version_number,s.input_fingerprint,s.candidate_id candidateId,c.product_id productId,p.updated_at productUpdatedAt,p.review_status productReviewStatus,p.lifecycle_status lifecycleStatus
      FROM safety_decisions s LEFT JOIN product_match_candidates c ON c.id=s.candidate_id LEFT JOIN library_products p ON p.id=c.product_id
      WHERE s.boq_item_id=? AND s.superseded_at IS NULL ORDER BY s.version_number DESC LIMIT 1`).bind(item.itemId).first();
    const technicalApproval = safety ? await db.prepare("SELECT id,entity_version,status,decided_at FROM safety_approval_requests WHERE safety_decision_id=? AND approval_type='Technical' ORDER BY COALESCE(decided_at,created_at) DESC,id DESC LIMIT 1").bind(safety.id).first() : null;
    const pricing = scenario ? await loadCanonicalPricingLine(db, { projectId, scenarioId: scenario.id, boqItemId: item.itemId }) : null;
    const commercialApproval = pricing ? await db.prepare("SELECT id,entity_version,status,decided_at FROM pricing_approvals WHERE pricing_run_id=? AND approval_type='Commercial Price' ORDER BY COALESCE(decided_at,created_at) DESC,id DESC LIMIT 1").bind(pricing.runId).first() : null;
    const finalReview = await db.prepare(`SELECT q.id reviewId,q.version_number reviewVersion,q.status,d.id decisionId,d.entity_version decisionVersion,d.outcome,d.decided_at
      FROM review_queue_items q LEFT JOIN review_decisions d ON d.id=(SELECT d2.id FROM review_decisions d2 WHERE d2.review_item_id=q.id ORDER BY d2.decided_at DESC,d2.id DESC LIMIT 1)
      WHERE q.project_id=? AND q.boq_item_id=? AND q.review_type='Final Estimation Review' AND q.deleted_at IS NULL ORDER BY q.updated_at DESC LIMIT 1`).bind(projectId, item.itemId).first();
    items.push({ ...item, requirement: requirement || null, match: match || null, safety: safety || null, technicalApproval: technicalApproval || null, pricing: pricing || null, commercialApproval: commercialApproval || null, finalReview: finalReview || null });
  }
  const manifest = { authorityVersion: QUOTATION_AUTHORITY_VERSION, project, selectedPricingScenario: scenario || null, currency: scenario?.project_currency || profile?.currency || "SAR", panelSizingAuthority: await loadPanelSizingAuthority(db, project), items };
  return { manifest, fingerprint: await quotationEvidenceFingerprint(manifest) };
}
