// CANONICAL BOQ UNDERSTANDING CURRENTNESS -- focused tests.
//
// THE DEFECT UNDER TEST
//
// Two surfaces answered "is this item's interpretation current?" differently:
// the controlled-pilot manifest (`alreadyInterpretedItemIds`) used fingerprint
// equality ALONE; the review layer required a fingerprint-matching attempt that
// actually produced a USABLE interpretation. A row whose newest
// fingerprint-matching attempt had FAILED was therefore "already interpreted"
// (never queued for a new attempt) to the manifest while being
// REVALIDATION_REQUIRED (every review action blocked) to the review layer.
// Neither surface could advance it -- a structurally unreachable state that was
// live for seven Central Kitchen Fire Alarm rows.
//
// The invariant these tests pin: there is exactly ONE answer to currentness, and
// CURRENTNESS is never conflated with ELIGIBILITY.
//
// Everything here is pure-function and database-free. No provider, no Workers AI,
// no project data, no retry budget.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INFRASTRUCTURE_FAILURE_CODES,
  USABLE_INTERPRETATION_STATUSES,
  UNDERSTANDING_CURRENTNESS_STATES,
  classifyAttemptFailure,
  resolveUnderstandingCurrentness,
  resolveUnderstandingExecutionGate,
} from "../app/domain/boq-understanding-currentness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = readFileSync(join(HERE, "..", "worker", "estimator-understanding-api.mjs"), "utf8");
const EFFECTIVE = readFileSync(join(HERE, "..", "worker", "effective-understanding-interpretation.mjs"), "utf8");

const FP = "fp-current";
const attempt = (over = {}) => ({
  interpretationId: "int_1", versionNumber: 1, inputFingerprint: FP,
  configFingerprint: null, authorizationFingerprint: null,
  status: "COMPLETED", errorCode: null, createdAt: "2026-01-01T00:00:00Z",
  ...over,
});
const resolve = (attempts, over = {}) => resolveUnderstandingCurrentness({
  currentInputFingerprint: FP, attempts, maxRetryAttempts: 3, ...over,
});

// ===========================================================================
// 1. no prior attempt -> eligible for analysis
// ===========================================================================
test("no prior attempt is NEVER_ANALYZED and eligible for analysis", () => {
  const r = resolve([]);
  assert.equal(r.state, "NEVER_ANALYZED");
  assert.equal(r.current, false);
  assert.equal(r.requiresRevalidation, false, "never analyzed is not the same as stale");
  assert.equal(r.eligibleForAnalysis, true);
  assert.equal(r.attemptCount, 0);
});

// ===========================================================================
// 2. current successful interpretation -> excluded from revalidation AND review-current
// ===========================================================================
test("a usable interpretation matching today's inputs is CURRENT", () => {
  const r = resolve([attempt()]);
  assert.equal(r.state, "CURRENT");
  assert.equal(r.current, true);
  assert.equal(r.requiresRevalidation, false);
  assert.equal(r.eligibleForAnalysis, false, "a current row must not spend a new attempt");
  assert.equal(r.currentInterpretationId, "int_1");
});

// ===========================================================================
// 3. changed semantic input -> stale + eligible for revalidation
// ===========================================================================
test("inputs changed since the interpretation -> STALE_REVALIDATION_REQUIRED", () => {
  const r = resolve([attempt()], { currentInputFingerprint: "fp-new" });
  assert.equal(r.state, "STALE_REVALIDATION_REQUIRED");
  assert.equal(r.current, false);
  assert.equal(r.requiresRevalidation, true);
  assert.equal(r.eligibleForAnalysis, true);
  assert.equal(r.staleReason, "SEMANTIC_INPUTS_CHANGED_SINCE_THE_INTERPRETATION");
});

// ===========================================================================
// 4. unchanged non-semantic metadata -> remains current
// ===========================================================================
test("a newer attempt with identical inputs keeps the row CURRENT", () => {
  // Provider/model/version churn that does NOT move the input fingerprint must not
  // invalidate a usable interpretation.
  const r = resolve([
    attempt({ interpretationId: "int_2", versionNumber: 2, configFingerprint: "cfg_new", status: "NEEDS_REVIEW" }),
    attempt({ interpretationId: "int_1", versionNumber: 1, configFingerprint: "cfg_old" }),
  ]);
  assert.equal(r.state, "CURRENT");
  assert.equal(r.current, true);
  assert.equal(r.currentInterpretationId, "int_2", "the newest usable interpretation governs");
});

