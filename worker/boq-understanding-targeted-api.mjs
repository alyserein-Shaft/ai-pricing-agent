// Targeted BOQ Understanding: governed authorization issue + execution.
//
// Reuses the canonical writer (`executeRun` -> `runUnderstandingBatch`) and the
// canonical eligibility rules (`buildBoqUnderstandingPilotManifest` lanes). It
// adds no parallel interpreter, inserts no interpretation row by hand, and does
// not relax the ordinary controlled pilot: a targeted run only happens when a
// human-authorized record explicitly covers the requested items.
import { requireHumanActor } from "./human-actor.mjs";
import { activeRows, executeRun, confirmedSpecifications } from "./estimator-understanding-api.mjs";
import { buildBoqUnderstandingPilotManifest } from "../app/domain/boq-understanding-pilot.mjs";
import {
  BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS,
  TARGETED_AUTHORIZATION_ERRORS,
  TARGETED_UNDERSTANDING_ACTION,
  TARGETED_UNDERSTANDING_RUN_MODE,
  authorizeTargetedUnderstanding,
  targetedAuthorizationFingerprint,
  validateTargetedUnderstandingRequest,
} from "../app/domain/boq-understanding-targeted.mjs";
import { interpretationInputFingerprint, prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const clean = (value) => String(value ?? "").trim();
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const now = () => new Date().toISOString();

/**
 * The canonical per-item eligibility fingerprint used by the pilot. An
 * authorization is bound to these, so evidence changing after issuance makes the
 * stored fingerprint stale instead of silently widening what was authorized.
 */
const eligibilityFingerprints = async (db, rows) => {
  const specs = await confirmedSpecifications(db, rows.projectId);
  const byItem = new Map(rows.rows.map((row) => [row.boqItemId || row.id, row]));
  const eligibility = {};
  for (const itemId of rows.itemIds) {
    const row = byItem.get(itemId);
    if (!row) continue;
    eligibility[itemId] = interpretationInputFingerprint(prepareBoqUnderstandingInput(row, specs[itemId] || []));
  }
  return eligibility;
};

/**
 * Re-derive the CURRENT canonical lanes for the project and expose the requested
 * items as eligible / excluded. Authorization can never promote an item the
 * ordinary pipeline would refuse.
 */
const canonicalEligibility = async (db, projectId, itemIds) => {
  const rows = await activeRows(db, projectId);
  const manifest = buildBoqUnderstandingPilotManifest(projectId, rows, { alreadyInterpretedItemIds: new Set() });
  const byId = new Map(rows.map((row) => [row.boqItemId || row.id, row]));
  const excludedIds = new Set(rows
    .filter((row) => !buildBoqUnderstandingPilotManifest(projectId, [row], { alreadyInterpretedItemIds: new Set() }).primaryItems.length
      && !buildBoqUnderstandingPilotManifest(projectId, [row], { alreadyInterpretedItemIds: new Set() }).exploratoryItems.length)
    .map((row) => row.boqItemId || row.id));
  const items = itemIds.map((itemId) => {
    const row = byId.get(itemId);
    if (!row) return { itemId, present: false, eligible: false, reason: TARGETED_AUTHORIZATION_ERRORS.UNKNOWN_ITEM };
    if (excludedIds.has(itemId)) return { itemId, present: true, eligible: false, reason: TARGETED_AUTHORIZATION_ERRORS.INELIGIBLE_ITEM };
    const single = buildBoqUnderstandingPilotManifest(projectId, [row], { alreadyInterpretedItemIds: new Set() });
    const lane = single.primaryItems.length ? "GOVERNED_PRIMARY"
      : single.exploratoryItems.length ? "CROSS_SYSTEM_EXPLORATORY" : "DATA_QUALITY_EXCLUDED";
    return { itemId, present: true, eligible: lane !== "DATA_QUALITY_EXCLUDED", lane, row };
  });
  return { manifest, byId, items };
};

/** Issue a human-authorized targeted authorization. Idempotent by fingerprint. */
export const issueTargetedUnderstandingAuthorization = async (env, context, request) => {
  const human = requireHumanActor(env);
  if (human.error) return { error: human.error, message: human.message };
  const validated = validateTargetedUnderstandingRequest(request);
  if (validated.error) return { error: validated.error, message: validated.message };
  const value = validated.value;

  const project = await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(value.projectId).first();
  if (!project) return { error: TARGETED_AUTHORIZATION_ERRORS.UNKNOWN_ITEM, message: "Project not found." };

  const eligibility = await canonicalEligibility(env.DB, value.projectId, value.itemIds);
  const unknown = eligibility.items.filter((item) => !item.present);
  if (unknown.length) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.UNKNOWN_ITEM, message: "One or more items are not authoritative BOQ rows in this project.", details: { itemIds: unknown.map((i) => i.itemId) } };
  }
  const ineligible = eligibility.items.filter((item) => !item.eligible);
  if (ineligible.length) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.INELIGIBLE_ITEM, message: "One or more items are data-quality excluded by the canonical pilot rules and cannot be authorized for Understanding.", details: { itemIds: ineligible.map((i) => i.itemId) } };
  }

  const fingerprints = await eligibilityFingerprints(env.DB, { projectId: value.projectId, itemIds: value.itemIds, rows: eligibility.items.map((i) => i.row) });
  const authorizationFingerprint = targetedAuthorizationFingerprint({
    projectId: value.projectId, itemIds: value.itemIds, authorizedBy: human.actor.id, reason: value.reason, eligibility: fingerprints,
  });

  const existing = await env.DB.prepare("SELECT * FROM boq_understanding_targeted_authorizations WHERE authorization_fingerprint=?").bind(authorizationFingerprint).first();
  if (existing) {
    return { authorizationId: existing.id, itemIds: JSON.parse(existing.item_ids), authorizationFingerprint, idempotent: true, authorizedBy: existing.authorized_by };
  }

  const id = newId("boqtargetauth");
  await env.DB.prepare(`INSERT INTO boq_understanding_targeted_authorizations(id,project_id,organization_id,item_ids,item_count,intended_action,authorization_reason,authorized_by,authorized_by_name,authorized_by_role,authorization_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, value.projectId, context.organizationId, JSON.stringify([...value.itemIds].sort()), value.itemIds.length, TARGETED_UNDERSTANDING_ACTION, value.reason, human.actor.id, human.actor.name, human.actor.role || null, authorizationFingerprint, now()).run();
  return { authorizationId: id, itemIds: [...value.itemIds].sort(), authorizationFingerprint, idempotent: false, authorizedBy: human.actor.id, authorizedByName: human.actor.name };
};

/** Execute a targeted run covered by an existing authorization. */
export const executeTargetedUnderstanding = async (env, context, authorizationId, projectId) => {
  const stored = await env.DB.prepare("SELECT * FROM boq_understanding_targeted_authorizations WHERE id=?").bind(clean(authorizationId)).first();
  if (!stored) return { error: TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED, message: "No governed targeted authorization with that id." };
  if (stored.superseded_at) return { error: TARGETED_AUTHORIZATION_ERRORS.SUPERSEDED_AUTHORIZATION, message: "This targeted authorization has been superseded." };
  if (clean(stored.project_id) !== clean(projectId)) return { error: TARGETED_AUTHORIZATION_ERRORS.CROSS_PROJECT, message: "The authorization belongs to a different project." };

  const itemIds = JSON.parse(stored.item_ids);
  const request = Object.freeze({ intendedAction: TARGETED_UNDERSTANDING_ACTION, projectId: clean(projectId), reason: stored.authorization_reason, itemIds: Object.freeze(itemIds) });
  const authorized = authorizeTargetedUnderstanding(request, {
    id: stored.id, projectId: stored.project_id, itemIds, intendedAction: stored.intended_action,
    authorizedBy: stored.authorized_by, authorizedByName: stored.authorized_by_name,
    authorizationReason: stored.authorization_reason, authorizationFingerprint: stored.authorization_fingerprint,
    supersededAt: stored.superseded_at,
  });
  if (authorized.error) return { error: authorized.error, message: authorized.message, details: authorized.details };

  // Re-validate CURRENT eligibility and CURRENT evidence fingerprints.
  const eligibility = await canonicalEligibility(env.DB, stored.project_id, itemIds);
  const nowIneligible = eligibility.items.filter((item) => !item.present || !item.eligible);
  if (nowIneligible.length) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.INELIGIBLE_ITEM, message: "One or more authorized items are no longer canonically eligible.", details: { itemIds: nowIneligible.map((i) => i.itemId) } };
  }
  const fingerprints = await eligibilityFingerprints(env.DB, { projectId: stored.project_id, itemIds, rows: eligibility.items.map((i) => i.row) });
  const currentFingerprint = targetedAuthorizationFingerprint({
    projectId: stored.project_id, itemIds, authorizedBy: stored.authorized_by, reason: stored.authorization_reason, eligibility: fingerprints,
  });
  if (currentFingerprint !== stored.authorization_fingerprint) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.STALE_AUTHORIZATION, message: "The authorized items' evidence has changed since this authorization was issued." };
  }

  // Linkage to the authorization is carried by `authorization_fingerprint`, which
  // is UNIQUE in boq_understanding_targeted_authorizations. `parent_run_id` is NOT
  // used: it foreign-keys estimator_understanding_runs.id, so a targeted run is
  // never a child of a previous run (it is its own root), and stuffing an
  // authorization id into it would violate that constraint.
  const replay = await env.DB.prepare("SELECT id, status FROM estimator_understanding_runs WHERE run_mode=? AND authorization_fingerprint=?").bind(TARGETED_UNDERSTANDING_RUN_MODE, stored.authorization_fingerprint).first();
  if (replay) return { runId: replay.id, status: replay.status, idempotent: true, authorizationId: stored.id, itemCount: itemIds.length };

  const rows = eligibility.items.map((item) => item.row);
  const result = await executeRun(env, context, stored.project_id, rows, { mode: TARGETED_UNDERSTANDING_RUN_MODE, authorizationFingerprint: stored.authorization_fingerprint });
  return { ...result, authorizationId: stored.id, authorizedBy: stored.authorized_by, itemCount: rows.length, maxItems: BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS };
};

/** Expire an authorization so it can never be replayed. */
export const supersedeTargetedUnderstandingAuthorization = async (env, authorizationId, reason) => {
  const human = requireHumanActor(env);
  if (human.error) return { error: human.error, message: human.message };
  const clean_ = clean(reason);
  if (clean_.length < 10) return { error: TARGETED_AUTHORIZATION_ERRORS.REASON_REQUIRED, message: "Provide a substantive supersede reason." };
  const stored = await env.DB.prepare("SELECT id, superseded_at FROM boq_understanding_targeted_authorizations WHERE id=?").bind(clean(authorizationId)).first();
  if (!stored) return { error: TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED, message: "No such authorization." };
  if (stored.superseded_at) return { authorizationId: stored.id, idempotent: true };
  await env.DB.prepare("UPDATE boq_understanding_targeted_authorizations SET superseded_at=?, supersede_reason=? WHERE id=? AND superseded_at IS NULL").bind(now(), clean_, stored.id).run();
  return { authorizationId: stored.id, superseded: true, supersededBy: human.actor.id };
};

/**
 * Route. Ordinary pilot/retry/quality routes are NOT handled here; this handler
 * only serves the targeted-authorization surface.
 */
export const handleTargetedUnderstandingApi = async (request, env, resolvedContext) => {
  const url = new URL(request.url);
  const issue = url.pathname.match(/^\/api\/projects\/([^/]+)\/boq-understanding\/targeted-authorizations$/);
  const run = url.pathname.match(/^\/api\/boq-understanding\/targeted-authorizations\/([^/]+)\/run$/);
  const supersede = url.pathname.match(/^\/api\/boq-understanding\/targeted-authorizations\/([^/]+)$/);
  if (!issue && !run && !supersede) return null;
  if (!env.DB) return json({ error: { code: "TARGETED_UNDERSTANDING_UNAVAILABLE", message: "BOQ understanding storage is unavailable." } }, 503);

  if (issue) {
    if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to issue a targeted authorization." } }, 405);
    const body = await request.json().catch(() => ({}));
    const result = await issueTargetedUnderstandingAuthorization(env, resolvedContext, { ...body, projectId: decodeURIComponent(issue[1]) });
    if (result.error) return json({ error: { code: result.error, message: result.message, details: result.details } }, result.error === TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED ? 403 : 422);
    return json(result, 201);
  }
  if (run) {
    if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to run." } }, 405);
    const authorizationId = decodeURIComponent(run[1]);
    const stored = await env.DB.prepare("SELECT project_id FROM boq_understanding_targeted_authorizations WHERE id=?").bind(authorizationId).first();
    if (!stored) return json({ error: { code: TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED, message: "No such authorization." } }, 404);
    const result = await executeTargetedUnderstanding(env, resolvedContext, authorizationId, stored.project_id);
    if (result.error) return json({ error: { code: result.error, message: result.message, details: result.details } }, result.error === TARGETED_AUTHORIZATION_ERRORS.SUPERSEDED_AUTHORIZATION ? 409 : 422);
    return json(result);
  }
  if (request.method !== "DELETE") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use DELETE to supersede." } }, 405);
  const result = await supersedeTargetedUnderstandingAuthorization(env, decodeURIComponent(supersede[1]), await request.text());
  if (result.error) return json({ error: { code: result.error, message: result.message } }, 422);
  return json(result);
};