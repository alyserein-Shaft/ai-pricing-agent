import { createHash } from "node:crypto";
import { resolveApplicationContext } from "./application-context.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate, currentBoqEvidenceCounts } from "./current-evidence-scope.mjs";
import { sanitizePilotSourceLocation } from "../app/domain/boq-understanding-pilot.mjs";
import { resolveEffectiveUnderstandingInterpretation } from "./effective-understanding-interpretation.mjs";
import {
  buildUnderstandingReviewActionPolicy, buildUnderstandingReviewLayers, evaluateUnderstandingAuthority, sanitizeReviewedInterpretation,
  summarizeUnderstandingReviewItems, understandingReviewRequestFingerprint,
  validateUnderstandingForApproval, validateUnderstandingReviewCommand,
} from "../app/domain/estimator-understanding-review.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const parse = (value, fallback = null) => { try { return value == null ? fallback : (typeof value === "string" ? JSON.parse(value) : value); } catch { return fallback; } };
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
const reviewKey = (itemId) => digest(`understanding-review:${itemId}`).slice(0, 28);
const requestFingerprint = (command) => digest(understandingReviewRequestFingerprint(command));
export const understandingReviewSelectionAuthority = (projectId, row) => digest(JSON.stringify({
  projectId,
  boqItemId: row.boqItemId,
  interpretationId: row.effective?.selected?.interpretationId || null,
  interpretationVersion: Number(row.effective?.selected?.versionNumber || 0),
  reviewVersion: Number(row.reviewVersion || 0),
  inputFingerprint: row.effective?.currentInputFingerprint || null,
  evidenceDocumentVersionId: row.evidenceDocumentVersionId || null,
  evidenceExtractionVersion: row.evidenceExtractionVersion || null,
}));
const ENGINEER_ROLES = new Set(["Admin", "Administrator", "Project Manager", "Technical Manager", "Technical Reviewer"]);
const access = (db, projectId, context) => db.prepare(`SELECT p.id,COALESCE(m.role,CASE WHEN p.owner_user_id=? THEN 'Project Manager' END) role FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL WHERE p.id=? AND p.organization_id=? AND (p.owner_user_id=? OR m.id IS NOT NULL)`).bind(context.userId, context.userId, projectId, context.organizationId, context.userId).first();

export const loadUnderstandingReviewRows = async (db, projectId) => {
  const result = await db.prepare(`SELECT b.id boqItemId,b.item_number itemReference,b.row_type rowType,b.description,b.numeric_quantity numericQuantity,b.original_quantity originalQuantity,b.normalized_unit normalizedUnit,b.original_unit originalUnit,b.system_value sourceSystem,b.category sourceCategory,b.subcategory sourceSubcategory,b.manufacturer,b.model sourceModel,b.part_number sourcePartNumber,b.current_values currentValues,b.source_location sourceLocation,b.review_status extractionReviewStatus,b.approved_for_downstream extractionApproved,b.evidence_document_version_id evidenceDocumentVersionId,b.evidence_extraction_version evidenceExtractionVersion,
    r.id reviewVersionId,r.interpretation_id reviewInterpretationId,r.source_input_fingerprint reviewInputFingerprint,r.version_number reviewVersion,r.review_status reviewStatus,r.canonical_interpretation canonicalInterpretation,r.created_at reviewedAt,r.review_reason reviewReason
    FROM ${currentBoqEvidenceFrom("b")}
    LEFT JOIN estimator_understanding_review_versions r ON r.boq_item_id=b.id AND NOT EXISTS (SELECT 1 FROM estimator_understanding_review_versions r2 WHERE r2.boq_item_id=r.boq_item_id AND r2.version_number>r.version_number)
    WHERE b.project_id=? AND ${currentBoqItemPredicate("b")} ORDER BY b.sequence,b.id`).bind(projectId).all();
  const interpretations = await db.prepare(`SELECT i.id interpretationId,i.boq_item_id boqItemId,i.run_id runId,i.version_number versionNumber,i.input_fingerprint inputFingerprint,i.config_fingerprint configFingerprint,i.status,i.validated_interpretation interpretation,i.error_code errorCode,i.model,i.raw_response usageMetadata,i.created_at createdAt,r.run_mode runMode,r.parent_run_id parentRunId
    FROM estimator_item_interpretations i JOIN estimator_understanding_runs r ON r.id=i.run_id WHERE i.project_id=? ORDER BY i.version_number DESC,i.created_at DESC,i.id DESC`).bind(projectId).all();
  const byItem = new Map();
  for (const interpretation of interpretations.results || []) byItem.set(interpretation.boqItemId, [...(byItem.get(interpretation.boqItemId) || []), interpretation]);
  return (result.results || []).map((row) => {
    const effective = resolveEffectiveUnderstandingInterpretation(row, byItem.get(row.boqItemId) || [], parse(row.sourceLocation, null));
    const selected = effective.selected;
    return { ...row, effective, interpretationId: selected?.interpretationId || null, runId: selected?.runId || null, interpretationVersion: selected?.versionNumber || null, inputFingerprint: selected?.inputFingerprint || null, interpretationStatus: selected?.status || null, interpretation: selected?.interpretation || null, errorCode: selected?.errorCode || null, model: selected?.model || null, usageMetadata: selected?.usageMetadata || null, interpretedAt: selected?.createdAt || null };
  });
};

