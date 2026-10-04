// Targeted BOQ Understanding authorization -- governed contract (pure).
//
// WHY THIS EXISTS. The ordinary controlled pilot selects one row per taxonomy
// family (`selectPrimaryByDistinctFamily`), capped at BOQ_UNDERSTANDING_PILOT_MAX_ITEMS,
// AFTER removing rows already interpreted at the current config fingerprint. So an
// eligible row can be perfectly healthy and still unselected because a sibling
// already holds its family slot. Reaching 12 already-authorized rows by rotation
// alone would interpret up to ~90 unrelated rows first. CONTROLLED_RETRY cannot
// help: it requires exactly 6 items drawn from one historical run's own quality
// recommendations.
//
// This module is the narrow, human-authorized alternative. It is deliberately
// NOT a general override:
//   * it carries an exact, immutable set of BOQ item ids bound to ONE project;
//   * it is issued by a resolved human actor (requireHumanActor), never the
//     synthetic session user;
//   * it binds an intended action, so it cannot be replayed as something else;
//   * every item is re-validated against the SAME canonical eligibility the
//     manifest uses (`exclusionReasonsFor` / selection lanes), so authorization
//     cannot make an ineligible row executable;
//   * it is currentness-scoped (superseded_at) and idempotent by authorization
//     fingerprint, matching CONTROLLED_PILOT / CONTROLLED_RETRY / PER_ITEM_RETRY.
//
// Ordinary pilot behaviour is untouched: nothing here is consulted unless a
// caller explicitly passes run_mode "TARGETED_AUTHORIZED".
import { createHash } from "node:crypto";
import { stableStringify } from "./identity-resolution-engine.mjs";

export const TARGETED_UNDERSTANDING_ACTION = "TARGETED_BOQ_UNDERSTANDING";

export const TARGETED_UNDERSTANDING_RUN_MODE = "TARGETED_AUTHORIZED";

/**
 * A targeted run stays inside the ordinary per-request pilot cap, so the
 * authorization can never be used as a bulk "interpret everything" lever.
 */
export const BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS = 15;

export const TARGETED_AUTHORIZATION_ERRORS = Object.freeze({
  HUMAN_ACTOR_REQUIRED: "TARGETED_AUTHORIZATION_REQUIRES_HUMAN_ACTOR",
  REASON_REQUIRED: "TARGETED_AUTHORIZATION_REASON_REQUIRED",
  ITEMS_REQUIRED: "TARGETED_AUTHORIZATION_REQUIRES_ITEMS",
  ITEM_LIMIT: "TARGETED_AUTHORIZATION_ITEM_LIMIT_EXCEEDED",
  DUPLICATE_ITEMS: "TARGETED_AUTHORIZATION_DUPLICATE_ITEMS",
  UNKNOWN_ITEM: "TARGETED_AUTHORIZATION_UNKNOWN_ITEM",
  CROSS_PROJECT: "TARGETED_AUTHORIZATION_CROSS_PROJECT_ITEM",
  INELIGIBLE_ITEM: "TARGETED_AUTHORIZATION_INELIGIBLE_ITEM",
  FINGERPRINT_MISMATCH: "TARGETED_AUTHORIZATION_FINGERPRINT_MISMATCH",
  STALE_AUTHORIZATION: "TARGETED_AUTHORIZATION_STALE",
  SUPERSEDED_AUTHORIZATION: "TARGETED_AUTHORIZATION_SUPERSEDED",
  NOT_AUTHORIZED: "TARGETED_AUTHORIZATION_ITEM_NOT_AUTHORIZED",
  ACTION_MISMATCH: "TARGETED_AUTHORIZATION_ACTION_MISMATCH",
});

const clean = (value) => String(value ?? "").trim();

/** Boq item id form used across the schema (`boqitem_<uuid>` and test fixtures). */
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;

/**
 * Validate the REQUEST that asks for a targeted run. Pure: no DB, no env.
 * Returns { value } or { error, message }.
 */
