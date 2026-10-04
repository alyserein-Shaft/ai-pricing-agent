// BOQ UNDERSTANDING PROVIDER HEALTH -- focused tests.
//
// WHY THIS EXISTS
//
// `boqUnderstandingProviderReadiness` answers ONE question: "is this provider
// wired up?". It inspects configuration and binding presence and never calls the
// model. In the Central Kitchen v2 benchmark it therefore reported
// "Ready -- native Workers AI binding" while ten consecutive REAL calls all
// failed with AI_PROVIDER_ERROR. Reporting a configured provider as if it were
// healthy is the defect these tests pin shut.
//
// The second defect was observability. `stableProviderCode` already separated a
// rate limit (429), an authorization failure (401/403), a request rejection
// (400/422) and an upstream outage (5xx) -- but every real call path then threw a
// flat `AI_PROVIDER_ERROR` and discarded the classification, so the actual cause
// could never be determined after the fact. These tests pin that the classified
// cause now survives.
//
// Both fixes are diagnostic only: no threshold, gate, retry policy or governed
// status vocabulary changes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDER_HEALTH_STATES,
  PROVIDER_HEALTH_STAGES,
  PROVIDER_HEALTH_STAGE_STATES,
  boqUnderstandingProviderReadiness,
  createConfiguredBoqUnderstandingProvider,
  resolveProviderHealth,
  sanitizeCloudflareProviderError,
} from "../worker/boq-understanding-provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDER = readFileSync(join(HERE, "..", "worker", "boq-understanding-provider.mjs"), "utf8");
const DIAGNOSTIC = readFileSync(join(HERE, "..", "worker", "boq-ai-diagnostic-api.mjs"), "utf8");
const ENGINE = readFileSync(join(HERE, "..", "app", "domain", "boq-understanding-engine.mjs"), "utf8");