const taxonomyValidFor = (row) => row.effective?.state === "AVAILABLE" && (
  row.effective?.classification?.system !== "Fire Alarm" || row.effective?.taxonomy?.acceptedCandidate
);

export const safeUnderstandingReviewItem = (row, { actorAuthorized = true } = {}) => {
  const quality = row.effective?.quality || null;
  const reviewMatchesEffective = Boolean(row.reviewVersionId && row.interpretationId && row.reviewInterpretationId === row.interpretationId && row.reviewInputFingerprint === row.effective?.currentInputFingerprint);
  const latestAttempt = row.effective?.latestCurrentAttempt || null;
  const reviewStatus = row.effective?.state === "AVAILABLE"
    ? (reviewMatchesEffective ? row.reviewStatus : "AWAITING_REVIEW")
    : latestAttempt?.status === "FAILED" ? "FAILED" : "NOT_ANALYZED";
  const source = sanitizePilotSourceLocation(parse(row.sourceLocation, {}));
  const layers = buildUnderstandingReviewLayers(
    row.effective?.proposal,
    parse(row.canonicalInterpretation, null),
    { hasVersion: reviewMatchesEffective, status: reviewStatus, version: Number(row.reviewVersion || 0) },
  );
  const proposalClassification = row.effective?.classification || layers.proposalClassification;
  const proposalState = row.effective?.state === "AVAILABLE" ? "AVAILABLE" : reviewStatus === "FAILED" ? "FAILED" : "UNAVAILABLE_OR_STALE";
  const authority = evaluateUnderstandingAuthority({ interpretation: row.effective?.proposal, reviewStatus, taxonomyValid: taxonomyValidFor(row) });
  const actionPolicy = buildUnderstandingReviewActionPolicy({
    reviewStatus,
    proposalState,
    classificationBlockers: authority.classificationBlockers,
    taxonomyValid: taxonomyValidFor(row),
    authorityValid: row.effective?.state === "AVAILABLE" && (!row.reviewVersionId || reviewMatchesEffective),
    actorAuthorized,
  });
  return {
    reviewKey: reviewKey(row.boqItemId), itemReference: row.itemReference || null, description: row.description || "",
    quantity: row.numericQuantity ?? row.originalQuantity ?? null, unit: row.normalizedUnit || row.originalUnit || null, source,
    extractionReview: { status: row.extractionReviewStatus, confirmedForDownstream: Boolean(row.extractionApproved) },
    aiAttempted: Boolean(latestAttempt),
    ai: row.interpretationId ? { status: row.interpretationStatus, confidence: layers.aiProposal?.confidence || "LOW", qualityStatus: quality?.finalStatus || row.interpretationStatus, model: row.model, interpretedAt: row.interpretedAt }
      : latestAttempt ? { status: latestAttempt.status, confidence: "Unavailable", qualityStatus: latestAttempt.status, model: latestAttempt.model, interpretedAt: latestAttempt.createdAt } : null,
    review: { status: reviewStatus, version: Number(row.reviewVersion || 0), hasVersion: Boolean(row.reviewVersionId), matchesEffectiveInterpretation: reviewMatchesEffective, reason: row.reviewReason || null, reviewedAt: row.reviewedAt || null },
    aiProposal: layers.aiProposal, canonicalReview: layers.canonicalReview, classification: proposalClassification,
    reviewReasons: quality?.reviewReasons || [],
    classificationBlockers: authority.classificationBlockers,
    matchingBlockers: authority.matchingBlockers,
    laterProjectEvidenceNeeded: authority.laterProjectEvidenceNeeded,
    blockingMissingFields: authority.classificationBlockers.map((entry) => entry.field),
    informationalMissingFields: [...authority.informationalMissing.map((entry) => entry.field), ...(quality?.informationalMissingFields || []).filter((field) => field !== "subcategory")],
    understandingApprovalEligible: authority.understandingApprovalEligible,
    discoveryReadiness: authority.discoveryReadiness,
    technicalMatchReadiness: authority.technicalMatchReadiness,
    governedAttributeProfile: authority.profile,
    provenanceSummary: quality?.provenanceSummary || null,
    governedTaxonomy: row.effective?.taxonomy || { version: null, candidateAvailable: false, acceptedCandidate: false, category: null, productFamily: null },
    proposalState,
    ...actionPolicy,
    discovery: row.effective?.state === "AVAILABLE" && (!row.reviewVersionId || reviewMatchesEffective)
      ? authority.discoveryReadiness
      : { state: "BLOCKED_STALE", eligible: false, label: "Current AI understanding requires engineer review before product discovery", missingConstraints: [] },
  };
};

