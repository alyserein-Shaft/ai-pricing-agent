// GOVERNED INFRASTRUCTURE-FAILURE RECOVERY -- focused tests.
//
// The capability exists because an item whose attempts were exhausted by a
// PROVIDER outage had no governed way back: the per-item retry route caps attempts
// and then refuses permanently, so a transient external outage silently became a
// terminal verdict about the BOQ row. Recovery authorizes ONE new opportunity --
// it never deletes attempts, resets counters, or relabels a failure.
//
// Everything here is pure-function and database-free except the route test, which
// uses an in-memory fake D1. No provider call, no benchmark data, no retry budget.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RECOVERY_AUTHORIZED_ROLES,
  UNDERSTANDING_RECOVERY_RESULTS,
  buildRecoveryIdentity,
  evaluateRecoveryConsumption,
  evaluateRecoveryProviderGate,
  evaluateRecoveryRequest,
  isRecoveryAuthorizedRole,
} from "../app/domain/boq-understanding-recovery.mjs";
import { resolveUnderstandingCurrentness } from "../app/domain/boq-understanding-currentness.mjs";
import { handleInfrastructureRecovery } from "../worker/estimator-understanding-api.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = readFileSync(join(HERE, "..", "worker", "estimator-understanding-api.mjs"), "utf8");

const FP = "fp-current";
const HEALTHY = { configured: true, state: "HEALTHY", model: "@cf/meta/llama-3.1-8b-instruct-fast" };
const attempt = (over = {}) => ({
  interpretationId: "int_x", versionNumber: 1, inputFingerprint: FP,
  configFingerprint: "cfg_1", status: "COMPLETED", errorCode: null, createdAt: "2026-01-01", ...over,
});
const exhaustedAttempts = (count = 3, code = "AI_PROVIDER_ERROR") => Array.from({ length: count }, (_, i) => attempt({
  interpretationId: `int_${count - i}`,
  versionNumber: count - i,
  status: "FAILED",
  errorCode: code,
}));
const resolveExhausted = (attempts = exhaustedAttempts(), over = {}) => resolveUnderstandingCurrentness({
  currentInputFingerprint: FP, attempts, maxRetryAttempts: 3, ...over,
});
const baseRequest = (over = {}) => ({
  role: "Administrator",
  reason: "Workers AI upstream outage has been confirmed recovered by the operator.",
  currentness: resolveExhausted(),
  health: HEALTHY,
  projectId: "project_1",
  boqItemId: "boqitem_1",
  latestAttempt: { id: "int_3", errorCode: "AI_PROVIDER_ERROR", configFingerprint: "cfg_1" },
  provider: "cloudflare-workers-ai-binding",
  model: "@cf/meta/llama-3.1-8b-instruct-fast",
  ...over,
});

// ===========================================================================
// 1. exhausted infrastructure failure + HEALTHY -> recovery authorized
// ===========================================================================
test("exhausted infrastructure failure with a healthy provider authorizes recovery", () => {
  const r = evaluateRecoveryRequest(baseRequest());
  assert.equal(r.ok, true);
  assert.equal(r.code, "RECOVERY_AUTHORIZED");
  assert.equal(r.failureClass, "INFRASTRUCTURE");
  assert.ok(r.recoveryIdentity, "an authorization must be bound to an identity");
  assert.equal(r.failedAttemptCount, 3);
});

// ===========================================================================
// 2 + 3. health gate: UNHEALTHY refuses, CONFIGURED alone cannot authorize
// ===========================================================================
test("an unhealthy provider refuses recovery", () => {
  for (const state of ["UNHEALTHY", "CONFIGURED", "UNKNOWN"]) {
    const r = evaluateRecoveryRequest(baseRequest({ health: { configured: true, state } }));
    assert.equal(r.ok, false, `${state} must not authorize recovery`);
    assert.ok(["PROVIDER_UNHEALTHY", "PROVIDER_HEALTH_UNVERIFIED"].includes(r.code), `${state} -> ${r.code}`);
  }
});

