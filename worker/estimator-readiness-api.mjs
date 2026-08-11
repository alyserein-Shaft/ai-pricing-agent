import { deriveEstimatorReadiness } from "../app/domain/estimator-row-readiness.mjs";
import { resolveApplicationContext } from "./application-context.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const projectAccess = (db, projectId, context) => db.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL WHERE p.id=? AND p.organization_id=? AND (p.owner_user_id=? OR m.id IS NOT NULL)`).bind(context.userId, projectId, context.organizationId, context.userId).first();

const readinessRows = async (db, projectId) => {
  const result = await db.prepare(`SELECT
    b.id boqItemId, b.row_type rowType, b.description, b.normalized_description normalizedDescription,
    b.numeric_quantity numericQuantity, b.original_unit originalUnit, b.normalized_unit normalizedUnit,
    b.system_value system, b.category, b.excluded_scope excludedScope, b.source_location sourceLocation,
    ui.status understandingStatus, ui.validated_interpretation understandingInterpretation,
    c.id candidateId, c.product_id productId, c.review_status candidateReviewStatus, c.confidence_score matchConfidence,
    c.confidence_state confidenceState, c.recommendation_tier recommendationTier, c.matching_basis matchBasis, c.mandatory_failures mandatoryFailures,
    p.part_number partNumber, m.name manufacturer, f.name productFamily,
    (SELECT e.cells FROM product_source_evidence e WHERE e.product_id=p.id ORDER BY e.created_at LIMIT 1) productSource,
    sd.safety_state safetyState, sd.technical_eligibility technicalEligibility,
    (SELECT a.status FROM safety_approval_requests a WHERE a.safety_decision_id=sd.id AND a.approval_type='Technical' ORDER BY a.decided_at DESC, a.id DESC LIMIT 1) technicalApprovalStatus,
    pl.id pricingLineId, pl.selected_price_record_id priceRecordId, pl.net_material_unit_minor unitCostMinor,
    CASE WHEN CAST(pl.quantity AS REAL)>0 THEN CAST(pl.net_selling_minor AS REAL)/CAST(pl.quantity AS REAL) END sellingUnitMinor,
    pl.net_selling_minor sellingTotalMinor, pl.project_currency currency,
    pr.approval_status priceApprovalStatus, pr.downstream_use priceDownstreamUse, pr.valid_until priceValidUntil, pr.source_location priceSource
  FROM boq_items b
  JOIN boq_extraction_versions ev ON ev.id=b.extraction_version_id AND ev.superseded_at IS NULL
  LEFT JOIN estimator_item_interpretations ui ON ui.boq_item_id=b.id AND ui.version_number=(SELECT MAX(ui2.version_number) FROM estimator_item_interpretations ui2 WHERE ui2.boq_item_id=b.id)
  LEFT JOIN product_match_runs mr ON mr.boq_item_id=b.id AND mr.superseded_at IS NULL AND mr.version_number=(SELECT MAX(mr2.version_number) FROM product_match_runs mr2 WHERE mr2.boq_item_id=b.id AND mr2.superseded_at IS NULL)
  LEFT JOIN product_match_candidates c ON c.match_run_id=mr.id AND c.rank=1 AND c.review_status<>'Rejected'
  LEFT JOIN library_products p ON p.id=c.product_id
  LEFT JOIN product_manufacturers m ON m.id=p.manufacturer_id
  LEFT JOIN product_families f ON f.id=p.family_id
  LEFT JOIN safety_decisions sd ON sd.candidate_id=c.id AND sd.superseded_at IS NULL AND sd.version_number=(SELECT MAX(sd2.version_number) FROM safety_decisions sd2 WHERE sd2.candidate_id=c.id AND sd2.superseded_at IS NULL)
  LEFT JOIN pricing_lines pl ON pl.id=(
    SELECT pl2.id FROM pricing_lines pl2
    JOIN pricing_runs pr2 ON pr2.id=pl2.pricing_run_id AND pr2.superseded_at IS NULL
    WHERE pl2.boq_item_id=b.id
    ORDER BY pr2.created_at DESC, pr2.version_number DESC, pl2.created_at DESC, pl2.id DESC LIMIT 1
  )
  LEFT JOIN price_records pr ON pr.id=pl.selected_price_record_id
  WHERE b.project_id=? AND (b.row_type IN ('Item','BOQ Item','Excluded') OR COALESCE(TRIM(b.excluded_scope),'')<>'')
  ORDER BY b.sequence, b.id`).bind(projectId).all();
  return (result.results || []).map((row) => ({ ...row, understandingAvailable: ["COMPLETED","NEEDS_REVIEW"].includes(row.understandingStatus) }));
};

export const handleEstimatorReadinessApi = async (request, env) => {
  const match = new URL(request.url).pathname.match(/^\/api\/projects\/([^/]+)\/estimator-readiness$/);
  if (!match) return null;
  if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for estimator readiness." } }, 405);
  if (!env.DB) return json({ error: { code: "ESTIMATOR_READINESS_UNAVAILABLE", message: "Estimator readiness storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const projectId = decodeURIComponent(match[1]);
  if (!(await projectAccess(env.DB, projectId, resolved.context))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
  return json(deriveEstimatorReadiness(await readinessRows(env.DB, projectId)));
};