const matchesFilter = (item, query) => {
  const status = query.get("status") || "All";
  const classification = query.get("classification") || "All";
  const search = (query.get("q") || "").trim().toLowerCase();
  if (status !== "All" && item.review.status !== status) return false;
  if (classification === "Missing essential classification" && !item.blockingMissingFields.some((value) => ["system", "category", "equipmentType", "productFamily"].some((field) => value === field || value.startsWith(`${field}.`)))) return false;
  if (classification === "Missing matching attributes" && !item.matchingBlockers.some((entry) => entry.field.startsWith("attributes."))) return false;
  if (classification === "Governed Fire Alarm" && item.classification?.system !== "Fire Alarm") return false;
  if (classification === "Exploratory systems" && (!item.ai || item.classification?.system === "Fire Alarm")) return false;
  return !search || `${item.itemReference || ""} ${item.description}`.toLowerCase().includes(search);
};

const listReview = async (db, projectId, url) => {
  const rows = await loadUnderstandingReviewRows(db, projectId);
  const items = rows.map((row) => safeUnderstandingReviewItem(row));
  const latestRun = await db.prepare(`SELECT model,run_mode runMode,status,started_at startedAt,completed_at completedAt FROM estimator_understanding_runs WHERE project_id=? ORDER BY started_at DESC,id DESC LIMIT 1`).bind(projectId).first();
  const extraction = await currentBoqEvidenceCounts(db, { projectId });
  return {
    summary: { ...summarizeUnderstandingReviewItems(items), extractionConfirmed: extraction.extractionConfirmed, extractionNeedsReview: extraction.extractionNeedsReview },
    currentRun: latestRun || null,
    items: items.filter((item) => matchesFilter(item, url.searchParams)),
    totalFiltered: items.filter((item) => matchesFilter(item, url.searchParams)).length,
    safeguards: { bulkApproval: false, matchingStarted: false, pricingStarted: false, rawProviderDataExposed: false },
  };
};

const resolveCurrent = async (db, projectId, requestedKey) => (await loadUnderstandingReviewRows(db, projectId)).find((row) => reviewKey(row.boqItemId) === requestedKey) || null;

