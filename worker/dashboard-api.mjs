import { requireMigratedTables } from "./schema-requirements.mjs";
import { DASHBOARD_MODEL_VERSION, METRIC_REGISTRY, deriveProjectDashboard } from "../app/domain/dashboard-workflow-engine.mjs";
import { authenticateLibraryActor } from "./library-auth.mjs";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-dashboard-model-version": DASHBOARD_MODEL_VERSION, ...headers } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const bodyOf = async (request) => { try { return await request.json(); } catch { return {}; } };
const number = (row) => Number(row?.count || 0);
const one = async (db, sql, ...bindings) => { try { return number(await db.prepare(sql).bind(...bindings).first()); } catch (error) { if (String(error).includes("no such table")) return 0; throw error; } };

const resolveActiveOrganization = async (db, userId, requestedOrganizationId = "") => {
  const memberships = await db.prepare(`SELECT o.id,o.name,m.id membership_id,GROUP_CONCAT(CASE WHEN r.status='Active' AND r.revoked_at IS NULL THEN r.role END,'|') roles
    FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
    LEFT JOIN organization_membership_roles r ON r.membership_id=m.id
    WHERE m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL AND o.status='Active'
    GROUP BY o.id,o.name,m.id ORDER BY m.granted_at,m.id`).bind(userId).all();
  const rows = memberships.results || [];
  if (!rows.length) return { error: { status: 409, code: "NO_ACTIVE_ORGANIZATION", message: "An active organization membership is required." } };
  if (rows.length > 1) return { error: { status: 409, code: "ACTIVE_ORGANIZATION_AMBIGUOUS", message: "A durable active organization selection is required before loading the organization dashboard." } };
  const organization = { id: rows[0].id, name: rows[0].name, membershipId: rows[0].membership_id, roles: String(rows[0].roles || "").split("|").filter(Boolean) };
  if (requestedOrganizationId && requestedOrganizationId !== organization.id) return { error: { status: 403, code: "ORGANIZATION_ACCESS_DENIED", message: "The requested organization is not the active server-derived organization." } };
  // Organization roles establish the dashboard boundary; project visibility still
  // requires project ownership or an active project membership.
  return { organization, canSeeAllProjects: false };
};

const organizationProjects = async (db, userId, organization, canSeeAllProjects, search = "") => db.prepare(`SELECT p.*, dp.*, COALESCE(pm.role, CASE WHEN p.owner_user_id=? THEN 'Project Manager' END) role
  FROM projects p
  LEFT JOIN project_dashboard_profiles dp ON dp.project_id=p.id
  LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' AND pm.revoked_at IS NULL
  WHERE p.organization_id=? AND p.archived_at IS NULL AND dp.deleted_at IS NULL
    AND (?=1 OR p.owner_user_id=? OR pm.id IS NOT NULL)
    AND (?='' OR p.name LIKE ? OR COALESCE(dp.client,'') LIKE ? OR COALESCE(dp.tender_number,'') LIKE ?)
  ORDER BY p.updated_at DESC LIMIT 100`).bind(userId, userId, organization.id, canSeeAllProjects ? 1 : 0, userId, search, `%${search}%`, `%${search}%`, `%${search}%`).all();

const unassignedLegacyCount = async (db, userId) => one(db, `SELECT COUNT(DISTINCT p.id) count FROM projects p
  LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' AND pm.revoked_at IS NULL
  LEFT JOIN project_dashboard_profiles dp ON dp.project_id=p.id
  WHERE p.organization_id IS NULL AND p.archived_at IS NULL AND dp.deleted_at IS NULL AND (p.owner_user_id=? OR pm.id IS NOT NULL)`, userId, userId);

