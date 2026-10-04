// Focused validation for the Drawing Vision P1 hardening:
// application deadline, abortability, typed provider errors, fail-closed
// behaviour, retry CLASSIFICATION (never automatic retry), and raw-output privacy.
//
// SCOPE GUARD: this suite asserts only that vision failures are typed, bounded
// and fail-closed. It asserts nothing that would make vision output
// authoritative, and it performs no governed writes.
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyVisionFailure, visionError, visionFailureRetryability,
  withVisionDeadline, VISION_FAILURE,
} from "../worker/drawing-vision-errors.mjs";
import {
  runVisualUnderstanding, visualUnderstandingProviderReadiness,
  visionTimeoutMs, DEFAULT_VISION_TIMEOUT_MS, MAX_VISION_TIMEOUT_MS,
} from "../worker/drawing-visual-understanding-provider.mjs";

const bytes = () => new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

// A vision run that fails during the vision stage, before any synthesis.
const visionOnlyEnv = (run) => ({ AI: { run }, BOQ_AI_MODEL: "test-synthesis-model" });

test("1. typed classifier maps Cloudflare numeric codes to neutral classes", () => {
  assert.equal(classifyVisionFailure({ code: 3007 }), VISION_FAILURE.PROVIDER_TIMEOUT);
  assert.equal(classifyVisionFailure({ code: 3008 }), VISION_FAILURE.PROVIDER_ABORTED);
  assert.equal(classifyVisionFailure({ code: 3006 }), VISION_FAILURE.REQUEST_TOO_LARGE);
  assert.equal(classifyVisionFailure({ code: 3040 }), VISION_FAILURE.CAPACITY_UNAVAILABLE);
  assert.equal(classifyVisionFailure({ code: 3036 }), VISION_FAILURE.QUOTA_EXHAUSTED);
  assert.equal(classifyVisionFailure({ code: 5004 }), VISION_FAILURE.INVALID_INPUT);
});

test("2. observed invalid-image code classifies as invalid input, not generic", () => {
  // Observed live from the real endpoint: a 1x1 image was rejected with code 8007.
  assert.equal(classifyVisionFailure({ code: 8007 }), VISION_FAILURE.INVALID_INPUT);
  const envelope = { success: false, errors: [{ code: 8007, message: "AiError: Image width must be at least 2 pixels" }] };
  assert.equal(classifyVisionFailure(envelope), VISION_FAILURE.INVALID_INPUT);
});

test("3. capacity is distinguishable from quota", () => {
  assert.equal(classifyVisionFailure({ code: 3040 }), VISION_FAILURE.CAPACITY_UNAVAILABLE);
  assert.equal(classifyVisionFailure({ code: 3036 }), VISION_FAILURE.QUOTA_EXHAUSTED);
  assert.notEqual(visionFailureRetryability(VISION_FAILURE.CAPACITY_UNAVAILABLE).transient,
                  visionFailureRetryability(VISION_FAILURE.QUOTA_EXHAUSTED).transient);
});

test("4. generic failure stays generic and is never assumed retryable", () => {
  assert.equal(classifyVisionFailure(new Error("something odd happened")), VISION_FAILURE.GENERIC);
  assert.equal(visionFailureRetryability(VISION_FAILURE.GENERIC).transient, false);
});

test("5. AbortError is typed as provider abort", () => {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  assert.equal(classifyVisionFailure(e), VISION_FAILURE.PROVIDER_ABORTED);
});

test("6. coarse governed code is unchanged; precise cause is additive", () => {
  const timeout = visionError({ providerCode: VISION_FAILURE.PROVIDER_TIMEOUT, message: "m", stage: "vision" });
  assert.equal(timeout.code, "AI_PROVIDER_TIMEOUT");
  assert.equal(timeout.providerCode, VISION_FAILURE.PROVIDER_TIMEOUT);
  // Everything else stays inside the vocabulary drawing-extraction-api persists.
  for (const fc of [VISION_FAILURE.REQUEST_TOO_LARGE, VISION_FAILURE.INVALID_INPUT, VISION_FAILURE.GENERIC]) {
    assert.equal(visionError({ providerCode: fc, message: "m", stage: "vision" }).code, "AI_PROVIDER_ERROR");
  }
  const deadline = visionError({ providerCode: VISION_FAILURE.DEADLINE_EXCEEDED, message: "m", stage: "vision" });
  assert.equal(deadline.code, "AI_PROVIDER_TIMEOUT");
});

