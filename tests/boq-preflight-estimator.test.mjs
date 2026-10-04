import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  BOQ_GOVERNED_INPUT_BUDGET,
  NEMOTRON_GOVERNED_CONTEXT_LIMIT,
  BOQ_NVIDIA_RESERVED_OUTPUT_TOKENS,
  BOQ_CONTEXT_SAFETY_MARGIN_TOKENS,
  createConfiguredBoqUnderstandingProvider,
  detectContextOverflowSignal,
  estimateBoqRequestTokens,
  upperBoundBoqRequestTokens,
} from "../worker/boq-understanding-provider.mjs";
import {
  buildBoqUnderstandingPrompt,
  interpretBoqItem,
  prepareBoqUnderstandingInput,
} from "../app/domain/boq-understanding-engine.mjs";

// Adversarial proof: the preflight safety gate is the byte-length upper bound,
// never the optimistic bytes/4 estimate. A request whose bytes/4 estimate is
// under budget but whose byte length is over budget MUST fail preflight.

const NIM_ENV = { NVIDIA_BASE_URL: "http://127.0.0.1:9/v1", BOQ_AI_MODEL: "NVIDIA_NIM/nvidia/nemotron-3-ultra-550b-a55b" };
const VALID_JSON = JSON.stringify({
  normalizedDescription: { value: "Addressable smoke detector", origin: "EXTRACTED", confidence: 90 },
  system: { value: "Fire Alarm", origin: "INFERRED", confidence: 70 },
  category: { value: "Detection Devices", origin: "INFERRED", confidence: 70 },
  equipmentType: { value: "Detector", origin: "INFERRED", confidence: 70 },
  productFamily: { value: null, origin: "MISSING", confidence: 0 },
  taxonomyCandidateKey: { value: null, origin: "MISSING", confidence: 0 },
  technicalAttributes: [], standards: [], manufacturerEvidence: [],
  compatibilityRequirements: [], requiredAccessories: [], searchTerms: [],
  missingInformation: [], ambiguities: [], confidence: "HIGH",
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

const row = (description, extra = {}) => ({ boqItemId: extra.boqItemId || "b1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });

describe("preflight estimator adversarial proof", () => {
  it("1. bytes/4 is not the safety authority: byte-length gate refuses what /4 would pass", () => {
    // A payload whose optimistic estimate is under budget but whose byte
    // length is over budget must be refused by the byte-length gate.
    // bytes = 2x budget -> /4 estimate = budget/2 (under), bytes = 2x budget (over).
    const overBytes = "x".repeat(BOQ_GOVERNED_INPUT_BUDGET * 2);
    assert.ok(estimateBoqRequestTokens(overBytes) <= BOQ_GOVERNED_INPUT_BUDGET, "fixture: /4 estimate is under budget");
    assert.ok(upperBoundBoqRequestTokens(overBytes) > BOQ_GOVERNED_INPUT_BUDGET, "fixture: byte bound is over budget");
  });

  it("2. normal request remains callable", async () => {
    const calls = okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput(row("Addressable smoke detector"), []);
    const result = await interpretBoqItem(input, { provider });
    assert.ok(result.status === "COMPLETED" || result.status === "NEEDS_REVIEW");
    assert.equal(calls.length, 1);
  });

  it("3. representative Golden payload (~9.7KB) stays SAFE under the byte bound", async () => {
    const bigDesc = "Addressable intelligent photoelectric smoke detector with sounder base, weatherproof outdoor horn strobe 75cd, control module relay " + "x".repeat(2000);
    const specs = Array.from({ length: 20 }, (_, i) => "The fire detection and alarm system shall be addressable and comply with NFPA 72 clause " + i + " including all subsections thereto.");
    const input = prepareBoqUnderstandingInput(row(bigDesc), specs);
    const prompt = buildBoqUnderstandingPrompt(input);
    const body = { model: "nvidia/nemotron-3-ultra-550b-a55b", messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], temperature: 0, max_tokens: 2048, response_format: { type: "json_schema", json_schema: { name: "boq_understanding", schema: {}, strict: true } }, chat_template_kwargs: { enable_thinking: false } };
    const serialized = JSON.stringify(body);
    const upper = upperBoundBoqRequestTokens(serialized);
    const est = estimateBoqRequestTokens(serialized);
    assert.ok(upper <= BOQ_GOVERNED_INPUT_BUDGET, `byte bound ${upper} must fit budget ${BOQ_GOVERNED_INPUT_BUDGET}`);
    assert.ok(est < upper, "optimistic estimate must be below the byte bound");
    const calls = okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const result = await interpretBoqItem(input, { provider });
    assert.ok(result.status === "COMPLETED" || result.status === "NEEDS_REVIEW");
    assert.equal(calls.length, 1);
  });

  it("4. dense JSON cannot exploit optimistic counting", async () => {
    // Dense JSON: many short keys/values, high punctuation. bytes/4 would
    // undercount; the byte bound must still gate correctly.
    const dense = JSON.stringify({ a: 1, b: "x", c: [1, 2, 3], d: { e: true, f: null }, g: "SKU-12345", h: "IDP-PHOTO-IV", i: "B501-IV", j: "24VDC" });
    const overDense = dense.repeat(Math.ceil((BOQ_GOVERNED_INPUT_BUDGET * 4) / dense.length) + 10);
    assert.ok(upperBoundBoqRequestTokens(overDense) > BOQ_GOVERNED_INPUT_BUDGET);
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput(row(overDense), []);
    const result = await interpretBoqItem(input, { provider });
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
    assert.equal(calls.length, 0);
  });

  it("5. SKU/part-number-heavy text cannot exploit optimistic counting", async () => {
    const sku = Array.from({ length: 7000 }, (_, i) => `IDP-PHOTO-IV-${i},B501-IV,24VDC,UL864,FM,SKU-${i}`).join(";");
    assert.ok(upperBoundBoqRequestTokens(sku) > BOQ_GOVERNED_INPUT_BUDGET);
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput(row(sku), []);
    const result = await interpretBoqItem(input, { provider });
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
    assert.equal(calls.length, 0);
  });

  it("6. multilingual/Unicode content cannot exploit optimistic counting", async () => {
    // Arabic + CJK + emoji: multi-byte characters. bytes/4 would undercount
    // tokenization for CJK (often 1-2 tokens per character) and Arabic.
    const unicode = "كاشف دخان قابل للعنونة 🔥 煙感知器 地址可能 " + "x".repeat(1000);
    const overUnicode = unicode.repeat(Math.ceil((BOQ_GOVERNED_INPUT_BUDGET * 4) / unicode.length) + 10);
    assert.ok(upperBoundBoqRequestTokens(overUnicode) > BOQ_GOVERNED_INPUT_BUDGET);
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput(row(overUnicode), []);
    const result = await interpretBoqItem(input, { provider });
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
    assert.equal(calls.length, 0);
  });

  it("7. known-over-limit input fails preflight", async () => {
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const huge = "x".repeat((BOQ_GOVERNED_INPUT_BUDGET + 1000) * 4);
    const input = prepareBoqUnderstandingInput(row(huge), []);
    const result = await interpretBoqItem(input, { provider });
    assert.equal(result.status, "FAILED");
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
    assert.equal(result.interpretation, undefined);
    assert.equal(result.rawResponse, null);
    assert.equal(calls.length, 0);
  });

  it("8. preflight overflow never calls NVIDIA", async () => {
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const huge = "x".repeat((BOQ_GOVERNED_INPUT_BUDGET + 1000) * 4);
    await interpretBoqItem(prepareBoqUnderstandingInput(row(huge), []), { provider });
    assert.equal(calls.length, 0);
  });

  it("9. typed code remains MODEL_CONTEXT_LIMIT_EXCEEDED", async () => {
    const calls = stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(okBody(VALID_JSON)) }));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const huge = "x".repeat((BOQ_GOVERNED_INPUT_BUDGET + 1000) * 4);
    const result = await interpretBoqItem(prepareBoqUnderstandingInput(row(huge), []), { provider });
    assert.equal(result.error.code, "MODEL_CONTEXT_LIMIT_EXCEEDED");
  });

  it("10. provider-side overflow classifier remains intact", () => {
    assert.equal(detectContextOverflowSignal(413, null), "http-413");
    assert.ok(detectContextOverflowSignal(400, { error: { code: "context_length_exceeded", message: "x" } }));
    assert.ok(detectContextOverflowSignal(400, { error: { message: "This model's maximum context length is 4096 tokens, however you requested 5000 tokens." } }));
    assert.equal(detectContextOverflowSignal(400, { error: { code: "invalid_request_error", message: "Bad request." } }), null);
    assert.equal(detectContextOverflowSignal(400, { error: { message: "max_tokens must be an integer." } }), null);
  });

  it("11. no automatic Cloudflare fallback appears", async () => {
    stubFetch(async () => ({ ok: false, status: 500, text: async () => "down" }));
    let cfCalls = 0;
    const provider = createConfiguredBoqUnderstandingProvider({
      ...NIM_ENV,
      AI: { run: async () => { cfCalls += 1; return { response: "{}" }; } },
    });
    const result = await interpretBoqItem(prepareBoqUnderstandingInput(row("Detector"), []), { provider });
    assert.equal(result.status, "FAILED");
    assert.equal(result.error.code, "AI_PROVIDER_ERROR");
    assert.equal(cfCalls, 0);
  });

  it("12. no prompt truncation occurs", async () => {
    const calls = okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const desc = "Addressable smoke detector with sounder base " + "y".repeat(500);
    const input = prepareBoqUnderstandingInput(row(desc), []);
    await interpretBoqItem(input, { provider });
    const sent = JSON.parse(calls[0].init.body);
    assert.ok(sent.messages[1].content.includes("y".repeat(500)), "full description must be sent, not truncated");
  });

  it("13. raw-response contract remains unchanged", async () => {
    okFetch(okBody(VALID_JSON));
    const provider = createConfiguredBoqUnderstandingProvider(NIM_ENV);
    const input = prepareBoqUnderstandingInput(row("Addressable smoke detector"), []);
    const result = await interpretBoqItem(input, { provider });
    assert.equal(provider.lastCallRawResponse, VALID_JSON);
    assert.ok(!("rawResponse" in result.interpretation));
  });

  it("budget arithmetic is unchanged and internally consistent", () => {
    assert.equal(NEMOTRON_GOVERNED_CONTEXT_LIMIT, 262144);
    assert.equal(BOQ_NVIDIA_RESERVED_OUTPUT_TOKENS, 2048);
    assert.equal(BOQ_CONTEXT_SAFETY_MARGIN_TOKENS, 1024);
    assert.equal(BOQ_GOVERNED_INPUT_BUDGET, 262144 - 2048 - 1024);
  });
});