test("CONFIGURED alone is explicitly insufficient", () => {
  const gate = evaluateRecoveryProviderGate({ configured: true, state: "CONFIGURED" });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "PROVIDER_HEALTH_UNVERIFIED");
  assert.match(gate.message, /unproven/i);
  // And the underlying gate function agrees.
  assert.equal(evaluateRecoveryProviderGate(HEALTHY).ok, true);
  assert.equal(evaluateRecoveryProviderGate({ configured: false, state: "HEALTHY" }).code, "PROVIDER_NOT_CONFIGURED");
});

// ===========================================================================
// 4 + 5. semantic / unknown failures refuse (fail closed)
// ===========================================================================
test("semantic failures are not infrastructure-recoverable", () => {
  for (const code of ["AI_OUTPUT_INVALID_SCHEMA", "AI_OUTPUT_INVALID_UNSUPPORTED_FIELD", "AI_OUTPUT_INVALID_CONFIDENCE"]) {
    const attempts = exhaustedAttempts(3, code);
    const r = evaluateRecoveryRequest(baseRequest({
      currentness: resolveExhausted(attempts),
      latestAttempt: { id: "int_3", errorCode: code, configFingerprint: "cfg_1" },
    }));
    assert.equal(r.ok, false, `${code} must not be recoverable`);
    // A semantic failure is not even retry-exhausted; it is FAILED_SEMANTIC.
    assert.equal(r.code === "FAILURE_NOT_INFRASTRUCTURE" || r.code === "NOT_EXHAUSTED", true, `${code} -> ${r.code}`);
  }
});

test("an unknown failure class fails closed", () => {
  const attempts = exhaustedAttempts(3, "SOME_BRAND_NEW_CODE");
  const currentness = resolveExhausted(attempts);
  // Whatever the resolver decides, an unclassified failure is never authorized.
  const r = evaluateRecoveryRequest(baseRequest({
    currentness,
    latestAttempt: { id: "int_3", errorCode: "SOME_BRAND_NEW_CODE", configFingerprint: "cfg_1" },
  }));
  assert.equal(r.ok, false);
  if (r.code === "NOT_EXHAUSTED") {
    // The resolver classified it as FAILED_SEMANTIC, which is the correct
    // fail-closed outcome: no infrastructure recovery.
    assert.equal(currentness.retryableFailureClass, "SEMANTIC");
  } else {
    assert.equal(r.code, "FAILURE_CLASS_UNKNOWN");
  }
  // A null error code is likewise never recoverable.
  assert.equal(evaluateRecoveryRequest(baseRequest({
    currentness: resolveExhausted(exhaustedAttempts(3, null)),
    latestAttempt: { id: "int_3", errorCode: null, configFingerprint: "cfg_1" },
  })).ok, false);
});

// ===========================================================================
// 6 + 7. authorization required; the actor cannot be spoofed
// ===========================================================================
test("authorization is required and the role comes from canonical resolution", () => {
  for (const role of [null, "", "Viewer", "Engineer", "unknown"]) {
    const r = evaluateRecoveryRequest(baseRequest({ role }));
    assert.equal(r.ok, false, `${role} must not authorize recovery`);
    assert.equal(r.code, "RECOVERY_NOT_AUTHORIZED_ROLE");
  }
  assert.equal(isRecoveryAuthorizedRole("Administrator"), true);
  assert.deepEqual([...RECOVERY_AUTHORIZED_ROLES], ["Administrator"]);
});

