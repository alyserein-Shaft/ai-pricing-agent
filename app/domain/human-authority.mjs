// Human decision authority -- POLICY, shared by every governed write path.
//
// WHY THIS IS DOMAIN AND NOT IN `worker/human-actor.mjs`. That module resolves
// an identity from server configuration, which is deployment wiring. But "is
// this identity allowed to approve canonical truth?" is a governance rule, and
// it is needed in two places that cannot both import from `worker/`:
//
//   * `worker/human-actor.mjs` (which reads APP_HUMAN_ID and must refuse the
//     synthetic fallback), and
//   * `app/domain/knowledge-source-authority-review.mjs` -- the governed
//     correction of a stored source authority, which is the single
//     trust-sensitive write in the Knowledge library and lives in `app/domain/`.
//
// The established dependency direction in this codebase is worker -> domain,
// never the reverse, so `app/domain/*.mjs` must not import from `worker/*.mjs`.
// Duplicating the synthetic-id list into the domain module would leave two
// definitions that could drift -- and the failure mode of drift here is not a
// crash, it is a synthetic identity quietly acquiring approval authority. So the
// policy lives here and `worker/human-actor.mjs` imports and re-exports it,
// leaving every existing importer of that module working unchanged.
//
// WHAT THE RULE IS. An identity may record a human decision when ALL of these
// hold:
//
//   1. it has a non-blank id;
//   2. the id is not one of the synthetic placeholders a deployment falls back
//      to when no human is configured (`local-development-user`, `system`, ...);
//   3. it carries `source === HUMAN_ACTOR_SOURCE`, i.e. it came from server
//      configuration rather than from a request.
//
// Clause 3 is the one that is easy to get wrong. `humanActor.synthetic === false`
// is an ATTESTATION: a caller can assert it for any id it likes. Only `source`
// records where the identity came from, so only `source` is worth checking, and
// even that is recorded in the audit row so a later reader can tell a
// config-derived actor from an asserted one.
//
// DISCOVERY IS NOT APPROVAL. `local-development-user` is a legitimate actor for
// research and extraction -- it is why the Batch-1 findings exist at all. It is
// not a legitimate actor for approving them. Those are different acts and the
// audit trail has to be able to say which one happened, so this rule separates
// them rather than treating the synthetic id as universally disallowed.

export const HUMAN_ACTOR_SOURCE = "server-configured-human-operator";

/**
 * Identities that are never a human, even if an operator configures them.
 * The development fallback must not be quotable as a human decision-maker.
 *
 * Frozen so a governed path cannot add an id at runtime: this list is the
 * difference between an audit trail and a decoration.
 */
export const SYNTHETIC_ACTOR_IDS = Object.freeze(
  new Set(["local-development-user", "system", "administrator", "admin", "unknown", "anonymous"]),
);

/** True when the id is one of the synthetic placeholders, case-insensitively. */
export const isSyntheticActorId = (id) => SYNTHETIC_ACTOR_IDS.has(String(id ?? "").trim().toLowerCase());

/**
 * The one predicate every governed write path uses to decide whether an actor
 * may be quoted as a human decision-maker.
 *
 * Returns a bare boolean on purpose: callers attach their own status code and
 * their own message, because the right refusal differs between a packet
 * decision, a source-authority correction and a requirement approval, and a
 * shared message would either be too vague or would leak one route's vocabulary
 * into another.
 */
export const isHumanDecisionActor = (actor) => {
  const id = String(actor?.id ?? "").trim();
  if (!id) return false;
  if (isSyntheticActorId(id)) return false;
  return actor?.source === HUMAN_ACTOR_SOURCE;
};

/**
 * A short explanation for a refusal, safe to record in an audit row. Never
 * includes the supplied value itself: a refusal log must not become a place
 * where ids accumulate.
 */
export const humanDecisionActorRefusal = (actor) => {
  const id = String(actor?.id ?? "").trim();
  if (!id) return "no identity was supplied";
  if (isSyntheticActorId(id)) return "the supplied identity is a synthetic development placeholder, not a human";
  return "the supplied identity did not come from server configuration";
};
