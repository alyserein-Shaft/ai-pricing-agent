import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createConfiguredCloudflareStructuredProvider,
  createConfiguredNvidiaNimStructuredProvider,
  createDeterministicHermeticProvider,
} from "../worker/boq-understanding-provider.mjs";
import {
  BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
  interpretBoqItem,
  packRawAuditEnvelope,
} from "../app/domain/boq-understanding-engine.mjs";

// Traceability hardening slice: the exact model-returned content must be
// retained per run (raw_response), strictly separate from the validated
// interpretation, and must never become authority. Unit-level only: stubbed
// transports, no network, no database.

const SCHEMA = BOQ_UNDERSTANDING_RESPONSE_SCHEMA;

const VALID_RAW_STRING = JSON.stringify({
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

const PROMPT = { system: "sys", user: "user" };
const NIM_ENV = { NVIDIA_BASE_URL: "http://127.0.0.1:9/v1", BOQ_AI_MODEL: "NVIDIA_NIM/nvidia/test-model" };

const openAiBody = (content, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) => ({
  choices: [{ message: { content } }],
  usage,
});

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const stubFetch = (handler) => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return handler(url, init);
  };
  return seen;
};

const okFetch = (body) => stubFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }));

describe("BOQ raw AI output persistence", () => {
  describe("NVIDIA provider raw capture", () => {
    it("successful response persists the exact raw string", async () => {
      okFetch(openAiBody(VALID_RAW_STRING));
      const provider = createConfiguredNvidiaNimStructuredProvider(NIM_ENV, { schema: SCHEMA });
      const parsed = await provider.interpret({ prompt: PROMPT });
      assert.equal(provider.lastCallRawResponse, VALID_RAW_STRING);
      assert.equal(typeof provider.lastCallRawResponse, "string");
      assert.equal(parsed.normalizedDescription.value, "Addressable smoke detector");
    });

    it("malformed JSON retains the raw string and still fails closed", async () => {
      okFetch(openAiBody("not-json{{{"));
      const provider = createConfiguredNvidiaNimStructuredProvider(NIM_ENV, { schema: SCHEMA });
      await assert.rejects(() => provider.interpret({ prompt: PROMPT }), /invalid structured output/i);
      assert.equal(provider.lastCallRawResponse, "not-json{{{");
    });

    it("provider failure leaves an explicit null raw response, not a previous call's", async () => {
      okFetch(openAiBody(VALID_RAW_STRING));
      const provider = createConfiguredNvidiaNimStructuredProvider(NIM_ENV, { schema: SCHEMA });
      await provider.interpret({ prompt: PROMPT });
      assert.equal(provider.lastCallRawResponse, VALID_RAW_STRING);
      stubFetch(async () => ({ ok: false, status: 500, text: async () => "boom" }));
      await assert.rejects(() => provider.interpret({ prompt: PROMPT }), /could not complete/i);
      assert.equal(provider.lastCallRawResponse, null);
    });

    it("no request credentials flow into the captured raw response", async () => {
      const seen = okFetch(openAiBody(VALID_RAW_STRING));
      const provider = createConfiguredNvidiaNimStructuredProvider(
        { ...NIM_ENV, NVIDIA_API_KEY: "sk-test-secret" }, { schema: SCHEMA },
      );
      await provider.interpret({ prompt: PROMPT });
      assert.ok(String(seen[0].init.headers.authorization || "").includes("sk-test-secret"));
      assert.ok(!JSON.stringify(provider.lastCallRawResponse).includes("sk-test-secret"));
    });
  });

  describe("Cloudflare provider raw capture", () => {
    const cfEnv = (run) => ({ AI: { run }, BOQ_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast" });

    it("string transport persists the exact raw string", async () => {
      const provider = createConfiguredCloudflareStructuredProvider(
        cfEnv(async () => ({ response: VALID_RAW_STRING, usage: { prompt_tokens: 1 } })), { schema: SCHEMA },
      );
      const parsed = await provider.interpret({ prompt: PROMPT });
      assert.equal(provider.lastCallRawResponse, VALID_RAW_STRING);
      assert.equal(parsed.normalizedDescription.value, "Addressable smoke detector");
    });

    it("native structured object is retained as-is without rewriting", async () => {
      const nativeObject = JSON.parse(VALID_RAW_STRING);
      const provider = createConfiguredCloudflareStructuredProvider(
        cfEnv(async () => nativeObject), { schema: SCHEMA },
      );
      const parsed = await provider.interpret({ prompt: PROMPT });
      assert.equal(provider.lastCallRawResponse, nativeObject);
      assert.deepEqual(parsed, nativeObject);
    });

    it("malformed string retains raw evidence and fails closed", async () => {
      const provider = createConfiguredCloudflareStructuredProvider(
        cfEnv(async () => ({ response: "[[broken" })), { schema: SCHEMA },
      );
      await assert.rejects(() => provider.interpret({ prompt: PROMPT }), /invalid structured output/i);
      assert.equal(provider.lastCallRawResponse, "[[broken");
    });

    it("binding failure leaves null, never a stale response", async () => {
      let calls = 0;
      const provider = createConfiguredCloudflareStructuredProvider(
        cfEnv(async () => {
          calls += 1;
          if (calls === 1) return { response: VALID_RAW_STRING };
          throw new Error("binding down");
        }), { schema: SCHEMA },
      );
      await provider.interpret({ prompt: PROMPT });
      assert.equal(provider.lastCallRawResponse, VALID_RAW_STRING);
      await assert.rejects(() => provider.interpret({ prompt: PROMPT }));
      assert.equal(provider.lastCallRawResponse, null);
    });
  });

  describe("engine threading (interpretBoqItem)", () => {
    const hermeticEnv = { GOLDEN_HERMETIC_AI: "1" };
    const input = { boqItemId: "item_1", description: "IDP-PHOTO-IV smoke detector 24V UL 864", deterministicFacts: {} };

    it("success threads the exact raw fixture separately from the validated interpretation", async () => {
      const provider = createDeterministicHermeticProvider(hermeticEnv);
      // Hermetic fixture is a deterministic function of the description text.
      const fixtureBefore = await provider.interpret({ prompt: { system: "s", user: '{"description": "IDP-PHOTO-IV smoke detector 24V UL 864"}' } });
      const result = await interpretBoqItem(input, { provider });
      assert.ok(result.interpretation);
      assert.ok(result.rawResponse);
      // The validated interpretation is a merged derivative: it carries
      // merge-added keys the raw fixture never had.
      assert.ok(Array.isArray(result.interpretation.reviewReasons));
      assert.ok(!("reviewReasons" in result.rawResponse));
      assert.ok(!("rawResponse" in (result.interpretation || {})));
      assert.notEqual(result.interpretation, result.rawResponse);
      assert.deepEqual(result.rawResponse, fixtureBefore);
    });

    it("schema-invalid output retains raw evidence without becoming a valid interpretation", async () => {
      const evil = { price: 5, approved: true };
      const provider = {
        metadata: { provider: "test" }, lastCallMetadata: null, lastCallRawResponse: evil,
        interpret: async () => evil,
      };
      const result = await interpretBoqItem(input, { provider });
      assert.equal(result.status, "FAILED");
      assert.deepEqual(result.rawResponse, evil);
      assert.equal(result.interpretation, undefined);
      assert.match(result.error.code, /AI_OUTPUT_INVALID/);
    });

    it("provider failure yields explicit null raw, distinguishable from invalid output", async () => {
      const provider = {
        metadata: { provider: "test" }, lastCallMetadata: null, lastCallRawResponse: null,
        interpret: async () => { const error = new Error("down"); error.code = "AI_PROVIDER_ERROR"; throw error; },
      };
      const result = await interpretBoqItem(input, { provider });
      assert.equal(result.status, "FAILED");
      assert.equal(result.error.code, "AI_PROVIDER_ERROR");
      assert.equal(result.rawResponse, null);
    });

    it("missing provider yields null raw without fabricating output", async () => {
      const result = await interpretBoqItem(input, { provider: null });
      assert.equal(result.status, "AI_UNAVAILABLE");
      assert.equal(result.rawResponse, null);
    });
  });

  describe("audit envelope", () => {
    it("packs usage and raw with exactly the closed key set", () => {
      const raw = '{"a":1}';
      const usage = { durationMs: 12, usage: { total_tokens: 3 } };
      const envelope = packRawAuditEnvelope({ usageMetadata: usage, rawResponse: raw });
      assert.deepEqual(Object.keys(envelope).sort(), ["raw", "usage"]);
      assert.equal(envelope.raw, raw);
      assert.deepEqual(envelope.usage, usage);
      assert.equal(JSON.parse(JSON.stringify(envelope)).raw, raw);
    });

    it("returns null when there is nothing to retain", () => {
      assert.equal(packRawAuditEnvelope({}), null);
      assert.equal(packRawAuditEnvelope({ usageMetadata: null, rawResponse: null }), null);
      assert.equal(packRawAuditEnvelope(), null);
    });

    it("usage-only history keeps its legacy shape", () => {
      const usage = { durationMs: 5 };
      const envelope = packRawAuditEnvelope({ usageMetadata: usage, rawResponse: null });
      assert.deepEqual(envelope, { usage, raw: null });
    });

    it("existing usage readers see an unchanged usage shape", () => {
      const usageMetadata = { durationMs: 7, usage: { total_tokens: 3 } };
      const legacyStored = { usage: usageMetadata };
      const envelope = packRawAuditEnvelope({ usageMetadata, rawResponse: VALID_RAW_STRING });
      assert.deepEqual(envelope.usage, legacyStored.usage);
    });
  });
});
