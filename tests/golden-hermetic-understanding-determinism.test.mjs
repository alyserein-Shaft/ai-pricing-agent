import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
  interpretBoqItem,
  normalizeBoqUnderstandingModelResponse,
  prepareBoqUnderstandingInput,
  interpretationConfigFingerprint,
  interpretationInputFingerprint,
} from "../app/domain/boq-understanding-engine.mjs";
import { createConfiguredBoqUnderstandingProvider, createDeterministicHermeticProvider } from "../worker/boq-understanding-provider.mjs";
import { runUnderstandingBatch } from "../worker/estimator-understanding-api.mjs";

// DETERMINISTIC GOLDEN BOQ UNDERSTANDING
//
// The Golden Full Journey called the REMOTE Workers AI binding for
// `estimator-understanding/run`, so two identical runs of the same seed produced
// different governed outcomes (observed: 1 COMPLETED + 2 NEEDS_REVIEW, then
// 1 COMPLETED + 1 NEEDS_REVIEW + 1 FAILED with error_code
// AI_OUTPUT_INVALID_SCHEMA). A governed acceptance gate whose result moves
// between identical runs is not a gate.
//
// This suite pins the seam that removes the stochastic dependency, and pins
// everything it must NOT change:
//
//   - The seam activates ONLY for an explicitly flagged hermetic environment
//     (GOLDEN_HERMETIC_AI=1, exported by scripts/run-golden-e2e.sh alone). With the flag
//     absent, the production factory returns the real Workers AI provider, so
//     the canonical runtime and any deployment are untouched.
//   - The response is validated against the SAME production schema and the SAME
//     production normalizer. The schema is not loosened; additionalProperties
//     stays false and every declared property is still honoured.
//   - The seam replaces only external model inference. request -> parsing ->
//     validation -> persistence -> governed status transition all still run
//     through the real production code, and fail-closed semantics are intact.
//
// The three BOQ descriptions below are the real rows in
// tests/e2e/fixtures/golden-boq.xlsx.

const GOLDEN_BOQ_ROWS = [
  { id: "boq-golden-1", itemReference: "1", description: "Golden addressable detector", manufacturer: "Golden Manufacturer", partNumber: "GOLDEN-FA-001", currentValues: { system: "Fire Alarm", category: "Detection Device", subcategory: "Smoke Detector" } },
  { id: "boq-golden-2", itemReference: "2", description: "Addressable interface module - model to be confirmed", currentValues: {} },
  { id: "boq-golden-3", itemReference: "3", description: "Specialized unsupported annunciator", manufacturer: "Golden Manufacturer", partNumber: "GOLDEN-NOMATCH-001", currentValues: {} },
];

const hermetic = () => createDeterministicHermeticProvider({ GOLDEN_HERMETIC_AI: "1" });

// -----------------------------------------------------------------------------
// 1. The seam is hermetic-only
// -----------------------------------------------------------------------------

test("the deterministic provider exists only for an explicitly flagged hermetic environment", () => {
  assert.equal(createDeterministicHermeticProvider({}), null, "no flag, no hermetic provider");
  assert.equal(createDeterministicHermeticProvider({ GOLDEN_HERMETIC_AI: "0" }), null, "GOLDEN_HERMETIC_AI must be exactly 1");
  assert.equal(createDeterministicHermeticProvider({ GOLDEN_HERMETIC_AI: "true" }), null, "truthy strings must not activate the seam");
  assert.equal(createDeterministicHermeticProvider({ GOLDEN_HERMETIC_AI: "" }), null);
  assert.ok(hermetic(), "GOLDEN_HERMETIC_AI=1 must activate the hermetic provider");
});