test("the route rejects any caller-supplied authority or counter field", async () => {
  // The request body may carry ONLY a reason. Anything that could assert authority
  // or grant a budget is refused outright.
  const forbidden = ["actor", "actorId", "role", "actorRole", "failedAttemptCount", "attemptCount", "retryCount", "maxRetryAttempts", "state", "currentnessState", "providerHealth", "health", "recoveryIdentity"];
  for (const key of forbidden) {
    const db = fakeDb();
    const res = await handleInfrastructureRecovery({ DB: db }, { userId: "u1", role: "Administrator" }, "project_1", "boqitem_1", postRequest({ [key]: "spoofed" }));
    const payload = await res.json();
    assert.equal(payload.error?.code, "RECOVERY_FIELD_NOT_ACCEPTED", `${key} must be refused`);
    assert.equal(db.recoveries.length, 0, `${key} must not write anything`);
  }
});

// ===========================================================================
// 8 + 9 + 10 + 11. history and counters are never reset
// ===========================================================================
test("recovery changes authorization only -- attempt and failure counts are unchanged", () => {
  const attempts = exhaustedAttempts(3);
  const before = resolveExhausted(attempts);
  assert.equal(before.state, "FAILED_RETRY_EXHAUSTED");
  assert.equal(before.eligibleForRetry, false);
  assert.equal(before.attemptCount, 3);
  assert.equal(before.failedAttemptCount, 3);
  assert.equal(before.retryBudgetRemaining, 0);

  const decision = evaluateRecoveryRequest(baseRequest());
  assert.equal(decision.ok, true);
  const after = resolveExhausted(attempts, {
    recovery: { identity: decision.recoveryIdentity, actor: "u1", reason: "recovered" },
    recoveryExpectedIdentity: decision.recoveryIdentity,
  });
  // §9: exhausted -> retryable.
  assert.equal(after.state, "FAILED_RETRYABLE");
  assert.equal(after.eligibleForRetry, true);
  // ...but NOTHING historical moved.
  assert.equal(after.attemptCount, 3, "attemptCount must not be reset");
  assert.equal(after.failedAttemptCount, 3, "failedAttemptCount must not be reset");
  assert.equal(after.attempts ? undefined : undefined, undefined);
});

// ===========================================================================
// 12 + 13. idempotency, and one recovery cannot authorize many attempts
// ===========================================================================
test("an identical recovery request is idempotent", () => {
  const existing = { id: "recovery_1", identity: "IDENT", consumedAt: null };
  const first = evaluateRecoveryRequest(baseRequest());
  assert.equal(first.ok, true);
  // Replaying the same governed decision against the same exhausted state.
  const stored = { id: "recovery_1", identity: first.recoveryIdentity, consumedAt: null };
  const replay = evaluateRecoveryRequest(baseRequest({ existingRecovery: stored }));
  assert.equal(replay.ok, true);
  assert.equal(replay.code, "RECOVERY_ALREADY_AUTHORIZED");
  assert.equal(replay.idempotent, true);
  assert.equal(replay.recoveryId, "recovery_1", "the SAME authorization is returned, not a new one");
  assert.notEqual(existing.identity, first.recoveryIdentity, "sanity: identities differ in this setup");
});

test("one recovery authorization cannot be reused after it is consumed", () => {
  const decision = evaluateRecoveryRequest(baseRequest());
  const consumed = evaluateRecoveryRequest(baseRequest({
    existingRecovery: { id: "recovery_1", identity: decision.recoveryIdentity, consumedAt: "2026-01-02T00:00:00Z" },
  }));
  assert.equal(consumed.ok, false);
  assert.equal(consumed.code, "RECOVERY_CONSUMED");
});

