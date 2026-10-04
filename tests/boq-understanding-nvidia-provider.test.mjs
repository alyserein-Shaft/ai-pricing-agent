// NVIDIA Nemotron (NVIDIA_NIM) BOQ Understanding provider tests.
//
// MOCKED ONLY: no live NVIDIA endpoint and no real credential is ever required
// here. Every network call is replaced with a stub; the only keys in this file
// are obviously fake fixtures.
//
// What is pinned:
//   - provider identity constants (canonical, frozen, closed)
//   - readiness configuration gate (hosted requires key, loopback does not)
//   - NO automatic fallback between vendors when NVIDIA is misconfigured
//   - health probe semantics (closed vocabulary, never HEALTHY without a real
//     completed call, 202 = pending and never a failure, transient mapping)
//   - interpret() request governance (temperature 0, stream false,
//     max_tokens 2048, json_schema CONSTRAINED decoding with the SAME
//     canonical BOQ schema Workers AI receives, thinking disabled, credential
//     only in the outbound Authorization header; the probe keeps the minimal
//     json_object mode)
//   - fail-closed structured output (invalid JSON is rejected, never repaired)
//   - error classification survives on the thrown error without changing the
//     governed coarse error.code
//   - provenance: provider identity and model stay separately observable and
//     produce a different interpretation config fingerprint than Workers AI
//   - Golden hermetic isolation still short-circuits first

import test, { after } from "node:test";
import assert from "node:assert/strict";

