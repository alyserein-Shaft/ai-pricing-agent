// Truthful human actor attribution (R1 integration).
//
// THE PROBLEM THIS SOLVES. Every governed write path quotes an actor identity
// (`decided_by`, `reviewed_by`, `actor_user_id`) taken from the application
// context's `userId`. In single-user R1 that value is server configuration
// (`local-development-user`), which is a SYNTHETIC development fallback, not a
// human being. Recording a requirement approval, a BOQ review, a human
// Understanding EDIT, or an ecosystem decision under that identity fabricates
// provenance: the audit trail claims a human decided when only configuration
// did.
//
// WHAT THIS MODULE IS. The single-user R1 truth model: one operator, whose
// human identity is configured EXPLICITLY on the server
// (`APP_HUMAN_ID` / `APP_HUMAN_NAME` / `APP_HUMAN_EMAIL`). Identity is never
// read from the request -- no header, cookie, or body field can supply or
// override it, so arbitrary impersonation through a client-supplied actor is
// impossible by construction. The R1 session/bearer gate (`r1-access.mjs`,
// enforced in `worker/index.ts`) separately proves the caller is the operator;
// this module names the human that operator is.
//
// WHAT THIS MODULE IS NOT. It is not multi-user IAM: there are no passwords,
// no user table, no roles here. Ownership checks (`owner_user_id`) are
// untouched -- the synthetic user still owns the existing data, and no data
// migration is required. Attribution and ownership are separate facts and are
// carried separately.
//
// FAIL-CLOSED CONTRACT. `requireHumanActor` returns `{ error }` -- and every
// wired mutation route turns that into HTTP 403 -- whenever the human identity
// is absent, blank, malformed, or collides with the synthetic fallback. A
// human-authority write can never silently downgrade to `local-development-user`.
//
// OPERATOR SETUP (server side, never in the browser bundle, never committed):
//   APP_HUMAN_ID=op-<stable-id>        # required, e.g. the operator's staff id
//   APP_HUMAN_NAME=<display name>       # required
//   APP_HUMAN_EMAIL=<email>             # optional but recommended
// Until these are set, human-authority mutations refuse with
// HUMAN_ACTOR_NOT_CONFIGURED while reads and system-automation keep working.

// The POLICY ("what may be quoted as a human decision-maker") lives in
// app/domain/human-authority.mjs and is re-exported here unchanged, so every
// existing importer of this module keeps working and there is exactly one
// definition. It cannot live here: app/domain/*.mjs must never import from
// worker/*.mjs (the established direction is worker -> domain), and the
// governed source-authority correction in app/domain needs the same rule.
import {
  HUMAN_ACTOR_SOURCE,
  SYNTHETIC_ACTOR_IDS,
  isSyntheticActorId,
} from "../app/domain/human-authority.mjs";

export { HUMAN_ACTOR_SOURCE, SYNTHETIC_ACTOR_IDS, isSyntheticActorId };

const configured = (value) => String(value ?? "").trim() || null;

export const HUMAN_ACTOR_ERRORS = Object.freeze({
  NOT_CONFIGURED: "HUMAN_ACTOR_NOT_CONFIGURED",
  INVALID_ID: "HUMAN_ACTOR_ID_INVALID",
  MISSING_NAME: "HUMAN_ACTOR_NAME_REQUIRED",
});

/**
 * Resolve the truthful human actor from SERVER configuration only.
 * Pure: no request access, no DB, no side effects. Returns the actor or null
 * (never a synthetic fallback, never a client value).
 */
export const resolveHumanActor = (env = {}) => {
  const id = configured(env.APP_HUMAN_ID);
  const name = configured(env.APP_HUMAN_NAME);
  const email = configured(env.APP_HUMAN_EMAIL);
  if (!id) return null;
  if (isSyntheticActorId(id)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(id)) return null;
  if (!name) return null;
  return Object.freeze({
    id,
    name,
    email: email || null,
    source: HUMAN_ACTOR_SOURCE,
    synthetic: false,
  });
};

/**
 * Gate for human-authority mutations. Returns { actor } or { error, message }.
 * Every wired route refuses the write when this errors -- provenance must not
 * silently downgrade to the synthetic development user.
 */
export const requireHumanActor = (env = {}) => {
  const hasId = configured(env.APP_HUMAN_ID);
  if (!hasId) {
    return {
      error: HUMAN_ACTOR_ERRORS.NOT_CONFIGURED,
      message: "No truthful human identity is configured on this server. Set APP_HUMAN_ID / APP_HUMAN_NAME (/ APP_HUMAN_EMAIL) to record human-authority decisions; synthetic development identity cannot be quoted as a human decision-maker.",
    };
  }
  const actor = resolveHumanActor(env);
  if (!actor) {
    const id = configured(env.APP_HUMAN_ID);
    if (!id || isSyntheticActorId(id) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(id)) {
      return {
        error: HUMAN_ACTOR_ERRORS.INVALID_ID,
        message: "The configured APP_HUMAN_ID is blank, malformed, or collides with a synthetic identity. Human-authority decisions are refused until a genuine human identifier is configured.",
      };
    }
    return {
      error: HUMAN_ACTOR_ERRORS.MISSING_NAME,
      message: "APP_HUMAN_NAME is required alongside APP_HUMAN_ID so audit provenance names a real human.",
    };
  }
  return { actor };
};

/** Describe actor availability for readiness/diagnostics without leaking values. */
export const humanActorReadiness = (env = {}) => {
  const result = requireHumanActor(env);
  if (result.actor) return { status: "pass", mode: "server-configured-human", source: HUMAN_ACTOR_SOURCE };
  return { status: "fail", mode: "synthetic-only", code: result.error, reason: result.message };
};