const detail = async (db, projectId, row) => {
  const base = safeUnderstandingReviewItem(row);
  const versions = await db.prepare(`SELECT i.version_number version,i.status,i.model,i.created_at createdAt,i.raw_response usageMetadata,r.run_mode runMode,r.started_at runStartedAt,CASE WHEN r.parent_run_id IS NULL THEN 0 ELSE 1 END hasParentRun
    FROM estimator_item_interpretations i JOIN estimator_understanding_runs r ON r.id=i.run_id WHERE i.boq_item_id=? ORDER BY i.version_number DESC`).bind(row.boqItemId).all();
  const events = await db.prepare(`SELECT e.action,e.previous_status previousStatus,e.new_status newStatus,e.reason,e.created_at createdAt FROM estimator_understanding_review_events e WHERE e.boq_item_id=? ORDER BY e.created_at DESC,e.id DESC`).bind(row.boqItemId).all();
  return { ...base, selectionAuthority: understandingReviewSelectionAuthority(projectId, row), authoritativeEvidence: { reviewKey: base.reviewKey, itemReference: base.itemReference, description: base.description, quantity: base.quantity, unit: base.unit, source: base.source }, interpretationHistory: (versions.results || []).map((version) => ({ version: version.version, status: version.status, model: version.model, createdAt: version.createdAt, runMode: version.runMode, hasParentRun: Boolean(version.hasParentRun), usage: (() => { const raw = parse(version.usageMetadata, {}); const usage = raw?.usage || {}; return { durationMs: Number.isFinite(Number(usage.durationMs)) ? Number(usage.durationMs) : null, promptTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null, completionTokens: Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null }; })() })), reviewHistory: events.results || [], missingSpecificationChecklist: [...new Set([...base.classificationBlockers, ...base.matchingBlockers, ...base.laterProjectEvidenceNeeded, ...base.informationalMissingFields].map((entry) => typeof entry === "string" ? entry : entry.field))].slice(0, 24) };
};