// ===========================================================================
// 14 + 15. binding to the exact exhausted state
// ===========================================================================
test("recovery binds to the exact exhausted state", () => {
  const identity = buildRecoveryIdentity({
    projectId: "p", boqItemId: "b", latestAttemptId: "int_3", failedAttemptCount: 3,
    inputFingerprint: FP, configFingerprint: "cfg_1", provider: "cf", model: "m",
    currentnessState: "FAILED_RETRY_EXHAUSTED",
  });
  // Any material change yields a DIFFERENT identity, so a stale authorization is
  // detectable and cannot float across a later attempt or a changed input.
  const variants = [
    { projectId: "p2" }, { boqItemId: "b2" }, { latestAttemptId: "int_4" },
    { failedAttemptCount: 4 }, { inputFingerprint: "fp-other" },
    { configFingerprint: "cfg_2" }, { model: "m2" }, { currentnessState: "STALE_REVALIDATION_REQUIRED" },
  ];
  const base = {
    projectId: "p", boqItemId: "b", latestAttemptId: "int_3", failedAttemptCount: 3,
    inputFingerprint: FP, configFingerprint: "cfg_1", provider: "cf", model: "m",
    currentnessState: "FAILED_RETRY_EXHAUSTED",
  };
  for (const v of variants) {
    const changed = buildRecoveryIdentity({ ...base, ...v });
    assert.notEqual(changed, identity, `${JSON.stringify(v)} must change the identity`);
  }
  assert.equal(buildRecoveryIdentity(base), identity, "the same facts are deterministic");
});

test("a stale recovery request is refused, forcing a fresh governed decision", () => {
  const r = evaluateRecoveryRequest(baseRequest({
    existingRecovery: { id: "recovery_old", identity: "identity-from-an-older-exhausted-state", consumedAt: null },
  }));
  assert.equal(r.ok, false);
  assert.equal(r.code, "RECOVERY_STALE");
});

// ===========================================================================
// 16 + 17. consumption and the return to ordinary policy
// ===========================================================================
test("consumption marks the authorization used and cannot be repeated", () => {
  const identity = "IDENT";
  const ok = evaluateRecoveryConsumption({ existingRecovery: { id: "r1", identity, consumedAt: null }, currentIdentity: identity });
  assert.equal(ok.ok, true);
  assert.equal(ok.code, "RECOVERY_CONSUMED");
  // Consuming again is refused.
  const again = evaluateRecoveryConsumption({ existingRecovery: { id: "r1", identity, consumedAt: "2026-01-02T00:00:00Z" }, currentIdentity: identity });
  assert.equal(again.ok, false);
  assert.equal(again.code, "RECOVERY_CONSUMED");
  // No authorization at all is refused.
  assert.equal(evaluateRecoveryConsumption({ existingRecovery: null, currentIdentity: identity }).code, "RECOVERY_NOT_FOUND");
  // A moved state refuses to consume a stale authorization.
  assert.equal(evaluateRecoveryConsumption({ existingRecovery: { id: "r1", identity, consumedAt: null }, currentIdentity: "OTHER" }).code, "RECOVERY_STALE");
});

