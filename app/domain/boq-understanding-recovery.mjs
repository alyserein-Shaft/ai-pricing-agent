// GOVERNED INFRASTRUCTURE-FAILURE RECOVERY
// ===========================================================================
//
// THE GAP THIS CLOSES
//
// A BOQ item whose Understanding attempts all failed on PROVIDER/INFRASTRUCTURE
// grounds (a Workers AI upstream outage) becomes permanently unrecoverable once
// its retry budget is spent. That is wrong: the row did not fail because anything
// about the BOQ, the requirement, or the engineering was wrong. It failed because
// an external service was unavailable, and when that service returns the honest
// next step is to try again.
//
// The existing per-item retry path cannot express this. It caps attempts and then
// refuses, permanently, with no governed way to re-arm -- so a transient upstream
// outage silently becomes a terminal engineering verdict. That is the bug.
//
// WHAT RECOVERY IS, AND IS NOT
//
// Recovery authorizes ONE NEW ANALYSIS OPPORTUNITY. It does NOT:
//
//   * delete, rewrite or backdate any failed attempt;
//   * reset attemptCount or failedAttemptCount to zero;
//   * relabel a failure as a success;
//   * widen the retry budget, or create a standing/unlimited bypass;
//   * touch any BOQ data, extraction, classification or matching state.
//
// It changes AUTHORIZATION TO ATTEMPT. History is append-only and remains exactly
// as recorded. The canonical currentness resolver keeps reporting the true
// historical counts; only the eligibility answer changes, and only while the
// authorization is valid, unconsumed and bound to this exact exhausted state.
//
// BINDING, NOT FLOATING (§7)
//
// A recovery authorization is bound to the precise exhausted state it was granted
// against -- project, BOQ item, latest attempt id, failed-attempt count, input
// fingerprint, config fingerprint and provider/model. If ANY of those move before
// the new attempt is made, the authorization no longer applies and a fresh
// governed decision is required. One recovery can therefore never float across a
// future attempt, a changed input, or a different provider configuration.
//
// IDEMPOTENCY AND CONSUMPTION (§8, §10)
//
// One exhausted state yields at most ONE live authorization, enforced by a unique
// index rather than by application logic alone. When the authorized retry is
// actually attempted the authorization is CONSUMED. A second authorization
// requires a NEW exhausted state and a NEW governed decision -- never a replay.
//
// FAIL CLOSED (§4, §16)
//
// Only an explicitly recognised provider/infrastructure failure class is
// recoverable. An unknown or absent error code is treated as SEMANTIC and is never
// recoverable, so a novel failure cannot silently earn a retry budget reset.
// Application-level defects (schema validation, malformed model output, bad
// project input) are explicitly NOT provider failures, no matter how they are
// worded.
//
// SEPARATION OF HEALTH AND CONFIGURATION (§5)
//
// Authorization requires the provider to be demonstrably HEALTHY -- proven by a
// real successful call. `CONFIGURED` (binding present) is never sufficient: that
// check never calls the model, and reporting a configured-but-broken provider as
// healthy is precisely how this class of outage went unnoticed.

import { classifyAttemptFailure } from "./boq-understanding-currentness.mjs";

/** Recovery outcome vocabulary. Every path returns one of these -- never a silent no-op. */
export const UNDERSTANDING_RECOVERY_RESULTS = Object.freeze([
  "RECOVERY_AUTHORIZED",
  "RECOVERY_ALREADY_AUTHORIZED",
  "PROVIDER_UNHEALTHY",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_HEALTH_UNVERIFIED",
  "NOT_EXHAUSTED",
  "FAILURE_NOT_INFRASTRUCTURE",
  "FAILURE_CLASS_UNKNOWN",
  "RECOVERY_STALE",
  "RECOVERY_CONSUMED",
  "RECOVERY_NOT_FOUND",
  "RECOVERY_NOT_AUTHORIZED",
  "RECOVERY_REASON_REQUIRED",
  "RECOVERY_NOT_AUTHORIZED_ROLE",
  "ITEM_NOT_FOUND",
  "PROJECT_MISMATCH",
]);

const ok = (code, extra = {}) => ({ ok: true, code, ...extra });
const refused = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * Roles permitted to authorize infrastructure recovery.
 *
 * This is an OPERATIONAL/GOVERNANCE REPAIR action, not an engineering or
 * commercial decision: it restores the ability to re-observe an external
 * service, and asserts nothing about the BOQ's technical meaning. It therefore
 * requires an administrative role rather than an engineering sign-off, and the
 * role is resolved from the canonical application context -- NEVER from a request
 * payload, so an actor cannot claim a role they do not hold.
 */
export const RECOVERY_AUTHORIZED_ROLES = Object.freeze(["Administrator"]);