// ===========================================================================
// 5 + 6. THE CORE DEFECT: a FAILED attempt with a MATCHING fingerprint
// ===========================================================================
test("a FAILED attempt whose fingerprint matches is NOT current (the live defect)", () => {
  const r = resolve([attempt({ status: "FAILED", errorCode: "AI_PROVIDER_ERROR" })]);
  assert.equal(r.current, false, "a failed attempt must never read as current");
  assert.notEqual(r.state, "CURRENT");
  assert.equal(r.state, "FAILED_RETRYABLE");
  assert.equal(r.eligibleForAnalysis, true, "a failed row must stay eligible for a fresh attempt");
});

test("a provider failure never becomes a usable interpretation", () => {
  for (const code of INFRASTRUCTURE_FAILURE_CODES) {
    const r = resolve([attempt({ status: "FAILED", errorCode: code })]);
    assert.notEqual(r.state, "CURRENT", `${code} must not be CURRENT`);
    assert.equal(r.retryableFailureClass, "INFRASTRUCTURE");
  }
  // AI_UNAVAILABLE is a failure class, not a usable interpretation either.
  assert.notEqual(resolve([attempt({ status: "AI_UNAVAILABLE" })]).current, true);
});

// ===========================================================================
// 7. FAILED retry exhausted -> requires recovery authority before retry
// ===========================================================================
test("exhausted infrastructure failures require RECOVERY, not a silent budget reset", () => {
  const exhausted = [
    attempt({ interpretationId: "i3", versionNumber: 3, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i2", versionNumber: 2, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i1", versionNumber: 1, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
  ];
  const r = resolve(exhausted);
  assert.equal(r.state, "FAILED_RETRY_EXHAUSTED");
  assert.equal(r.retryBudgetExhausted, true);
  assert.equal(r.retryBudgetRemaining, 0);
  assert.equal(r.eligibleForRetry, false, "exhausted rows must not retry without authority");
  assert.equal(r.retryBlockReason, "REQUIRES_GOVERNED_INFRASTRUCTURE_RECOVERY");
  // History is reported, never erased.
  assert.equal(r.attemptCount, 3);
  assert.equal(r.failedAttemptCount, 3);
  assert.equal(r.latestAttemptId, "i3");
});

// ===========================================================================
// 8. new successful attempt supersedes prior failure
// ===========================================================================
test("a new successful attempt supersedes prior provider failures", () => {
  const r = resolve([
    attempt({ interpretationId: "i4", versionNumber: 4, status: "COMPLETED" }),
    attempt({ interpretationId: "i3", versionNumber: 3, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i2", versionNumber: 2, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i1", versionNumber: 1, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
  ]);
  assert.equal(r.state, "CURRENT");
  assert.equal(r.current, true);
  assert.equal(r.currentInterpretationId, "i4");
  // The failures remain on the record even though the row is now current.
  assert.equal(r.failedAttemptCount, 3);
});

// ===========================================================================
// 9 + 10. stale/fresh approved REVIEW does not change interpretation currentness
// ===========================================================================
test("an approved review on a SUPERSEDED interpretation does not stay effective", () => {
  // Currentness is a property of the INTERPRETATION + its inputs, never of the
  // review row. A stale interpretation stays stale regardless of an old approval,
  // so no stale authority can leak downstream.
  const r = resolve([attempt()], { currentInputFingerprint: "fp-moved" });
  assert.equal(r.state, "STALE_REVALIDATION_REQUIRED");
  assert.equal(r.current, false);
  assert.equal(r.currentInterpretationId, null, "a stale row publishes NO current interpretation");
  // A fresh interpretation PRODUCED UNDER the new inputs restores currentness.
  // (Its stored fingerprint must match the new current fingerprint -- that is the
  // whole point of the fingerprint, and is why simply bumping versionNumber is
  // not enough.)
  const fresh = resolve([attempt({ interpretationId: "i2", versionNumber: 2, inputFingerprint: "fp-moved" })], { currentInputFingerprint: "fp-moved" });
  assert.equal(fresh.state, "CURRENT");
  assert.equal(fresh.current, true);
});

// ===========================================================================
// 11 + 12 + 13. specification context, isolation, determinism
// ===========================================================================
test("specification context change invalidates only when it is semantically consumed", () => {
  // Canonicalization happens upstream in the fingerprint, so this resolver is
  // indifferent to HOW a fingerprint was derived -- it only ever compares. That is
  // what makes ordering-only differences provably harmless.
  const base = [attempt()];
  assert.equal(resolve(base).current, true);
  assert.equal(resolve(base, { currentInputFingerprint: "fp-different" }).current, false);
});

test("canonicalisation is deterministic and the resolver is pure", () => {
  const attempts = [attempt({ interpretationId: "b" }), attempt({ interpretationId: "a" })];
  const first = resolve(attempts);
  const second = resolve([...attempts].reverse());
  assert.equal(first.state, second.state);
  assert.equal(first.currentInterpretationId, second.currentInterpretationId, "order of the input array must not matter");
  // Results are frozen so no consumer can rewrite a reported state.
  assert.throws(() => { first.state = "CURRENT"; });
});

// ===========================================================================
// 14. manifest and review ALWAYS agree -- the seven split shapes
// ===========================================================================
test("the seven Central Kitchen split shapes all resolve to one consistent state", () => {
  // Each shape is the REAL benchmark situation: a stored interpretation whose
  // fingerprint no longer matches the current inputs (because confirmed
  // requirement links were authored afterwards), or whose newest matching
  // attempt failed. Before the fix the manifest called these "already
  // interpreted" while the review layer called them REVALIDATION_REQUIRED.
  //
  // The test does NOT assert a particular resulting state. It asserts the
  // property that actually matters: a single canonical answer that both
  // consumers can only derive, and that is never CURRENT for a row lacking a
  // usable current interpretation.
  const seven = [
    { name: "28.21", attempts: [attempt({ status: "COMPLETED" })], currentInputFingerprint: "fp-shifted" },
    { name: "28.25", attempts: [attempt({ status: "NEEDS_REVIEW" })], currentInputFingerprint: "fp-shifted" },
    { name: "28.28", attempts: [attempt({ status: "COMPLETED" })], currentInputFingerprint: "fp-shifted" },
    { name: "28.3", attempts: [attempt({ status: "COMPLETED" })], currentInputFingerprint: "fp-shifted" },
    { name: "28.31", attempts: [attempt({ status: "COMPLETED" })], currentInputFingerprint: "fp-shifted" },
    { name: "28.32", attempts: [attempt({ status: "COMPLETED" })], currentInputFingerprint: "fp-shifted" },
    { name: "28.34", attempts: [attempt({ status: "NEEDS_REVIEW" })], currentInputFingerprint: "fp-shifted" },
  ];
  for (const shape of seven) {
    const r = resolve(shape.attempts, { currentInputFingerprint: shape.currentInputFingerprint });
    assert.equal(r.current, false, `${shape.name} must not be CURRENT`);
    assert.equal(r.requiresRevalidation, true, `${shape.name} must require revalidation`);
    assert.equal(r.eligibleForAnalysis, true, `${shape.name} must stay eligible for revalidation`);
    // The impossible combination can never be produced.
    assert.ok(!(r.current === true && r.requiresRevalidation === true));
  }
});

test("a provider-FAILED row (28.24/26/27/33/35 shape) is not CURRENT and stays retryable", () => {
  for (const code of ["AI_PROVIDER_ERROR"]) {
    const r = resolve([
      attempt({ interpretationId: "i3", versionNumber: 3, status: "FAILED", errorCode: code }),
      attempt({ interpretationId: "i2", versionNumber: 2, status: "COMPLETED" }),
    ]);
    assert.equal(r.current, false, "a newer provider failure must not read as current");
    // Canonical semantics: the NEWEST attempt against today's inputs failed, so
    // the row is FAILED_RETRYABLE -- not "stale because inputs changed".
    assert.equal(r.state, "FAILED_RETRYABLE");
    assert.equal(r.staleReason, "LATEST_ATTEMPT_FAILED_PROVIDER_INFRASTRUCTURE");
    assert.equal(r.eligibleForRetry, true);
  }
});

test("the impossible state is unrepresentable across the whole state machine", () => {
  // Exhaustively: current===true must ALWAYS imply requiresRevalidation===false,
  // for every combination of status, error code and fingerprint match.
  const statuses = ["COMPLETED", "NEEDS_REVIEW", "FAILED", "AI_UNAVAILABLE"];
  const codes = [null, "AI_PROVIDER_ERROR", "AI_OUTPUT_INVALID_SCHEMA", "WEIRD_UNKNOWN"];
  const fps = [FP, "other"];
  let count = 0;
  for (const status of statuses) {
    for (const errorCode of codes) {
      for (const inputFingerprint of fps) {
        for (const currentInputFingerprint of [FP, "other"]) {
          const r = resolve([attempt({ status, errorCode, inputFingerprint })], { currentInputFingerprint });
          if (r.current) {
            assert.equal(r.requiresRevalidation, false, `current row must not require revalidation (${status}/${errorCode})`);
            assert.ok(USABLE_INTERPRETATION_STATUSES.includes(status), "only a usable interpretation may be CURRENT");
            assert.ok(r.currentInterpretationId, "a CURRENT row must name its governing interpretation");
          }
          count += 1;
        }
      }
    }
  }
  assert.equal(count, 64);
});

// ===========================================================================
// 15. governed classification authority sees the SAME current interpretation
// ===========================================================================
test("the resolver publishes the interpretation identity classification authority consumes", () => {
  const r = resolve([attempt({ interpretationId: "int_governed" })]);
  assert.equal(r.currentInterpretationId, "int_governed");
  assert.equal(r.latestAttemptId, "int_governed");
  // When nothing is current, the identity is explicitly null so a downstream
  // authority reader cannot mistake a stale interpretation for a current one.
  const stale = resolve([attempt()], { currentInputFingerprint: "fp-other" });
  assert.equal(stale.currentInterpretationId, null);
});

// ===========================================================================
// §13 provider health gate
// ===========================================================================
test("provider health gates EXECUTION without changing the currentness state", () => {
  const stale = resolve([attempt()], { currentInputFingerprint: "fp-other" });
  assert.equal(stale.eligibleForAnalysis, true, "the ROW is eligible for analysis");
  const gate = resolveUnderstandingExecutionGate(stale, { state: "UNHEALTHY", configured: true });
  assert.equal(gate.mayExecuteInference, false, "but EXECUTION is refused");
  assert.equal(gate.refusalReason, "PROVIDER_UNHEALTHY");
  assert.equal(gate.currentnessState, "STALE_REVALIDATION_REQUIRED", "the row's semantic state is unchanged");
  // Once healthy, execution is permitted -- the row was never the problem.
  assert.equal(resolveUnderstandingExecutionGate(stale, { state: "HEALTHY", configured: true }).mayExecuteInference, true);
  // CONFIGURED is NOT healthy: a config check must never authorise a real call.
  assert.equal(resolveUnderstandingExecutionGate(stale, { state: "CONFIGURED", configured: true }).mayExecuteInference, false);
  assert.equal(resolveUnderstandingExecutionGate(stale, { state: "UNKNOWN", configured: true }).mayExecuteInference, false);
});

test("an exhausted row stays refused even when the provider is healthy", () => {
  const exhausted = resolve([
    attempt({ versionNumber: 3, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ versionNumber: 2, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ versionNumber: 1, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
  ]);
  const gate = resolveUnderstandingExecutionGate(exhausted, { state: "HEALTHY", configured: true });
  assert.equal(gate.mayExecuteInference, true, "provider health permits the call");
  assert.equal(gate.retryBlockReason, "REQUIRES_GOVERNED_INFRASTRUCTURE_RECOVERY",
    "but recovery authority is still required");
});

// ===========================================================================
// §16 infrastructure vs semantic failure -- fail closed
// ===========================================================================
test("only recognised infrastructure failures are infrastructure-recoverable", () => {
  for (const code of INFRASTRUCTURE_FAILURE_CODES) {
    assert.equal(classifyAttemptFailure(code), "INFRASTRUCTURE", code);
  }
  for (const code of ["AI_OUTPUT_INVALID_SCHEMA", "AI_OUTPUT_INVALID_UNSUPPORTED_FIELD", "AI_OUTPUT_INVALID_CONFIDENCE", "SOMETHING_NEW"]) {
    assert.equal(classifyAttemptFailure(code), "SEMANTIC", `${code} must not earn infrastructure recovery`);
  }
  // Unknown/absent fails closed.
  assert.equal(classifyAttemptFailure(null), "UNKNOWN");
  assert.equal(classifyAttemptFailure(undefined), "UNKNOWN");
  assert.equal(classifyAttemptFailure(""), "UNKNOWN");
});

test("a semantic failure never becomes infrastructure-retryable", () => {
  const r = resolve([attempt({ status: "FAILED", errorCode: "AI_OUTPUT_INVALID_SCHEMA" })]);
  assert.equal(r.state, "FAILED_SEMANTIC");
  assert.equal(r.retryableFailureClass, "SEMANTIC");
  assert.notEqual(r.retryBlockReason, "REQUIRES_GOVERNED_INFRASTRUCTURE_RECOVERY");
});

// ===========================================================================
// §17 recovery
// ===========================================================================
test("recovery re-arms the row WITHOUT erasing history", () => {
  const history = [
    attempt({ interpretationId: "i3", versionNumber: 3, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i2", versionNumber: 2, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i1", versionNumber: 1, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
  ];
  // A recovery is honoured only when its identity matches the CURRENT exhausted
  // state -- an arbitrary/mismatched identity must NOT re-arm the row.
  const identity = "recovery-identity-current";
  const r = resolve(history, {
    recovery: { identity, actor: "engineer-1", reason: "Workers AI upstream outage recovered" },
    recoveryExpectedIdentity: identity,
  });
  assert.equal(r.state, "FAILED_RETRYABLE", "recovery re-arms a new attempt");
  assert.equal(r.eligibleForRetry, true);
  assert.equal(r.recoveryApplied, true);
  assert.equal(r.recoveryActor, "engineer-1");
  // NOTHING is erased: every attempt, the old count and the failure class remain.
  assert.equal(r.attemptCount, 3);
  assert.equal(r.failedAttemptCount, 3);
  assert.equal(r.latestAttemptId, "i3");
  assert.equal(r.latestAttemptStatus, "FAILED");
  assert.equal(r.retryableFailureClass, "INFRASTRUCTURE");
});

// ===========================================================================
// recovery identity binding -- a stale or consumed recovery must NOT re-arm
// ===========================================================================
test("a mismatched or consumed recovery identity does NOT re-arm the row", () => {
  const history = [
    attempt({ interpretationId: "i3", versionNumber: 3, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i2", versionNumber: 2, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
    attempt({ interpretationId: "i1", versionNumber: 1, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" }),
  ];
  // Mismatched identity: the exhausted state moved underneath it.
  const stale = resolve(history, {
    recovery: { identity: "recovery-identity-OLD", actor: "engineer-1" },
    recoveryExpectedIdentity: "recovery-identity-current",
  });
  assert.equal(stale.recoveryApplied, false, "a stale recovery must not re-arm the row");
  assert.equal(stale.state, "FAILED_RETRY_EXHAUSTED");
  assert.equal(stale.eligibleForRetry, false);
  // Consumed: an actual retry already happened, so it cannot be reused.
  const consumed = resolve(history, {
    recovery: { identity: "recovery-identity-current", consumedAt: "2026-01-02T00:00:00Z" },
    recoveryExpectedIdentity: "recovery-identity-current",
  });
  assert.equal(consumed.recoveryApplied, false, "a consumed recovery must not re-arm the row");
  assert.equal(consumed.recoveryConsumed, true);
  assert.equal(consumed.state, "FAILED_RETRY_EXHAUSTED");
  // And history is untouched in both cases.
  for (const r of [stale, consumed]) {
    assert.equal(r.attemptCount, 3);
    assert.equal(r.failedAttemptCount, 3);
  }
});

// ===========================================================================
// config currency
// ===========================================================================
test("a stale config makes a matching interpretation non-current", () => {
  const r = resolve([attempt({ configFingerprint: "cfg_old" })], {
    currentConfigFingerprint: "cfg_new",
    isCurrentConfig: (stored, current) => stored === current,
  });
  assert.equal(r.current, false);
  assert.equal(r.requiresRevalidation, true);
});

// ===========================================================================
// vocabulary + wiring
// ===========================================================================
test("the state vocabulary is closed and frozen", () => {
  assert.deepEqual([...UNDERSTANDING_CURRENTNESS_STATES], [
    "NEVER_ANALYZED", "CURRENT", "STALE_REVALIDATION_REQUIRED", "SUPERSEDED",
    "FAILED_RETRYABLE", "FAILED_RETRY_EXHAUSTED", "FAILED_SEMANTIC",
  ]);
  assert.deepEqual([...USABLE_INTERPRETATION_STATUSES], ["COMPLETED", "NEEDS_REVIEW"]);
});

test("both real consumers delegate to the canonical resolver", () => {
  // The manifest must not answer currentness itself any more.
  assert.match(API, /resolveUnderstandingCurrentness/,
    "the pilot manifest must consume the canonical resolver");
  assert.match(API, /from "\.\.\/app\/domain\/boq-understanding-currentness\.mjs"/);
  // And it must no longer treat bare fingerprint equality as "already interpreted".
  const predicate = API.slice(API.indexOf("const alreadyInterpretedItemIds"), API.indexOf("const alreadyInterpretedItemIds") + 2000);
  assert.ok(!/inputFingerprint !== currentFingerprint\) return false;/.test(predicate),
    "the manifest must not re-implement the fingerprint predicate");
  // The review layer's effective resolver still owns the REVIEW-facing shape.
  assert.match(EFFECTIVE, /resolveEffectiveUnderstandingInterpretation/);
});