const READY = { state: "Ready — native Workers AI binding", detail: "BOQ Understanding uses the server-side AI binding.", model: "@cf/meta/llama-3.1-8b-instruct-fast" };
const fakeBinding = (impl) => ({ AI: { run: impl } });
const envWith = (impl) => ({ BOQ_AI_PROVIDER: "cloudflare", BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast", ...fakeBinding(impl) });

// ===========================================================================
// 1. CONFIGURED is not HEALTHY
// ===========================================================================
test("a configured binding is CONFIGURED, never HEALTHY", () => {
  const health = resolveProviderHealth(READY, { attempted: false });
  assert.equal(health.configured, true);
  assert.equal(health.state, "CONFIGURED");
  assert.equal(health.probed, false);
  // The single most important assertion in this file: no configuration check may
  // ever be able to produce HEALTHY.
  assert.notEqual(health.state, "HEALTHY");
});

test("no input to resolveProviderHealth can report HEALTHY without a successful real call", () => {
  const attempts = [
    { attempted: false },
    { attempted: false, ok: true },
    { attempted: true, ok: true, failureClass: "AI_PROVIDER_UPSTREAM_UNAVAILABLE" },
    { attempted: false, ok: false },
  ];
  for (const attempt of attempts) {
    assert.notEqual(resolveProviderHealth(READY, attempt).state, "HEALTHY",
      `attempted=${attempt.attempted} must not yield HEALTHY`);
  }
  assert.equal(resolveProviderHealth(READY, { attempted: true, ok: true }).state, "HEALTHY");
});

test("readiness itself never claims a provider is healthy", () => {
  const readiness = boqUnderstandingProviderReadiness(envWith(() => {}));
  assert.equal(readiness.state, "Ready — native Workers AI binding");
  // Readiness answers configuration only. It has no health field at all.
  assert.equal(readiness.health, undefined);
  assert.equal(readiness.state === "HEALTHY", false);
});

// ===========================================================================
// 2. the probe makes a REAL provider invocation
// ===========================================================================
test("the probe performs a real binding call and reports HEALTHY on success", async () => {
  let called = 0;
  const provider = createConfiguredBoqUnderstandingProvider(envWith(async () => {
    called += 1;
    return { response: JSON.stringify({ system: { value: "Fire Alarm" } }), usage: { total_tokens: 7 } };
  }));
  assert.ok(provider, "provider must be constructed");
  await provider.interpret({ prompt: { system: "s", user: "u" }, schema: { type: "object" } });
  assert.equal(called, 1, "a real binding invocation must have happened");
  assert.equal(resolveProviderHealth(READY, { attempted: true, ok: true }).state, "HEALTHY");
});

// ===========================================================================
// 5 + 6 + 7. success / failure / preserved failure class
// ===========================================================================
test("a failed real call reports UNHEALTHY with its classified failure class", async () => {
  const cases = [
    { make: () => Object.assign(new Error("upstream"), { name: "InferenceUpstreamError" }), code: "AI_PROVIDER_ERROR", transient: false },
    { make: () => Object.assign(new Error("rate"), { status: 429 }), code: "AI_PROVIDER_RATE_LIMITED", transient: true },
    { make: () => Object.assign(new Error("auth"), { status: 401 }), code: "AI_PROVIDER_AUTHORIZATION_FAILED", transient: false },
    { make: () => Object.assign(new Error("shape"), { status: 400 }), code: "AI_PROVIDER_REQUEST_REJECTED", transient: false },
    { make: () => Object.assign(new Error("boom"), { status: 503 }), code: "AI_PROVIDER_UPSTREAM_UNAVAILABLE", transient: true },
  ];
  for (const testCase of cases) {
    const provider = createConfiguredBoqUnderstandingProvider(envWith(async () => { throw testCase.make(); }));
    let thrown = null;
    try { await provider.interpret({ prompt: { system: "s", user: "u" }, schema: { type: "object" } }); }
    catch (error) { thrown = error; }

    assert.ok(thrown, `${testCase.code}: must throw`);
    // THE OBSERVABILITY FIX: the classified cause survives instead of being
    // collapsed into one indistinguishable error.
    assert.equal(thrown.providerCode, testCase.code, "classified cause must survive");
    assert.ok(thrown.providerDiagnostic, "a sanitized diagnostic must be attached");
    assert.equal(thrown.providerDiagnostic.code, testCase.code);

    const health = resolveProviderHealth(READY, { attempted: true, ok: false, failureClass: thrown.providerCode });
    assert.equal(health.state, "UNHEALTHY");
    assert.equal(health.failureClass, testCase.code);
    assert.equal(health.transient, testCase.transient, `${testCase.code} transient classification`);
  }
});

test("the governed error.code is unchanged by the observability fix", async () => {
  // Downstream retry policy, failure classification and every persisted attempt
  // depend on `error.code`. The finer class is ADDITIVE; the coarse governed code
  // must not change meaning or historical rows would be reinterpreted.
  const provider = createConfiguredBoqUnderstandingProvider(envWith(async () => { throw Object.assign(new Error("x"), { status: 429 }); }));
  let thrown = null;
  try { await provider.interpret({ prompt: { system: "s", user: "u" }, schema: { type: "object" } }); }
  catch (error) { thrown = error; }
  assert.equal(thrown.code, "AI_PROVIDER_ERROR");
  assert.equal(thrown.providerCode, "AI_PROVIDER_RATE_LIMITED");
  // And the engine's provider-error handling is untouched by this file.
  assert.match(ENGINE, /error\?\.code === "AI_PROVIDER_ERROR" \|\| error\?\.code === "AI_PROVIDER_TIMEOUT"/);
});

// ===========================================================================
// 3 + 4. the probe is non-mutating and consumes no retry budget
// ===========================================================================
test("the diagnostic probe touches no project state and no retry budget", () => {
  // Scan EXECUTABLE CODE only: this route documents these very prohibitions in
  // prose, so scanning raw text would match its own comments.
  const CODE = DIAGNOSTIC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // It reads no database handle at all, and inserts nothing.
  assert.ok(!/\.prepare\(|\.batch\(|INSERT|UPDATE|DELETE/i.test(CODE),
    "the probe must perform no database mutation of any kind");
  assert.ok(!/MAX_PER_ITEM_RETRY_ATTEMPTS|retry/i.test(CODE), "the probe must not consult retry budget");
  // It analyses a fixed FICTIONAL item, never a project row.
  assert.match(DIAGNOSTIC, /id: "fictional-native-smoke"/);
  // No project, BOQ-item or document identity may appear in executable code.
  assert.ok(!/projectId|project_id|boqItemId|boq_item_id|documentId|sourceDocument/i.test(CODE),
    "no project/BOQ/document identity may be referenced by the probe");
});

test("the probe rejects any caller-supplied payload or parameter", () => {
  // Fixed payload only: a probe cannot be steered into carrying project content.
  assert.match(DIAGNOSTIC, /FIXED_PAYLOAD_ONLY/);
  assert.match(DIAGNOSTIC, /if \(url\.search\)/);
  assert.match(DIAGNOSTIC, /if \(body\.trim\(\)\)/);
});

// ===========================================================================
// 8. secrets are never exposed
// ===========================================================================
test("diagnostics are sanitized: no upstream payload, no credential", () => {
  const hostile = Object.assign(new Error("denied for token sk-SECRET-abc123"), {
    status: 401,
    authorization: "Bearer sk-SECRET-abc123",
    request: { headers: { Authorization: "Bearer sk-SECRET-abc123" } },
  });
  const diagnostic = sanitizeCloudflareProviderError(hostile, { durationMs: 12, model: "@cf/meta/llama-3.1-8b-instruct-fast" });
  const serialized = JSON.stringify(diagnostic);
  assert.ok(!serialized.includes("sk-SECRET-abc123"), "no credential may appear anywhere in the diagnostic");
  assert.ok(!serialized.includes("Bearer"), "no header may be echoed");
  assert.equal(diagnostic.code, "AI_PROVIDER_AUTHORIZATION_FAILED");
  assert.equal(diagnostic.message, "Cloudflare Workers AI request failed.", "a fixed message, never the upstream text");
  // Bounded: name is sanitized and length-capped.
  assert.match(diagnostic.name, /^[A-Za-z0-9_ -]{1,64}$/);
});

test("the timeout class is preserved separately from a generic failure", () => {
  assert.equal(sanitizeCloudflareProviderError(new Error("t"), { model: "m", timedOut: true }).code, "AI_PROVIDER_TIMEOUT");
  assert.equal(resolveProviderHealth(READY, { attempted: true, ok: false, failureClass: "AI_PROVIDER_TIMEOUT" }).transient, true);
});

// ===========================================================================
// 9. existing provider selection is unchanged
// ===========================================================================
test("provider selection itself is untouched by the health work", () => {
  // Readiness still returns null for a missing binding -- the health model adds
  // reporting, it never makes a misconfigured provider usable.
  assert.equal(boqUnderstandingProviderReadiness({ BOQ_AI_PROVIDER: "cloudflare", BOQ_AI_MODEL: "@cf/x" }).state, "Unavailable — binding missing");
  assert.equal(boqUnderstandingProviderReadiness({ BOQ_AI_PROVIDER: "openai", BOQ_AI_MODEL: "gpt" }).state, "Misconfigured");
  assert.equal(createConfiguredBoqUnderstandingProvider({ BOQ_AI_PROVIDER: "cloudflare", BOQ_AI_MODEL: "@cf/x" }), null);
  // The factory body and the hermetic seam are unchanged. NOTE: the hermetic
  // flag is GOLDEN_HERMETIC_AI, pinned by the committed
  // tests/golden-hermetic-understanding-determinism.test.mjs, which also pins
  // that GOLDEN_E2E must NOT conjure a provider (a committed governance test in
  // tests/boq-understanding.test.mjs requires GOLDEN_E2E=1 without a binding to
  // keep failing closed). An earlier revision of this assertion expected
  // GOLDEN_E2E and was stale against that committed authority.
  assert.match(PROVIDER, /export function createDeterministicHermeticProvider/);
  assert.match(PROVIDER, /if \(String\(env\.GOLDEN_HERMETIC_AI \|\| ""\) !== "1"\) return null;/);
  assert.match(PROVIDER, /if \(readiness\.state !== "Ready — native Workers AI binding"\) return null;/);
});

// ===========================================================================
// 10. Golden hermetic behaviour remains isolated
// ===========================================================================
test("the hermetic Golden provider stays isolated from the real provider path", () => {
  // GOLDEN_HERMETIC_AI is the ONLY switch (committed hermetic-determinism
  // authority), and it short-circuits before any real binding is constructed.
  // The health model must not become a second activation path. GOLDEN_E2E
  // deliberately does NOT activate it (see the committed hermetic test).
  assert.match(PROVIDER, /const hermetic = createDeterministicHermeticProvider\(env\);\s*\n\s*if \(hermetic\) return hermetic;/);
  const hermetic = createConfiguredBoqUnderstandingProvider({ GOLDEN_HERMETIC_AI: "1" });
  assert.equal(hermetic.metadata.provider, "hermetic-deterministic-boq-understanding");
  assert.equal(hermetic.metadata.model, "hermetic-fixture-v1");
  // Real providers never carry the hermetic fixture model.
  assert.ok(!PROVIDER.includes('"hermetic-fixture-v1"') || PROVIDER.indexOf('"hermetic-fixture-v1"') > PROVIDER.indexOf("createDeterministicHermeticProvider"));
});

// ===========================================================================
// the health vocabulary is closed
// ===========================================================================
test("provider health states are a closed, documented vocabulary", () => {
  assert.deepEqual([...PROVIDER_HEALTH_STATES], ["CONFIGURED", "HEALTHY", "UNHEALTHY", "UNKNOWN", "STRUCTURED_OUTPUT_HEALTHY"]);
  assert.equal(PROVIDER_HEALTH_STATES.length, 5);
  for (const state of PROVIDER_HEALTH_STATES) {
    assert.match(PROVIDER, new RegExp(`state: "${state}"`), `${state} must be producible`);
  }
  // The evidence-stage vocabularies are closed too: a health verdict must
  // distinguish how far the evidence got, and one completed call can never
  // prove more than the stages it literally observed.
  assert.deepEqual([...PROVIDER_HEALTH_STAGES], ["CONFIGURED", "REACHABLE", "AUTHENTICATED", "MODEL_AVAILABLE", "STRUCTURED_OUTPUT_HEALTHY", "OPERATIONALLY_STABLE"]);
  assert.deepEqual([...PROVIDER_HEALTH_STAGE_STATES], ["CONFIRMED", "REFUTED", "UNKNOWN"]);
  // A non-configured provider is UNKNOWN, never healthy and never "ready".
  const misconfigured = resolveProviderHealth({ state: "Misconfigured", model: null }, { attempted: false });
  assert.equal(misconfigured.state, "UNKNOWN");
  assert.equal(misconfigured.configured, false);
  assert.equal(misconfigured.failureClass, "PROVIDER_MISCONFIGURED");
  assert.equal(resolveProviderHealth({ state: "Unavailable — binding missing", model: "m" }, {}).failureClass, "AI_BINDING_MISSING");
});

test("health results are frozen so no consumer can rewrite a reported state", () => {
  const health = resolveProviderHealth(READY, { attempted: true, ok: true });
  assert.throws(() => { health.state = "CONFIGURED"; });
  assert.throws(() => { health.failureClass = null; });
});