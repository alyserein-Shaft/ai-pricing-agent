/**
 * Focused tests for the NVIDIA drawing probe adapter.
 *
 * No network and no credentials: `fetchImpl` is injected, so these assert the
 * contract, the provenance binding, the structured output and the known failure
 * cases that the Agent 6 audit actually observed against the live endpoint.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  NEMOTRON_PARSE_MAX_OUTPUT_TOKENS,
  isDegenerate,
  SEMANTIC_VERDICTS,
  AVAILABILITY_UNVERIFIED,
  NVIDIA_CV_BASE_URL,
  NVIDIA_CV_COORDINATE_SPACE,
  NVIDIA_CV_SERVICES,
  nvidiaCvRequestBody,
  nvidiaCvRoute,
  assertProvenance,
  callNvidiaModel,
  probeDrawingRegion,
  stripModelCoordinates,
} from "../app/domain/nvidia-drawing-probe.mjs";

const PROVENANCE = {
  projectId: "project_ae501b85-9c12-4332-bf8e-787c90f2d388",
  documentId: "doc_facp",
  pageNumber: 1,
  boundingBox: { x: 100, y: 200, width: 800, height: 400 },
};

const okFetch = (content, { finish = "stop" } = {}) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "nvidia/nemotron-parse-2.0",
        choices: [{ message: { content }, finish_reason: finish }],
        usage: { prompt_tokens: 10, completion_tokens: 42, total_tokens: 52 },
      }),
    };
  };
  impl.calls = calls;
  return impl;
};

test("a probe is refused without citable provenance", async () => {
  for (const [label, provenance] of [
    ["missing projectId", { ...PROVENANCE, projectId: "" }],
    ["missing documentId", { ...PROVENANCE, documentId: undefined }],
    ["missing pageNumber", { ...PROVENANCE, pageNumber: null }],
    ["missing boundingBox", { ...PROVENANCE, boundingBox: undefined }],
    ["incomplete boundingBox", { ...PROVENANCE, boundingBox: { x: 1, y: 2 } }],
  ]) {
    await assert.rejects(
      probeDrawingRegion({ capability: "text_extraction", model: "m", prompt: "p", image: "AAA", provenance, fetchImpl: okFetch("x") }),
      (error) => error?.code === "PROBE_PROVENANCE_REQUIRED",
      `expected refusal for ${label}`,
    );
  }
});

test("the probe is advisory and never claims authority", async () => {
  const result = await probeDrawingRegion({
    capability: "text_extraction",
    model: "nvidia/nemotron-parse-2.0",
    prompt: "Parse this region.",
    image: "AAAA",
    provenance: PROVENANCE,
    fetchImpl: okFetch("DETECTOR  QTY 4"),
  });
  assert.equal(result.authoritative, false, "an NVIDIA probe is never authoritative");
  assert.equal(result.advisory, true);
  assert.equal(result.output, "DETECTOR  QTY 4");
  assert.equal(result.provenance.projectId, PROVENANCE.projectId);
  assert.equal(result.provenance.pageNumber, 1);
  assert.deepEqual(result.provenance.boundingBox, PROVENANCE.boundingBox);
  assert.equal(result.provenance.coordinateMode, "pixels");
  assert.equal(result.latencyMs >= 0, true);
});

test("the verified 4096-token server cap is enforced on the client", async () => {
  const impl = okFetch("x");
  const result = await callNvidiaModel({
    model: "nvidia/nemotron-parse-2.0",
    prompt: "p",
    image: "AAAA",
    maxTokens: 99999,
    apiKey: "test-key",
    fetchImpl: impl,
  });
  assert.equal(result.maxTokensApplied, NEMOTRON_PARSE_MAX_OUTPUT_TOKENS);
  const sent = JSON.parse(impl.calls[0].init.body);
  assert.equal(sent.max_tokens, NEMOTRON_PARSE_MAX_OUTPUT_TOKENS);
});

test("a truncated response is reported as incomplete, never as 'nothing found'", async () => {
  const result = await callNvidiaModel({
    model: "nvidia/nemotron-parse-2.0",
    prompt: "p",
    image: "AAAA",
    apiKey: "test-key",
    fetchImpl: okFetch(" partial text", { finish: "length" }),
  });
  assert.equal(result.finishReason, "length");
  assert.equal(result.truncated, true, "a run that hit the cap must be visible as truncation");
});

test("the credential is required and never echoed", async () => {
  await assert.rejects(
    callNvidiaModel({ model: "m", prompt: "p", image: "A", apiKey: "" }),
    (error) => error?.code === "NVIDIA_CREDENTIAL_MISSING",
  );
  const impl = okFetch("x");
  await callNvidiaModel({ model: "m", prompt: "p", image: "A", apiKey: "test-key", fetchImpl: impl });
  const sent = impl.calls[0].init;
  assert.match(sent.headers.Authorization, /^Bearer /);
  assert.equal(sent.headers.Authorization.includes("test-key"), true);
  // The key is used as a header only; it must not appear in any request body.
  assert.equal(sent.body.includes("test-key"), false);
});

test("a server refusal is surfaced with its status, not swallowed", async () => {
  const impl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "max_tokens cannot be greater than max_model_len" } }),
  });
  await assert.rejects(
    callNvidiaModel({ model: "m", prompt: "p", image: "A", apiKey: "k", fetchImpl: impl }),
    (error) => error?.code === "NVIDIA_REQUEST_FAILED" && error?.status === 400,
  );
});

test("a transport failure is fail-closed with an explicit code", async () => {
  const impl = async () => { throw new Error("socket hang up"); };
  await assert.rejects(
    callNvidiaModel({ model: "m", prompt: "p", image: "A", apiKey: "k", fetchImpl: impl }),
    (error) => error?.code === "PROBE_TRANSPORT_FAILED",
  );
});

test("model-generated coordinates are stripped and never travel as provenance", async () => {
  const { text, coordinatesRemoved } = stripModelCoordinates(
    'Block 1: SUPPORTED, "FACP" at [100, 20, 900, 80]; bbox of the label is 120,300.',
  );
  assert.equal(coordinatesRemoved, true);
  assert.equal(/\[\s*\d/.test(text), false, "no numeric coordinate array may survive");
  const result = await probeDrawingRegion({
    capability: "visual_reasoning", model: "m", prompt: "p", image: "A",
    provenance: PROVENANCE, fetchImpl: okFetch('label at [10,20,30,40] is SUPPORTED'),
  });
  assert.equal(result.modelCoordinatesRemoved, true);
  assert.equal(/\[\s*\d/.test(result.output), false);
  // Our own bbox is the only provenance that leaves the adapter.
  assert.deepEqual(result.provenance.boundingBox, PROVENANCE.boundingBox);
});

test("model ambiguity is preserved, never coerced into an answer", async () => {
  const result = await probeDrawingRegion({
    capability: "visual_reasoning", model: "m", prompt: "p", image: "A",
    provenance: PROVENANCE,
    fetchImpl: okFetch("NOT_VISIBLE — no header is legible in this region"),
  });
  assert.match(result.output, /NOT_VISIBLE/);
  assert.ok(SEMANTIC_VERDICTS.includes(result.output.match(/NOT_VISIBLE/)[0]));
});

test("degenerate filler is flagged as a distinct failure, not an empty page", async () => {
  const degenerate = await probeDrawingRegion({
    capability: "text_extraction", model: "nvidia/nemotron-parse-2.0", prompt: "p", image: "A",
    provenance: PROVENANCE,
    fetchImpl: okFetch(" are are are are are are are are are are ", { finish: "length" }),
  });
  assert.equal(degenerate.degenerate, true, "repetition must be visible as degeneration");
  assert.equal(degenerate.truncated, true, "and it must be reported as truncation, not as content");
  // Real content is not flagged, so the signal stays meaningful.
  const real = await probeDrawingRegion({
    capability: "text_extraction", model: "nvidia/nemotron-parse-2.0", prompt: "p", image: "A",
    provenance: PROVENANCE,
    fetchImpl: okFetch("FACP Block 1 LOOP-3 detector quantity 12 header DEVICE", { finish: "stop" }),
  });
  assert.equal(real.degenerate, false);
});

test("degeneration is judged on the real responses this project actually received", () => {
  // Captured verbatim from nemotron-parse-2.0 on real Al Mousa CAD regions.
  assert.equal(isDegenerate(" are are are are are are are are are are "), true);
  assert.equal(isDegenerate("  . . . . . . . . . "), true);
  // Captured verbatim from nemotron-ocr-v2 on a real sheet title block, which is
  // real text at very low fidelity: detected, but never mistaken for content.
  assert.equal(isDegenerate("F RIE DDTECTON LALAAMS SCHEEAATIC"), false);
  assert.equal(isDegenerate("FIRE DETECTION  AAASSS SCHENNTC"), false);
});

test("the CV route rejects a prefixed id, which is what caused the false 404", () => {
  // The exact mistake that produced four 404s: the base URL already ends in
  // /nvidia, so a catalog-form id doubles the segment and the service 404s.
  assert.throws(() => nvidiaCvRoute("nvidia/nemotron-ocr-v2"), /BARE service id/);
  assert.equal(nvidiaCvRoute("nemotron-ocr-v2"), `${NVIDIA_CV_BASE_URL}/nemotron-ocr-v2`);
  assert.ok(!nvidiaCvRoute("nemotron-ocr-v2").includes("/nvidia/nvidia/"));
  assert.deepEqual(
    NVIDIA_CV_SERVICES.map((s) => s.model),
    ["nemotron-ocr-v2", "nemotron-page-elements-v3", "nemotron-table-structure-v1"],
  );
});

test("the CV request body matches the one the working integration sends", () => {
  assert.deepEqual(nvidiaCvRequestBody("QUJD"), { input: [{ type: "image_url", url: "data:image/png;base64,QUJD" }] });
});

test("CV geometry is normalised 0..1 and therefore never page-space provenance", () => {
  assert.equal(NVIDIA_CV_COORDINATE_SPACE, "NORMALISED_0_1");
  const geometryOnly = NVIDIA_CV_SERVICES.filter((s) => s.returns.includes("NO text"));
  assert.deepEqual(geometryOnly.map((s) => s.role), ["regions", "geometry"],
    "element and table services return geometry without any cell text");
});

test("a model that 404-ed through the wrong service class is unverified, not unavailable", () => {
  const names = AVAILABILITY_UNVERIFIED.map((entry) => entry.model);
  assert.ok(names.includes("nvidia/cosmos-reason2-8b"));
  assert.ok(names.includes("nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1"));
  for (const entry of AVAILABILITY_UNVERIFIED) {
    assert.match(entry.why_unverified, /endpoint|embeddings/,
      "an unverified 404 must state which endpoint was actually used");
  }
});

test("the token cap is exclusive, as the endpoint actually enforces it", () => {
  assert.equal(NEMOTRON_PARSE_MAX_OUTPUT_TOKENS, 4095, "4096 is rejected by the endpoint");
});

test("assertProvenance accepts a complete region and rejects an incomplete one", () => {
  assert.equal(assertProvenance(PROVENANCE), true);
  assert.throws(() => assertProvenance({ ...PROVENANCE, pageNumber: undefined }), /boundingBox|pageNumber|missing/);
});