import {
  CLOUDFLARE_WORKERS_AI,
  DEFAULT_NVIDIA_BOQ_MODEL,
  NVIDIA_NIM,
  PROVIDER_IDENTITY_CHOICES,
  boqUnderstandingProviderReadiness,
  createConfiguredBoqUnderstandingProvider,
  createConfiguredNvidiaNimStructuredProvider,
  probeNvidiaNimProviderHealth,
} from "../worker/boq-understanding-provider.mjs";
import { interpretBoqItem, interpretationConfigFingerprint, prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";

const realFetch = global.fetch;
after(() => { global.fetch = realFetch; });

const FAKE_KEY = "sk-nvidia-fixture-not-a-real-key";

const nvidiaEnv = (over = {}) => ({
  BOQ_AI_PROVIDER: "NVIDIA_NIM",
  BOQ_AI_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
  NVIDIA_API_KEY: FAKE_KEY,
  ...over,
});

const responseOf = ({ status = 200, body = null, headers = {} }) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const completionBody = (content, usage = null) => ({
  ...(usage ? { usage } : {}),
  choices: [{ message: { content } }],
});

const prompt = { system: "system-contract-prompt", user: "user-row-prompt" };

// ===========================================================================
// 1. Identity
// ===========================================================================

test("provider identity constants are canonical, frozen and closed", () => {
  assert.equal(CLOUDFLARE_WORKERS_AI, "CLOUDFLARE_WORKERS_AI");
  assert.equal(NVIDIA_NIM, "NVIDIA_NIM");
  assert.ok(Object.isFrozen(PROVIDER_IDENTITY_CHOICES));
  assert.deepEqual([...PROVIDER_IDENTITY_CHOICES], [CLOUDFLARE_WORKERS_AI, NVIDIA_NIM]);
  assert.equal(PROVIDER_IDENTITY_CHOICES.length, 2);
  assert.ok(!PROVIDER_IDENTITY_CHOICES.includes("SOME_OTHER_PROVIDER"));
  // The model name must never be usable as a provider identity.
  assert.ok(!PROVIDER_IDENTITY_CHOICES.some((choice) => choice.includes("nemotron")));
});

test("model identity is resolved independently and never leaks the Workers AI default", () => {
  assert.equal(
    boqUnderstandingProviderReadiness(nvidiaEnv({ BOQ_AI_MODEL: "NVIDIA_NIM/nvidia/nemotron-3.5-lightning-30b-a3b" })).model,
    "nvidia/nemotron-3.5-lightning-30b-a3b",
  );
  assert.equal(boqUnderstandingProviderReadiness(nvidiaEnv({ BOQ_AI_MODEL: "NVIDIA_NIM" })).model, DEFAULT_NVIDIA_BOQ_MODEL);
  assert.equal(
    boqUnderstandingProviderReadiness(nvidiaEnv({ BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast" })).model,
    DEFAULT_NVIDIA_BOQ_MODEL,
  );
  assert.equal(boqUnderstandingProviderReadiness(nvidiaEnv({ BOQ_AI_MODEL: "" })).model, DEFAULT_NVIDIA_BOQ_MODEL);
});

// ===========================================================================
// 2. Readiness configuration gate (never health)
// ===========================================================================

test("readiness refuses NVIDIA on the hosted endpoint without a key", () => {
  const result = boqUnderstandingProviderReadiness(nvidiaEnv({ NVIDIA_API_KEY: "" }));
  assert.equal(result.state, "Misconfigured");
  assert.match(result.detail, /NVIDIA_API_KEY/);
});

test("readiness accepts NVIDIA on the hosted endpoint with a key, without claiming health", () => {
  const result = boqUnderstandingProviderReadiness(nvidiaEnv());
  assert.equal(result.state, "Ready — NVIDIA NIM configured");
  assert.equal(result.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.ok(!("health" in result), "readiness must never carry a health claim");
});

test("readiness accepts a loopback NIM container without a key", () => {
  const result = boqUnderstandingProviderReadiness(nvidiaEnv({
    NVIDIA_API_KEY: "",
    NVIDIA_NIM_BASE_URL: "http://localhost:8000/v1",
  }));
  assert.equal(result.state, "Ready — NVIDIA NIM configured");
  // A lookalike host never qualifies as loopback: keyless access stays closed.
  const lookalike = boqUnderstandingProviderReadiness(nvidiaEnv({
    NVIDIA_API_KEY: "",
    NVIDIA_NIM_BASE_URL: "http://localhost.evil.example:8000/v1",
  }));
  assert.equal(lookalike.state, "Misconfigured");
});

test("readiness for Workers AI is untouched by the NVIDIA branch", () => {
  const result = boqUnderstandingProviderReadiness({
    BOQ_AI_PROVIDER: "cloudflare",
    BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    AI: { run: async () => ({}) },
  });
  assert.equal(result.state, "Ready — native Workers AI binding");
});

// ===========================================================================
// 3. Factory gates: fail closed, NO automatic fallback
// ===========================================================================

test("factory returns null for misconfigured NVIDIA and never falls back to Workers AI", () => {
  // Even with a perfectly healthy Workers AI binding present, a selected-but-
  // unconfigured NVIDIA provider must yield null, not the other vendor.
  const provider = createConfiguredBoqUnderstandingProvider({
    BOQ_AI_PROVIDER: "NVIDIA_NIM",
    AI: { run: async () => ({ response: "{}" }) },
  });
  assert.equal(provider, null, "no automatic cross-vendor fallback is permitted");
  assert.equal(createConfiguredNvidiaNimStructuredProvider({ BOQ_AI_PROVIDER: "NVIDIA_NIM" }), null);
});

test("factory yields the NVIDIA provider with separately observable identity", () => {
  const provider = createConfiguredBoqUnderstandingProvider(nvidiaEnv());
  assert.ok(provider, "configured NVIDIA provider must be created");
  assert.equal(provider.metadata.provider, NVIDIA_NIM);
  assert.equal(provider.metadata.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(provider.metadata.escalationEnabled, false);
  // The model name is not the provider identity, and vice versa.
  assert.ok(!provider.metadata.provider.includes("nemotron"));
  assert.ok(!provider.metadata.model.includes("NVIDIA_NIM"));
});

test("Golden hermetic isolation still short-circuits before NVIDIA", () => {
  const provider = createConfiguredBoqUnderstandingProvider(
    { ...nvidiaEnv(), GOLDEN_HERMETIC_AI: "1" },
  );
  assert.equal(provider.metadata.provider, "hermetic-deterministic-boq-understanding");
  assert.equal(provider.metadata.model, "hermetic-fixture-v1");
});

test("the Workers AI factory path is unchanged", () => {
  const provider = createConfiguredBoqUnderstandingProvider({
    BOQ_AI_PROVIDER: "cloudflare",
    BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    AI: { run: async () => ({}) },
  });
  assert.equal(provider.metadata.provider, "cloudflare-workers-ai-binding");
});

// ===========================================================================
// 4. Provenance / currentness
// ===========================================================================

test("NVIDIA provenance yields a different interpretation config fingerprint than Workers AI", () => {
  const nvidia = createConfiguredBoqUnderstandingProvider(nvidiaEnv()).metadata;
  const workers = {
    provider: "cloudflare-workers-ai-binding",
    model: "@cf/meta/llama-3.1-8b-instruct-fast",
    modelVersion: "@cf/meta/llama-3.1-8b-instruct-fast",
  };
  const nvidiaFingerprint = interpretationConfigFingerprint(nvidia);
  const workersFingerprint = interpretationConfigFingerprint(workers);
  assert.ok(nvidiaFingerprint && workersFingerprint);
  assert.notEqual(nvidiaFingerprint, workersFingerprint, "a provider switch must invalidate currentness");
  // Stable for the same identity.
  assert.equal(nvidiaFingerprint, interpretationConfigFingerprint({ ...nvidia }));
});

// ===========================================================================
// 5. Health probe (mocked)
// ===========================================================================

test("probe without configuration stays UNKNOWN and never HEALTHY", async () => {
  const result = await probeNvidiaNimProviderHealth({ BOQ_AI_PROVIDER: "NVIDIA_NIM" });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.configured, false);
  assert.equal(result.probed, false);
  assert.equal(result.provider, NVIDIA_NIM);
  assert.ok(Object.isFrozen(result));
});

// RECONCILED against the canonical provider contract (worker/boq-understanding-provider.mjs).
// The provider deliberately separates evidence STAGES: one completed structured
// call proves transport, credentials, model routing and structured output, but
// NOT operational stability, so it reports STRUCTURED_OUTPUT_HEALTHY. Only
// repeated consecutive successes may be reported as HEALTHY. This test previously
// asserted a bare "HEALTHY" from a SINGLE call, which contradicted that contract
// and would have overstated provider reliability. The expectation is corrected
// here rather than the provider being reverted, because the provider's contract
// is the newer canonical model and is internally consistent.
test("probe performs exactly one real request and reports STRUCTURED_OUTPUT_HEALTHY (never HEALTHY) on a single completed call", async () => {
  let calls = 0;
  let captured = null;
  global.fetch = async (url, init) => {
    calls += 1;
    captured = { url, init };
    return responseOf({ body: completionBody("{\"ok\":true}") });
  };
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  // A single structured call must NOT claim HEALTHY.
  assert.equal(result.state, "STRUCTURED_OUTPUT_HEALTHY");
  assert.notEqual(result.state, "HEALTHY", "one call must never be reported as operationally stable");
  assert.equal(result.configured, true);
  assert.equal(result.probed, true);
  assert.equal(result.failureClass, null);
  assert.equal(result.provider, NVIDIA_NIM);
  assert.equal(result.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.ok(Object.isFrozen(result));
  assert.equal(calls, 1, "the probe must be a single request");
  assert.equal(captured.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  // The probe payload is fictional; no project or BOQ-row content is involved.
  assert.match(body.messages[1].content, /Addressable optical smoke detector/);
  assert.ok(!body.messages.some((m) => /central kitchen/i.test(m.content)), "no project data may enter the probe");
});

test("probe maps HTTP 401 to authorization failure (transient: no)", async () => {
  global.fetch = async () => responseOf({ status: 401, body: { error: { code: "invalid_api_key" } } });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_PROVIDER_AUTHORIZATION_FAILED");
  assert.equal(result.transient, false);
});

test("probe maps HTTP 429 to rate limited (transient: yes)", async () => {
  global.fetch = async () => responseOf({ status: 429, body: { error: { code: "rate_limit_exceeded" } } });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_PROVIDER_RATE_LIMITED");
  assert.equal(result.transient, true);
});

test("probe maps HTTP 500 to upstream unavailable (transient: yes)", async () => {
  global.fetch = async () => responseOf({ status: 500, body: { error: { code: "internal_error" } } });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_PROVIDER_UPSTREAM_UNAVAILABLE");
  assert.equal(result.transient, true);
});

test("probe maps HTTP 400 to request rejected (transient: no)", async () => {
  global.fetch = async () => responseOf({ status: 400, body: { error: { message: "bad request" } } });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_PROVIDER_REQUEST_REJECTED");
  assert.equal(result.transient, false);
});

test("probe fails closed when the response carries no usable structured content", async () => {
  global.fetch = async () => responseOf({ body: { model: "nvidia/nemotron-3.5-lightning-30b-a3b" } });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_OUTPUT_INVALID");
});

test("probe fails closed on prose (non-JSON) message content", async () => {
  global.fetch = async () => responseOf({ body: completionBody("This is prose, not JSON.") });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_OUTPUT_INVALID");
  assert.equal(result.stages.structuredOutputHealthy.status, "REFUTED");
  assert.equal(result.stages.structuredOutputHealthy.reason, "INVALID_OUTPUT");
});

test("probe classifies an abort/timeout cause as AI_PROVIDER_TIMEOUT", async () => {
  global.fetch = async () => { throw new Error("Request timed out after 15000ms"); };
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_PROVIDER_TIMEOUT");
  assert.equal(result.transient, true);
});

test("probe classifies a network error as AI_PROVIDER_ERROR", async () => {
  global.fetch = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:8000"); };
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "UNHEALTHY");
  assert.equal(result.failureClass, "AI_PROVIDER_ERROR");
});

test("probe treats HTTP 202 as pending: never a failure, never HEALTHY", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseOf({ status: 202, body: { status: "accepted" } }); };
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  assert.equal(result.state, "CONFIGURED", "pending health stays unproven");
  assert.equal(result.configured, true);
  assert.equal(result.probed, false);
  assert.equal(result.pending, true, "pending must be explicit");
  assert.equal(result.failureClass, null, "202 must never be reported as a failure");
  assert.equal(calls, 2, "one bounded resume attempt, then stop");
  assert.ok(Object.isFrozen(result));
});

test("probe reaches HEALTHY only after repeated consecutive structured successes", async () => {
  // A unique model gives this test its own ledger entry, isolated from the
  // default-model probes elsewhere in this file.
  const env = { ...nvidiaEnv(), BOQ_AI_MODEL: "NVIDIA_NIM/nvidia/nemotron-3.5-lightning-30b-a3b-stability" };
  global.fetch = async () => responseOf({ body: completionBody("{\"ok\":true}") });
  const first = await probeNvidiaNimProviderHealth(env);
  assert.equal(first.state, "STRUCTURED_OUTPUT_HEALTHY");
  assert.equal(first.stages.operationallyStable.status, "UNKNOWN");
  const second = await probeNvidiaNimProviderHealth(env);
  assert.equal(second.state, "STRUCTURED_OUTPUT_HEALTHY");
  assert.equal(second.stages.operationallyStable.status, "UNKNOWN");
  const third = await probeNvidiaNimProviderHealth(env);
  assert.equal(third.state, "HEALTHY", "stability is proven only by consecutive successes");
  assert.equal(third.stages.operationallyStable.status, "CONFIRMED");
  assert.equal(third.stages.operationallyStable.reason, "CONSECUTIVE_SUCCESSES");
  assert.ok(Object.isFrozen(third));
  assert.ok(Object.isFrozen(third.stages));
});

test("repeated consecutive stalls refute stability as UPSTREAM_UNSTABLE instead of inviting more calls", async () => {
  const env = { ...nvidiaEnv(), BOQ_AI_MODEL: "NVIDIA_NIM/nvidia/nemotron-3.5-lightning-30b-a3b-stalls" };
  global.fetch = async () => { throw new Error("Request timed out after 90000ms"); };
  const first = await probeNvidiaNimProviderHealth(env);
  assert.equal(first.state, "UNHEALTHY");
  assert.equal(first.failureClass, "AI_PROVIDER_TIMEOUT");
  assert.equal(first.stages.reachable.status, "REFUTED");
  assert.equal(first.stages.operationallyStable.status, "UNKNOWN", "a single stall is one bad observation");
  const second = await probeNvidiaNimProviderHealth(env);
  assert.equal(second.state, "UNHEALTHY");
  assert.equal(second.stages.operationallyStable.status, "REFUTED");
  assert.equal(second.stages.operationallyStable.reason, "UPSTREAM_UNSTABLE", "repeated stalls must surface UPSTREAM_UNSTABLE");
});

test("probe result never contains the credential", async () => {
  global.fetch = async () => responseOf({ body: completionBody("{\"ok\":true}") });
  const result = await probeNvidiaNimProviderHealth(nvidiaEnv());
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(FAKE_KEY), "the API key must never appear in probe output");
  assert.ok(!serialized.includes("Bearer"));
});

// ===========================================================================
// 6. interpret() (mocked)
// ===========================================================================

const interpret = async (env, providerOptions) => {
  const provider = createConfiguredBoqUnderstandingProvider(env, providerOptions);
  assert.ok(provider, "provider must be configured");
  return provider.interpret({ prompt });
};

test("interpret sends the governed NVIDIA request and returns parsed JSON", async () => {
  let captured = null;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return responseOf({
      body: completionBody(
        JSON.stringify({ normalizedDescription: { value: "row", origin: "EXTRACTED", confidence: 90 } }),
        { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      ),
    });
  };
  const provider = createConfiguredBoqUnderstandingProvider(nvidiaEnv());
  const result = await provider.interpret({ prompt });

  assert.equal(result.normalizedDescription.value, "row");
  assert.equal(captured.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 2048);
  // Constrained decoding with the SAME canonical schema Workers AI receives --
  // no NVIDIA-specific interpretation schema, only the OpenAI wire envelope.
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "boq_understanding");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ["normalizedDescription", "confidence"]);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.deepEqual(body.messages, [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ]);
  assert.equal(provider.lastCallMetadata.usage.total_tokens, 18);
});

test("interpret fails closed on malformed structured output without prose repair", async () => {
  global.fetch = async () => responseOf({ body: completionBody("Sure! Here is the JSON you asked for: { not json") });
  await assert.rejects(
    () => interpret(nvidiaEnv()),
    (error) => {
      assert.equal(error.code, "AI_OUTPUT_INVALID");
      assert.equal(error.providerCode, "AI_OUTPUT_INVALID");
      assert.ok(!/Sure! Here is/.test(error.message), "untrusted model text must never be echoed");
      return true;
    },
  );
});

test("interpret fails closed when the response has no content", async () => {
  global.fetch = async () => responseOf({ body: { choices: [{ message: {} }] } });
  await assert.rejects(() => interpret(nvidiaEnv()), (error) => error.code === "AI_OUTPUT_INVALID");
});

test("interpret keeps the coarse governed code while the classified cause survives", async () => {
  const cases = [
    { status: 401, providerCode: "AI_PROVIDER_AUTHORIZATION_FAILED" },
    { status: 403, providerCode: "AI_PROVIDER_AUTHORIZATION_FAILED" },
    { status: 429, providerCode: "AI_PROVIDER_RATE_LIMITED" },
    { status: 400, providerCode: "AI_PROVIDER_REQUEST_REJECTED" },
    { status: 503, providerCode: "AI_PROVIDER_UPSTREAM_UNAVAILABLE" },
  ];
  for (const testCase of cases) {
    global.fetch = async () => responseOf({ status: testCase.status, body: { error: { message: "upstream says no" } } });
    await assert.rejects(
      () => interpret(nvidiaEnv()),
      (error) => {
        assert.equal(error.code, "AI_PROVIDER_ERROR", `status ${testCase.status} keeps the historical coarse code`);
        assert.equal(error.providerCode, testCase.providerCode);
        assert.equal(error.providerDiagnostic.code, testCase.providerCode);
        assert.ok(!JSON.stringify(error.providerDiagnostic).includes(FAKE_KEY));
        assert.ok(!String(error.message).includes(FAKE_KEY));
        return true;
      },
    );
  }
});

test("interpret maps an abort to the governed timeout code", async () => {
  global.fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })));
  });
  // NVIDIA uses its own transport envelope (NVIDIA_NIM_TIMEOUT_MS), not the
  // Workers AI-tuned BOQ_AI_TIMEOUT_MS.
  await assert.rejects(
    () => interpret(nvidiaEnv({ NVIDIA_NIM_TIMEOUT_MS: "1000", BOQ_AI_TIMEOUT_MS: "30000" })),
    (error) => {
      assert.equal(error.code, "AI_PROVIDER_TIMEOUT");
      assert.equal(error.providerCode, "AI_PROVIDER_TIMEOUT");
      return true;
    },
  );
});

