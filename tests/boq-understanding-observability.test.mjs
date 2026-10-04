import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  qualityItem,
  runUnderstandingBatch,
} from "../worker/estimator-understanding-api.mjs";
import {
  interpretBoqItem,
  packRawAuditEnvelope,
  prepareBoqUnderstandingInput,
  serializeRawAuditEnvelope,
} from "../app/domain/boq-understanding-engine.mjs";
import { safeUnderstandingReviewItem } from "../worker/estimator-understanding-review-api.mjs";

// BOQ Understanding raw-response observability -- canonical contract:
//
//   storage : estimator_item_interpretations.raw_response (existing JSON column)
//   envelope: { usage, raw } built ONLY by packRawAuditEnvelope()
//   raw     : exact pre-parse model-returned content (string, or object as-is
//             for native structured transports), null when the provider
//             produced nothing usable
//
// The envelope is audit evidence, never authority: validated_interpretation
// is the sole governed interpretation, batch HTTP items never carry raw
// content (save() alone receives it), and historical {usage}-only / null
// rows stay readable without invented content.

const row = (description, extra = {}) => ({ boqItemId: extra.boqItemId || "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });
const fakeProvider = (interpretImpl, metadata = { provider: "fake", model: "fake-v1", modelVersion: "1" }) => {
  const provider = { metadata, lastCallMetadata: null, lastCallRawResponse: null, interpret: async (args) => interpretImpl(provider, args) };
  return provider;
};

test("A. successful structured model output is persisted inside raw_response.raw", async () => {
  const modelResponse = { normalizedDescription: { value: "Addressable smoke detector", origin: "EXTRACTED", confidence: 100 }, confidence: "HIGH" };
  const usage = { durationMs: 120, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  const raw = JSON.parse(serializeRawAuditEnvelope(packRawAuditEnvelope({ usageMetadata: usage, rawResponse: modelResponse })));
  assert.deepEqual(raw.raw, modelResponse);
});

test("B. usage metadata is still persisted alongside raw", async () => {
  const usage = { durationMs: 250, usage: { prompt_tokens: 761, completion_tokens: 257, total_tokens: 1018 } };
  const raw = JSON.parse(serializeRawAuditEnvelope(packRawAuditEnvelope({ usageMetadata: usage, rawResponse: { confidence: "HIGH" } })));
  assert.deepEqual(raw.usage, usage);
});

test("C. historical usage-only raw_response (no raw key) remains readable by qualityItem's usage extraction", () => {
  const historicalRawResponse = JSON.stringify({ usage: { durationMs: 300, usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 } } });
  const item = qualityItem({ itemReference: "1", description: "Old row", status: "COMPLETED", model: "8b", usageMetadata: historicalRawResponse, interpretation: JSON.stringify({ normalizedDescription: { value: "Old row", origin: "EXTRACTED", confidence: 100 }, confidence: "HIGH" }) });
  assert.equal(item.durationMs, 300);
  assert.equal(item.promptTokens, 500);
  assert.equal(item.completionTokens, 100);
  assert.equal(item.totalTokens, 600);
});

test("null raw_response remains readable (no usage, no raw)", () => {
  const item = qualityItem({ itemReference: "1", description: "Row", status: "COMPLETED", model: "8b", usageMetadata: null, interpretation: JSON.stringify({ normalizedDescription: { value: "Row", origin: "EXTRACTED", confidence: 100 }, confidence: "HIGH" }) });
  assert.equal(item.durationMs, null);
  assert.equal(item.promptTokens, null);
});

test("D. a provider error persists no unsanitized secret text -- rawResponse is null, only sanitized usage/providerDiagnostic may persist", async () => {
  const provider = fakeProvider(async (self) => {
    self.lastCallMetadata = { durationMs: 40, providerDiagnostic: { name: "Error", code: "AI_PROVIDER_RATE_LIMITED", status: 429, message: "Cloudflare Workers AI request failed.", durationMs: 40, model: "@cf/meta/test" } };
    self.lastCallRawResponse = null;
    const error = new Error("Workers AI could not complete the request.");
    error.code = "AI_PROVIDER_ERROR";
    throw error;
  });
  const input = prepareBoqUnderstandingInput(row("Duct Smoke Detector"));
  const result = await interpretBoqItem(input, { provider });
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "AI_PROVIDER_ERROR");
  assert.equal(result.rawResponse, null, "the provider itself failed before returning a model response -- raw must be absent/null");
  const persisted = serializeRawAuditEnvelope(packRawAuditEnvelope({ usageMetadata: result.usageMetadata, rawResponse: result.rawResponse }));
  assert.equal(persisted.includes("secret"), false);
  assert.deepEqual(JSON.parse(persisted).usage.providerDiagnostic, provider.lastCallMetadata.providerDiagnostic);
  assert.equal("modelResponse" in JSON.parse(persisted), false);
});

test("E. schema-invalid structured model output is retained diagnostically when safely available, while status still FAILS", async () => {
  const invalidResponse = { normalizedDescription: { value: "Speaker with strobe", origin: "EXTRACTED", confidence: 100 }, technicalAttributes: [{ name: "operating_voltage", value: "24 VDC", origin: "MISSING", confidence: 55 }], confidence: "HIGH" };
  const provider = fakeProvider(async (self) => { self.lastCallMetadata = { durationMs: 80, usage: { prompt_tokens: 300, completion_tokens: 90, total_tokens: 390 } }; self.lastCallRawResponse = invalidResponse; return invalidResponse; });
  const input = prepareBoqUnderstandingInput(row("Speaker with strobe"));
  const result = await interpretBoqItem(input, { provider });
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "AI_OUTPUT_INVALID_SCHEMA");
  assert.deepEqual(result.rawResponse, invalidResponse, "the provider DID return a structured object; it must be retained for diagnosis even though validation rejected it");
  const persisted = JSON.parse(serializeRawAuditEnvelope(packRawAuditEnvelope({ usageMetadata: result.usageMetadata, rawResponse: result.rawResponse })));
  assert.deepEqual(persisted.raw, invalidResponse);
});

