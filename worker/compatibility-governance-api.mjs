// MATCH-001 Slice 1 -- production reachability for the governed compatibility
// auto-confirm capability.
//
// WHY THIS FILE EXISTS.
// worker/compatibility-auto-confirm.mjs implements a deliberately gated policy:
// auto-confirm is allowed only after six gates pass, including an
// evidence-classification allowlist (EXPLICIT_EXACT / EXPLICIT_FAMILY /
// SUPPORTED_VARIANT) plus mandatory source document + revision and a
// no-project-inference gate. That policy is sound and is NOT re-implemented
// here. The defect was that the capability was unreachable: the only callers
// were a one-off stage script and a unit test, so engineering_relationships was
// never populated in normal operation while consumers kept reading it.
//
// This route is the smallest legitimate production path onto that EXISTING
// authority. It adds reach and an honest caller contract; it adds no
// compatibility logic, no gate, and no new role vocabulary.
//
// SLICE BOUNDARY.
// Slice 1 (below) is reachability; Slice 2 (also below) is the governed
// correction lifecycle. They are kept in one module because they are two
// halves of a single authority surface, but they are separate operations with
// separate contracts. A project-scoped WRITE is still refused: this route
// records library-level (Global) truth only, which is what manufacturer-proven
// compatibility actually is.

import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { authenticateLibraryActor, requireLibraryCapability } from "./library-auth.mjs";
import { autoConfirmCompatibility, EVIDENCE_CLASSIFICATION, COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION, COMPATIBILITY_AUTO_CONFIRM_ACTOR } from "./compatibility-auto-confirm.mjs";

export const COMPATIBILITY_GOVERNANCE_API_VERSION = "compatibility-governance-1.0.0";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const AUTO_CONFIRM_PATH = /^\/api\/compatibility\/relationships\/auto-confirm$/;