const DASHBOARD_SCHEMA_TABLES = ["projects", "project_members", "project_dashboard_profiles", "workflow_stage_states", "project_progress_snapshots", "dashboard_metric_definitions", "project_risks", "project_status_history", "dashboard_audit_log"];
let initialized = false;
const ensureSchema = async (db) => { if (initialized) return; await requireMigratedTables(db, DASHBOARD_SCHEMA_TABLES); await db.batch(METRIC_REGISTRY.map((metric) => db.prepare("INSERT OR IGNORE INTO dashboard_metric_definitions (id, version, name, description, scope, data_source, formula, filters, exclusions, refresh_strategy, permission, drill_down_route, owner, test_cases) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(metric.id, metric.version, metric.name, metric.description, metric.scope, metric.source, metric.formula, metric.filters, metric.exclusions, metric.refresh, metric.permission, metric.route, metric.owner, JSON.stringify([`${metric.id} reconciles with its detail route`])))); initialized = true; };

const access = async (db, projectId, userId) => db.prepare("SELECT p.*, dp.*, COALESCE(pm.role, CASE WHEN p.owner_user_id=? THEN 'Project Manager' END) role FROM projects p LEFT JOIN project_dashboard_profiles dp ON dp.project_id=p.id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' WHERE p.id=? AND dp.deleted_at IS NULL AND (p.owner_user_id=? OR pm.id IS NOT NULL)").bind(userId, userId, projectId, userId).first();

export const collectProjectFacts = async (db, projectId) => {
  const pricingAuthority = await db
    .prepare("SELECT selected_pricing_scenario_id FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL")
    .bind(projectId)
    .first();
  const selectedPricingScenarioId = pricingAuthority?.selected_pricing_scenario_id || null;

  const [documents, classified, processing, failedJobs, boqItems, extractionReview, specificationExtractions, requirementProfiles, requirementReview, matchedItems, technicalPending, technicalApproved, pricedItems, commercialPending, commercialApproved, finalReviewApproved, openClarifications, blockingClarifications, openSafetyBlocks, exportsCompleted, exportFailures] = await Promise.all([
    one(db, "SELECT COUNT(*) count FROM documents WHERE project_id=? AND archived_at IS NULL AND deleted_at IS NULL", projectId),
    one(db, "SELECT COUNT(DISTINCT d.id) count FROM documents d JOIN document_classifications c ON c.document_id=d.id AND c.superseded_at IS NULL WHERE d.project_id=? AND d.archived_at IS NULL AND d.deleted_at IS NULL AND c.status IN ('Classified','Confirmed','Manually Confirmed')", projectId),
    one(db, "SELECT COUNT(*) count FROM document_processing_runs r JOIN document_versions v ON v.id=r.document_version_id JOIN documents d ON d.id=v.document_id WHERE d.project_id=? AND d.current_version_id=v.id AND r.stage IN ('Intake','Classification') AND r.status IN ('Queued','Processing','Retrying','In Progress') AND NOT EXISTS (SELECT 1 FROM document_processing_runs newer WHERE newer.document_version_id=r.document_version_id AND newer.stage=r.stage AND (newer.created_at>r.created_at OR (newer.created_at=r.created_at AND newer.id>r.id)))", projectId),
    one(db, "SELECT COUNT(*) count FROM document_processing_runs r JOIN document_versions v ON v.id=r.document_version_id JOIN documents d ON d.id=v.document_id WHERE d.project_id=? AND d.current_version_id=v.id AND r.stage IN ('Intake','Classification') AND r.status='Failed' AND NOT EXISTS (SELECT 1 FROM document_processing_runs newer WHERE newer.document_version_id=r.document_version_id AND newer.stage=r.stage AND (newer.created_at>r.created_at OR (newer.created_at=r.created_at AND newer.id>r.id)))", projectId),
    one(db, "SELECT COUNT(*) count FROM boq_items b JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE b.project_id=? AND b.row_type IN ('Item','BOQ Item')", projectId),
    one(db, "SELECT COUNT(*) count FROM boq_items b JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE b.project_id=? AND b.row_type IN ('Item','BOQ Item') AND (b.review_status NOT IN ('Approved','Accepted') OR b.approved_for_downstream=0)", projectId),
    one(db, "SELECT COUNT(*) count FROM specification_extraction_versions s JOIN documents d ON d.id=s.document_id WHERE d.project_id=? AND s.superseded_at IS NULL AND s.status IN ('Completed','Needs Review')", projectId),
    one(db, "SELECT COUNT(DISTINCT p.boq_item_id) count FROM requirement_profile_versions p JOIN boq_items b ON b.id=p.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE p.project_id=? AND p.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item')", projectId),
    one(db, "SELECT COUNT(*) count FROM requirement_profile_versions p JOIN boq_items b ON b.id=p.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE p.project_id=? AND p.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item') AND (p.readiness_status NOT IN ('Ready for Matching','Ready with Warnings','Approved') OR p.approved_for_matching=0)", projectId),
    one(db, "SELECT COUNT(DISTINCT r.boq_item_id) count FROM product_match_runs r JOIN boq_items b ON b.id=r.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE r.project_id=? AND r.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item') AND r.candidate_count>0", projectId),
    one(db, `SELECT COUNT(*) count
FROM boq_items b
JOIN boq_extraction_versions e
  ON e.id=b.extraction_version_id
 AND e.superseded_at IS NULL
WHERE b.project_id=?
  AND b.row_type IN ('Item','BOQ Item')
  AND NOT EXISTS (
    SELECT 1
    FROM safety_decisions d
    WHERE d.boq_item_id=b.id
      AND d.superseded_at IS NULL
      AND (
        SELECT a.status
        FROM safety_approval_requests a
        WHERE a.safety_decision_id=d.id
          AND a.approval_type='Technical'
        ORDER BY a.decided_at DESC, a.id DESC
        LIMIT 1
      )='Approved'
  )`, projectId),
    one(db, `SELECT COUNT(DISTINCT d.boq_item_id) count
FROM safety_decisions d
JOIN boq_items b
  ON b.id=d.boq_item_id
 AND b.row_type IN ('Item','BOQ Item')
JOIN boq_extraction_versions e
  ON e.id=b.extraction_version_id
 AND e.superseded_at IS NULL
WHERE d.project_id=?
  AND d.superseded_at IS NULL
  AND (
    SELECT a.status
    FROM safety_approval_requests a
    WHERE a.safety_decision_id=d.id
      AND a.approval_type='Technical'
    ORDER BY a.decided_at DESC, a.id DESC
    LIMIT 1
  )='Approved'`, projectId),
    selectedPricingScenarioId ? one(db, "SELECT COUNT(DISTINCT l.boq_item_id) count FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id JOIN boq_items b ON b.id=l.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE l.project_id=? AND r.scenario_id=? AND r.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item') AND l.approval_ready=1 AND l.status NOT IN ('Invalid','Expired','Rejected') AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)", projectId, selectedPricingScenarioId) : 0,
    selectedPricingScenarioId ? one(db, `SELECT COUNT(DISTINCT l.boq_item_id) count
FROM pricing_lines l
JOIN pricing_runs r ON r.id=l.pricing_run_id
JOIN boq_items b ON b.id=l.boq_item_id AND b.row_type IN ('Item','BOQ Item')
JOIN boq_extraction_versions e
  ON e.id=b.extraction_version_id
 AND e.superseded_at IS NULL
WHERE l.project_id=?
  AND r.scenario_id=?
  AND r.superseded_at IS NULL
  AND l.approval_ready=1
  AND r.version_number=(
    SELECT MAX(r2.version_number)
    FROM pricing_runs r2
    JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
    WHERE r2.scenario_id=r.scenario_id
      AND r2.superseded_at IS NULL
      AND l2.boq_item_id=l.boq_item_id
  )
  AND COALESCE((
    SELECT a.status
    FROM pricing_approvals a
    WHERE a.pricing_run_id=l.pricing_run_id
      AND a.approval_type='Commercial Price'
    ORDER BY COALESCE(a.decided_at,a.created_at) DESC,
             a.created_at DESC,
             a.id DESC
    LIMIT 1
  ),'')<>'Approved'`, projectId, selectedPricingScenarioId) : 0,

    selectedPricingScenarioId ? one(db, `SELECT COUNT(DISTINCT l.boq_item_id) count
FROM pricing_lines l
JOIN pricing_runs r ON r.id=l.pricing_run_id
JOIN boq_items b ON b.id=l.boq_item_id AND b.row_type IN ('Item','BOQ Item')
JOIN boq_extraction_versions e
  ON e.id=b.extraction_version_id
 AND e.superseded_at IS NULL
WHERE l.project_id=?
  AND r.scenario_id=?
  AND r.superseded_at IS NULL
  AND l.approval_ready=1
  AND r.version_number=(
    SELECT MAX(r2.version_number)
    FROM pricing_runs r2
    JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id
    WHERE r2.scenario_id=r.scenario_id
      AND r2.superseded_at IS NULL
      AND l2.boq_item_id=l.boq_item_id
  )
  AND (
    SELECT a.status
    FROM pricing_approvals a
    WHERE a.pricing_run_id=l.pricing_run_id
      AND a.approval_type='Commercial Price'
    ORDER BY COALESCE(a.decided_at,a.created_at) DESC,
             a.created_at DESC,
             a.id DESC
    LIMIT 1
  )='Approved'`, projectId, selectedPricingScenarioId) : 0,

    one(db, "SELECT COUNT(DISTINCT b.id) count FROM boq_items b JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL JOIN review_queue_items q ON q.boq_item_id=b.id AND q.project_id=b.project_id AND q.review_type='Final Estimation Review' AND q.deleted_at IS NULL AND q.status IN ('Approved','Approved with Conditions') WHERE b.project_id=? AND b.row_type IN ('Item','BOQ Item')", projectId),
    one(db, "SELECT COUNT(*) count FROM review_clarifications c JOIN review_queue_items q ON q.id=c.review_item_id LEFT JOIN boq_items b ON b.id=q.boq_item_id LEFT JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE c.project_id=? AND c.status NOT IN ('Resolved','Cancelled') AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR (b.row_type IN ('Item','BOQ Item') AND e.id IS NOT NULL))", projectId),
    one(db, "SELECT COUNT(*) count FROM review_clarifications c JOIN review_queue_items q ON q.id=c.review_item_id LEFT JOIN boq_items b ON b.id=q.boq_item_id LEFT JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE c.project_id=? AND c.status NOT IN ('Resolved','Cancelled') AND q.deleted_at IS NULL AND q.blocking=1 AND (q.boq_item_id IS NULL OR (b.row_type IN ('Item','BOQ Item') AND e.id IS NOT NULL))", projectId),
    one(db, "SELECT COUNT(*) count FROM safety_blocks sb JOIN safety_decisions s ON s.id=sb.safety_decision_id JOIN boq_items b ON b.id=s.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE s.project_id=? AND s.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item') AND sb.status='Open'", projectId),
    one(db, "SELECT COUNT(*) count FROM excel_export_jobs WHERE project_id=? AND status IN ('Completed','Completed with Warnings') AND cancelled_at IS NULL", projectId),
    one(db, "SELECT COUNT(*) count FROM excel_export_jobs WHERE project_id=? AND status='Failed'", projectId),
  ]);
  return { documents, classified, processing, failedJobs, boqItems, extractionReview, specificationExtractions, requirementProfiles, requirementReview, matchedItems, technicalPending, technicalApproved, pricedItems, missingPrices: Math.max(0, boqItems - pricedItems), commercialPending, commercialApproved, finalReviewApproved, finalReviewPending: Math.max(0, boqItems - finalReviewApproved), openClarifications, blockingClarifications, openSafetyBlocks, exportsCompleted, exportFailures };
};

const pricingTotals = async (db, projectId) => {
  try {
    const authority = await db
      .prepare("SELECT selected_pricing_scenario_id,currency FROM project_dashboard_profiles WHERE project_id=? AND deleted_at IS NULL")
      .bind(projectId)
      .first();
    const scenarioId = authority?.selected_pricing_scenario_id || null;
    if (!scenarioId)
      return {
        currency: authority?.currency || "SAR",
        estimatedCost: 0,
        quotedValue: 0,
        averageMargin: 0,
        selectedScenarioId: null,
      };

    const row = await db
      .prepare("SELECT COALESCE(SUM(l.total_cost_minor),0) total_cost, COALESCE(SUM(l.net_selling_minor),0) quoted_value, COALESCE(AVG(l.margin_basis_points),0) margin FROM pricing_lines l JOIN pricing_runs r ON r.id=l.pricing_run_id JOIN boq_items b ON b.id=l.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE l.project_id=? AND r.scenario_id=? AND r.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item') AND l.approval_ready=1 AND l.status NOT IN ('Invalid','Expired','Rejected') AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=r.scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=l.boq_item_id)")
      .bind(projectId, scenarioId)
      .first();

    return {
      currency: authority?.currency || "SAR",
      estimatedCost: Number(row?.total_cost || 0) / 100,
      quotedValue: Number(row?.quoted_value || 0) / 100,
      averageMargin: Number(row?.margin || 0) / 100,
      selectedScenarioId: scenarioId,
    };
  } catch (error) {
    if (String(error).includes("no such table"))
      return {
        currency: "SAR",
        estimatedCost: 0,
        quotedValue: 0,
        averageMargin: 0,
        selectedScenarioId: null,
      };
    throw error;
  }
};
const sourceVersion = (project, facts) => `${project.updated_at || "0"}:${Object.values(facts).join(":")}`;
// The actor parameters are retained for forward-compatible snapshot attribution.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistSnapshot = async (db, dashboard, userId, role) => { const version = sourceVersion(dashboard.project, dashboard.facts), stamp = now(); const statements = [db.prepare("INSERT OR IGNORE INTO project_progress_snapshots (id, project_id, model_version, progress, derived_status, ready_for_quotation, facts, source_version, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("progress"), dashboard.project.id, DASHBOARD_MODEL_VERSION, dashboard.workflow.progress, dashboard.project.status, dashboard.workflow.ready ? 1 : 0, JSON.stringify(dashboard.facts), version, stamp), ...dashboard.workflow.stages.map((s) => db.prepare("INSERT OR IGNORE INTO workflow_stage_states (id, project_id, stage_id, model_version, status, progress, blocking_issue_count, warning_count, owner_role, next_action, drill_down_route, source_version, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("stage"), dashboard.project.id, s.id, DASHBOARD_MODEL_VERSION, s.status, s.progress, s.blockingIssues, s.warningCount, s.owner, s.nextAction, s.route, version, stamp)), ...dashboard.risks.map((r) => db.prepare("INSERT OR IGNORE INTO project_risks (id, project_id, risk_type, severity, trigger, impact, affected_module, recommended_action, owner, due_date, source, source_version, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("risk"), dashboard.project.id, r.type, r.severity, r.trigger, r.impact, r.module, r.recommendedAction, r.owner, r.dueDate, r.source, version, stamp))]; await db.batch(statements); };
const projectDashboard = async (db, project, userId) => { const facts = await collectProjectFacts(db, project.id), totals = await pricingTotals(db, project.id), normalized = { id: project.id, name: project.name, client: project.client, consultant: project.consultant, contractor: project.contractor, location: project.location, tenderNumber: project.tender_number, package: project.package_name, dueDate: project.due_date, currency: project.currency || "SAR", owner: project.owner_user_id, effectiveRole: project.role || null, organizationId: project.organization_id || null, systemDomain: project.system_domain || "Unspecified", initialStatus: project.initial_status || "Draft", manualStatus: project.manual_status, archivedAt: project.archived_at, updatedAt: project.updated_at }; const dashboard = deriveProjectDashboard({ facts, project: normalized, role: project.role || "No Project Permission", totals }); dashboard.project.systemDomain = normalized.systemDomain; dashboard.project.initialStatus = normalized.initialStatus; await persistSnapshot(db, dashboard, userId, project.role || "No Project Permission"); return dashboard; };
const audit = (db, projectId, action, previous, next, reason, user, role, request) => db.prepare("INSERT INTO dashboard_audit_log (id, project_id, action, previous_value, new_value, reason, actor_user_id, actor_role, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("dashboardaudit"), projectId, action, JSON.stringify(previous), JSON.stringify(next), reason, user.id, role, request.headers.get("x-request-id") || id("request"));

export const handleDashboardApi = async (request, env) => {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/dashboard") && !url.pathname.startsWith("/api/projects")) return null;
  const authentication = await authenticateLibraryActor(request, env); if (authentication.error) return json({ error: authentication.error }, authentication.error.status); const user = authentication.actor;
  await ensureSchema(env.DB);
  if (url.pathname === "/api/dashboard/metrics" && request.method === "GET") return json({ modelVersion: DASHBOARD_MODEL_VERSION, metrics: METRIC_REGISTRY });
  if (url.pathname === "/api/projects" && request.method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim(), active = await resolveActiveOrganization(env.DB, user.id, String(url.searchParams.get("organizationId") || ""));
    if (active.error) return json({ error: active.error }, active.error.status);
    const rows = await organizationProjects(env.DB, user.id, active.organization, active.canSeeAllProjects, q);
    const projects = await Promise.all((rows.results || []).map((project) => projectDashboard(env.DB, project, user.id))), legacyCount = await unassignedLegacyCount(env.DB, user.id);
    return json({ organization: active.organization, projects, state: projects.length ? "Projects Available" : q ? "No Search Results" : "No Organization Projects", query: q, unassignedLegacyProjects: { count: legacyCount, includedInMetrics: false }, pagination: { limit: 100, offset: 0, returned: projects.length }, updatedAt: now() });
  }
  if (url.pathname === "/api/projects" && request.method === "POST") {
    const active = await resolveActiveOrganization(env.DB, user.id, ""); if (active.error) return json({ error: active.error }, active.error.status);
    if (!active.organization.roles.some((role) => ["Organization Owner", "Organization Administrator"].includes(role))) return json({ error: { status: 403, code: "ORGANIZATION_PROJECT_CREATE_DENIED", message: "Organization Owner or Administrator permission is required." } }, 403);
    const body = await bodyOf(request), name = String(body.name || "").trim(), client = String(body.client || "").trim(), reference = String(body.reference || "").trim(), dueDate = String(body.dueDate || "").trim();
    const requestedSystem = String(body.system || "").trim();
    const systemDomain = requestedSystem === "Fire Detection & Alarm" ? "Fire Alarm" : requestedSystem;
    const initialStatus = String(body.status || "Draft").trim();
    if (name.length < 2) return json({ error: { status: 422, code: "PROJECT_NAME_REQUIRED", message: "A project name is required." } }, 422);
    if (!systemDomain) return json({ error: { status: 422, code: "PROJECT_SYSTEM_REQUIRED", message: "A project system/domain is required." } }, 422);
    if (initialStatus !== "Draft") return json({ error: { status: 422, code: "PROJECT_INITIAL_STATUS_INVALID", message: "New projects must begin in Draft status." } }, 422);
    const projectId = id("project"), stamp = now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(projectId, name, user.id, active.organization.id, systemDomain, initialStatus, stamp, stamp),
      env.DB.prepare("INSERT INTO project_dashboard_profiles (project_id,client,tender_number,due_date,currency,updated_by) VALUES (?,?,?,?,'SAR',?)").bind(projectId, client || null, reference || null, dueDate || null, user.id),
      audit(env.DB, projectId, "Project Created", null, { name, organizationId: active.organization.id, systemDomain, initialStatus }, "Created within the active server-derived organization", user, "Project Manager", request),
    ]);
    return json({ project: { id: projectId, name, organizationId: active.organization.id, ownerUserId: user.id, client: client || null, tenderNumber: reference || null, dueDate: dueDate || null, systemDomain, initialStatus, role: "Project Manager" }, organization: active.organization }, 201);
  }
  if (url.pathname === "/api/dashboard/organization" && request.method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim(), active = await resolveActiveOrganization(env.DB, user.id, String(url.searchParams.get("organizationId") || ""));
    if (active.error) return json({ error: active.error }, active.error.status);
    const allRows = await organizationProjects(env.DB, user.id, active.organization, active.canSeeAllProjects, ""), visibleRows = q ? await organizationProjects(env.DB, user.id, active.organization, active.canSeeAllProjects, q) : allRows;
    const allProjects = await Promise.all((allRows.results || []).map((project) => projectDashboard(env.DB, project, user.id))), projects = q ? await Promise.all((visibleRows.results || []).map((project) => projectDashboard(env.DB, project, user.id))) : allProjects, today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), commercial = allProjects.filter((p) => !p.commercialRestricted), legacyCount = await unassignedLegacyCount(env.DB, user.id);
    const metrics = { activeProjects: allProjects.length, projectsDueSoon: allProjects.filter((p) => p.project.dueDate && p.project.dueDate >= today && p.project.dueDate <= soon).length, projectsOverdue: allProjects.filter((p) => p.project.dueDate && p.project.dueDate < today).length, projectsBlocked: allProjects.filter((p) => p.risks.some((r) => r.severity === "Critical")).length, documentsProcessing: allProjects.reduce((s, p) => s + p.facts.processing, 0), failedProcessingJobs: allProjects.reduce((s, p) => s + p.facts.failedJobs, 0), reviewRequired: allProjects.reduce((s, p) => s + p.facts.technicalPending + p.facts.commercialPending, 0), missingPrices: allProjects.reduce((s, p) => s + p.facts.missingPrices, 0), readyForQuotation: allProjects.filter((p) => p.workflow.ready).length, estimatedCost: commercial.reduce((s, p) => s + (p.totals?.estimatedCost || 0), 0), quotedValue: commercial.reduce((s, p) => s + (p.totals?.quotedValue || 0), 0) };
    return json({ modelVersion: DASHBOARD_MODEL_VERSION, scope: "organization", organization: active.organization, state: projects.length ? "Projects Available" : q ? "No Search Results" : "No Organization Projects", query: q, metrics, projects, unassignedLegacyProjects: { count: legacyCount, includedInMetrics: false }, actionQueue: allProjects.flatMap((p) => p.actions).sort((a, b) => b.priority - a.priority).slice(0, 50), updatedAt: now(), refreshAfterMs: allProjects.some((p) => p.facts.processing) ? 5000 : 15000 });
  }
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/(dashboard|workflow|actions|risks|archive|restore|hold|resume|win|lose|cancel|owner|delete)$/); if (!match) return null;
  const projectId = decodeURIComponent(match[1]), operation = match[2], project = await access(env.DB, projectId, user.id); if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project was not found or is not available to this account." } }, 404); const role = project.role || "Estimator";
  if (request.method === "GET" && ["dashboard", "workflow", "actions", "risks"].includes(operation)) { const dashboard = await projectDashboard(env.DB, project, user.id); return json(operation === "dashboard" ? dashboard : { project: dashboard.project, [operation]: operation === "workflow" ? dashboard.workflow : dashboard[operation], updatedAt: dashboard.updatedAt }); }
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use the documented operation method." } }, 405);
  const body = await bodyOf(request), management = ["Project Manager", "Management", "Administrator"].includes(role); if (!management) return json({ error: { code: "PROJECT_CONTROL_PERMISSION_REQUIRED", message: "Project management permission is required." } }, 403); if (String(body.reason || "").trim().length < 5) return json({ error: { code: "REASON_REQUIRED", message: "Record a reason for this project control." } }, 422);
  if (["archive", "restore"].includes(operation)) { await env.DB.batch([env.DB.prepare(`UPDATE projects SET archived_at=${operation === "archive" ? "?" : "NULL"}, updated_at=? WHERE id=?`).bind(...(operation === "archive" ? [now(), now(), projectId] : [now(), projectId])), audit(env.DB, projectId, operation === "archive" ? "Project Archived" : "Project Restored", { archivedAt: project.archived_at }, { archivedAt: operation === "archive" ? now() : null }, body.reason, user, role, request)]); return json({ projectId, status: operation === "archive" ? "Archived" : "Restored" }); }
  if (["hold", "resume"].includes(operation)) { const next = operation === "hold" ? "On Hold" : null; await env.DB.batch([env.DB.prepare("INSERT INTO project_dashboard_profiles (project_id, currency, manual_status, status_reason, updated_by) VALUES (?, 'SAR', ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET manual_status=excluded.manual_status,status_reason=excluded.status_reason,status_version=status_version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(projectId, next, body.reason, user.id), audit(env.DB, projectId, operation === "hold" ? "Project Put On Hold" : "Project Resumed", { status: project.manual_status }, { status: next }, body.reason, user, role, request)]); return json({ projectId, manualStatus: next }); }
  if (["win", "lose", "cancel"].includes(operation)) { const next = operation === "win" ? "Won" : operation === "lose" ? "Lost" : "Cancelled"; await env.DB.batch([env.DB.prepare("INSERT INTO project_dashboard_profiles (project_id, currency, manual_status, status_reason, updated_by) VALUES (?, 'SAR', ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET manual_status=excluded.manual_status,status_reason=excluded.status_reason,status_version=status_version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(projectId, next, body.reason, user.id), audit(env.DB, projectId, `Project ${next}`, { status: project.manual_status }, { status: next }, body.reason, user, role, request)]); return json({ projectId, manualStatus: next }); }
  if (operation === "owner") { if (!body.ownerUserId) return json({ error: { code: "OWNER_REQUIRED", message: "Select a project owner." } }, 422); await env.DB.batch([env.DB.prepare("UPDATE projects SET owner_user_id=?,updated_at=? WHERE id=?").bind(body.ownerUserId, now(), projectId), audit(env.DB, projectId, "Project Owner Assigned", { owner: project.owner_user_id }, { owner: body.ownerUserId }, body.reason, user, role, request)]); return json({ projectId, ownerUserId: body.ownerUserId }); }
  if (operation === "delete") { const protectedCount = await one(env.DB, "SELECT (SELECT COUNT(*) FROM review_decisions WHERE project_id=?) + (SELECT COUNT(*) FROM excel_export_jobs WHERE project_id=? AND status IN ('Completed','Completed with Warnings')) count", projectId, projectId); if (protectedCount) return json({ error: { code: "PROJECT_DELETE_PROTECTED_HISTORY", message: "This project has protected approvals or completed exports. Archive it instead.", protectedRecords: protectedCount } }, 409); await env.DB.batch([env.DB.prepare("INSERT INTO project_dashboard_profiles (project_id,currency,updated_by,deleted_at,status_reason) VALUES (?,'SAR',?,?,?) ON CONFLICT(project_id) DO UPDATE SET deleted_at=excluded.deleted_at,status_reason=excluded.status_reason,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(projectId, user.id, now(), body.reason), audit(env.DB, projectId, "Project Soft Deleted", null, { deletedAt: now() }, body.reason, user, role, request)]); return json({ projectId, deleted: true }); }
  return json({ error: { code: "DASHBOARD_OPERATION_NOT_FOUND", message: "Project control not found." } }, 404);
};