test("7. retryability is classified, and quota/deadline are not blindly retryable", () => {
  assert.equal(visionFailureRetryability(VISION_FAILURE.PROVIDER_TIMEOUT).transient, true);
  assert.equal(visionFailureRetryability(VISION_FAILURE.CAPACITY_UNAVAILABLE).transient, true);
  assert.equal(visionFailureRetryability(VISION_FAILURE.QUOTA_EXHAUSTED).transient, false);
  assert.equal(visionFailureRetryability(VISION_FAILURE.QUOTA_EXHAUSTED).administrative, true);
  assert.equal(visionFailureRetryability(VISION_FAILURE.DEADLINE_EXCEEDED).transient, false);
  assert.equal(visionFailureRetryability(VISION_FAILURE.INVALID_INPUT).transient, false);
  assert.equal(visionFailureRetryability(VISION_FAILURE.REQUEST_TOO_LARGE).transient, false);
});

test("8. credentials never reach a typed diagnostic", () => {
  const e = visionError({
    providerCode: VISION_FAILURE.GENERIC, message: "m", stage: "vision",
    providerEvidence: "failed with Authorization: Bearer nvapi-abcdef123456 and api_key=sk-secret999",
  });
  const text = JSON.stringify(e.providerDiagnostic);
  assert.ok(!/nvapi-abcdef123456/.test(text), "bearer value must be redacted");
  assert.ok(!/sk-secret999/.test(text), "api key must be redacted");
});

test("9. application deadline terminates an unresponsive vision call", async () => {
  const t0 = Date.now();
  await assert.rejects(
    withVisionDeadline({ timeoutMs: 60, stage: "vision", model: "m", task: () => new Promise(() => {}) }),
    (e) => {
      assert.equal(e.providerCode, VISION_FAILURE.DEADLINE_EXCEEDED);
      assert.equal(e.code, "AI_PROVIDER_TIMEOUT");
      return true;
    },
  );
  assert.ok(Date.now() - t0 < 2000, "deadline must fire promptly, not hang");
});

test("10. an abandoned call that later rejects does not surface as unhandled rejection", async () => {
  let rejectLater;
  const work = new Promise((_, rej) => { rejectLater = rej; });
  await assert.rejects(withVisionDeadline({ timeoutMs: 50, stage: "vision", model: "m", task: () => work }));
  rejectLater(new Error("late provider failure"));
  await new Promise((r) => setTimeout(r, 30)); // an unhandled rejection would fail the run here
});

test("11. a call that finishes in time is returned unchanged, timer cleared", async () => {
  assert.equal(await withVisionDeadline({ timeoutMs: 1000, stage: "vision", model: "m", task: async () => "done" }), "done");
});

test("12. timeout configuration follows the project Cloudflare convention", () => {
  assert.equal(visionTimeoutMs({}), DEFAULT_VISION_TIMEOUT_MS);
  assert.equal(DEFAULT_VISION_TIMEOUT_MS, 30_000);
  assert.equal(MAX_VISION_TIMEOUT_MS, 60_000);
  assert.equal(visionTimeoutMs({ DRAWING_VISUAL_AI_VISION_TIMEOUT_MS: 45_000 }), 45_000);
  assert.equal(visionTimeoutMs({ DRAWING_VISUAL_AI_VISION_TIMEOUT_MS: 5 }), 1_000);       // floor
  assert.equal(visionTimeoutMs({ DRAWING_VISUAL_AI_VISION_TIMEOUT_MS: 999_999 }), 60_000); // ceiling
  assert.equal(visionTimeoutMs({ DRAWING_VISUAL_AI_VISION_TIMEOUT_MS: "nonsense" }), DEFAULT_VISION_TIMEOUT_MS);
});

test("13. readiness reports the deadline that will actually be enforced", () => {
  const r = visualUnderstandingProviderReadiness({ AI: { run: () => {} } });
  assert.equal(r.visionTimeoutMs, DEFAULT_VISION_TIMEOUT_MS);
  assert.equal(visualUnderstandingProviderReadiness({}).visionTimeoutMs, undefined);
});

test("14. FAIL CLOSED: a vision timeout produces no result and no findings", async () => {
  const env = visionOnlyEnv(() => new Promise(() => {}));
  env.DRAWING_VISUAL_AI_VISION_TIMEOUT_MS = 60;
  await assert.rejects(
    runVisualUnderstanding(env, { images: [{ bytes: bytes(), kind: "crop", pageNumber: 1 }] }),
    (e) => {
      assert.equal(e.providerCode, VISION_FAILURE.DEADLINE_EXCEEDED);
      return true;
    },
  );
});

