// R1 identity presentation.
//
// WHAT THIS IS FOR
// The Administration "ACCOUNT" card and the application header both rendered
// the configured session name verbatim and labelled it "Administrator". In this
// deployment that name is `Local Development User` (see `.dev.vars`:
// `LOCAL_DEVELOPMENT_USER_NAME=Local Development User`, `APP_USER_ID=
// local-development-user`) -- a SYNTHETIC development fallback, not a person.
// The UI therefore told the engineer that a synthetic identity was the
// administrator making governed decisions.
//
// THREE IDENTITIES, KEPT SEPARATE
//   1. authentication/session identity -- who the server is talking to. This
//      is always present and is not evidence of a human.
//   2. human technical actor -- the governed person attributed on approvals,
//      review events and audit rows. Only an authority backend can supply it.
//   3. development fallback identity -- `local-development-user`, used when no
//      human is configured. Legitimate for local runs, never a human.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
// It does not invent a name. `local-development-user` has no human behind it, so
// this module reports the session as a development session and says that
// governed decisions are attributed elsewhere. Substituting a real person's
// name here would fabricate a human actor in every governed write made from the
// UI -- exactly the failure this presentation is meant to stop.
//
// TO ATTRIBUTE A REAL HUMAN
// Configure `APP_USER_NAME` (with `APP_USER_EMAIL`/`APP_USER_ID`). That is the
// existing server-configured path: `worker/application-context.mjs` prefers it
// over `LOCAL_DEVELOPMENT_USER_NAME`. No UI change is needed, and no role or
// permission semantics are inferred anywhere here.
//
// The server is the only authority for which of these an actor is; this module
// only formats what the server already returned.

const SYNTHETIC_IDS = new Set([
  "local-development-user",
  "system",
  "administrator",
  "admin",
  "unknown",
  "anonymous",
  "development",
]);

const SYNTHETIC_NAMES = new Set([
  "local development user",
  "local-development-user",
  "development user",
  "local user",
  "system",
  "unknown",
  "anonymous",
]);

// Mirrors the synthetic-actor vocabulary already enforced by
// `app/domain/human-authority.mjs`, so the UI cannot present an actor as human
// that the authority layer would refuse to treat as one.
function syntheticId(actor) {
  return String(actor?.userId || actor?.id || "").trim().toLowerCase();
}

export function isSyntheticActor(actor) {
  const id = syntheticId(actor);
  if (id && SYNTHETIC_IDS.has(id)) return true;
  const name = String(actor?.displayName || "").trim().toLowerCase();
  return Boolean(name) && SYNTHETIC_NAMES.has(name);
}

/**
 * Present a session identity truthfully.
 *
 * Returns the label/detail pair to render plus the flags a caller needs in
 * order to avoid implying human authority:
 *   `synthetic`         -- this is a development fallback, not a person
 *   `attribution`       -- what governed writes will actually record
 *   `permissionSuffix`  -- advisory text; never a permission change
 */
export function presentActor(actor) {
  const displayName = String(actor?.displayName || "").trim();
  const email = String(actor?.email || "").trim();
  const synthetic = isSyntheticActor(actor);

  if (synthetic) {
    return {
      label: "Development session",
      detail: displayName && !SYNTHETIC_NAMES.has(displayName.toLowerCase())
        ? displayName
        : "No human actor configured",
      // Named explicitly so no surface can read as a person.
      attribution: "Governed decisions are attributed to the configured human actor, not this session.",
      synthetic: true,
    };
  }

  return {
    label: displayName || email || "Unknown user",
    detail: email && email !== displayName ? email : "",
    attribution: "",
    synthetic: false,
  };
}