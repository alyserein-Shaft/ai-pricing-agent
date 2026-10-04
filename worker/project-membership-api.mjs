// AUTH-002 -- the missing production writer for project_members.
//
// WHY THIS FILE EXISTS.
// Nine production authorization readers gate access on project_members
// membership (library-scope.mjs, confidence-safety-api.mjs x2, dashboard-api.mjs
// x2, pricing-api.mjs, boq-line-bom-api.mjs x2, boq-line-cost-api.mjs,
// presales-workflow-api.mjs). Until now the only INSERT/UPDATE statements
// against that table anywhere in the repository were ELEVEN hand-written
// statements inside tests. Production therefore had no legitimate way to make
// anyone a project member, so resolveProjectAuthority's LEFT JOIN always
// returned member_role = NULL and every role except the owner and an
// application administrator was permanently unassignable -- including
// 'Commercial Approver', which app/domain/presales-workflow-engine.mjs
// requires for quotation approval and final issue.
//
// Those nine readers are CORRECT and are deliberately left untouched. This adds
// the writer they were always written against.
//
// WHAT IS REUSED, NOT REINVENTED
//   - role vocabulary  : PROJECT_ROLE_VOCABULARY (app/domain/project-roles.mjs)
//   - project authority: resolveProjectAuthority (worker/project-authority.mjs)
//   - reason governance: MIN_GOVERNED_REASON_LENGTH
//   - audit trail      : dashboard_audit_log, the repository's existing generic
//                        PROJECT audit log (already written by dashboard-api and
//                        pricing-api for unrelated actions), reused rather than
//                        adding a new table while DB-002 leaves the migration
//                        chain unsettled.

import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { authenticateLibraryActor } from "./library-auth.mjs";
import { resolveProjectAuthority } from "./project-authority.mjs";
import { PROJECT_ROLE_VOCABULARY } from "../app/domain/project-roles.mjs";

export const PROJECT_MEMBERSHIP_API_VERSION = "project-membership-1.0.0";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const MEMBERS_PATH = /^\/api\/projects\/([^/]+)\/members$/;
const MEMBER_PATH = /^\/api\/projects\/([^/]+)\/members\/([^/]+)$/;

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

// The only three operations. No operation is added because it sounds useful:
// the table's own columns (role, status, revoked_at) define exactly this
// lifecycle, and the nine readers define the only state that counts as current.
const ACTIONS = Object.freeze({
  ADD: "add",
  UPDATE_ROLE: "update-role",
  REMOVE: "remove",
});
const ACTIVE = "Active";
const REVOKED = "Revoked";

const audit = (db, { projectId, action, previous, next, reason, actor }) =>
  db
    .prepare(
      "INSERT INTO dashboard_audit_log (id, project_id, action, previous_value, new_value, reason, actor_user_id, actor_role, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id("dashboardaudit"),
      projectId,
      action,
      JSON.stringify(previous),
      JSON.stringify(next),
      reason,
      actor.id,
      actor.role || actor.permission || "Project Manager",
      id("request"),
    )
    .run();

const membershipRow = (db, projectId, userId) =>
  db
    .prepare("SELECT * FROM project_members WHERE project_id=? AND user_id=?")
    .bind(projectId, userId)
    .first();

const isCurrent = (row) => Boolean(row) && row.status === ACTIVE && row.revoked_at === null;

