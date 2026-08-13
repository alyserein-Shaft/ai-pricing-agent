import test from "node:test";
import assert from "node:assert/strict";
import { handleBoqAiDiagnosticApi } from "../worker/boq-ai-diagnostic-api.mjs";
import { sanitizeCloudflareProviderError } from "../worker/boq-understanding-provider.mjs";

const f = (value, origin = "INFERRED", confidence = 90) => ({ value, origin, confidence });
const output = {
  normalizedDescription: f("Addressable optical smoke detector with built-in isolator", "EXTRACTED", 100),
  taxonomyCandidateKey: f("FA-1"),
  system: f("Fire Alarm"), category: f("Detection Devices"),
  equipmentType: f("Addressable optical smoke detector"), productFamily: f("Addressable Smoke Detector"),
  technicalAttributes: [{ name: "addressing", ...f("Addressable", "EXTRACTED", 100) }, { name: "isolation_capability", ...f("Built-in", "EXTRACTED", 100) }],
  searchTerms: [f("addressable optical smoke detector")], missingInformation: [], ambiguities: [], confidence: "HIGH",
};
const request = (url = "http://localhost/api/dev/boq-ai/native-smoke", init = { method: "POST" }) => new Request(url, init);

test("diagnostic is unavailable outside explicitly enabled local mode", async () => {
  assert.equal((await handleBoqAiDiagnosticApi(request(), {})).status, 404);
  assert.equal((await handleBoqAiDiagnosticApi(request("https://example.com/api/dev/boq-ai/native-smoke"), { BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1" })).status, 404);
});
test("diagnostic rejects arbitrary payloads and never accepts project identifiers", async () => {
  const response = await handleBoqAiDiagnosticApi(request(undefined, { method: "POST", body: JSON.stringify({ projectId: "project_real" }) }), { BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "FIXED_PAYLOAD_ONLY");
  const queryResponse = await handleBoqAiDiagnosticApi(request("http://localhost/api/dev/boq-ai/native-smoke?project=project_real", { method: "GET" }), { BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1" });
  assert.equal(queryResponse.status, 400);
});
test("diagnostic uses native binding, production schema, and no database", async () => {
  let model; let aiInput; let databaseRead = false;
  const env = {
    BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1",
    BOQ_AI_PROVIDER: "cloudflare",
    get DB() { databaseRead = true; throw new Error("D1 must not be opened"); },
    AI: { run: async (selectedModel, input) => { model = selectedModel; aiInput = input; return { response: JSON.stringify(output), usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }; } },
  };
  const response = await handleBoqAiDiagnosticApi(request(), env);
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(databaseRead, false);
  assert.equal(model, "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.equal(aiInput.response_format.type, "json_schema");
  assert.equal(result.schemaValid, true); assert.equal(result.jsonModeHonored, true);
  assert.deepEqual(result.provenanceStates, ["EXTRACTED", "INFERRED", "MISSING"]);
});

test("provider diagnostics are bounded and redact sensitive material", () => {
  const error = Object.assign(new Error("Bearer secret-token Authorization=top-secret account_id=0123456789abcdef0123456789abcdef https://api.cloudflare.com/path?token=bad\nprovider failed"), {
    name: "CloudflareError<script>", code: "upstream-failed", status: 429,
    headers: { authorization: "must-not-leak" }, response: { body: "must-not-leak" }, stack: "must-not-leak",
  });
  const diagnostic = sanitizeCloudflareProviderError(error, { durationMs: 321, model: "@cf/meta/test" });
  const serialized = JSON.stringify(diagnostic);
  assert.deepEqual(Object.keys(diagnostic), ["name", "code", "status", "message", "durationMs", "model"]);
  assert.equal(diagnostic.code, "AI_PROVIDER_RATE_LIMITED");
  assert.equal(diagnostic.status, 429);
  assert.ok(diagnostic.message.length <= 240);
  for (const secret of ["secret-token", "top-secret", "0123456789abcdef0123456789abcdef", "api.cloudflare.com", "must-not-leak", "<script>"]) assert.equal(serialized.includes(secret), false);
});

test("diagnostic timeout is classified distinctly and logs only sanitized fields", async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...values) => logged.push(values.join(" "));
  try {
    const env = {
      BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1",
      BOQ_AI_PROVIDER: "cloudflare",
      BOQ_AI_TIMEOUT_MS: "1000",
      BOQ_AI_MODEL: "@cf/meta/timeout-test",
      AI: { run: () => new Promise(() => {}) },
    };
    const response = await handleBoqAiDiagnosticApi(request(), env);
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.errorCategory, "AI_PROVIDER_TIMEOUT");
    assert.equal(result.result, null);
    assert.equal(result.usage, null);
    assert.equal(logged.length, 1);
    const diagnostic = logged[0];
    assert.match(diagnostic, /AI_PROVIDER_TIMEOUT/);
    assert.match(diagnostic, /@cf\/meta\/timeout-test/);
    assert.doesNotMatch(diagnostic, /messages|response_format|Addressable optical|prompt|headers|stack|token|account/i);
  } finally {
    console.error = originalError;
  }
});

test("production provider failures remain generic when diagnostics are not supplied", async () => {
  const sensitive = Object.assign(new Error("Bearer production-secret prompt payload"), { code: "CF_INTERNAL", headers: { authorization: "secret" } });
  const env = { BOQ_AI_PROVIDER: "cloudflare", AI: { run: async () => { throw sensitive; } } };
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await handleBoqAiDiagnosticApi(request(), { ...env, BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1" });
    const body = JSON.stringify(await response.json());
    assert.equal(response.status, 502);
    assert.equal(body.includes("production-secret"), false);
    assert.equal(body.includes("prompt payload"), false);
    assert.equal(body.includes("authorization"), false);
  } finally {
    console.error = originalError;
  }
});

test("invalid provider output cannot leak through diagnostic response", async () => {
  const secret = "secret-model-output-project-id-and-credential";
  const env = {
    BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1", BOQ_AI_PROVIDER: "cloudflare",
    AI: { run: async () => ({ response: JSON.stringify({ normalizedDescription: f("Detector"), confidence: "HIGH", forbiddenPayload: secret }) }) },
  };
  const response = await handleBoqAiDiagnosticApi(request(), env);
  const body = JSON.stringify(await response.json());
  assert.equal(response.status, 502);
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes("forbiddenPayload"), false);
});
