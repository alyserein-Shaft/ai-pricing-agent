import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  BOQ_GOVERNED_INPUT_BUDGET,
  BOQ_NVIDIA_RESERVED_OUTPUT_TOKENS,
  NEMOTRON_GOVERNED_CONTEXT_LIMIT,
  NVIDIA_NIM,
  DEFAULT_NVIDIA_BOQ_MODEL,
  createConfiguredBoqUnderstandingProvider,
  detectContextOverflowSignal,
  estimateBoqRequestTokens,
} from "../worker/boq-understanding-provider.mjs";
import {
  buildBoqUnderstandingPrompt,
  interpretBoqItem,
  interpretationConfigFingerprint,
  interpretationInputFingerprint,
  prepareBoqUnderstandingInput,
} from "../app/domain/boq-understanding-engine.mjs";

// Nemotron canonical adoption + context-overflow diagnosis. Stubbed transport,
// no network, no database.

const NIM_ENV = { NVIDIA_BASE_URL: "http://127.0.0.1:9/v1", BOQ_AI_MODEL: "NVIDIA_NIM/nvidia/nemotron-3-ultra-550b-a55b" };
const VALID_JSON = JSON.stringify({
  normalizedDescription: { value: "Addressable smoke detector", origin: "EXTRACTED", confidence: 90 },
  system: { value: "Fire Alarm", origin: "INFERRED", confidence: 70 },
  category: { value: "Detection Devices", origin: "INFERRED", confidence: 70 },
  equipmentType: { value: "Detector", origin: "INFERRED", confidence: 70 },
  productFamily: { value: null, origin: "MISSING", confidence: 0 },
  taxonomyCandidateKey: { value: null, origin: "MISSING", confidence: 0 },
  technicalAttributes: [],
  standards: [],
  manufacturerEvidence: [],
  compatibilityRequirements: [],
  requiredAccessories: [],
  searchTerms: [],
  missingInformation: [],
  ambiguities: [],
  confidence: "HIGH",
});
const okBody = (content) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });
const stubFetch = (handler) => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return calls;
};
const okFetch = (body) => stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }));