test("F. a non-JSON-serializable model response is explicitly marked omitted, never thrown or silently corrupted", () => {
  const circular = { confidence: "HIGH" };
  circular.self = circular;
  const serialized = serializeRawAuditEnvelope(packRawAuditEnvelope({ usageMetadata: { durationMs: 1 }, rawResponse: circular }));
  assert.deepEqual(JSON.parse(serialized), { usage: { durationMs: 1 }, raw: { omitted: true, reason: "RAW_RESPONSE_NOT_SERIALIZABLE" } });
});

test("G. prompt.system / prompt.user are never persisted in raw_response, in any code path", async () => {
  const source = await readFile(new URL("../worker/estimator-understanding-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /prompt\.system|prompt\.user/);
  const provider = fakeProvider(async (self) => { self.lastCallMetadata = { durationMs: 10, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; const out = { normalizedDescription: { value: "Addressable smoke detector", origin: "EXTRACTED", confidence: 100 }, confidence: "HIGH" }; self.lastCallRawResponse = out; return out; });
  const input = prepareBoqUnderstandingInput(row("Addressable smoke detector"));
  const result = await interpretBoqItem(input, { provider });
  const persisted = serializeRawAuditEnvelope(packRawAuditEnvelope({ usageMetadata: result.usageMetadata, rawResponse: result.rawResponse }));
  assert.equal(persisted.includes("Interpret one BOQ row"), false, "the system prompt text must never appear in the persisted envelope");
});

test("H. validated_interpretation remains the sole authoritative interpretation -- rawResponse never overrides or substitutes for it", async () => {
  // A model that internally contradicts its own validated fields (proposes
  // "Fire Alarm Control Panel" but the merge/taxonomy layer resolves a
  // different governed classification) must still persist validated_interpretation
  // as the merge computed it, not the model's raw claim.
  const provider = fakeProvider(async (self) => { self.lastCallMetadata = { durationMs: 10, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; const out = { normalizedDescription: { value: "Addressable Flasher", origin: "EXTRACTED", confidence: 100 }, taxonomyCandidateKey: { value: "FA-1", origin: "INFERRED", confidence: 100 }, equipmentType: { value: "Addressable Flasher", origin: "EXTRACTED", confidence: 100 }, confidence: "HIGH" }; self.lastCallRawResponse = out; return out; });
  const input = prepareBoqUnderstandingInput(row("Addressable Flasher"));
  const result = await interpretBoqItem(input, { provider });
  assert.ok(result.status === "COMPLETED" || result.status === "NEEDS_REVIEW", "a governed merge outcome, never FAILED for this input");
  assert.equal(result.interpretation.productFamily.value, "Strobe");
  // rawResponse is a completely separate field, present purely for
  // persistence/debugging -- it is never read by anything computing status
  // or classification.
  assert.ok("rawResponse" in result);
  assert.notDeepEqual(result.rawResponse, result.interpretation);
});

test("I. no downstream review/matching/pricing path reads raw as authority", async () => {
  // runUnderstandingBatch's items (which flow into the live POST /run,
  // controlled-retry and per-item-retry HTTP responses) must never carry
  // rawResponse at all -- only save() (persistence) receives it.
  let savedRecord = null;
  const provider = fakeProvider(async (self) => { self.lastCallMetadata = { durationMs: 10, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; const out = { normalizedDescription: { value: "Addressable smoke detector", origin: "EXTRACTED", confidence: 100 }, confidence: "HIGH" }; self.lastCallRawResponse = out; return out; });
  const outcome = await runUnderstandingBatch([row("Addressable smoke detector")], {
    provider,
    save: async (record) => { savedRecord = record; },
  });
  assert.ok("rawResponse" in savedRecord, "save() must receive rawResponse so it can be persisted");
  assert.equal("rawResponse" in outcome.items[0], false, "the HTTP-response-facing items array must never carry rawResponse");

  // safeUnderstandingReviewItem (the AI Understanding Review API's own
  // response sanitizer) never exposes a raw/modelResponse field either.
  const safeItem = safeUnderstandingReviewItem({ boqItemId: "boq_1", itemReference: "1", description: "Row", numericQuantity: 1, normalizedUnit: "EA", sourceLocation: "{}", extractionReviewStatus: "Auto Verified", extractionApproved: 1, effective: { state: "AVAILABLE", proposal: null, classification: null, quality: null, taxonomy: null, currentInputFingerprint: null, selected: null, latestCurrentAttempt: null } });
  assert.equal("modelResponse" in safeItem, false);
  assert.equal("rawResponse" in safeItem, false);
  assert.equal("raw" in safeItem, false);
});
