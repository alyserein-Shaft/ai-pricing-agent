import { calculateQuotationReadiness, calculateReviewPriority, canTransitionReview, summarizeReviews, validateBulkAction, validateDecision } from "../app/domain/review-workflow.mjs";
import { resolveApplicationContext } from "./application-context.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const roleFor = async (db, projectId, userId) => {
  const project = await db
    .prepare("SELECT owner_user_id FROM projects WHERE id=?")
    .bind(projectId)
    .first();

  if (!project) return null;
  if (project.owner_user_id === userId) return "Admin";

  const member = await db
    .prepare(
      "SELECT role FROM project_members WHERE project_id=? AND user_id=? AND status='Active' AND revoked_at IS NULL",
    )
    .bind(projectId, userId)
    .first();

  return member?.role || null;
};
const ownedProject = async (db, projectId, userId) => (await db.prepare("SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL WHERE p.id=? AND (p.owner_user_id=? OR m.id IS NOT NULL)").bind(userId, projectId, userId).first()) || null;
const error = (code, message, status, affectedItem, requiredAction) => json({ error: { code, message, technicalDetails: code, affectedItem, requiredAction, retryable: status >= 500 || status === 409, escalationAvailable: true } }, status);
const audit = (db, { projectId, reviewItemId = null, action, previous = null, next = null, reason, userId, role, version }) => db.prepare("INSERT INTO review_audit_log (id, project_id, review_item_id, action, previous_value, new_value, reason, actor_user_id, actor_role, request_id, entity_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("reviewaudit"), projectId, reviewItemId, action, JSON.stringify(previous), JSON.stringify(next), reason, userId, role, id("request"), version);

export const latestSafety = async (db, item) =>
  item.boq_item_id
    ? await db
        .prepare(
          "SELECT d.*, " +
          "CASE WHEN (" +
          "SELECT a.status FROM safety_approval_requests a " +
          "WHERE a.safety_decision_id=d.id " +
          "AND a.approval_type='Technical' " +
          "ORDER BY a.decided_at DESC, a.id DESC LIMIT 1" +
          ")='Approved' THEN 'Eligible' " +
          "ELSE d.technical_eligibility END AS technical_eligibility " +
          "FROM safety_decisions d " +
          "WHERE d.boq_item_id=? " +
          "AND d.superseded_at IS NULL " +
          "ORDER BY d.version_number DESC LIMIT 1",
        )
        .bind(item.boq_item_id)
        .first()
    : null;
const currentPricing = async (db, item) => item.boq_item_id ? await db.prepare("SELECT l.* FROM project_dashboard_profiles p JOIN pricing_runs r ON r.scenario_id=p.selected_pricing_scenario_id AND r.superseded_at IS NULL JOIN pricing_lines l ON l.pricing_run_id=r.id AND l.boq_item_id=? WHERE p.project_id=? AND p.deleted_at IS NULL ORDER BY r.version_number DESC LIMIT 1").bind(item.boq_item_id, item.project_id).first() : null;
export const technicalApproved = async (db, reviewItemId) => {
  const latest = await db
    .prepare(
      "SELECT outcome FROM review_decisions WHERE review_item_id=? AND decision_type='Approve Technical Match' ORDER BY decided_at DESC, id DESC LIMIT 1",
    )
    .bind(reviewItemId)
    .first();

  return ["Approved", "Approved with Conditions"].includes(latest?.outcome);
};

export const safetyTechnicalApproved = async (db, safetyDecisionId) => {
  if (!safetyDecisionId) return false;

  const latest = await db
    .prepare(
      "SELECT status FROM safety_approval_requests WHERE safety_decision_id=? AND approval_type='Technical' ORDER BY COALESCE(decided_at,created_at) DESC, created_at DESC, id DESC LIMIT 1",
    )
    .bind(safetyDecisionId)
    .first();

  return latest?.status === "Approved";
};
const dependencies = async (db, reviewItemId) => (await db.prepare("SELECT * FROM review_dependencies WHERE review_item_id=?").bind(reviewItemId).all()).results || [];

const createQueueFromExceptions = async (db, projectId, userId, role) => {
  const items = (
    await db
      .prepare(
        "SELECT b.id, b.description, b.extraction_confidence, b.review_status, b.updated_at " +
        "FROM boq_items b " +
        "JOIN boq_extraction_versions e ON e.id=b.extraction_version_id " +
        "WHERE b.project_id=? " +
        "AND e.superseded_at IS NULL " +
        "AND b.row_type IN ('Item','BOQ Item')",
      )
      .bind(projectId)
      .all()
  ).results || [];
  let created = 0;
  for (const boq of items) {
    const existing = await db.prepare("SELECT id, status FROM review_queue_items WHERE boq_item_id=? AND review_type='Final Estimation Review' AND deleted_at IS NULL AND status NOT IN ('Superseded','Cancelled')").bind(boq.id).first();
    const safety = await db.prepare("SELECT safety_state, technical_eligibility, confidence_level FROM safety_decisions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(boq.id).first();
    const pricing = await db.prepare("SELECT l.status, l.approval_ready, l.final_value_minor, l.margin_basis_points FROM project_dashboard_profiles p JOIN pricing_runs r ON r.scenario_id=p.selected_pricing_scenario_id AND r.superseded_at IS NULL JOIN pricing_lines l ON l.pricing_run_id=r.id AND l.boq_item_id=? WHERE p.project_id=? AND p.deleted_at IS NULL ORDER BY r.version_number DESC LIMIT 1").bind(boq.id, projectId).first();
    const blocking = !safety || safety.technical_eligibility !== "Eligible" || !pricing || !pricing.approval_ready;
    const priority = calculateReviewPriority({ safetyState: safety?.safety_state || "Blocked", severity: blocking ? "High" : "Medium", blocking, value: Number(pricing?.final_value_minor || 0) / 100, confidence: Number(boq.extraction_confidence || 0) });
    if (existing) { await db.prepare("UPDATE review_queue_items SET priority=?, priority_score=?, severity=?, blocking=?, safety_state=?, approval_level=?, updated_at=? WHERE id=?").bind(priority.priority, priority.score, blocking ? "High" : "Medium", blocking ? 1 : 0, safety?.safety_state || "Not Evaluated", blocking ? 2 : 1, now(), existing.id).run(); continue; }
    const reviewId = id("review");
    await db.batch([db.prepare("INSERT INTO review_queue_items (id, project_id, boq_item_id, review_type, priority, priority_score, severity, status, required_role, blocking, source_module, reason_for_review, required_decision, approval_level, safety_state, entity_version, version_number, created_by) VALUES (?, ?, ?, 'Final Estimation Review', ?, ?, ?, 'Open', 'Senior Technical Reviewer', ?, 'Safety and Pricing', ?, 'Technical then commercial approval', ?, ?, 1, 1, ?)").bind(reviewId, projectId, boq.id, priority.priority, priority.score, blocking ? "High" : "Medium", blocking ? 1 : 0, blocking ? "Safety or current pricing evidence requires review" : "Final governed estimation review is due", blocking ? 2 : 1, safety?.safety_state || "Not Evaluated", userId), audit(db, { projectId, reviewItemId: reviewId, action: "Review Created", next: { boqItemId: boq.id, priority: priority.priority }, reason: "Actionable BOQ exception synchronized", userId, role: role || "System", version: 1 })]); created++;
  }
  return created;
};

export const handleReviewWorkflowApi = async (request, env) => {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/reviews")) return null;
  if (!env.DB) return error("REVIEW_STORAGE_UNAVAILABLE", "Review storage is unavailable.", 503, null, "Retry after storage recovers");
  const resolved = await resolveApplicationContext(request, env); if (resolved.error) return json({ error: resolved.error }, resolved.error.status); const userId = resolved.context.userId;
  const projectRoute = url.pathname.match(/^\/api\/reviews\/projects\/([^/]+)\/(queue|sync|summary|readiness|bulk)$/);
  if (projectRoute) {
    const projectId = decodeURIComponent(projectRoute[1]), operation = projectRoute[2]; if (!(await ownedProject(env.DB, projectId, userId))) return error("PROJECT_NOT_FOUND", "Project not found.", 404, projectId, "Open an accessible project"); const role = await roleFor(env.DB, projectId, userId);
    if (operation === "sync" && request.method === "POST") { if (!role) return error("REVIEW_ROLE_REQUIRED", "An active project role is required.", 403, projectId, "Ask a project admin for access"); return json({ created: await createQueueFromExceptions(env.DB, projectId, userId, role) }, 201); }
    if (operation === "queue" && request.method === "GET") { const status = url.searchParams.get("status"), priority = url.searchParams.get("priority"), search = url.searchParams.get("search"), clauses = [
      "q.project_id=?",
      "q.deleted_at IS NULL",
      "(q.boq_item_id IS NULL OR EXISTS (SELECT 1 FROM boq_items active_b JOIN boq_extraction_versions active_e ON active_e.id=active_b.extraction_version_id AND active_e.superseded_at IS NULL WHERE active_b.id=q.boq_item_id AND active_b.row_type IN ('Item','BOQ Item')))",
    ], values = [projectId]; if (status) { clauses.push("q.status=?"); values.push(status); } if (priority) { clauses.push("q.priority=?"); values.push(priority); } if (search) { clauses.push("(q.reason_for_review LIKE ? OR b.description LIKE ?)"); values.push(`%${search}%`, `%${search}%`); } const rows = await env.DB.prepare(`SELECT q.*, b.description boq_description, b.item_number, b.original_unit, b.original_quantity FROM review_queue_items q LEFT JOIN boq_items b ON b.id=q.boq_item_id WHERE ${clauses.join(" AND ")} ORDER BY q.priority_score DESC, q.due_date, q.updated_at DESC`).bind(...values).all(); return json({ items: rows.results || [] }); }
    const items = (await env.DB.prepare("SELECT q.* FROM review_queue_items q WHERE q.project_id=? AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR EXISTS (SELECT 1 FROM boq_items b JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE b.id=q.boq_item_id AND b.row_type IN ('Item','BOQ Item')))").bind(projectId).all()).results || [], clarifications = (await env.DB.prepare("SELECT c.* FROM review_clarifications c JOIN review_queue_items q ON q.id=c.review_item_id WHERE c.project_id=? AND q.deleted_at IS NULL AND (q.boq_item_id IS NULL OR EXISTS (SELECT 1 FROM boq_items b JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE b.id=q.boq_item_id AND b.row_type IN ('Item','BOQ Item')))").bind(projectId).all()).results || [], blocks = Number((await env.DB.prepare("SELECT COUNT(*) count FROM safety_blocks sb JOIN safety_decisions d ON d.id=sb.safety_decision_id JOIN boq_items b ON b.id=d.boq_item_id JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE d.project_id=? AND d.superseded_at IS NULL AND b.row_type IN ('Item','BOQ Item') AND sb.status='Open'").bind(projectId).first())?.count || 0), pricingPending = Number((await env.DB.prepare("SELECT COUNT(*) count FROM boq_items b JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.superseded_at IS NULL WHERE b.project_id=? AND b.row_type IN ('Item','BOQ Item') AND NOT EXISTS (SELECT 1 FROM project_dashboard_profiles p JOIN pricing_runs r ON r.scenario_id=p.selected_pricing_scenario_id AND r.superseded_at IS NULL JOIN pricing_lines l ON l.pricing_run_id=r.id AND l.boq_item_id=b.id WHERE p.project_id=b.project_id AND p.deleted_at IS NULL AND r.version_number=(SELECT MAX(r2.version_number) FROM pricing_runs r2 JOIN pricing_lines l2 ON l2.pricing_run_id=r2.id WHERE r2.scenario_id=p.selected_pricing_scenario_id AND r2.superseded_at IS NULL AND l2.boq_item_id=b.id) AND l.approval_ready=1 AND l.status NOT IN ('Invalid','Expired','Rejected'))").bind(projectId).first())?.count || 0), readiness = calculateQuotationReadiness({ reviewItems: items.map((x) => ({ ...x, reviewType: x.review_type, dueDate: x.due_date })), clarifications, safetyBlocks: blocks, pricingPending });
    if (operation === "readiness" && request.method === "GET") return json({ readiness, serverComputed: true, safetyBlocks: blocks, pricingPending });
    if (operation === "summary" && request.method === "GET") return json({ summary: summarizeReviews(items.map((x) => ({ ...x, dueDate: x.due_date })), readiness), serverComputed: true });
    if (operation === "bulk" && request.method === "POST") { const body = await request.json(), ids = Array.isArray(body.reviewItemIds) ? body.reviewItemIds : []; if (!ids.length) return error("NO_REVIEW_ITEMS", "Select review items.", 422, projectId, "Select compatible items"); const placeholders = ids.map(() => "?").join(","), rows = (await env.DB.prepare(`SELECT * FROM review_queue_items WHERE project_id=? AND id IN (${placeholders})`).bind(projectId, ...ids).all()).results || [], validation = validateBulkAction(rows.map((x) => ({ safetyState: x.safety_state, approvalLevel: x.approval_level, reviewType: x.review_type, severity: x.severity, blocking: Boolean(x.blocking) }))); if (!validation.permitted) return error("INVALID_BULK_ACTION", `Bulk action blocked: ${validation.errors.join(", ")}.`, 409, projectId, "Review items individually"); if (body.action !== "Assign reviewer") return error("UNSUPPORTED_BULK_ACTION", "Only safe bulk assignment is currently permitted.", 422, projectId, "Choose Assign reviewer"); await env.DB.batch(rows.flatMap((row) => [env.DB.prepare("UPDATE review_queue_items SET assigned_reviewer_id=?, status='Assigned', version_number=version_number+1, updated_at=? WHERE id=?").bind(body.assigneeId, now(), row.id), audit(env.DB, { projectId, reviewItemId: row.id, action: "Bulk Assigned", previous: { assignee: row.assigned_reviewer_id }, next: { assignee: body.assigneeId }, reason: body.reason || "Safe bulk assignment", userId, role: role || "Unknown", version: Number(row.version_number) + 1 })])); return json({ updated: rows.length }); }
  }
  const itemRoute = url.pathname.match(/^\/api\/reviews\/([^/]+)(?:\/(assign|start|decision|comment|evidence|clarification|clarification-response|resolve-conflict|escalate|complete|reopen|history))?$/);
  if (!itemRoute) return error("REVIEW_API_NOT_FOUND", "Review operation not found.", 404, null, "Check the operation");
  const reviewId = decodeURIComponent(itemRoute[1]), operation = itemRoute[2] || "detail", item = await env.DB.prepare("SELECT q.*, b.description boq_description, b.item_number, b.original_unit, b.original_quantity, b.source_location, b.original_raw_values, b.current_values FROM review_queue_items q LEFT JOIN boq_items b ON b.id=q.boq_item_id WHERE q.id=? AND q.deleted_at IS NULL").bind(reviewId).first(); if (!item || !(await ownedProject(env.DB, item.project_id, userId))) return error("REVIEW_NOT_FOUND", "Review item not found.", 404, reviewId, "Refresh the review queue"); const role = await roleFor(env.DB, item.project_id, userId);
  if (operation === "detail" && request.method === "GET") { const [safety, pricing, deps, history, comments, clarifications, conditions, steps] = await Promise.all([latestSafety(env.DB, item), currentPricing(env.DB, item), dependencies(env.DB, reviewId), env.DB.prepare("SELECT * FROM review_audit_log WHERE review_item_id=? ORDER BY created_at DESC").bind(reviewId).all(), env.DB.prepare("SELECT * FROM review_comments WHERE review_item_id=? AND deleted_at IS NULL ORDER BY created_at").bind(reviewId).all(), env.DB.prepare("SELECT * FROM review_clarifications WHERE review_item_id=? ORDER BY created_at").bind(reviewId).all(), env.DB.prepare("SELECT * FROM review_approval_conditions WHERE review_item_id=? ORDER BY due_date").bind(reviewId).all(), env.DB.prepare("SELECT * FROM review_approval_steps WHERE review_item_id=? ORDER BY group_key, step_order").bind(reviewId).all()]); return json({ item, safety, pricing, dependencies: deps, history: history.results || [], comments: comments.results || [], clarifications: clarifications.results || [], conditions: conditions.results || [], approvalSteps: steps.results || [] }); }
  if (operation === "history" && request.method === "GET") return json({ history: (await env.DB.prepare("SELECT * FROM review_audit_log WHERE review_item_id=? ORDER BY created_at DESC").bind(reviewId).all()).results || [] });
  const body = request.method === "POST" ? await request.json() : {};
  if (!role) return error("REVIEW_ROLE_REQUIRED", "An active project role is required.", 403, reviewId, "Ask a project admin for access");
  if (Number(body.reviewVersion || item.version_number) !== Number(item.version_number)) return error("STALE_REVIEW_VERSION", "This review changed. Refresh before deciding.", 409, reviewId, "Refresh and revalidate");
  if (operation === "assign" && request.method === "POST") { if (!body.assigneeId || !body.role) return error("ASSIGNMENT_FIELDS_REQUIRED", "Assignee and role are required.", 422, reviewId, "Complete assignment fields"); await env.DB.batch([env.DB.prepare("UPDATE review_assignments SET ended_at=? WHERE review_item_id=? AND ended_at IS NULL").bind(now(), reviewId), env.DB.prepare("INSERT INTO review_assignments (id, review_item_id, assignee_id, role, assignment_type, team, due_date, sla_hours, assigned_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("assignment"), reviewId, body.assigneeId, body.role, body.assignmentType || "Primary", body.team || null, body.dueDate || null, body.slaHours || null, userId), env.DB.prepare("UPDATE review_queue_items SET assigned_reviewer_id=?, required_role=?, due_date=?, status='Assigned', version_number=version_number+1, updated_at=? WHERE id=?").bind(body.assigneeId, body.role, body.dueDate || null, now(), reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Review Assigned", previous: { assignee: item.assigned_reviewer_id }, next: { assignee: body.assigneeId, role: body.role }, reason: body.reason || "Review ownership assigned", userId, role, version: Number(item.version_number) + 1 })]); return json({ status: "Assigned", version: Number(item.version_number) + 1 }); }
  if (operation === "start" && request.method === "POST") { if (!canTransitionReview(item.status, "In Review")) return error("INVALID_REVIEW_TRANSITION", `Cannot start a review from ${item.status}.`, 409, reviewId, "Refresh status"); await env.DB.batch([env.DB.prepare("UPDATE review_queue_items SET status='In Review', version_number=version_number+1, updated_at=? WHERE id=?").bind(now(), reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Review Started", previous: { status: item.status }, next: { status: "In Review" }, reason: body.reason || "Reviewer opened current evidence", userId, role, version: Number(item.version_number) + 1 })]); return json({ status: "In Review", version: Number(item.version_number) + 1 }); }
  if (operation === "decision" && request.method === "POST") {
    const [safety, pricing, deps, tech] = await Promise.all([
      latestSafety(env.DB, item),
      currentPricing(env.DB, item),
      dependencies(env.DB, reviewId),
      technicalApproved(env.DB, reviewId),
    ]);

    const durableSafetyTechnicalApproval = await safetyTechnicalApproved(
      env.DB,
      safety?.id,
    );

    const validation = validateDecision({ review: { versionNumber: item.version_number }, decision: body, role, currentVersion: body.reviewVersion, safety: safety
        ? {
            technicalEligibility: durableSafetyTechnicalApproval
              ? "Eligible"
              : safety.technical_eligibility,
          }
        : { technicalEligibility: "Blocked" },
      technicalApproved:
        tech ||
        durableSafetyTechnicalApproval ||
        body.type === "Approve Technical Match", pricingReady: Boolean(pricing?.approval_ready), dependencies: deps, conditions: body.conditions || [] }); if (!validation.permitted) return error(validation.errors[0], `Decision blocked: ${validation.errors.join(", ")}.`, validation.errors.includes("STALE_REVIEW_VERSION") ? 409 : 422, reviewId, "Resolve the listed control and retry"); const newState = body.outcome || "In Review"; if (!canTransitionReview(item.status, newState) && item.status !== newState) return error("INVALID_REVIEW_TRANSITION", `Cannot move from ${item.status} to ${newState}.`, 409, reviewId, "Choose a valid outcome"); const decisionId = id("reviewdecision"), nextVersion = Number(item.version_number) + 1, statements = [env.DB.prepare("INSERT INTO review_decisions (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state, entity_version, review_version, safety_state, reason, notes, evidence, scope, conditions, expires_at, approval_level, decided_by, decided_role, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(decisionId, reviewId, item.project_id, body.type, newState, item.status, newState, item.entity_version, nextVersion, safety?.safety_state || item.safety_state, body.reason.trim(), body.notes || null, JSON.stringify(body.evidence || []), body.scope || "BOQ Item", JSON.stringify(body.conditions || []), body.expiresAt || null, item.approval_level, userId, role, id("request")), env.DB.prepare("UPDATE review_queue_items SET status=?, version_number=?, blocking=?, updated_at=?, closed_at=? WHERE id=?").bind(newState, nextVersion, ["Blocked", "Escalated"].includes(newState) ? 1 : 0, now(), ["Approved", "Rejected"].includes(newState) ? now() : null, reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: body.type, previous: { status: item.status }, next: { status: newState, decisionId }, reason: body.reason.trim(), userId, role, version: nextVersion })]; for (const condition of body.conditions || []) statements.push(env.DB.prepare("INSERT INTO review_approval_conditions (id, review_item_id, decision_id, description, risk, owner_id, due_date, verification_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("condition"), reviewId, decisionId, condition.description, condition.risk || "Documented", condition.owner, condition.dueDate, condition.verificationMethod || "Evidence review")); await env.DB.batch(statements); return json({ decisionId, status: newState, version: nextVersion }, 201); }
  if (operation === "comment" && request.method === "POST") { if (String(body.body || "").trim().length < 2) return error("COMMENT_REQUIRED", "Enter a comment.", 422, reviewId, "Add a comment"); const commentId = id("reviewcomment"); await env.DB.batch([env.DB.prepare("INSERT INTO review_comments (id, project_id, review_item_id, body, mentions, visibility, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(commentId, item.project_id, reviewId, body.body.trim(), JSON.stringify(body.mentions || []), body.visibility || "Project Team", userId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Comment Added", next: { commentId }, reason: "Review collaboration", userId, role, version: item.version_number })]); return json({ commentId }, 201); }
  if (operation === "evidence" && request.method === "POST") { if (!body.documentId || !body.label || !body.attachmentType) return error("EVIDENCE_FIELDS_REQUIRED", "Document, label and evidence type are required.", 422, reviewId, "Select stored evidence"); const attachmentId = id("reviewattachment"); await env.DB.batch([env.DB.prepare("INSERT INTO review_attachments (id, project_id, review_item_id, decision_id, document_id, attachment_type, label, access_level, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(attachmentId, item.project_id, reviewId, body.decisionId || null, body.documentId, body.attachmentType, body.label, body.accessLevel || "Project Team", userId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Evidence Added", next: { attachmentId, documentId: body.documentId }, reason: body.reason || "Decision evidence attached", userId, role, version: item.version_number })]); return json({ attachmentId }, 201); }
  if (operation === "clarification" && request.method === "POST") { if (String(body.question || "").trim().length < 10) return error("CLARIFICATION_QUESTION_REQUIRED", "Enter a complete clarification question.", 422, reviewId, "Add the question"); const clarificationId = id("clarification"); await env.DB.batch([env.DB.prepare("INSERT INTO review_clarifications (id, project_id, review_item_id, question, recipient, priority, due_date, status, affected_entities, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?)").bind(clarificationId, item.project_id, reviewId, body.question.trim(), body.recipient || null, body.priority || "Medium", body.dueDate || null, JSON.stringify(body.affectedEntities || []), userId), env.DB.prepare("UPDATE review_queue_items SET status='Waiting for Clarification', blocking=1, version_number=version_number+1, updated_at=? WHERE id=?").bind(now(), reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Clarification Created", next: { clarificationId }, reason: body.reason || "Missing information requires clarification", userId, role, version: Number(item.version_number) + 1 })]); return json({ clarificationId, status: "Draft" }, 201); }
  if (operation === "clarification-response" && request.method === "POST") { if (!body.clarificationId || String(body.response || "").trim().length < 2) return error("CLARIFICATION_RESPONSE_REQUIRED", "Select a clarification and record its response.", 422, reviewId, "Record response evidence"); await env.DB.batch([env.DB.prepare("UPDATE review_clarifications SET response=?, status=?, responded_at=?, resolved_by=?, resolved_at=? WHERE id=? AND review_item_id=?").bind(body.response.trim(), body.resolve ? "Resolved" : "Responded", now(), body.resolve ? userId : null, body.resolve ? now() : null, body.clarificationId, reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Clarification Response Recorded", next: { clarificationId: body.clarificationId, resolved: Boolean(body.resolve) }, reason: body.reason || "Clarification response reviewed", userId, role, version: item.version_number })]); return json({ status: body.resolve ? "Resolved" : "Responded", recalculationRequired: true }); }
  if (operation === "resolve-conflict" && request.method === "POST") { if (!body.conflictType || !body.resolution || String(body.reason || "").trim().length < 10 || !body.sourceA || !body.sourceB) return error("CONFLICT_RESOLUTION_EVIDENCE_REQUIRED", "Both sources, resolution and reason are required.", 422, reviewId, "Complete conflict evidence"); const conflictId = id("conflictresolution"); await env.DB.batch([env.DB.prepare("INSERT INTO review_conflict_resolutions (id, project_id, review_item_id, conflict_type, source_a, source_b, resolution, reason, exception_scope, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(conflictId, item.project_id, reviewId, body.conflictType, JSON.stringify(body.sourceA), JSON.stringify(body.sourceB), body.resolution, body.reason.trim(), body.exceptionScope || null, userId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Conflict Resolved", next: { conflictId, resolution: body.resolution }, reason: body.reason.trim(), userId, role, version: item.version_number })]); return json({ conflictId }, 201); }
  if (operation === "escalate" && request.method === "POST") { if (String(body.reason || "").trim().length < 10) return error("ESCALATION_REASON_REQUIRED", "Provide an escalation reason.", 422, reviewId, "Explain the risk and required decision"); await env.DB.batch([env.DB.prepare("UPDATE review_queue_items SET status='Escalated', escalation_status='Active', blocking=1, version_number=version_number+1, updated_at=? WHERE id=?").bind(now(), reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Review Escalated", previous: { status: item.status }, next: { status: "Escalated", targetRole: body.targetRole }, reason: body.reason.trim(), userId, role, version: Number(item.version_number) + 1 })]); return json({ status: "Escalated", version: Number(item.version_number) + 1 }); }
  if (operation === "complete" && request.method === "POST") { const deps = await dependencies(env.DB, reviewId), openConditions = Number((await env.DB.prepare("SELECT COUNT(*) count FROM review_approval_conditions WHERE review_item_id=? AND status!='Closed'").bind(reviewId).first())?.count || 0); if (deps.some((x) => x.blocking && x.status !== "Completed") || openConditions || !["Approved", "Rejected"].includes(item.status)) return error("REVIEW_COMPLETION_BLOCKED", "Required decisions, dependencies or conditions remain open.", 409, reviewId, "Resolve all blocking records"); return json({ status: item.status, complete: true }); }
  if (operation === "reopen" && request.method === "POST") { if (!["Approved", "Rejected", "Cancelled"].includes(item.status)) return error("REVIEW_NOT_CLOSED", "Only closed reviews can be reopened.", 409, reviewId, "Refresh status"); await env.DB.batch([env.DB.prepare("UPDATE review_queue_items SET status='Open', closed_at=NULL, version_number=version_number+1, updated_at=? WHERE id=?").bind(now(), reviewId), audit(env.DB, { projectId: item.project_id, reviewItemId: reviewId, action: "Review Reopened", previous: { status: item.status }, next: { status: "Open" }, reason: body.reason || "Review reopened for new evidence", userId, role, version: Number(item.version_number) + 1 })]); return json({ status: "Open", version: Number(item.version_number) + 1 }); }
  return error("REVIEW_API_NOT_FOUND", "Review operation not found.", 404, reviewId, "Check the operation");
};