test("the pre-existing GOLDEN_E2E flag still cannot conjure a provider", () => {
  // GOLDEN_E2E is an existing committed hermetic flag with unrelated meanings
  // (dashboard scope, navigation, and the Golden E2E state dir). A committed
  // governance test -- "fixture flags cannot replace a missing native binding"
  // in tests/boq-understanding.test.mjs -- requires that GOLDEN_E2E=1 with no
  // native binding still fails closed. This seam therefore uses its own flag
  // rather than weakening that assertion.
  assert.equal(createDeterministicHermeticProvider({ GOLDEN_E2E: "1" }), null, "GOLDEN_E2E must not activate the seam");
  assert.equal(createConfiguredBoqUnderstandingProvider({ GOLDEN_E2E: "1" }), null,
    "GOLDEN_E2E=1 with no native binding must still fail closed, exactly as before");
});

test("only the Golden harness and the provider itself know the flag", () => {
  const harness = readFileSync(new URL("../scripts/run-golden-e2e.sh", import.meta.url), "utf8");
  assert.match(harness, /^export GOLDEN_HERMETIC_AI=1$/m, "the Golden harness must activate the seam");
  // The flag must be readable only by the provider factory. No worker router,
  // no domain engine and no committed wrangler/vite configuration may set or
  // read it, so no canonical runtime or deployed environment can reach it.
  const files = [
    "worker/index.ts",
    "worker/estimator-understanding-api.mjs",
    "worker/boq-ai-diagnostic-api.mjs",
    "wrangler.toml",
    "wrangler.jsonc",
    "vite.config.ts",
  ];
  for (const file of files) {
    const path = new URL(`../${file}`, import.meta.url);
    if (!existsSync(path)) continue;
    assert.equal(readFileSync(path, "utf8").includes("GOLDEN_HERMETIC_AI"), false, `${file} must never set or read the hermetic flag`);
  }
});

test("the production factory is unchanged when the hermetic flag is absent", () => {
  // No native binding -> production must still fail closed, exactly as before.
  assert.equal(createConfiguredBoqUnderstandingProvider({}), null);
  assert.equal(createConfiguredBoqUnderstandingProvider({ AI: {} }), null);
  const cloudflare = createConfiguredBoqUnderstandingProvider({ AI: { run: async () => ({ response: "{}" }) } });
  assert.equal(cloudflare.metadata.provider, "cloudflare-workers-ai-binding", "production must keep the real Workers AI provider");
  assert.notEqual(cloudflare.metadata.provider, hermetic().metadata.provider);
});

test("the hermetic provider cannot be reached by a fixture-style flag without the hermetic flag", () => {
  const provider = createConfiguredBoqUnderstandingProvider({ GOLDEN_BOQ_UNDERSTANDING_PROVIDER: "deterministic" });
  assert.notEqual(provider?.metadata?.provider, "hermetic-deterministic-boq-understanding");
});

test("the hermetic provider declares itself honestly in its metadata and readiness", () => {
  const provider = hermetic();
  assert.equal(provider.metadata.provider, "hermetic-deterministic-boq-understanding");
  assert.equal(provider.metadata.model, "hermetic-fixture-v1");
  assert.equal(provider.metadata.modelVersion, "hermetic-fixture-v1");
  assert.equal(provider.metadata.escalationEnabled, false, "a deterministic provider never escalates to a second model");
  assert.equal(provider.readiness.state, "Ready — hermetic deterministic provider");
  assert.match(provider.readiness.detail, /GOLDEN_HERMETIC_AI/);
});

// -----------------------------------------------------------------------------
// 2. The response satisfies the production schema, unloosened
// -----------------------------------------------------------------------------