describe("Nemotron canonical provider + context safety", () => {
  it("1-2. unset provider with a configured NIM endpoint resolves to canonical NVIDIA Ultra", () => {
    const { BOQ_AI_PROVIDER, ...withoutSelection } = { ...NIM_ENV, BOQ_AI_PROVIDER: undefined };
    const provider = createConfiguredBoqUnderstandingProvider(withoutSelection);
    assert.ok(provider);
    assert.equal(provider.metadata.provider, NVIDIA_NIM);
    assert.equal(provider.metadata.model, "nvidia/nemotron-3-ultra-550b-a55b");
    assert.equal(provider.metadata.model, DEFAULT_NVIDIA_BOQ_MODEL);
  });

  it("explicit cloudflare selection is still honored (operator choice, not fallback)", () => {
    const provider = createConfiguredBoqUnderstandingProvider({
      BOQ_AI_PROVIDER: "cloudflare",
      BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
      AI: { run: async () => ({ response: "{}" }) },
    });
    assert.equal(provider.metadata.provider, "cloudflare-workers-ai-binding");
  });

  it("canonical-but-unconfigured NVIDIA never silently falls back to Cloudflare", () => {
    const provider = createConfiguredBoqUnderstandingProvider({
      BOQ_AI_PROVIDER: "NVIDIA_NIM",
      AI: { run: async () => ({ response: "{}" }) },
    });
    assert.equal(provider, null);
  });

  it("3. persisted metadata matches the actually-called model", async () => {
    const calls = okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    await provider.interpret({ prompt: { system: "s", user: "u" } });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.model, provider.metadata.model);
    assert.equal(sent.model, "nvidia/nemotron-3-ultra-550b-a55b");
    assert.equal(provider.metadata.provider, NVIDIA_NIM);
  });

  it("4-6. successful Nemotron response follows the validated path with separate raw evidence", async () => {
    okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Addressable smoke detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    const result = await interpretBoqItem(input, { provider });
    assert.ok(result.status === "COMPLETED" || result.status === "NEEDS_REVIEW");
    assert.ok(result.interpretation);
    assert.equal(provider.lastCallRawResponse, VALID_JSON);
    assert.notEqual(result.interpretation, result.rawResponse);
    assert.ok(!("rawResponse" in result.interpretation));
  });

  it("reasoning-mode content is never parsed or persisted as interpretation", async () => {
    okFetch({ choices: [{ message: { content: VALID_JSON, reasoning_content: "hidden chain of thought that must never govern" } }], usage: {} });
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const parsed = await provider.interpret({ prompt: { system: "s", user: "u" } });
    assert.equal(parsed.normalizedDescription.value, "Addressable smoke detector");
    assert.equal(provider.lastCallRawResponse, VALID_JSON);
    assert.ok(!JSON.stringify(provider.lastCallRawResponse).includes("hidden chain"));
  });

  it("7. Nemotron failure with a healthy Cloudflare binding never reroutes", async () => {
    stubFetch(async () => ({ ok: false, status: 500, text: async () => "down" }));
    let cfCalls = 0;
    const provider = createConfiguredBoqUnderstandingProvider({
      ...NIM_ENV,
      AI: { run: async () => { cfCalls += 1; return { response: "{}" }; } },
    });
    assert.equal(provider.metadata.provider, NVIDIA_NIM);
    const result = await interpretBoqItem(
      prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []),
      { provider },
    );
    assert.equal(result.status, "FAILED");
    assert.equal(result.error.code, "AI_PROVIDER_ERROR");
    assert.equal(cfCalls, 0);
    assert.equal(result.rawResponse, null);
  });

  it("8. normal request below budget reaches the NVIDIA adapter", async () => {
    const calls = okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    await provider.interpret({ prompt: { system: "s", user: "u" } });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chat\/completions$/);
  });

  it("9-10. oversized request fails preflight without invoking the provider", async () => {
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const huge = "x".repeat((BOQ_GOVERNED_INPUT_BUDGET + 1000) * 4);
    const input = prepareBoqUnderstandingInput({ boqItemId: "b1", description: huge, numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    const result = await interpretBoqItem(input, { provider });
    assert.equal(result.status, "FAILED");
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
    assert.equal(result.interpretation, undefined);
    assert.equal(result.rawResponse, null);
    assert.equal(calls.length, 0);
  });

  it("11. explicit endpoint context errors classify as overflow (413, error code, classic message)", () => {
    assert.equal(detectContextOverflowSignal(413, null), "http-413");
    assert.ok(detectContextOverflowSignal(400, { error: { code: "context_length_exceeded", message: "x" } }));
    assert.ok(detectContextOverflowSignal(400, { error: { message: "This model's maximum context length is 4096 tokens, however you requested 5000 tokens." } }));
  });

  it("11b. provider-reported overflow surfaces as typed FAILED, never an interpretation", async () => {
    stubFetch(async () => ({
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: { code: "context_length_exceeded", message: "maximum context length exceeded", type: "invalid_request_error" } }),
    }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const result = await interpretBoqItem(
      prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []),
      { provider },
    );
    assert.equal(result.status, "FAILED");
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
    assert.equal(result.interpretation, undefined);
    assert.equal(result.rawResponse, null);
  });

  it("12. generic 400s and bare max_tokens complaints are not overflow", () => {
    assert.equal(detectContextOverflowSignal(400, { error: { code: "invalid_request_error", message: "Bad request." } }), null);
    assert.equal(detectContextOverflowSignal(400, { error: { message: "max_tokens must be an integer." } }), null);
    assert.equal(detectContextOverflowSignal(500, null), null);
    assert.equal(detectContextOverflowSignal(429, null), null);
  });

  it("15. malformed and schema-invalid responses stay distinguishable from overflow", async () => {
    okFetch({ choices: [{ message: { content: "[[broken" } }], usage: {} });
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    const malformed = await interpretBoqItem(input, { provider });
    assert.equal(malformed.error.code, "AI_OUTPUT_INVALID_SCHEMA");
    assert.equal(malformed.rawResponse, "[[broken");
    assert.notEqual(malformed.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
  });

  it("14. provider failure cannot reuse a stale success", async () => {
    let mode = "ok";
    stubFetch(async () => mode === "ok"
      ? { ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }
      : { ok: false, status: 500, text: async () => "down" });
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    const first = await interpretBoqItem(input, { provider });
    assert.ok(first.interpretation);
    mode = "down";
    const second = await interpretBoqItem(input, { provider });
    assert.equal(second.status, "FAILED");
    assert.equal(second.interpretation, undefined);
    assert.equal(second.rawResponse, null);
  });

  it("17. fingerprints are stable per input and shift with evidence", () => {
    const base = prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    const same = prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    const changed = prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector absence", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []);
    assert.equal(interpretationInputFingerprint(base), interpretationInputFingerprint(same));
    assert.notEqual(interpretationInputFingerprint(base), interpretationInputFingerprint(changed));
    assert.equal(interpretationConfigFingerprint({ provider: NVIDIA_NIM, model: "nvidia/nemotron-3-ultra-550b-a55b" }).length, 64);
  });

  it("budget constants are internally consistent with the request contract", () => {
    assert.equal(NEMOTRON_GOVERNED_CONTEXT_LIMIT, 262144);
    assert.equal(BOQ_NVIDIA_RESERVED_OUTPUT_TOKENS, 2048);
    assert.ok(BOQ_GOVERNED_INPUT_BUDGET > 250000);
    const prompt = buildBoqUnderstandingPrompt(
      prepareBoqUnderstandingInput({ boqItemId: "b1", description: "Detector", numericQuantity: 1, normalizedUnit: "EA", deterministicFacts: {} }, []),
    );
    const estimate = estimateBoqRequestTokens(JSON.stringify({ messages: [prompt.system, prompt.user] }));
    assert.ok(estimate < 5000, `ordinary request must be far under budget, got ${estimate}`);
    assert.ok(estimate > 0);
  });
});