// The exact allowlist the authority accepts. Mirrored here ONLY to reject an
// absent or unrecognised classification before the authority is called, so the
// caller can never inherit `evaluateCompatibilityAutoConfirmation`'s permissive
// default of EXPLICIT_EXACT by omitting the field. The authority remains the
// single decision point: this list cannot widen it.
const ACCEPTED_EVIDENCE_CLASSIFICATIONS = Object.freeze([
  EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
  EVIDENCE_CLASSIFICATION.EXPLICIT_FAMILY,
  EVIDENCE_CLASSIFICATION.SUPPORTED_VARIANT,
]);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export async function handleCompatibilityGovernanceApi(request, env) {
  const pathname = new URL(request.url).pathname;

  // Slice 2 first: the decision route is more specific than the auto-confirm
  // path, and both are matched independently below.
  const decisionMatch = pathname.match(DECISION_PATH);
  if (decisionMatch) {
    return handleRelationshipDecision(request, env, decisionMatch, COMPATIBILITY_GOVERNANCE_API_VERSION);
  }

  if (!AUTO_CONFIRM_PATH.test(pathname)) return null;
  if (request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
  }

  // --- Actor and capability, from the existing authorization vocabulary. ----
  // Creating permanent library-level compatibility authority is an approval act,
  // so it requires the existing `approve` capability (Library Manager). No new
  // role or capability is invented. NOTE: AUTH-001 is still OPEN -- the library
  // capability gate cannot currently deny in the deployed single-user context,
  // so this check is honest but not yet load-bearing. It is written correctly so
  // it starts binding the moment AUTH-001 is repaired.
  const authenticated = await authenticateLibraryActor(request, env);
  if (authenticated?.error) {
    return json({ error: authenticated.error }, authenticated.error.status);
  }
  const actor = authenticated.actor;
  const denied = requireLibraryCapability(actor, "approve");
  if (denied) {
    return json({ error: { code: denied.code, message: denied.message } }, denied.status);
  }

  const body = await request.json().catch(() => ({}));
  const apiVersion = COMPATIBILITY_GOVERNANCE_API_VERSION;

  // --- Caller contract ------------------------------------------------------
  // Fail closed on anything the authority would otherwise default in its own
  // favour. A defaulted classification is exactly how an accidental inference
  // becomes permanent Approved truth, so the caller must assert it explicitly.
  const evidenceClassification = body.evidenceClassification;
  if (!isNonEmptyString(evidenceClassification)) {
    return json(
      {
        error: {
          code: "EVIDENCE_CLASSIFICATION_REQUIRED",
          message:
            "An explicit evidenceClassification is required. It is never defaulted: a missing classification must not be read as manufacturer-exact evidence.",
        },
        accepted: ACCEPTED_EVIDENCE_CLASSIFICATIONS,
      },
      422,
    );
  }
  if (!ACCEPTED_EVIDENCE_CLASSIFICATIONS.includes(evidenceClassification)) {
    return json(
      {
        error: {
          code: "EVIDENCE_CLASSIFICATION_NOT_AUTO_CONFIRMABLE",
          message: `Evidence classification ${evidenceClassification} is not eligible for automatic confirmation.`,
        },
        accepted: ACCEPTED_EVIDENCE_CLASSIFICATIONS,
      },
      422,
    );
  }

  // Authoritative evidence must actually be present, not an empty object.
  if (!isNonEmptyString(body.evidenceJson) || body.evidenceJson.trim() === "{}") {
    return json(
      {
        error: {
          code: "EVIDENCE_REQUIRED",
          message: "Authoritative manufacturer evidence is required for an auto-confirmed relationship.",
        },
      },
      422,
    );
  }

  // Source document + revision provenance (authority gate 5). Required here as
  // well so the refusal is a clear caller error rather than a gate failure.
  if (!isNonEmptyString(body.sourceDocumentNumber) || !isNonEmptyString(body.sourceDocumentRevision)) {
    return json(
      {
        error: {
          code: "SOURCE_DOCUMENT_PROVENANCE_REQUIRED",
          message: "A source document number and revision are required for an auto-confirmed relationship.",
        },
      },
      422,
    );
  }

  // Slice boundary: this route writes library-level truth only.
  if (body.projectId !== undefined && body.projectId !== null) {
    return json(
      {
        error: {
          code: "PROJECT_SCOPED_RELATIONSHIP_NOT_SUPPORTED",
          message:
            "This endpoint records library-level manufacturer-proven compatibility only. Project-scoped relationships are not written here.",
        },
      },
      422,
    );
  }

  if (!isNonEmptyString(body.sourceProductId)) {
    return json({ error: { code: "SOURCE_PRODUCT_REQUIRED", message: "sourceProductId is required." } }, 422);
  }
  const hasTargetProduct = isNonEmptyString(body.targetProductId);
  const hasTargetFamily = isNonEmptyString(body.targetFamilyId);
  if (hasTargetProduct === hasTargetFamily) {
    return json(
      {
        error: {
          code: "TARGET_REQUIRED",
          message: "Provide exactly one of targetProductId or targetFamilyId.",
        },
      },
      422,
    );
  }
  if (!isNonEmptyString(body.relationshipType)) {
    return json({ error: { code: "RELATIONSHIP_TYPE_REQUIRED", message: "relationshipType is required." } }, 422);
  }

  // --- Call the canonical authority. No compatibility logic here. ----------
  const outcome = await autoConfirmCompatibility(env.DB, {
    sourceProductId: body.sourceProductId,
    targetProductId: hasTargetProduct ? body.targetProductId : null,
    targetFamilyId: hasTargetFamily ? body.targetFamilyId : null,
    relationshipType: body.relationshipType,
    conditionsJson: typeof body.conditionsJson === "string" ? body.conditionsJson : "{}",
    evidenceJson: body.evidenceJson,
    // A confidence the caller did not assert is NOT invented here: pass undefined
    // so the authority applies its own documented default rather than this route
    // manufacturing a number.
    confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : undefined,
    sourceDocumentNumber: body.sourceDocumentNumber,
    sourceDocumentRevision: body.sourceDocumentRevision,
    sourceDocumentDate: body.sourceDocumentDate ?? null,
    sourceDocumentUrl: body.sourceDocumentUrl ?? null,
    sourceDocumentPage: body.sourceDocumentPage ?? null,
    sourceDocumentSection: body.sourceDocumentSection ?? null,
    evidenceClassification,
  });

  if (outcome.success) {
    return json(
      {
        ok: true,
        status: "Approved",
        relationshipId: outcome.relationshipId,
        evidenceClassification,
        policyVersion: COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION,
        policyActor: COMPATIBILITY_AUTO_CONFIRM_ACTOR,
        apiVersion,
      },
      201,
    );
  }

  // Idempotency. The authority's duplicate gate is a refusal, but for a caller
  // repeating the same governed request the correct answer is "already
  // recorded", not an error. Reported from the gate reason the authority
  // produced, never re-derived.
  const reason = String(outcome.reason || "");
  if (reason === "Relationship already exists") {
    return json(
      {
        ok: true,
        status: "Approved",
        idempotent: true,
        reason,
        evidenceClassification,
        policyVersion: COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION,
        apiVersion,
      },
      200,
    );
  }

  // A disputed pair is a genuine conflict, not a caller error: a human resolves
  // it through the engineering-knowledge decision flow.
  if (reason.startsWith("Conflicting")) {
    return json(
      {
        error: { code: "COMPATIBILITY_CONFLICT", message: reason },
        evaluation: outcome.evaluation,
        apiVersion,
      },
      409,
    );
  }

  // Every other gate failure is a fail-closed refusal with the authority's own
  // reasons. Nothing is written.
  return json(
    {
      error: {
        code: "COMPATIBILITY_AUTO_CONFIRM_REFUSED",
        message: reason || "The relationship is not eligible for automatic confirmation.",
      },
      evaluation: outcome.evaluation,
      apiVersion,
    },
    422,
  );
}