test("the hermetic response declares exactly the production schema's properties", async () => {
  const declared = new Set(Object.keys(BOQ_UNDERSTANDING_RESPONSE_SCHEMA.properties));
  assert.equal(BOQ_UNDERSTANDING_RESPONSE_SCHEMA.additionalProperties, false, "the production schema must keep additionalProperties:false");
  for (const row of GOLDEN_BOQ_ROWS) {
    const input = prepareBoqUnderstandingInput(row, []);
    const response = await hermetic().interpret({ input, prompt: { system: "s", user: JSON.stringify({ description: row.description }) } });
    const keys = Object.keys(response).sort();
    const extra = keys.filter((key) => !declared.has(key));
    assert.deepEqual(extra, [], `no undeclared property may be returned (schema is additionalProperties:false): ${extra.join(", ")}`);
    const absent = [...declared].filter((key) => !keys.includes(key));
    assert.deepEqual(absent, [], `every declared property must be present: ${absent.join(", ")}`);
  }
});

test("the hermetic response passes the production normalizer and validator", async () => {
  for (const row of GOLDEN_BOQ_ROWS) {
    const input = prepareBoqUnderstandingInput(row, []);
    const response = await hermetic().interpret({ input, prompt: { system: "s", user: JSON.stringify({ description: row.description }) } });
    // normalizeBoqUnderstandingModelResponse is the production normalizer: it
    // must accept the hermetic response and return the same {response,
    // corrections} envelope it returns for real model output. It also
    // downgrades any EXTRACTED claim whose value is not present in the BOQ
    // row's own evidence text, which is why system/equipmentType stay INFERRED
    // even when the hermetic provider reads them off a real model line.
    const normalized = normalizeBoqUnderstandingModelResponse(response);
    assert.ok(normalized, "normalizeBoqUnderstandingModelResponse must not throw on the hermetic response");
    assert.ok(Array.isArray(normalized.corrections), "the production corrections envelope must be preserved");
    assert.equal(typeof normalized.response, "object");
    assert.equal(typeof normalized.response.confidence, "string", "confidence must survive normalization as a string");
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(normalized.response.confidence));
    let facts = 0;
    for (const [key, value] of Object.entries(normalized.response)) {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "origin")) {
        facts += 1;
        assert.ok(["EXTRACTED", "INFERRED", "MISSING"].includes(value.origin), `${key}.origin must stay in the production vocabulary`);
        assert.equal(typeof value.confidence, "number");
        assert.ok(value.confidence >= 0 && value.confidence <= 100, `${key}.confidence must stay in 0..100`);
        if (value.origin === "MISSING") {
          assert.equal(value.value, null, "a MISSING fact must carry a null value");
          assert.equal(value.confidence, 0, "a MISSING fact must carry zero confidence");
        }
      }
    }
    assert.ok(facts >= 5, `the production scalar facts must survive normalization (${row.id})`);
  }
});

test("every EXTRACTED claim the hermetic provider makes is quoted from the row's own text", async () => {
  // Governance proof: the hermetic seam may only ever claim EXTRACTED for text
  // it actually read out of the BOQ row. Everything it infers stays INFERRED
  // with reduced confidence, so the production confidence machinery -- not the
  // seam -- still decides what counts as extracted, and every downstream
  // confidence and readiness decision keeps its meaning.
  const description = "Honeywell IDP-115 addressable photoelectric smoke detector, 24 V DC";
  const response = await hermetic().interpret({
    input: prepareBoqUnderstandingInput({ id: "x", description }, []),
    prompt: { system: "s", user: JSON.stringify({ description }) },
  });
  let extracted = 0;
  for (const [key, value] of Object.entries(response)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (value.origin !== "EXTRACTED") continue;
    extracted += 1;
    assert.ok(
      String(description).toLowerCase().includes(String(value.value).toLowerCase()),
      `${key} claims EXTRACTED for text absent from the BOQ row: ${JSON.stringify(value.value)}`,
    );
  }
  assert.ok(extracted >= 1, "the row's own description must still be reported as genuinely extracted");
  assert.equal(response.system.origin, "INFERRED", "an inferred classification must never claim to be extracted");
  assert.equal(response.system.confidence, 70);
});

// -----------------------------------------------------------------------------
// 3. Determinism
// -----------------------------------------------------------------------------