async function handleMembership(request, env, match) {
  const projectId = decodeURIComponent(match[1]);
  const apiVersion = PROJECT_MEMBERSHIP_API_VERSION;

  if (request.method !== "POST" && request.method !== "PUT") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST or PUT." } }, 405);
  }

  const authenticated = await authenticateLibraryActor(request, env);
  if (authenticated?.error) {
    return json({ error: authenticated.error }, authenticated.error.status);
  }
  const actor = authenticated.actor;

  // Ownership must be EXPLICIT. resolveProjectAuthority is the canonical
  // project authority primitive; it resolves the owner to 'Project Manager' and
  // an explicit application administrator to 'Administrator'. Anyone else gets
  // null and cannot manage membership.
  const authority = await resolveProjectAuthority(env.DB, { projectId, actor });
  if (!authority) {
    return json(
      {
        error: {
          code: "PROJECT_AUTHORITY_REQUIRED",
          message: "Active project authority is required to manage project membership.",
        },
      },
      403,
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();
  if (!Object.values(ACTIONS).includes(action)) {
    return json(
      {
        error: {
          code: "MEMBERSHIP_ACTION_INVALID",
          message: `action must be one of: ${Object.values(ACTIONS).join(", ")}.`,
        },
        accepted: Object.values(ACTIONS),
      },
      422,
    );
  }

  const reason = String(body.reason || "").trim();
  if (reason.length < MIN_GOVERNED_REASON_LENGTH) {
    return json(
      {
        error: {
          code: "MEMBERSHIP_REASON_REQUIRED",
          message: "A substantive governed reason is required for a membership change.",
        },
      },
      422,
    );
  }

  const targetUserId = String(body.userId || (match[2] ? decodeURIComponent(match[2]) : "") || "").trim();
  if (!targetUserId) {
    return json({ error: { code: "MEMBER_USER_ID_REQUIRED", message: "userId is required." } }, 422);
  }

  // SELF-ESCALATION GUARD. A project authority may not change its OWN role, and
  // may not remove itself. Membership that governs approval authority must not be
  // self-issued; escalation goes through a different actor with the authority to
  // grant the target role.
  if (targetUserId === actor.id && (action === ACTIONS.UPDATE_ROLE || action === ACTIONS.REMOVE)) {
    return json(
      {
        error: {
          code: "SELF_MEMBERSHIP_CHANGE_FORBIDDEN",
          message:
            "You cannot change or revoke your own project membership. Another project authority must do it.",
        },
      },
      403,
    );
  }

  const existing = await membershipRow(env.DB, projectId, targetUserId);

  // ---- add ---------------------------------------------------------------
  if (action === ACTIONS.ADD) {
    const role = String(body.role || "").trim();
    if (!PROJECT_ROLE_VOCABULARY.includes(role)) {
      return json(
        {
          error: {
            code: "PROJECT_ROLE_INVALID",
            message: `role must be one of the canonical project roles. "${role}" is not a project role.`,
          },
          vocabulary: PROJECT_ROLE_VOCABULARY,
        },
        422,
      );
    }
    if (isCurrent(existing)) {
      // Idempotent: an identical current grant is reported, not rewritten.
      const sameRole = existing.role === role;
      return json(
        {
          ok: true,
          status: sameRole ? "Active" : "RoleMismatch",
          member: existing,
          idempotent: sameRole,
          apiVersion,
        },
        200,
      );
    }
    const stamp = now();
    if (existing) {
      // Re-granting a revoked membership is an explicit, audited reinstatement.
      await env.DB.prepare(
        "UPDATE project_members SET role=?, status=?, granted_by=?, granted_at=?, revoked_at=NULL WHERE id=?",
      )
        .bind(role, ACTIVE, actor.id, stamp, existing.id)
        .run();
      audit(env.DB, { projectId, action: "Project membership reinstated", previous: { role: existing.role, status: existing.status }, next: { role, status: ACTIVE }, reason, actor });
      return json({ ok: true, status: ACTIVE, memberId: existing.id, reinstated: true, apiVersion }, 200);
    }
    const memberId = id("pm");
    await env.DB.prepare(
      "INSERT INTO project_members (id, project_id, user_id, role, status, granted_by, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    )
      .bind(memberId, projectId, targetUserId, role, ACTIVE, actor.id, stamp)
      .run();
    audit(env.DB, { projectId, action: "Project member added", previous: null, next: { userId: targetUserId, role }, reason, actor });
    return json({ ok: true, status: ACTIVE, memberId, role, apiVersion }, 201);
  }

  // ---- update-role / remove require an existing current membership -------
  if (!existing) {
    return json(
      { error: { code: "PROJECT_MEMBER_NOT_FOUND", message: "That user is not a member of this project." } },
      404,
    );
  }

  if (action === ACTIONS.UPDATE_ROLE) {
    const role = String(body.role || "").trim();
    if (!PROJECT_ROLE_VOCABULARY.includes(role)) {
      return json(
        {
          error: {
            code: "PROJECT_ROLE_INVALID",
            message: `role must be one of the canonical project roles. "${role}" is not a project role.`,
          },
          vocabulary: PROJECT_ROLE_VOCABULARY,
        },
        422,
      );
    }
    if (existing.role === role && isCurrent(existing)) {
      return json({ ok: true, status: ACTIVE, member: existing, idempotent: true, apiVersion }, 200);
    }
    // CAS on the CURRENT role and status. A concurrent change wins; this update
    // affects nothing and the caller is told the truth.
    const updated = await env.DB.prepare(
      "UPDATE project_members SET role=?, granted_by=?, granted_at=? WHERE id=? AND role=? AND status=?",
    )
      .bind(role, actor.id, now(), existing.id, existing.role, existing.status)
      .run();
    const changes = Number(updated?.meta?.changes ?? updated?.changes ?? 0);
    if (changes !== 1) {
      const current = await membershipRow(env.DB, projectId, targetUserId);
      return json(
        { error: { code: "PROJECT_MEMBERSHIP_CONFLICT", message: "The membership changed concurrently; nothing was written." }, current, apiVersion },
        409,
      );
    }
    audit(env.DB, { projectId, action: "Project member role changed", previous: { role: existing.role }, next: { role }, reason, actor });
    return json({ ok: true, status: ACTIVE, memberId: existing.id, role, apiVersion }, 200);
  }

  // ---- remove ------------------------------------------------------------
  if (!isCurrent(existing)) {
    return json({ ok: true, status: existing.status, member: existing, idempotent: true, apiVersion }, 200);
  }
  const stamp = now();
  const updated = await env.DB.prepare(
    "UPDATE project_members SET status=?, revoked_at=? WHERE id=? AND status=? AND revoked_at IS NULL",
  )
    .bind(REVOKED, stamp, existing.id, ACTIVE)
    .run();
  const changes = Number(updated?.meta?.changes ?? updated?.changes ?? 0);
  if (changes !== 1) {
    const current = await membershipRow(env.DB, projectId, targetUserId);
    return json(
      { error: { code: "PROJECT_MEMBERSHIP_CONFLICT", message: "The membership changed concurrently; nothing was written." }, current, apiVersion },
      409,
    );
  }
  audit(env.DB, { projectId, action: "Project member removed", previous: { role: existing.role, status: ACTIVE }, next: { status: REVOKED }, reason, actor });
  return json({ ok: true, status: REVOKED, memberId: existing.id, apiVersion }, 200);
}

export async function handleProjectMembershipApi(request, env) {
  const pathname = new URL(request.url).pathname;
  const memberMatch = pathname.match(MEMBER_PATH);
  if (memberMatch) return handleMembership(request, env, memberMatch);
  const membersMatch = pathname.match(MEMBERS_PATH);
  if (membersMatch) return handleMembership(request, env, membersMatch);
  return null;
}