test("15. FAIL CLOSED: one failing image aborts the whole run (no partial observation set)", async () => {
  let calls = 0;
  const env = visionOnlyEnv(async () => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error("AiError: Request too large"), { code: 3006 });
    return { description: "legible text" };
  });
  await assert.rejects(
    runVisualUnderstanding(env, { images: [0, 1, 2].map((i) => ({ bytes: bytes(), kind: "crop", pageNumber: i + 1 })) }),
    (e) => { assert.equal(e.providerCode, VISION_FAILURE.REQUEST_TOO_LARGE); return true; },
  );
  assert.equal(calls, 2, "must stop at the first failure, never continue to later images");
});

test("16. no automatic provider fallback: only the canonical model is ever called", async () => {
  const models = [];
  const env = visionOnlyEnv(async (model) => { models.push(model); throw Object.assign(new Error("capacity"), { code: 3040 }); });
  env.DRAWING_VISUAL_AI_VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
  await assert.rejects(runVisualUnderstanding(env, { images: [{ bytes: bytes(), kind: "crop", pageNumber: 1 }] }));
  assert.deepEqual(models, ["@cf/llava-hf/llava-1.5-7b-hf"], "exactly one model, no second attempt elsewhere");
});

test("17. provider/model metadata equals the model actually called", async () => {
  const env = visionOnlyEnv(async () => ({ description: "text" }));
  env.DRAWING_VISUAL_AI_VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
  env.DRAWING_VISUAL_AI_SYNTHESIS_MODEL = "synthesis-model-x";
  // Synthesis needs a schema-conformant response; assert only the vision record.
  const seen = [];
  await runVisualUnderstanding(env, {
    images: [{ bytes: bytes(), kind: "crop", pageNumber: 1 }],
    onModelResponse: async (r) => { seen.push(r); },
  }).catch(() => {});
  const vision = seen.find((r) => r.stage === "vision");
  assert.equal(vision.model, "@cf/llava-hf/llava-1.5-7b-hf");
});

test("18. raw audit records carry no credentials and no image bytes", async () => {
  const env = visionOnlyEnv(async () => ({ description: "text" }));
  const seen = [];
  await runVisualUnderstanding(env, {
    images: [{ bytes: bytes(), kind: "crop", pageNumber: 1 }],
    onModelResponse: async (r) => { seen.push(r); },
  }).catch(() => {});
  const vision = seen.find((r) => r.stage === "vision");
  assert.equal(vision.input.image, undefined, "image bytes must never be recorded");
  assert.ok(vision.input.imageIndex !== undefined);
  assert.ok(!/authorization|bearer|api_key/i.test(JSON.stringify(vision.input)));
});

test("19. reasoning traces are stripped from the persisted raw response", async () => {
  const env = visionOnlyEnv(async () => ({
    description: "final answer",
    reasoning_content: "hidden chain of thought that must never be persisted",
    nested: { thinking: "more private reasoning", keep: "visible" },
  }));
  const seen = [];
  await runVisualUnderstanding(env, {
    images: [{ bytes: bytes(), kind: "crop", pageNumber: 1 }],
    onModelResponse: async (r) => { seen.push(r); },
  }).catch(() => {});
  const returned = seen.find((r) => r.status === "Returned");
  const text = JSON.stringify(returned.response);
  assert.ok(!/chain of thought|more private reasoning/.test(text), "reasoning must be removed");
  assert.ok(/final answer/.test(text), "final answer must be retained");
  assert.ok(/visible/.test(text), "non-reasoning nested fields survive");
});

test("20. a vision failure never becomes a successful or empty finding set", async () => {
  const outcomes = [];
  for (const [label, impl] of [
    ["timeout", () => new Promise(() => {})],
    ["invalid", () => { throw Object.assign(new Error("bad image"), { code: 8007 }); }],
    ["quota", () => { throw Object.assign(new Error("quota"), { code: 3036 }); }],
  ]) {
    const env = visionOnlyEnv(impl);
    env.DRAWING_VISUAL_AI_VISION_TIMEOUT_MS = 60;
    const r = await runVisualUnderstanding(env, { images: [{ bytes: bytes(), kind: "crop", pageNumber: 1 }] })
      .then((v) => ({ label, resolved: v }))
      .catch((e) => ({ label, code: e.providerCode, resolved: null }));
    outcomes.push(r);
    assert.equal(r.resolved, null, `${label} must not resolve a result`);
  }
  assert.deepEqual(outcomes.map((o) => o.code), [
    VISION_FAILURE.DEADLINE_EXCEEDED, VISION_FAILURE.INVALID_INPUT, VISION_FAILURE.QUOTA_EXHAUSTED,
  ]);
});