export const isRecoveryAuthorizedRole = (role) => RECOVERY_AUTHORIZED_ROLES.includes(String(role || ""));

/**
 * The health gate (§5).
 *
 * A recovery may only be authorized when the provider is demonstrably HEALTHY,
 * i.e. a real provider call has completed successfully. CONFIGURED / UNKNOWN /
 * UNHEALTHY / absent all refuse. Health evidence is supplied by the caller from
 * the existing probe; this function never performs I/O itself.
 */
export const evaluateRecoveryProviderGate = (health = {}) => {
  const state = String(health?.state || "UNKNOWN");
  if (health?.configured === false) {
    return refused("PROVIDER_NOT_CONFIGURED", "The BOQ Understanding provider is not configured, so no recovery can be justified.");
  }
  // CONFIGURED is explicitly NOT sufficient: it only proves a binding exists.
  if (state !== "HEALTHY") {
    return refused(
      state === "UNHEALTHY" ? "PROVIDER_UNHEALTHY" : "PROVIDER_HEALTH_UNVERIFIED",
      state === "CONFIGURED"
        ? "The provider is configured but its live health is unproven. Recovery requires a provider that has demonstrably completed a real call."
        : `Provider health is ${state}. Recovery requires a demonstrably healthy provider.`,
      { providerHealth: state },
    );
  }
  return ok("PROVIDER_HEALTHY", { providerHealth: state });
};

/**
 * Build the recovery identity (§7).
 *
 * This is the deterministic fingerprint a recovery authorization is bound to. Any
 * material change to the exhausted state -- a newer attempt, a different input
 * fingerprint, a different provider configuration, a different failed-attempt
 * count -- produces a DIFFERENT identity, which is what makes a stale recovery
 * detectable and forces a fresh governed decision rather than silently reusing an
 * old authorization.
 */
export const buildRecoveryIdentity = ({
  projectId,
  boqItemId,
  latestAttemptId,
  failedAttemptCount,
  inputFingerprint,
  configFingerprint,
  provider = null,
  model = null,
  currentnessState,
} = {}) => {
  const parts = [
    "boq-understanding-infrastructure-recovery-v1",
    projectId || "",
    boqItemId || "",
    latestAttemptId || "",
    String(failedAttemptCount ?? 0),
    inputFingerprint || "",
    configFingerprint || "",
    provider || "",
    model || "",
    currentnessState || "",
  ];
  return parts.join("|");
};

/**
 * Decide whether a recovery may be authorized, and on what terms.
 *
 * Pure: no I/O, no database, no provider call. The caller supplies the persisted
 * facts and the probe result. Returns a governed result object; it never throws
 * for an ordinary refusal, and it NEVER returns an ambiguous "no".
 *
 * @param {object} options
 * @param {string}  options.role                 canonical resolved role (never from payload)
 * @param {string}  options.reason               substantive operator justification
 * @param {object}  options.currentness          result of resolveUnderstandingCurrentness
 * @param {object}  options.health               result of the live provider health probe
 * @param {?object} options.existingRecovery      the already-persisted authorization, if any
 */