test("a failed retry after recovery returns the row to ordinary retry policy", () => {
  // Recovery granted one opportunity; the retry then failed, so ordinary
  // exhaustion/exhaustion-budget policy applies again -- NOT a standing bypass.
  const attempts = [...exhaustedAttempts(3), attempt({ interpretationId: "int_4", versionNumber: 4, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" })];
  const afterFailedRetry = resolveExhausted(attempts);
  assert.equal(afterFailedRetry.failedAttemptCount, 4);
  assert.equal(afterFailedRetry.state, "FAILED_RETRY_EXHAUSTED");
  assert.equal(afterFailedRetry.eligibleForRetry, false, "no permanent bypass of retry limits");
  assert.equal(afterFailedRetry.retryBlockReason, "REQUIRES_GOVERNED_INFRASTRUCTURE_RECOVERY");
});

test("a successful retry after recovery takes over normal currentness semantics", () => {
  const attempts = [...exhaustedAttempts(3), attempt({ interpretationId: "int_4", versionNumber: 4, status: "COMPLETED" })];
  const r = resolveExhausted(attempts);
  assert.equal(r.state, "CURRENT");
  assert.equal(r.current, true);
  assert.equal(r.currentInterpretationId, "int_4");
  assert.equal(r.failedAttemptCount, 3, "prior failures remain on the record");
});

// ===========================================================================
// 18. no project cross-link
// ===========================================================================
test("recovery refuses when the BOQ item does not belong to the project", async () => {
  const db = fakeDb({ itemProjectId: "project_other" });
  const res = await handleInfrastructureRecovery({ DB: db }, { userId: "u1", role: "Administrator" }, "project_1", "boqitem_1", postRequest({ reason: "operator confirmed provider recovery on the real service" }));
  const payload = await res.json();
  assert.equal(payload.error?.code, "PROJECT_MISMATCH");
  assert.equal(db.recoveries.length, 0);
});

// ===========================================================================
// §5/§13 route-level live refusal when the provider is unhealthy
// ===========================================================================
test("the route refuses with no write when the provider is unhealthy", async () => {
  const db = fakeDb();
  const env = { DB: db, BOQ_AI_PROVIDER: "cloudflare", BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast", AI: { run: async () => { throw Object.assign(new Error("upstream"), { name: "InferenceUpstreamError" }); } } };
  const res = await handleInfrastructureRecovery(env, { userId: "u1", role: "Administrator" }, "project_1", "boqitem_1", postRequest({ reason: "operator confirmed provider recovery on the real service" }));
  const payload = await res.json();
  assert.equal(res.status, 503);
  assert.equal(payload.recovery.authorized, false);
  assert.equal(payload.error.code, "PROVIDER_UNHEALTHY");
  assert.equal(payload.providerHealth.state, "UNHEALTHY");
  // §13: NO recovery record, NO eligibility change, NO attempt change, NO run.
  assert.equal(db.recoveries.length, 0, "no recovery record may be written");
  assert.equal(db.attempts.length, 3, "no attempt may be added or removed");
  assert.equal(db.attemptWrites, 0, "no Understanding run may be started");
  // The canonical currentness is still reported truthfully.
  assert.equal(payload.currentness.state, "FAILED_RETRY_EXHAUSTED");
  assert.equal(payload.currentness.eligibleForRetry, false);
  assert.equal(payload.currentness.failedAttemptCount, 3);
});

test("the route refuses when the caller lacks the required role, before any probe", async () => {
  const db = fakeDb();
  const res = await handleInfrastructureRecovery({ DB: db }, { userId: "u1", role: "Viewer" }, "project_1", "boqitem_1", postRequest({ reason: "operator confirmed provider recovery on the real service" }));
  const payload = await res.json();
  assert.equal(payload.error.code, "RECOVERY_NOT_AUTHORIZED_ROLE");
  assert.equal(db.recoveries.length, 0);
});

test("the route requires a substantive reason", async () => {
  const db = fakeDb();
  // A HEALTHY provider, so the health gate cannot mask the reason check.
  const env = { DB: db, BOQ_AI_PROVIDER: "cloudflare", BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast", AI: { run: async () => ({ response: "{}", usage: {} }) } };
  // Lengths at or below the canonical governed minimum must all be refused. The
  // minimum is MIN_GOVERNED_REASON_LENGTH, the same constant the per-item retry
  // route already uses -- recovery must not lower it.
  for (const reason of [null, "", "   ", "abc", "abcd"]) {
    const res = await handleInfrastructureRecovery(env, { userId: "u1", role: "Administrator" }, "project_1", "boqitem_1", postRequest({ reason }));
    const payload = await res.json();
    assert.equal(payload.error.code, "RECOVERY_REASON_REQUIRED", `reason=${JSON.stringify(reason)}`);
  }
  assert.equal(db.recoveries.length, 0);
  // A reason that DOES meet the minimum gets past this gate.
  const ok = await handleInfrastructureRecovery(env, { userId: "u1", role: "Administrator" }, "project_1", "boqitem_1", postRequest({ reason: "confirmed provider recovery" }));
  assert.equal(ok.status, 201);
  assert.equal(db.recoveries.length, 1);
});

// ===========================================================================
// vocabulary + wiring
// ===========================================================================
test("the recovery result vocabulary is closed", () => {
  assert.ok(UNDERSTANDING_RECOVERY_RESULTS.includes("RECOVERY_AUTHORIZED"));
  assert.ok(UNDERSTANDING_RECOVERY_RESULTS.includes("PROVIDER_UNHEALTHY"));
  assert.ok(UNDERSTANDING_RECOVERY_RESULTS.includes("FAILURE_CLASS_UNKNOWN"));
  assert.ok(UNDERSTANDING_RECOVERY_RESULTS.includes("RECOVERY_CONSUMED"));
  assert.equal(new Set(UNDERSTANDING_RECOVERY_RESULTS).size, UNDERSTANDING_RECOVERY_RESULTS.length);
});

test("the route exists and reuses the canonical currentness resolver, not a second interpreter", () => {
  assert.match(API, /export async function handleInfrastructureRecovery/);
  assert.match(API, /estimator-understanding\\\/recover/);
  // It must NOT invent a second retry-state machine.
  const body = API.slice(API.indexOf("export async function handleInfrastructureRecovery"));
  assert.ok(!/NEVER_ANALYZED|STALE_REVALIDATION_REQUIRED|FAILED_SEMANTIC/.test(body),
    "the route must delegate currentness to the canonical resolver");
  assert.match(body, /resolveUnderstandingCurrentness/);
  assert.match(body, /probeBoqUnderstandingProviderHealth/);
  // And it must not accept an actor from the payload.
  assert.match(body, /RECOVERY_FIELD_NOT_ACCEPTED/);
  assert.match(body, /applicationActor/);
});

// ===========================================================================
// in-memory fake D1
// ===========================================================================
function postRequest(body) {
  return new Request("http://local/api/boq-items/boqitem_1/estimator-understanding/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

function fakeDb({ itemProjectId = "project_1" } = {}) {
  const attempts = exhaustedAttempts();
  const db = {
    attempts,
    recoveries: [],
    attemptWrites: 0,
    prepare(sql) {
      return {
        bind(...args) { this._args = args; return this; },
        async all() {
          if (/estimator_understanding_recoveries/.test(sql)) return { results: db.recoveries, success: true };
          if (/boq_items/.test(sql)) {
            return {
              results: [{
                boqItemId: "boqitem_1", itemNumber: "28.34", rowType: "BOQ Item",
                description: "Smoke wall mounted, addressable type", numericQuantity: 2, originalQuantity: 2,
                normalizedUnit: "Each", originalUnit: "Each", system: "Fire Alarm", category: null,
                subcategory: null, manufacturer: null, model: null, partNumber: null,
                projectId: itemProjectId, currentValues: {}, sourceLocation: null,
                interpretationAttempts: attempts,
              }],
              success: true,
            };
          }
          if (/boq_requirement_links/.test(sql)) return { results: [], success: true };
          return { results: [], success: true };
        },
        async first() {
          if (/estimator_understanding_recoveries/.test(sql)) return db.recoveries[0] || null;
          return null;
        },
        async run() {
          if (/INSERT INTO estimator_understanding_recoveries/.test(sql)) {
            const a = this._args;
            db.recoveries.push({
              id: a[0], project_id: a[1], boq_item_id: a[2], recovery_identity: a[3],
              latest_attempt_id: a[4], failed_attempt_count: a[5], currentness_state: a[6],
              input_fingerprint: a[7], config_fingerprint: a[8], provider: a[9], model: a[10],
              error_code: a[11], failure_class: a[12], provider_health_state: a[13],
              provider_health_configured: a[14], provider_health_failure_class: a[15],
              actor_id: a[16], actor_role: a[17], reason: a[18], authorized_at: a[19], consumed_at: null,
            });
            return { success: true };
          }
          db.attemptWrites += 1;
          return { success: true };
        },
      };
    },
  };
  return db;
}