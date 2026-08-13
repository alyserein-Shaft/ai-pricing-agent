import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";

const CURRENT_PRICING_PREDICATE = `
  l.project_id=? AND r.scenario_id=? AND r.superseded_at IS NULL
  AND ${currentBoqItemPredicate("b")}
  AND l.approval_ready=1 AND l.status NOT IN ('Invalid','Expired','Rejected')
  AND r.version_number=(
    SELECT MAX(r2.version_number)
    FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
    WHERE r2.project_id=r.project_id AND r2.scenario_id=r.scenario_id
      AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id
  )`;

export async function loadCanonicalPricingTotals(db, { projectId, scenarioId, currency = "SAR" }) {
  if (!scenarioId) return { currency, costMinor: 0, subtotalMinor: 0, lineCount: 0, selectedScenarioId: null };
  const row = await db.prepare(`SELECT COALESCE(SUM(l.total_cost_minor),0) cost_minor,COALESCE(SUM(l.net_selling_minor),0) subtotal_minor,COUNT(*) lines
    FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id
    JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id
    WHERE ${CURRENT_PRICING_PREDICATE}`).bind(projectId, scenarioId).first();
  return { currency, costMinor: Number(row?.cost_minor || 0), subtotalMinor: Number(row?.subtotal_minor || 0), lineCount: Number(row?.lines || 0), selectedScenarioId: scenarioId };
}

export async function loadCanonicalPricingLine(db, { projectId, scenarioId, boqItemId }) {
  if (!scenarioId) return null;
  return db.prepare(`SELECT r.id runId,r.version_number runVersion,r.input_fingerprint,l.id lineId,l.version_number lineVersion,l.candidate_id candidateId,l.product_id productId,l.safety_decision_id safetyDecisionId,l.selected_price_record_id priceRecordId,l.total_cost_minor,l.net_selling_minor,l.final_value_minor,l.status lineStatus,l.approval_ready approvalReady,pr.approval_status priceApprovalStatus,pr.validity_state priceValidityState,pr.valid_until priceValidUntil,pr.reviewed_at priceReviewedAt
    FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id
    JOIN ${currentBoqEvidenceFrom("b")} ON b.id=l.boq_item_id
    LEFT JOIN price_records pr ON pr.id=l.selected_price_record_id
    WHERE ${CURRENT_PRICING_PREDICATE} AND l.boq_item_id=?
    LIMIT 1`).bind(projectId, scenarioId, boqItemId).first();
}