export const evaluateRecoveryRequest = ({
  role = null,
  reason = "",
  currentness = null,
  health = null,
  existingRecovery = null,
  projectId = null,
  boqItemId = null,
  latestAttempt = null,
  provider = null,
  model = null,
  minReasonLength = 12,
} = {}) => {
  // ---- 1. AUTHORITY FIRST. An unauthorized actor is refused before any other
  //         consideration, and the role is the caller's canonical resolution.
  if (!isRecoveryAuthorizedRole(role)) {
    return refused(
      "RECOVERY_NOT_AUTHORIZED_ROLE",
      "Infrastructure recovery requires an authorized administrative role.",
      { requiredRoles: [...RECOVERY_AUTHORIZED_ROLES] },
    );
  }

  // ---- 2. SUBSTANTIVE REASON. A recovery must be justified in words, so it
  //         cannot be triggered by an accidental or automated call.
  const justification = String(reason || "").trim();
  if (justification.length < minReasonLength) {
    return refused("RECOVERY_REASON_REQUIRED", `Provide a substantive recovery reason (at least ${minReasonLength} characters).`);
  }

  // ---- 3. THE ROW MUST ACTUALLY BE EXHAUSTED. Recovery is only meaningful for
  //         FAILED_RETRY_EXHAUSTED; it is never a way to re-run a healthy or
  //         merely-stale row.
  if (!currentness || currentness.state !== "FAILED_RETRY_EXHAUSTED") {
    return refused(
      "NOT_EXHAUSTED",
      `Recovery applies only to a retry-exhausted infrastructure failure. This item is ${currentness?.state || "unknown"}.`,
      { currentnessState: currentness?.state ?? null },
    );
  }

  // ---- 4. FAILURE CLASS MUST BE INFRASTRUCTURE, and must be KNOWN.
  const errorCode = latestAttempt?.errorCode ?? null;
  const failureClass = classifyAttemptFailure(errorCode);
  if (failureClass === "UNKNOWN") {
    // Fail closed. An unclassified failure must never earn a retry budget reset.
    return refused("FAILURE_CLASS_UNKNOWN", "The failure class is unknown, so infrastructure recovery cannot be justified.", { errorCode });
  }
  if (failureClass !== "INFRASTRUCTURE") {
    return refused(
      "FAILURE_NOT_INFRASTRUCTURE",
      "This failure is a processing/semantic failure, not a provider outage. Recovery does not apply.",
      { errorCode, failureClass },
    );
  }

  // ---- 5. PROVIDER MUST BE DEMONSTRABLY HEALTHY (not merely configured).
  const gate = evaluateRecoveryProviderGate(health || {});
  if (!gate.ok) return gate;

  // ---- 6. IDEMPOTENCY: one exhausted state, one live authorization.
  const identity = buildRecoveryIdentity({
    projectId,
    boqItemId,
    latestAttemptId: latestAttempt?.id || currentness.latestAttemptId,
    failedAttemptCount: currentness.failedAttemptCount,
    inputFingerprint: currentness.actualInputFingerprint,
    configFingerprint: latestAttempt?.configFingerprint || null,
    provider,
    model,
    currentnessState: currentness.state,
  });
  if (existingRecovery) {
    // A CONSUMED authorization is not reusable: a new attempt already happened,
    // so a new authorization requires a NEW exhausted state.
    if (existingRecovery.consumedAt || existingRecovery.consumed) {
      return refused(
        "RECOVERY_CONSUMED",
        "The previous recovery authorization for this exhausted state has already been consumed by an actual retry attempt.",
        { recoveryIdentity: identity, consumedAt: existingRecovery.consumedAt || existingRecovery.consumed || null },
      );
    }
    if (existingRecovery.identity === identity) {
      // Idempotent replay: the same governed decision, not a second allowance.
      return ok("RECOVERY_ALREADY_AUTHORIZED", {
        recoveryIdentity: identity,
        recoveryId: existingRecovery.id || null,
        idempotent: true,
      });
    }
    // The exhausted state moved underneath the existing authorization.
    return refused(
      "RECOVERY_STALE",
      "The exhausted state changed since the existing recovery authorization; a fresh governed recovery decision is required.",
      { recoveryIdentity: identity, existingIdentity: existingRecovery.identity || null },
    );
  }

  return ok("RECOVERY_AUTHORIZED", {
    recoveryIdentity: identity,
    justification,
    errorCode,
    failureClass,
    // A snapshot of the health evidence that justified this decision (§11). Safe
    // by construction: a state string and a failure class, never a credential,
    // header or raw upstream payload.
    healthEvidence: Object.freeze({
      configured: Boolean(health?.configured),
      state: String(health?.state || "UNKNOWN"),
      failureClass: health?.failureClass ?? null,
      model: health?.model ?? null,
    }),
    failedAttemptCount: currentness.failedAttemptCount,
    latestAttemptId: currentness.latestAttemptId,
  });
};

/**
 * §10 CONSUMPTION.
 *
 * Called when the authorized retry is actually attempted. Returns the consumed
 * authorization, or a refusal explaining why it may not be consumed (already
 * consumed, identity moved, or no authorization exists). Consumption never
 * modifies any attempt row.
 */
export const evaluateRecoveryConsumption = ({ existingRecovery = null, currentIdentity = null, currentness = null } = {}) => {
  if (!existingRecovery) {
    return refused("RECOVERY_NOT_FOUND", "No recovery authorization exists for this item.");
  }
  if (existingRecovery.consumedAt || existingRecovery.consumed) {
    return refused("RECOVERY_CONSUMED", "This recovery authorization has already been consumed.", { consumedAt: existingRecovery.consumedAt || existingRecovery.consumed || null });
  }
  // If the state moved, the authorization no longer describes reality.
  if (existingRecovery.identity !== currentIdentity) {
    return refused("RECOVERY_STALE", "The exhausted state changed; this recovery authorization no longer applies.", {
      recoveryIdentity: currentIdentity,
      existingIdentity: existingRecovery.identity || null,
    });
  }
  // After consumption the row is back under ordinary retry policy (§17).
  return ok("RECOVERY_CONSUMED", {
    recoveryIdentity: currentIdentity,
    // The failure count is reported, never reset: history stands.
    failedAttemptCount: currentness?.failedAttemptCount ?? null,
  });
};