test("repeated interpretation of the same input is byte-identical", async () => {
  const provider = hermetic();
  for (const row of GOLDEN_BOQ_ROWS) {
    const input = prepareBoqUnderstandingInput(row, []);
    const prompt = { system: "s", user: JSON.stringify({ description: row.description }) };
    const runs = [];
    for (let attempt = 0; attempt < 25; attempt += 1) runs.push(JSON.stringify(await provider.interpret({ input, prompt })));
    assert.equal(new Set(runs).size, 1, `25 identical runs for ${row.id} must produce one identical response`);
  }
});

test("the hermetic provider interprets each line from its own text, not a constant", async () => {
  const provider = hermetic();
  const read = async (description) => {
    const response = await provider.interpret({ input: prepareBoqUnderstandingInput({ id: "x", description }, []), prompt: { system: "s", user: JSON.stringify({ description }) } });
    return response.normalizedDescription.value;
  };
  const values = await Promise.all(GOLDEN_BOQ_ROWS.map((row) => read(row.description)));
  assert.equal(new Set(values).size, GOLDEN_BOQ_ROWS.length, "three different BOQ lines must produce three different readings");
  for (const [index, row] of GOLDEN_BOQ_ROWS.entries()) {
    assert.equal(values[index], row.description, `the reading must be the row's own text, not an invented value`);
  }
});

test("the hermetic provider never asserts an identity it did not read", async () => {
  // A line with no model token and no technical qualifier must be reported
  // honestly as unclassified, not upgraded into a confident classification.
  const provider = hermetic();
  const response = await provider.interpret({ input: prepareBoqUnderstandingInput({ id: "x", description: "Specialized unsupported annunciator" }, []), prompt: { system: "s", user: JSON.stringify({ description: "Specialized unsupported annunciator" }) } });
  assert.equal(response.system.value, null);
  assert.equal(response.system.origin, "MISSING");
  assert.equal(response.system.confidence, 0);
  assert.equal(response.equipmentType.value, null);
  assert.equal(response.confidence, "MEDIUM", "an unclassified line must not report HIGH confidence");
});

test("a line carrying real engineering identity is reported as confidently understood", async () => {
  const provider = hermetic();
  const description = "Honeywell IDP-115 addressable photoelectric smoke detector, 24 V DC";
  const input = prepareBoqUnderstandingInput({ id: "x", description }, []);
  const response = await provider.interpret({ input, prompt: { system: "s", user: JSON.stringify({ description }) } });
  assert.equal(response.confidence, "HIGH");
  assert.equal(response.system.value, "Fire Alarm");
  assert.equal(response.system.origin, "INFERRED");
  assert.equal(response.equipmentType.value, "Detector");
  assert.equal(response.normalizedDescription.value, description);
  assert.equal(response.normalizedDescription.confidence, 100);
});

// -----------------------------------------------------------------------------
// 4. The governed pipeline is deterministic end to end
// -----------------------------------------------------------------------------

test("no Golden BOQ line can fail, so AI_OUTPUT_INVALID_SCHEMA cannot occur", async () => {
  const provider = hermetic();
  for (const row of GOLDEN_BOQ_ROWS) {
    const result = await interpretBoqItem(prepareBoqUnderstandingInput(row, []), { provider });
    assert.notEqual(result.error?.code, "AI_OUTPUT_INVALID_SCHEMA", `${row.id} must never fail schema validation`);
    assert.ok(["COMPLETED", "NEEDS_REVIEW"].includes(result.status), `${row.id} must reach COMPLETED or NEEDS_REVIEW, got ${result.status}`);
    assert.equal(result.interpretation.reviewReasons.includes("AI_OUTPUT_INVALID_SCHEMA"), false);
  }
});