export const mutateUnderstandingReview = async (db, context, projectId, row, command) => {
  const existingEvent = await db.prepare(`SELECT request_fingerprint requestFingerprint,review_version_id reviewVersionId FROM estimator_understanding_review_events WHERE project_id=? AND request_id=?`).bind(projectId, command.requestId).first();
  const incomingFingerprint = requestFingerprint(command);
  if (existingEvent) return existingEvent.requestFingerprint === incomingFingerprint
    ? { idempotent: true, review: safeUnderstandingReviewItem(await resolveCurrent(db, projectId, reviewKey(row.boqItemId))).review }
    : { error: "UNDERSTANDING_REVIEW_IDEMPOTENCY_CONFLICT", status: 409 };
  if (command.selectionAuthority !== understandingReviewSelectionAuthority(projectId, row)) return { error: "UNDERSTANDING_REVIEW_SELECTION_STALE", status: 409 };
  const actualVersion = Number(row.reviewVersion || 0);
  if (actualVersion !== command.expectedVersion) return { error: "UNDERSTANDING_REVIEW_STALE", status: 409 };
  const currentItem = safeUnderstandingReviewItem(row, { actorAuthorized: true });
  if (!currentItem.allowedActions.includes(command.action)) return {
    error: currentItem.denialReasons[command.action] || "UNDERSTANDING_INTERPRETATION_NOT_REVIEWABLE",
    status: 409,
    missing: currentItem.classificationBlockers.map((entry) => entry.field),
  };
  const sourceInterpretation = row.effective?.proposal || null;
  const candidate = command.action === "EDIT_AND_APPROVE" ? command.canonicalInterpretation
    : parse(row.canonicalInterpretation, null) || sourceInterpretation;
  if (["APPROVE_INTERPRETATION", "EDIT_AND_APPROVE"].includes(command.action)) {
    const valid = validateUnderstandingForApproval(candidate);
    if (!valid.ok) return { error: valid.code, status: 409, missing: valid.missing };
  }
  const canonical = sanitizeReviewedInterpretation(candidate);
  if (!canonical) return { error: "UNDERSTANDING_REVIEW_PAYLOAD_INVALID", status: 400 };
  const nextStatus = command.action === "REJECT_INTERPRETATION" ? "REJECTED" : command.action === "RETURN_TO_REVIEW" ? "AWAITING_REVIEW" : "APPROVED";
  const nextVersion = actualVersion + 1;
  const versionId = id("understandingreview");
  const eventId = id("understandingreviewevent");
  try {
    await db.batch([
      db.prepare(`INSERT INTO estimator_understanding_review_versions(id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,review_reason,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(versionId, projectId, row.boqItemId, row.interpretationId, nextVersion, nextStatus, JSON.stringify(canonical), row.effective.currentInputFingerprint, row.evidenceDocumentVersionId, row.evidenceExtractionVersion, command.reason, context.userId),
      db.prepare(`INSERT INTO estimator_understanding_review_events(id,project_id,boq_item_id,interpretation_id,review_version_id,action,previous_status,new_status,reason,actor_user_id,request_id,request_fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventId, projectId, row.boqItemId, row.interpretationId, versionId, command.action, row.reviewStatus || "AWAITING_REVIEW", nextStatus, command.reason, context.userId, command.requestId, incomingFingerprint),
    ]);
  } catch {
    const raced = await db.prepare(`SELECT request_fingerprint requestFingerprint FROM estimator_understanding_review_events WHERE project_id=? AND request_id=?`).bind(projectId, command.requestId).first();
    if (raced?.requestFingerprint === incomingFingerprint) return { idempotent: true, review: safeUnderstandingReviewItem(await resolveCurrent(db, projectId, reviewKey(row.boqItemId))).review };
    return { error: "UNDERSTANDING_REVIEW_STALE", status: 409 };
  }
  const resultingAuthority = evaluateUnderstandingAuthority({ interpretation: canonical, reviewStatus: nextStatus, taxonomyValid: taxonomyValidFor(row) });
  return {
    idempotent: false,
    review: { status: nextStatus, version: nextVersion },
    discovery: resultingAuthority.discoveryReadiness,
    technicalMatchReadiness: resultingAuthority.technicalMatchReadiness,
  };
};

export async function handleEstimatorUnderstandingReviewApi(request, env) {
  const url = new URL(request.url);
  const listMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding-review$/);
  const itemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding-review\/items\/([^/]+)$/);
  if (!listMatch && !itemMatch) return null;
  if (!env.DB) return json({ error: { code: "UNDERSTANDING_REVIEW_UNAVAILABLE", message: "Understanding review storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const projectId = decodeURIComponent((listMatch || itemMatch)[1]);
  const projectAuthority = await access(env.DB, projectId, resolved.context);
  if (!resolved.context.fullAccess || !projectAuthority) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
  if (!ENGINEER_ROLES.has(projectAuthority.role)) return json({ error: { code: "UNDERSTANDING_REVIEW_FORBIDDEN", message: "An authorized engineer role is required." } }, 403);
  if (listMatch) return request.method === "GET" ? json(await listReview(env.DB, projectId, url)) : json({ error: { code: "BULK_UNDERSTANDING_REVIEW_PROHIBITED", message: "Review one current BOQ item at a time." } }, 405);
  const row = await resolveCurrent(env.DB, projectId, decodeURIComponent(itemMatch[2]));
  if (!row) return json({ error: { code: "CURRENT_BOQ_ITEM_NOT_FOUND", message: "Current BOQ item not found." } }, 404);
  if (request.method === "GET") return json(await detail(env.DB, projectId, row));
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: { code: "UNDERSTANDING_REVIEW_REQUEST_INVALID", message: "Use the governed item review contract." } }, 400); }
  const validated = validateUnderstandingReviewCommand(body);
  if (!validated.ok) return json({ error: { code: validated.code, message: "The understanding review request is invalid." } }, 400);
  const currentRow = await resolveCurrent(env.DB, projectId, decodeURIComponent(itemMatch[2]));
  if (!currentRow) return json({ error: { code: "CURRENT_BOQ_ITEM_NOT_FOUND", message: "Current BOQ item not found." } }, 404);
  const result = await mutateUnderstandingReview(env.DB, resolved.context, projectId, currentRow, validated.value);
  return result.error ? json({ error: { code: result.error, message: "The understanding review could not be recorded." }, missing: result.missing || [] }, result.status) : json(result);
}