// ---------------------------------------------------------------------------
// MATCH-001 SLICE 2 -- governed correction lifecycle.
//
// WHY THESE STATES AND NOT OTHERS.
// The written vocabulary in engineering_relationships is currently a single
// value, 'Approved' (confirmed against live data: 14 rows, all Approved, all
// 'Compatible With'). Consumers read it with `status='Approved'` or
// `status IN ('Active','Approved','Confirmed')`. So the minimal correct
// correction surface is:
//
//   Approved --reject-->  Rejected   (a human says the evidence does not support it)
//   Approved --withdraw--> Withdrawn  (it was supported, the basis no longer stands)
//
// Both are TERMINAL for current authority, and both are already excluded by
// every existing consumer predicate, so NO read filter had to be widened or
// changed to make correctness real.
//
// SUPERSEDE IS DELIBERATELY NOT A NEW STATE. Because a second 'Approved' row for
// the same (left, type, right) triple is refused by the authority's duplicate
// gate, superseding is exactly "withdraw the old statement, then auto-confirm
// the new one" -- a composition of the two operations that already exist. Adding
// a 'Superseded' status would have been a state invented for symmetry rather
// than for a semantic distinction that current domain evidence requires.

const DECISION_PATH = /^\/api\/compatibility\/relationships\/([^/]+)\/decide$/;
const DECISIONS = Object.freeze({ REJECTED: "Rejected", WITHDRAWN: "Withdrawn" });
const ACCEPTED_DECISIONS = Object.freeze([
  { action: "reject", status: DECISIONS.REJECTED },
  { action: "withdraw", status: DECISIONS.WITHDRAWN },
]);

const decisionId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

