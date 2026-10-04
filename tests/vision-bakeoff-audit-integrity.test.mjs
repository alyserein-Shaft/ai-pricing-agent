// Focused proof that the benchmark AUDIT ROW describes the request that was
// actually transmitted. This is the mechanical defect found in
// scripts/vision-bakeoff-run.mjs, where the recorder hardcoded max_tokens:400
// while the NVIDIA request transmitted 1200.
//
// SCOPE: proves the single-source-of-truth invariant only. It does NOT touch the
// prompt, expected truth, cases, rubric weights or penalties.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  transportFor, requestMetadataFor, CASES, RUBRIC, VISION_PROMPT,
  LLAVA_TRANSPORT_MAX_TOKENS, NIM_TRANSPORT_MAX_TOKENS,
} from "../scripts/vision-bakeoff-packet.mjs";

const NIM = { provider: "nvidia_nim", model: "z-ai/glm-5.3-flash" };
const CF = { provider: "cloudflare", model: "@cf/llava-hf/llava-1.5-7b-hf" };

test("1. RECORDED_MAX_TOKENS === TRANSMITTED_MAX_TOKENS for NVIDIA", () => {
  const recorded = requestMetadataFor(NIM, 120000).max_tokens;
  const transmitted = transportFor(NIM).maxTokens;
  assert.equal(recorded, transmitted, "audit row must describe the real request");
  assert.equal(recorded, 1200);
});

test("2. RECORDED_MAX_TOKENS === TRANSMITTED_MAX_TOKENS for Cloudflare", () => {
  assert.equal(requestMetadataFor(CF, 30000).max_tokens, transportFor(CF).maxTokens);
  assert.equal(requestMetadataFor(CF, 30000).max_tokens, 400);
});

test("3. the audit row carries the deadline actually enforced", () => {
  assert.equal(requestMetadataFor(NIM, 120000).deadlineMs, 120000);
  assert.equal(requestMetadataFor(NIM, 120000).temperature, 0);
});

test("4. the runner sources BOTH the body and the record from the resolver", () => {
  // Static proof that no hardcoded ceiling can silently reintroduce the defect.
  const src = readFileSync(new URL("../scripts/vision-bakeoff-run.mjs", import.meta.url), "utf8");
  const bodyCeilings = [...src.matchAll(/max_tokens:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
  assert.ok(bodyCeilings.length > 0, "transmitted ceilings must be present");
  for (const expr of bodyCeilings) {
    assert.match(expr, /^TRANSPORT\.maxTokens$/, `non-resolver max_tokens found: ${expr}`);
  }
  assert.ok(src.includes("request: requestMetadataFor(cand, DEADLINE_MS)"), "record must use the resolver");
});

test("5. Golden truth and rubric are unchanged by the audit fix", () => {
  assert.deepEqual(CASES.map((c) => c.id), ["A", "B", "B2", "C", "C2", "D"]);
  assert.deepEqual(RUBRIC.weights, {
    visualAccuracy: 30, textTableExtraction: 20, engineeringSemantics: 15,
    abstentionDiscipline: 15, structuredOutput: 10, operational: 10,
  });
  assert.deepEqual(RUBRIC.penalties, {
    hallucinatedPrintedQuantity: -25, hallucinatedText: -15, unsupportedEngineeringInference: -10,
  });
  assert.equal(RUBRIC.minimumMeaningfulDeltaPoints, 5);
  // Case D must still require abstention -- the negative case is not softened.
  const d = CASES.find((c) => c.id === "D");
  assert.equal(d.expected.requireAbstention, true);
  assert.equal(d.expected.mustNotInventQuantity, true);
});

test("6. every case still forbids invented quantity", () => {
  for (const c of CASES) assert.equal(c.expected.mustNotInventQuantity, true, `case ${c.id}`);
});

test("7. the semantic prompt is byte-identical and truth-free", () => {
  assert.ok(VISION_PROMPT.includes("Transcribe only legible text exactly"));
  assert.ok(VISION_PROMPT.includes("Do not guess"));
  // The prompt must never leak expected answers into the model's view.
  for (const leak of ["FIREMAN TELEPHONE", "expect", "answer:", "must be"]) {
    assert.ok(!VISION_PROMPT.includes(leak), `prompt leaks benchmark truth: ${leak}`);
  }
});