test("interpret treats a still-pending HTTP 202 as transient pending, not a provider failure", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseOf({ status: 202, body: { status: "accepted" } }); };
  await assert.rejects(
    () => interpret(nvidiaEnv()),
    (error) => {
      // Governed transient code so retry semantics apply; the classified cause
      // explicitly says PENDING, never a failure class.
      assert.equal(error.code, "AI_PROVIDER_TIMEOUT");
      assert.equal(error.providerCode, "AI_PROVIDER_PENDING");
      assert.equal(calls, 2, "one bounded resume, then report pending");
      return true;
    },
  );
});

test("interpret does not emit or persist reasoning traces", async () => {
  global.fetch = async () => responseOf({
    body: {
      choices: [{
        message: {
          reasoning: "secret chain of thought that must never survive",
          content: JSON.stringify({ normalizedDescription: { value: "row", origin: "EXTRACTED", confidence: 90 } }),
        },
      }],
    },
  });
  const result = await interpret(nvidiaEnv());
  assert.ok(!("reasoning" in result), "reasoning must not reach the canonical output");
  assert.ok(!JSON.stringify(result).includes("secret chain of thought"));
});

// ===========================================================================
// Provider-accurate failure messaging
// ===========================================================================

test("interpretBoqItem's sanitized provider-failure message names NVIDIA, never Workers AI", async () => {
  global.fetch = async () => responseOf({ status: 500, body: { error: { message: "secret upstream detail" } } });
  const provider = createConfiguredBoqUnderstandingProvider(nvidiaEnv());
  const result = await interpretBoqItem(prepareBoqUnderstandingInput({
    id: "fictional-row",
    description: "Addressable smoke detector",
    numericQuantity: 1,
    normalizedUnit: "Each",
  }), { provider });
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "AI_PROVIDER_ERROR");
  // The message must name the provider that ACTUALLY failed (identity is
  // observable and truthful); the historical Workers AI wording belongs to
  // the Workers AI path only and stays pinned there by its own suite.
  assert.equal(result.error.message, "NVIDIA NIM could not complete the request.");
  assert.doesNotMatch(JSON.stringify(result), /secret upstream detail/);
});

test("diagnostic failure readiness names the provider that failed", async () => {
  global.fetch = async () => responseOf({ status: 500, body: {} });
  const { handleBoqAiDiagnosticApi } = await import("../worker/boq-ai-diagnostic-api.mjs");
  const response = await handleBoqAiDiagnosticApi(
    new Request("http://localhost/api/dev/boq-ai/native-smoke", { method: "POST" }),
    { ...nvidiaEnv(), BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1" },
  );
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.provider, "NVIDIA_NIM");
  assert.equal(payload.readiness.state, "Provider error");
  assert.equal(payload.readiness.detail, "NVIDIA NIM could not complete the request.");
  assert.equal(payload.errorCategory, "AI_PROVIDER_ERROR");
});
