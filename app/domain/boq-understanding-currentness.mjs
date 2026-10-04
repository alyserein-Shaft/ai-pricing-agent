// CANONICAL BOQ UNDERSTANDING CURRENTNESS CONTRACT
// ===========================================================================
//
// THE DEFECT THIS CLOSES
//
// Two surfaces independently answered "is this BOQ item's Understanding
// interpretation current?", and they disagreed:
//
//   * the controlled-pilot manifest (`alreadyInterpretedItemIds`) answered
//     YES/NO from input-fingerprint + config-fingerprint equality ALONE;
//   * the review layer (`resolveEffectiveUnderstandingInterpretation`) answered
//     from fingerprint equality PLUS a usability rule (the attempt must have
//     produced a COMPLETED or NEEDS_REVIEW interpretation).
//
// A row whose only fingerprint-matching attempt FAILED therefore satisfied the
// manifest's predicate (so the manifest declared it already-interpreted and
// never queued it) while failing the review layer's predicate (so every review
// action was blocked and it reported REVALIDATION_REQUIRED). Neither surface
// could ever advance the row. That is a structurally unreachable state, and it
// was live for multiple Central Kitchen Fire Alarm rows.
//
// The failure was a SPLIT BRAIN between two predicates, not bad data. The
// stored interpretations were fine; the questions were being asked differently.
//
// THIS MODULE IS THE ONE ANSWER
//
// `resolveUnderstandingCurrentness` is a PURE resolver. Both consumers must call
// it. Neither may reconstruct the logic.
//
// ---------------------------------------------------------------------------
// CURRENTNESS AND ELIGIBILITY ARE DIFFERENT QUESTIONS
//
// "Is the interpretation current?" and "May the system run another attempt?" are
// NOT the same question and are deliberately reported as separate facts:
//
//   * a CURRENT row is normally not eligible for a fresh attempt (no point
//     re-running an interpretation whose inputs have not changed);
//   * a STALE row is normally eligible for revalidation, but only if execution
//     is permitted -- provider health and retry budget are INDEPENDENT gates;
//   * a retry-EXHAUSTED row is stale or current on input terms but still cannot
//     be attempted, and that refusal is reported as `eligibleForRetry: false`
//     with an explicit reason, never by pretending the row is current.
//
// Conflating them is what produced the impossible state in the first place.
// ---------------------------------------------------------------------------
//
// AUTHORITY AND TRUST BOUNDARIES
//
// This resolver is a pure function of facts handed to it. It performs NO I/O,
// never calls a provider, never reads a database and never mutates anything, so
// it is exhaustively testable without any infrastructure.
//
// It derives classification/eligibility from governed review state ONLY. It is
// never derived from a product candidate, a selected SKU, a price, a brand
// strategy or a historical quotation. The direction stays:
//   classification -> requirements -> matching
// never:
//   candidate -> classification
//
// Nothing here mutates or rewrites a raw machine confidence. `system_confidence`
// stays exactly as extracted; this module only reports which interpretation
// currently governs.

/** Statuses that constitute a usable interpretation. */
export const USABLE_INTERPRETATION_STATUSES = Object.freeze(["COMPLETED", "NEEDS_REVIEW"]);

/** Statuses that represent a failed attempt. */
export const FAILED_INTERPRETATION_STATUSES = Object.freeze(["FAILED", "AI_UNAVAILABLE"]);

/**
 * The canonical currentness/retry state machine.
 *
 * Naming deliberately follows existing architecture vocabulary where one
 * already exists, and adds nothing merely for naming convenience:
 *
 *   NEVER_ANALYZED               no interpretation attempt has ever existed
 *   CURRENT                      a usable interpretation matches the current
 *                                 semantic inputs and the current config
 *   STALE_REVALIDATION_REQUIRED  a usable interpretation exists but its inputs
 *                                 (or configuration) have changed since
 *   SUPERSEDED                   a newer attempt has replaced an older one
 *   FAILED_RETRYABLE             the newest attempt failed and retry budget
 *                                 remains
 *   FAILED_RETRY_EXHAUSTED       the newest attempt failed and the retry budget
 *                                 is spent -- needs recovery authority
 *   FAILED_SEMANTIC              the newest attempt failed for a
 *                                 non-provider, non-transient reason
 *
 * CURRENTNESS and ELIGIBILITY are separate fields, never one derived from the
 * other by accident.
 */
export const UNDERSTANDING_CURRENTNESS_STATES = Object.freeze([
  "NEVER_ANALYZED",
  "CURRENT",
  "STALE_REVALIDATION_REQUIRED",
  "SUPERSEDED",
  "FAILED_RETRYABLE",
  "FAILED_RETRY_EXHAUSTED",
  "FAILED_SEMANTIC",
]);