async function handleRelationshipDecision(request, env, match, apiVersion) {
  const relationshipId = decodeURIComponent(match[1]);

  const authenticated = await authenticateLibraryActor(request, env);
  if (authenticated?.error) {
    return json({ error: authenticated.error }, authenticated.error.status);
  }
  const actor = authenticated.actor;
  // Same existing capability vocabulary as the write path. Correcting a
  // permanent library-level authority is at least as privileged as granting it.
  const denied = requireLibraryCapability(actor, "approve");
  if (denied) {
    return json({ error: { code: denied.code, message: denied.message } }, denied.status);
  }

  if (request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const requested = String(body.action || "").toLowerCase();
  const decision = ACCEPTED_DECISIONS.find((entry) => entry.action === requested);
  if (!decision) {
    return json(
      {
        error: {
          code: "COMPATIBILITY_DECISION_INVALID",
          message: `action must be one of: ${ACCEPTED_DECISIONS.map((entry) => entry.action).join(", ")}.`,
        },
        accepted: ACCEPTED_DECISIONS.map((entry) => entry.action),
      },
      422,
    );
  }

  const reason = String(body.reason || "").trim();
  if (reason.length < MIN_GOVERNED_REASON_LENGTH) {
    return json(
      {
        error: {
          code: "COMPATIBILITY_DECISION_REASON_REQUIRED",
          message: "A substantive governed reason is required to change a compatibility decision.",
        },
      },
      422,
    );
  }

  const existing = await env.DB.prepare(
    "SELECT id, status, project_id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id FROM engineering_relationships WHERE id=?",
  )
    .bind(relationshipId)
    .first();

  if (!existing) {
    return json({ error: { code: "COMPATIBILITY_RELATIONSHIP_NOT_FOUND", message: "Compatibility relationship not found." } }, 404);
  }

  // Ownership. A library-level relationship (project_id IS NULL) is global truth
  // and is governed by the library capability above. A project-scoped one is
  // governed by that project's own authority, so it must not be correctable by
  // someone with no authority over the project.
  if (existing.project_id) {
    const project = await env.DB.prepare("SELECT id, owner_user_id, organization_id FROM projects WHERE id=?")
      .bind(existing.project_id)
      .first();
    if (!project) {
      return json({ error: { code: "PROJECT_NOT_FOUND", message: "The relationship's project no longer exists." } }, 404);
    }
    if (actor.id !== project.owner_user_id) {
      return json(
        {
          error: {
            code: "PROJECT_AUTHORITY_REQUIRED",
            message: "Only the project owner may correct a project-scoped compatibility relationship.",
          },
        },
        403,
      );
    }
  }

  const stamp = new Date().toISOString();

  // Already in a terminal state. Report the truth and do not write again, so a
  // repeated request is idempotent rather than a second audit entry.
  if (existing.status === decision.status) {
    return json(
      {
        ok: true,
        relationshipId,
        status: existing.status,
        idempotent: true,
        apiVersion,
      },
      200,
    );
  }
  if (existing.status !== "Approved") {
    return json(
      {
        error: {
          code: "COMPATIBILITY_DECISION_NOT_ALLOWED",
          message: `A relationship in status '${existing.status}' cannot be corrected. Only a current Approved relationship can be rejected or withdrawn.`,
        },
        currentStatus: existing.status,
        apiVersion,
      },
      409,
    );
  }

  // CAS. The WHERE clause is the currentness guard: a concurrent decision that
  // already moved the row out of Approved wins, and this update affects nothing.
  const updated = await env.DB.prepare(
    `UPDATE engineering_relationships
        SET status=?, effective_to=?, reviewed_by=?, reviewed_at=?
      WHERE id=? AND status='Approved' AND effective_to IS NULL`,
  )
    .bind(decision.status, stamp, actor.id, stamp, relationshipId)
    .run();

  const changes = Number(updated?.meta?.changes ?? updated?.changes ?? 0);
  if (changes !== 1) {
    // Lost the race. Report the current truth rather than claiming success.
    const current = await env.DB.prepare("SELECT id, status FROM engineering_relationships WHERE id=?")
      .bind(relationshipId)
      .first();
    return json(
      {
        ok: current?.status === decision.status,
        relationshipId,
        status: current?.status || null,
        idempotent: current?.status === decision.status,
        apiVersion,
      },
      current?.status === decision.status ? 200 : 409,
    );
  }

  // Audit, in the same product_library_decisions store the auto-confirm writer
  // already uses, so both halves of the lifecycle are attributable in one place.
  await env.DB.prepare(
    `INSERT INTO product_library_decisions
       (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      decisionId("libdecision"),
      existing.project_id ?? null,
      "EngineeringRelationship",
      relationshipId,
      `Compatibility ${decision.action}`,
      JSON.stringify({ status: "Approved" }),
      JSON.stringify({ status: decision.status, effectiveTo: stamp }),
      reason,
      actor.id,
      actor.permission || actor.role || "Library Manager",
      stamp,
    )
    .run();

  return json(
    {
      ok: true,
      relationshipId,
      status: decision.status,
      idempotent: false,
      reason,
      apiVersion,
    },
    200,
  );
}