test("the provider is a hard prerequisite: without one the row still fails closed", async () => {
  const result = await interpretBoqItem(prepareBoqUnderstandingInput(GOLDEN_BOQ_ROWS[0], []), { provider: null });
  assert.equal(result.status, "AI_UNAVAILABLE", "removing inference must not silently produce a confident interpretation");
  assert.equal(result.error.code, "AI_UNAVAILABLE");
});

test("the real batch pipeline gives an identical governed outcome on every run", async () => {
  const run = async () => {
    const saved = [];
    const outcome = await runUnderstandingBatch(GOLDEN_BOQ_ROWS.map(prepareBoqUnderstandingInput), {
      provider: hermetic(),
      existing: async () => null,
      save: async (record) => { saved.push(record); },
      confirmedSpecifications: {},
    });
    return { outcome, saved: saved.map((record) => ({ boqItemId: record.boqItemId, inputFingerprint: record.inputFingerprint, configFingerprint: record.configFingerprint, status: record.status, errorCode: record.error?.code ?? null })) };
  };
  const runs = [];
  for (let attempt = 0; attempt < 5; attempt += 1) runs.push(await run());
  const canonical = JSON.stringify(runs[0]);
  for (const [index, result] of runs.entries()) {
    assert.equal(JSON.stringify(result), canonical, `run ${index + 1} must be identical to run 1`);
  }
  const { outcome, saved } = runs[0];
  assert.equal(outcome.summary.total, 3);
  assert.equal(outcome.summary.processed, 3);
  assert.equal(outcome.summary.failed, 0, "no Golden line may fail");
  assert.equal(outcome.summary.unavailable, 0);
  assert.equal(outcome.summary.successful + outcome.summary.review, 3);
  assert.equal(saved.length, 3, "every line must still be persisted through the real save path");
  for (const record of saved) assert.match(record.inputFingerprint, /^[0-9a-f]{64}$/, "the real input fingerprint must still be computed");
});

test("the config fingerprint records the hermetic provider, so its evidence is never confused with a model run", () => {
  const hermeticFingerprint = interpretationConfigFingerprint(hermetic().metadata);
  const cloudflareFingerprint = interpretationConfigFingerprint(createConfiguredBoqUnderstandingProvider({ AI: { run: async () => ({}) } }).metadata);
  assert.notEqual(hermeticFingerprint, cloudflareFingerprint, "hermetic and real-provider interpretations must never share an authority fingerprint");
  assert.match(hermeticFingerprint, /^[0-9a-f]{64}$/);
});

test("input fingerprints are still per-line, so a changed line changes its authority", () => {
  const first = interpretationInputFingerprint(prepareBoqUnderstandingInput(GOLDEN_BOQ_ROWS[0], []));
  const same = interpretationInputFingerprint(prepareBoqUnderstandingInput(GOLDEN_BOQ_ROWS[0], []));
  const other = interpretationInputFingerprint(prepareBoqUnderstandingInput(GOLDEN_BOQ_ROWS[2], []));
  assert.equal(first, same, "an unchanged line keeps its fingerprint");
  assert.notEqual(first, other, "a different line must not share a fingerprint");
});

test("the seam replaces inference only: the production understanding pipeline is untouched", () => {
  const provider = readFileSync(new URL("../worker/boq-understanding-provider.mjs", import.meta.url), "utf8");
  const hermeticBlock = provider.slice(provider.indexOf("export function createDeterministicHermeticProvider"));
  const forbidden = [
    "db.", "prepare(", "INSERT", "UPDATE", "DELETE", "boq_items", "estimator_", "project_id", "projectId",
    "itemId", "approved", "price", "quotation", "supplier", "process.env", "globalThis",
  ];
  for (const token of forbidden) {
    assert.equal(hermeticBlock.includes(token), false, `the hermetic seam must not reach persistence or commercial state (${token})`);
  }
  assert.equal(/golden-|GOLDEN_/i.test(hermeticBlock.replace(/GOLDEN_HERMETIC_AI/g, "")), false, "the seam must not branch on Golden project or product IDs");
});