/** Failure classes that represent provider/INFRASTRUCTURE failure, not a semantic problem. */
export const INFRASTRUCTURE_FAILURE_CODES = Object.freeze([
  "AI_PROVIDER_ERROR",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_AUTHORIZATION_FAILED",
  "AI_PROVIDER_REQUEST_REJECTED",
  "AI_PROVIDER_UPSTREAM_UNAVAILABLE",
]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const frozen = (value) => Object.freeze(value);

/**
 * Fail-closed classification of a failed attempt.
 *
 * ONLY an explicitly recognised provider/infrastructure failure class is ever
 * treated as infrastructure-recoverable. An unknown or absent error code is
 * treated as SEMANTIC, so a novel failure can never silently earn a retry
 * budget reset.
 */
export const classifyAttemptFailure = (errorCode) => {
  const code = String(errorCode || "").trim().toUpperCase();
  if (!code) return "UNKNOWN";
  return INFRASTRUCTURE_FAILURE_CODES.includes(code) ? "INFRASTRUCTURE" : "SEMANTIC";
};

const newestFirst = (left, right) => {
  const version = Number(right?.versionNumber || 0) - Number(left?.versionNumber || 0);
  if (version) return version;
  const created = String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""));
  if (created) return created;
  return String(right?.interpretationId || "").localeCompare(String(left?.interpretationId || ""));
};

/**
 * The ONE canonical resolver.
 *
 * @param {object} options
 * @param {string}  options.currentInputFingerprint  recomputed from today's semantic inputs
 * @param {Array}   options.attempts                 every historical attempt for the item
 * @param {string?} options.currentConfigFingerprint  current provider/config fingerprint
 * @param {boolean} options.isCurrentConfig           per-attempt config currency predicate result
 * @param {number}  options.maxRetryAttempts          retry budget (attempts allowed)
 * @param {boolean} options.recoveredAt               a governed recovery re-armed this row
 * @returns {object} explicit, frozen currentness facts
 */