export const validateTargetedUnderstandingRequest = (body = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ITEMS_REQUIRED, message: "Send a targeted BOQ Understanding request body." };
  }
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "intendedAction,itemIds,projectId,reason") {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ITEMS_REQUIRED, message: "Send exactly intendedAction, itemIds, projectId and reason." };
  }
  if (body.intendedAction !== TARGETED_UNDERSTANDING_ACTION) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ACTION_MISMATCH, message: `intendedAction must be ${TARGETED_UNDERSTANDING_ACTION}.` };
  }
  const projectId = clean(body.projectId);
  if (!projectId) return { error: TARGETED_AUTHORIZATION_ERRORS.UNKNOWN_ITEM, message: "projectId is required." };
  const reason = clean(body.reason);
  if (reason.length < 10) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.REASON_REQUIRED, message: "Provide a substantive authorization reason (>= 10 characters)." };
  }
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(clean).filter(Boolean) : null;
  if (!itemIds || !itemIds.length) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ITEMS_REQUIRED, message: "Select at least one BOQ item." };
  }
  if (itemIds.some((itemId) => !ITEM_ID.test(itemId))) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.UNKNOWN_ITEM, message: "Every item id must be a valid BOQ item id." };
  }
  if (new Set(itemIds).size !== itemIds.length) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.DUPLICATE_ITEMS, message: "itemIds must not repeat." };
  }
  if (itemIds.length > BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ITEM_LIMIT, message: `A targeted run is limited to ${BOQ_UNDERSTANDING_TARGETED_MAX_ITEMS} items.` };
  }
  return { value: Object.freeze({ intendedAction: TARGETED_UNDERSTANDING_ACTION, projectId, reason, itemIds: Object.freeze(itemIds) }) };
};

/**
 * Validate that a request is covered by an EXISTING stored authorization.
 *
 * `authorization` is the row written by issueTargetedUnderstandingAuthorization:
 * { id, projectId, itemIds, intendedAction, authorizedBy, authorizedByName,
 *   authorizationReason, authorizationFingerprint, createdAt, supersededAt }.
 *
 * Fails closed on: wrong action, superseded/stale authorization, cross-project,
 * and any requested item outside the exact authorized set.
 */
export const authorizeTargetedUnderstanding = (request, authorization) => {
  if (!request || typeof request !== "object") {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ITEMS_REQUIRED, message: "No validated targeted request." };
  }
  if (!authorization || typeof authorization !== "object" || !authorization.id) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED, message: "No governed targeted authorization was presented." };
  }
  if (authorization.supersededAt) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.SUPERSEDED_AUTHORIZATION, message: "This targeted authorization has been superseded and can no longer be used." };
  }
  if (clean(authorization.intendedAction) !== TARGETED_UNDERSTANDING_ACTION || request.intendedAction !== TARGETED_UNDERSTANDING_ACTION) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.ACTION_MISMATCH, message: "The authorization is not for targeted BOQ Understanding." };
  }
  if (clean(authorization.projectId) !== clean(request.projectId)) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.CROSS_PROJECT, message: "The authorization belongs to a different project." };
  }
  if (!clean(authorization.authorizedBy) || authorization.authorizedBySynthetic) {
    return { error: TARGETED_AUTHORIZATION_ERRORS.HUMAN_ACTOR_REQUIRED, message: "The authorization was not issued by a resolved human actor." };
  }
  const covered = new Set((authorization.itemIds || []).map(clean));
  const outside = request.itemIds.filter((itemId) => !covered.has(itemId));
  if (outside.length) {
    return {
      error: TARGETED_AUTHORIZATION_ERRORS.NOT_AUTHORIZED,
      message: "One or more items are outside this targeted authorization.",
      details: { itemIds: outside },
    };
  }
  return { value: Object.freeze({ authorizationId: authorization.id, authorizedBy: clean(authorization.authorizedBy) }) };
};

/**
 * Deterministic fingerprint binding the WHOLE authorization: action, project,
 * the exact item set, the authorizing human, the reason and the current
 * eligibility fingerprint of every item. Any change to the set, the actor, the
 * reason or the underlying evidence produces a different value, so a stored
 * fingerprint can never be replayed against different content.
 */
export const targetedAuthorizationFingerprint = ({ projectId, itemIds, authorizedBy, reason, eligibility }) =>
  createHash("sha256").update(stableStringify({
    intendedAction: TARGETED_UNDERSTANDING_ACTION,
    projectId: clean(projectId),
    itemIds: [...(itemIds || [])].map(clean).sort(),
    authorizedBy: clean(authorizedBy),
    reason: clean(reason),
    eligibility: Object.fromEntries([...(itemIds || [])].map(clean).sort().map((itemId) => [itemId, eligibility?.[itemId] ?? null])),
  })).digest("hex");