export const resolveUnderstandingCurrentness = ({
  currentInputFingerprint = null,
  attempts = [],
  currentConfigFingerprint = null,
  isCurrentConfig = () => true,
  maxRetryAttempts = 3,
  recovery = null,
  recoveryExpectedIdentity = null,
} = {}) => {
  const history = asArray(attempts).filter(Boolean).slice().sort(newestFirst);
  const expected = currentInputFingerprint || null;

  // The newest attempt that matches TODAY's semantic inputs. This is the
  // interpretation that would actually be used, so it is the one whose status
  // decides usability.
  const fingerprintMatched = expected ? history.filter((a) => a.inputFingerprint === expected) : [];
  const configCurrent = (attempt) => {
    if (currentConfigFingerprint == null) return true;
    try { return Boolean(isCurrentConfig(attempt?.configFingerprint, currentConfigFingerprint, attempt?.authorizationFingerprint)); }
    catch { return false; }
  };

  const matchingCurrentConfig = fingerprintMatched.filter(configCurrent);
  // An attempt with NO recorded status is treated as USABLE. That is deliberate
  // backward compatibility: a caller that only supplies the legacy
  // "input:config:auth" fingerprint list has no status evidence either way, and
  // its pre-existing coverage semantics were "a fingerprint match means already
  // interpreted". Any attempt that DOES carry a real status is judged strictly.
  const statusOf = (attempt) => (attempt?.status == null ? "COMPLETED" : attempt.status);
  const usable = matchingCurrentConfig.filter((a) => USABLE_INTERPRETATION_STATUSES.includes(statusOf(a)));
  const newestUsable = usable[0] || null;
  // A NEWER failed attempt on the SAME fingerprint supersedes an older usable one
  // for the same inputs: the most recent attempt against today's inputs is the
  // one that actually reflects provider/model behaviour now. Ignoring it would
  // let a provider outage masquerade as a CURRENT row because an older success
  // happens to share the fingerprint. A usable attempt only counts as current
  // when nothing newer and worse exists for these inputs.
  const supersededByNewerAttempt = Boolean(
    newestUsable
    && matchingCurrentConfig.length > usable.length
    && matchingCurrentConfig[0].versionNumber > newestUsable.versionNumber,
  );
  const newestAttemptOverall = history[0] || null;

  // Retry budget counts ATTEMPTS that failed, matching the existing
  // MAX_PER_ITEM_RETRY_ATTEMPTS accounting so this resolver cannot disagree
  // with the retry gate about how much budget is left.
  const failedCount = history.filter((a) => FAILED_INTERPRETATION_STATUSES.includes(statusOf(a))).length;
  // §9/§15: recovery is an ADDITIVE AUTHORIZATION, never a counter reset. It
  // only takes effect when it is a real, current, UNCONSUMED authorization for
  // this exact exhausted state. Every historical count below is reported exactly
  // as recorded whether or not a recovery exists.
  //
  // A recovery is honoured only when: it exists, is not consumed, and its
  // identity still matches the CURRENT exhausted state. A consumed or stale
  // authorization is ignored -- which is what stops one recovery from floating
  // across future attempts or becoming a standing bypass.
  const recoveryPresent = Boolean(recovery && recovery.identity);
  const recoveryConsumed = Boolean(recovery?.consumedAt || recovery?.consumed);
  const recoveryIdentityMatches = Boolean(
    recoveryPresent && !recoveryConsumed && recoveryExpectedIdentity
    && recovery.identity === recoveryExpectedIdentity,
  );
  const recoveryApplied = recoveryPresent && recoveryIdentityMatches && !recoveryConsumed;
  const retryBudgetRemaining = recoveryApplied
    ? Math.max(0, Number(maxRetryAttempts || 0))
    : Math.max(0, Number(maxRetryAttempts || 0) - failedCount);

  // Shared classification for a failed newest attempt, used by both the
  // "current inputs" branch and the general fallback branch so the two can
  // never drift apart.
  // Returns the STATE plus its facts, so a caller can never pass the facts object
  // where a state string is expected (which would silently report `state` as an
  // object and drop every field).
  const classifyFailedAttempt = (failed) => {
    const failureClass = classifyAttemptFailure(failed?.errorCode);
    if (failureClass !== "INFRASTRUCTURE") {
      return {
        state: "FAILED_SEMANTIC",
        current: false,
        requiresRevalidation: true,
        staleReason: "LATEST_ATTEMPT_FAILED_NON_INFRASTRUCTURE",
        eligibleForAnalysis: retryBudgetRemaining > 0,
        eligibleForRetry: retryBudgetRemaining > 0,
        retryBlockReason: retryBudgetRemaining > 0 ? null : "RETRY_BUDGET_EXHAUSTED",
        retryableFailureClass: failureClass,
      };
    }
    if (retryBudgetRemaining > 0) {
      return {
        state: "FAILED_RETRYABLE",
        current: false,
        requiresRevalidation: true,
        staleReason: "LATEST_ATTEMPT_FAILED_PROVIDER_INFRASTRUCTURE",
        eligibleForAnalysis: true,
        eligibleForRetry: true,
        retryBlockReason: null,
        retryableFailureClass: failureClass,
      };
    }
    return {
      state: "FAILED_RETRY_EXHAUSTED",
      current: false,
      requiresRevalidation: true,
      staleReason: "INFRASTRUCTURE_FAILURES_EXHAUSTED_THE_RETRY_BUDGET",
      eligibleForAnalysis: false,
      eligibleForRetry: false,
      // Recovery authority -- NOT a budget reset -- is what re-arms this row.
      retryBlockReason: "REQUIRES_GOVERNED_INFRASTRUCTURE_RECOVERY",
      retryableFailureClass: failureClass,
    };
  };

  const base = frozen({
    currentInterpretationId: newestUsable?.interpretationId || null,
    latestAttemptId: newestAttemptOverall?.interpretationId || null,
    latestAttemptStatus: newestAttemptOverall?.status || null,
    expectedInputFingerprint: expected,
    actualInputFingerprint: newestAttemptOverall?.inputFingerprint || null,
    attemptCount: history.length,
    failedAttemptCount: failedCount,
    retryBudgetRemaining,
    retryBudgetExhausted: retryBudgetRemaining === 0,
    recoveryApplied,
    recoveryPresent,
    recoveryConsumed,
    recoveryIdentityMatches,
    recoveryIdentity: recoveryPresent ? recovery.identity : null,
    recoveryActor: recovery?.actor || null,
    recoveryReason: recovery?.reason || null,
  });

  const finish = (state, extra = {}) => frozen({
    ...base,
    state,
    // A recovery-authorised row is no longer budget-exhausted for the purpose of
    // a NEW attempt, but its history is preserved and reported untouched.
    ...extra,
  });

  // ---- NO HISTORY ---------------------------------------------------------
  if (!history.length) {
    return finish("NEVER_ANALYZED", {
      current: false,
      requiresRevalidation: false,
      staleReason: "NO_INTERPRETATION_ATTEMPT_EXISTS",
      eligibleForAnalysis: true,
      eligibleForRetry: false,
      retryBlockReason: null,
      retryableFailureClass: null,
    });
  }

  // ---- A USABLE INTERPRETATION MATCHES TODAY ------------------------------
  if (newestUsable && !supersededByNewerAttempt) {
    return finish("CURRENT", {
      current: true,
      requiresRevalidation: false,
      staleReason: null,
      eligibleForAnalysis: false,
      eligibleForRetry: false,
      retryBlockReason: "INTERPRETATION_IS_CURRENT",
      retryableFailureClass: null,
    });
  }

  // ---- THE NEWEST ATTEMPT AGAINST TODAY'S INPUTS FAILED --------------------
  // Checked BEFORE the stale branch: when the newest attempt for the CURRENT
  // inputs failed, that failure is the truthful description of the row, even if
  // an older usable attempt shares the fingerprint. Reporting STALE here would
  // misattribute a provider outage to changed inputs.
  const newestForCurrentInputs = matchingCurrentConfig[0] || null;
  if (newestForCurrentInputs && FAILED_INTERPRETATION_STATUSES.includes(statusOf(newestForCurrentInputs))) {
    { const { state, ...facts } = classifyFailedAttempt(newestForCurrentInputs); return finish(state, facts); }
  }

  // ---- SUPERSEDED: a usable interpretation exists but under OTHER inputs ---
  const usableElsewhereAttemptIds = history.filter((a) => USABLE_INTERPRETATION_STATUSES.includes(statusOf(a)))
    .map((a) => a.interpretationId);
  const usableElsewhere = usableElsewhereAttemptIds.length > 0;
  if (usableElsewhere) {
    // `usable` is empty in this branch (a usable interpretation exists only
    // under OTHER inputs), so this can never be decided by comparing against it.
    // The distinction that matters is whether the newest attempt overall is a
    // SUPERSEDING newer one or simply predates the input change.
    const newerThanUsable = Boolean(
      newestAttemptOverall
      && usableElsewhereAttemptIds.length
      && !usableElsewhereAttemptIds.includes(newestAttemptOverall.interpretationId),
    );
    return finish("STALE_REVALIDATION_REQUIRED", {
      current: false,
      requiresRevalidation: true,
      staleReason: newerThanUsable
        ? "A_NEWER_ATTEMPT_SUPERSEDED_THE_CURRENT_INTERPRETATION"
        : "SEMANTIC_INPUTS_CHANGED_SINCE_THE_INTERPRETATION",
      eligibleForAnalysis: true,
      eligibleForRetry: false,
      retryBlockReason: null,
      retryableFailureClass: null,
    });
  }

  // ---- THE NEWEST ATTEMPT FAILED ------------------------------------------
  const newestFailed = newestAttemptOverall;
  if (newestFailed && FAILED_INTERPRETATION_STATUSES.includes(statusOf(newestFailed))) {
    { const { state, ...facts } = classifyFailedAttempt(newestFailed); return finish(state, facts); }
  }
  // ---- Fallback: matched an input but was neither usable nor a clean failure
  return finish("STALE_REVALIDATION_REQUIRED", {
    current: false,
    requiresRevalidation: true,
    staleReason: "NO_USABLE_INTERPRETATION_FOR_CURRENT_INPUTS",
    eligibleForAnalysis: true,
    eligibleForRetry: false,
    retryBlockReason: null,
    retryableFailureClass: null,
  });
};

/**
 * Provider-health EXECUTION gate.
 *
 * This is deliberately NOT a currentness state. A row may legitimately be
 * STALE_REVALIDATION_REQUIRED (and therefore eligible for analysis) while the
 * provider is UNHEALTHY and execution is still refused. Keeping the two
 * separate prevents retry churn against a broken provider without lying about
 * the row's semantic state.
 */
export const resolveUnderstandingExecutionGate = (currentness, providerHealth = {}) => {
  const state = String(providerHealth?.state || "UNKNOWN");
  const refused = state !== "HEALTHY";
  return frozen({
    providerHealth: state,
    providerConfigured: Boolean(providerHealth?.configured),
    // Refuse to run a real inference unless the provider is demonstrably healthy.
    mayExecuteInference: !refused,
    refusalReason: refused
      ? `PROVIDER_${state}`
      : null,
    // An exhausted row still needs recovery authority even once healthy.
    retryBlockReason: refused
      ? `PROVIDER_${state}`
      : currentness?.retryBlockReason ?? null,
    currentnessState: currentness?.state ?? null,
  });
};

export default resolveUnderstandingCurrentness;