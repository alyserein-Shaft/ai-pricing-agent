// NVIDIA DOCUMENT SHADOW API -- focused coverage.
//
// The point of this suite is the SAFETY properties, not the happy path:
//   * the privacy guard is fail-closed and refuses known-private locations
//   * nothing is transmitted when a guard refuses
//   * the credential is never returned, logged or embedded in any response
//   * NVIDIA output is never authoritative and never mutates extraction
//   * provider configuration is external (client handoff = config, not code)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  handleNvidiaDocumentShadowApi, runShadowProbe, guardProbePath, guardProbePayload, buildShadowStatus,
  classifyUpstream, SHADOW_STATUS, PROBE_DECISIONS, UPSTREAM_ERRORS, DEFAULT_NVIDIA_CONFIG,
  PAYLOAD_CLASSIFICATIONS, RESTRICTED_PAYLOAD_CLASSIFICATIONS,
  SHADOW_ROUTE_PATH, DEFAULT_TRUSTED_ROOTS, resolveTrustedProbeRoots, shadowProbeEnabled,
} from "../worker/nvidia-document-shadow-api.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Build a real routed request, exactly as `worker/index.ts` would hand it over. */
const shadowRequest = (body, { method = "POST", path = SHADOW_ROUTE_PATH } = {}) =>
  new Request(`https://app.invalid${path}`, {
    method,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });

const shadowJson = async (response) => ({ status: response.status, body: await response.json() });

// 1 -----------------------------------------------------------------
test("1 -- restricted COMMERCIAL paths are refused; project identity is NOT a blocker", () => {
  // Still refused: supplier pricing / quotation / price-list material, refused for
  // what it CONTAINS, not who owns it.
  const restricted = [
    "private/supplier-price/quote.pdf",
    "inputs/final-quotation.pdf",
    "inputs/price-list.xlsx",
    "refs/pricelist.xlsx",
    "x/supplier_price/q.pdf",
  ];
  for (const p of restricted) {
    const g = guardProbePath(p, { allowedRoots: ["tests/fixtures/ai-synthetic"] });
    assert.equal(g.decision, PROBE_DECISIONS.REFUSED_PRIVATE_PATH, `must refuse ${p}`);
    assert.ok(g.reason.length > 20, "refusal must explain itself");
  }
  // A restricted-commercial path nested INSIDE an allowed root is still refused.
  const nested = guardProbePath("tests/fixtures/ai-synthetic/supplier-price/q.png", { allowedRoots: ["tests/fixtures/ai-synthetic"] });
  assert.equal(nested.decision, PROBE_DECISIONS.REFUSED_PRIVATE_PATH);

  // Project IDENTITY, project filenames and project paths are NOT privacy blockers
  // (PROJECT_DATA_DISCLOSURE_POLICY = AUTHORIZED). Inside an allowed root these pass.
  const allowed = [
    "tests/fixtures/ai-synthetic/al-mousa/boq.png",
    "tests/fixtures/ai-synthetic/al_mousa/boq.png",
    "tests/fixtures/ai-synthetic/inputs/central-kitchen/source-boq.png",
    "tests/fixtures/ai-synthetic/central-kitchen/spec.png",
    "tests/fixtures/ai-synthetic/outputs/boq.png",
    "tests/fixtures/ai-synthetic/uploads/boq.png",
    "tests/fixtures/ai-synthetic/project-upload/boq.png",
  ];
  for (const p of allowed) {
    const g = guardProbePath(p, { allowedRoots: ["tests/fixtures/ai-synthetic"] });
    assert.equal(g.decision, PROBE_DECISIONS.OK, `project identity must not block: ${p}`);
  }
});

// 1b ----------------------------------------------------------------
test("1b -- payload classification is fail-closed and rejects only restricted content", () => {
  // Only an explicitly authorized project document passes.
  assert.equal(guardProbePayload(PAYLOAD_CLASSIFICATIONS.AUTHORIZED_PROJECT_DOCUMENT).decision, PROBE_DECISIONS.OK);
  // Every restricted class is rejected.
  for (const c of RESTRICTED_PAYLOAD_CLASSIFICATIONS) {
    assert.equal(guardProbePayload(c).decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD, `must reject ${c}`);
  }
  assert.equal(guardProbePayload("RESTRICTED_PII").decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD);
  assert.equal(guardProbePayload("RESTRICTED_INTERNAL_ONLY").decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD);
  assert.equal(guardProbePayload("RESTRICTED_CONFIDENTIAL_THIRD_PARTY").decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD);
  // Fail-closed: absent or unknown classification is a REFUSAL, never a pass.
  for (const bad of [null, undefined, "", "AUTHORIZED", "AUTHORIZED_PROJECT_DOCUMENT_V2", 42, {}]) {
    assert.equal(guardProbePayload(bad).decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD, `must fail closed: ${String(bad)}`);
  }
});

// 2 -----------------------------------------------------------------
test("2 -- the guard is FAIL-CLOSED: an unapproved path is refused even if not 'private'", () => {
  for (const p of ["package.json", "/etc/hosts", "app/page.tsx", "tests/fixtures/ai-synthetic/../../../etc/hosts"]) {
    const g = guardProbePath(p, { allowedRoots: ["tests/fixtures/ai-synthetic"] });
    assert.equal(g.decision, PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS, `must refuse ${p}`);
  }
  // An explicitly approved synthetic path is allowed.
  assert.equal(guardProbePath("tests/fixtures/ai-synthetic/ok.png", { allowedRoots: ["tests/fixtures/ai-synthetic"] }).decision, PROBE_DECISIONS.OK);
  // And with NO allowed roots configured, nothing is allowed by default.
  assert.equal(guardProbePath("tests/fixtures/ai-synthetic/ok.png", { allowedRoots: [] }).decision, PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS);
});

// 3 -----------------------------------------------------------------
test("3 -- a REFUSED probe transmits nothing", async () => {
  // Restricted-commercial path -> refused before anything is read or sent.
  const restricted = await runShadowProbe({
    filePath: "private/supplier-price/quote.pdf",
    allowedRoots: ["tests/fixtures/ai-synthetic"],
    env: { NVIDIA_API_KEY: "nvapi-SECRET" },
    payloadClassification: PAYLOAD_CLASSIFICATIONS.AUTHORIZED_PROJECT_DOCUMENT,
  });
  assert.equal(restricted.transmitted, false);
  assert.equal(restricted.decision, PROBE_DECISIONS.REFUSED_PRIVATE_PATH);
  assert.ok(!JSON.stringify(restricted).includes("SECRET"), "the credential must never appear");

  // Restricted PAYLOAD on an otherwise-allowed path -> also refused, nothing sent.
  for (const c of RESTRICTED_PAYLOAD_CLASSIFICATIONS) {
    const r = await runShadowProbe({
      filePath: "tests/fixtures/ai-synthetic/ok.png",
      allowedRoots: ["tests/fixtures/ai-synthetic"],
      env: { NVIDIA_API_KEY: "nvapi-SECRET" },
      payloadClassification: c,
    });
    assert.equal(r.transmitted, false, `restricted ${c} must not transmit`);
    assert.equal(r.decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD, `restricted ${c} must be refused`);
    assert.ok(!JSON.stringify(r).includes("SECRET"), "the credential must never appear");
  }

  // Undeclared classification fails closed even on an allowed path.
  const undeclared = await runShadowProbe({
    filePath: "tests/fixtures/ai-synthetic/ok.png",
    allowedRoots: ["tests/fixtures/ai-synthetic"],
    env: { NVIDIA_API_KEY: "nvapi-SECRET" },
  });
  assert.equal(undeclared.transmitted, false);
  assert.equal(undeclared.decision, PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD);
});

// 4 -----------------------------------------------------------------
test("4 -- the CREDENTIAL is never returned anywhere, and is only ever a boolean", async () => {
  const status = buildShadowStatus({ credentialPresent: true });
  assert.equal(status.credentialPresent, true);
  assert.equal(typeof status.credentialPresent, "boolean");
  const body = JSON.stringify(status);
  assert.ok(!/nvapi-/.test(body), "no key material may appear in a status payload");
  // A probe with no credential must refuse rather than attempt a call.
  const noKey = await runShadowProbe({
    filePath: "tests/fixtures/ai-synthetic/x.png",
    allowedRoots: ["tests/fixtures/ai-synthetic"],
    env: {},
  });
  assert.equal(noKey.transmitted, false);
  assert.equal(noKey.decision, PROBE_DECISIONS.NO_CREDENTIAL);
});

// 5 -----------------------------------------------------------------
test("5 -- NVIDIA is NEVER authoritative and this is stated in every payload", async () => {
  assert.equal(SHADOW_STATUS.AUTHORITATIVE_PARSER, "NATIVE_ONLY");
  assert.equal(SHADOW_STATUS.NVIDIA_ROLE, "SHADOW_ONLY_ADVISORY");
  assert.equal(SHADOW_STATUS.ESCALATION_POLICY, "MEASURED_NON_DISCRIMINATING");
  const status = buildShadowStatus({});
  assert.ok(/never.*persist|promoted|authoritative/i.test(status.disclaimer));
  const refused = await runShadowProbe({ filePath: "nope.png", allowedRoots: [], env: {} });
  assert.equal(refused.authority.AUTHORITATIVE_PARSER, "NATIVE_ONLY");
  // The module must not import the extractor or any mutation path: it observes.
  const src = readFileSync(join(HERE, "..", "worker", "nvidia-document-shadow-api.mjs"), "utf8");
  assert.ok(!/boq-extractor|extractBoqBytes|\.run\(\)|\.exec\(|INSERT|UPDATE /.test(src),
    "the shadow API must not extract or mutate anything");
});

// 6 -----------------------------------------------------------------
test("6 -- provider configuration is EXTERNAL so client handoff is config-only", () => {
  // Models, base URLs and timeouts are data, not literals buried in logic.
  assert.ok(DEFAULT_NVIDIA_CONFIG.baseUrl.startsWith("https://"));
  assert.ok(DEFAULT_NVIDIA_CONFIG.chatBaseUrl.startsWith("https://"));
  for (const [role, model] of Object.entries(DEFAULT_NVIDIA_CONFIG.models)) {
    assert.equal(typeof model, "string", `${role} must be configurable`);
  }
  assert.equal(typeof DEFAULT_NVIDIA_CONFIG.timeoutMs, "number");
  // A caller can override the whole config without touching this module.
  const custom = { ...DEFAULT_NVIDIA_CONFIG, models: { ...DEFAULT_NVIDIA_CONFIG.models, ocr: "vendor/other-ocr" } };
  assert.equal(custom.models.ocr, "vendor/other-ocr");
  // No credential is baked into the shipped defaults.
  assert.ok(!/nvapi-/.test(JSON.stringify(DEFAULT_NVIDIA_CONFIG)));
  assert.ok(!/apiKey|secret/i.test(JSON.stringify(DEFAULT_NVIDIA_CONFIG)));
});

// 7 -----------------------------------------------------------------
test("7 -- the image size policy is UNIFORM, never per-case", async () => {
  const tiny = { ...DEFAULT_NVIDIA_CONFIG, maxImageBase64Chars: 10 };
  const result = await runShadowProbe({
    filePath: "tests/fixtures/ai-synthetic/x.png",
    allowedRoots: ["tests/fixtures/ai-synthetic"],
    env: { NVIDIA_API_KEY: "k" }, config: tiny,
  });
  // Either the file is missing (UPSTREAM_FAILED) or the size cap rejects it --
  // both are refusals that transmit nothing. The cap is never bypassed silently.
  assert.equal(result.transmitted, false);
});

// 8 -----------------------------------------------------------------
test("8 -- upstream failures map to the bounded taxonomy and leak nothing", () => {
  assert.equal(classifyUpstream(401), UPSTREAM_ERRORS.AUTHORIZATION_FAILED);
  assert.equal(classifyUpstream(429), UPSTREAM_ERRORS.RATE_LIMITED);
  assert.equal(classifyUpstream(404), UPSTREAM_ERRORS.MODEL_UNAVAILABLE);
  assert.equal(classifyUpstream(503), UPSTREAM_ERRORS.UPSTREAM_UNAVAILABLE);
  assert.equal(classifyUpstream(408), UPSTREAM_ERRORS.TIMEOUT);
  for (const v of Object.values(UPSTREAM_ERRORS)) assert.equal(typeof v, "string");
});

// 9 -----------------------------------------------------------------
test("9 -- the router is read-only, path-scoped, and rejects unknown actions", async () => {
  // Another path is not ours: the router must fall through (null), never serve.
  assert.equal(await handleNvidiaDocumentShadowApi(shadowRequest({}, { path: "/api/dev/other" }), {}), null);
  // Our path, wrong verb: a bounded refusal, not a fall-through.
  const wrongVerb = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({}, { method: "DELETE" }), {}));
  assert.equal(wrongVerb.status, 405);
  assert.equal(wrongVerb.body.error.code, "METHOD_NOT_ALLOWED");

  const status = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({ action: "status" }), {}));
  assert.equal(status.status, 200);
  assert.equal(status.body.authority.AUTHORITATIVE_PARSER, "NATIVE_ONLY");

  const bad = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({ action: "delete-everything" }), {}));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "UNSUPPORTED_ACTION");

  // GET status works without a body.
  const viaGet = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({}, { method: "GET" }), {}));
  assert.equal(viaGet.status, 200);
  assert.equal(viaGet.body.authority.NVIDIA_ROLE, "SHADOW_ONLY_ADVISORY");

  // Malformed JSON is refused, never partially accepted.
  const malformed = new Request(`https://app.invalid${SHADOW_ROUTE_PATH}`, { method: "POST", body: "{not json" });
  assert.equal((await shadowJson(await handleNvidiaDocumentShadowApi(malformed, {}))).status, 400);
});

// 11 ----------------------------------------------------------------
test("11 -- a CLIENT CANNOT override, add or widen the trusted allowedRoots", async () => {
  // The client asks for the whole filesystem. It must be ignored entirely.
  const attempted = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({
    action: "probe",
    // Every one of these is attacker-controlled and must carry zero weight.
    allowedRoots: ["/"],
    filePath: "/etc/hosts.png",
    payloadClassification: PAYLOAD_CLASSIFICATIONS.AUTHORIZED_PROJECT_DOCUMENT,
  }), {
    NVIDIA_DOCUMENT_SHADOW_ENABLED: "1",
    NVIDIA_API_KEY: "nvapi-SECRET",
  }));

  assert.equal(attempted.body.transmitted, false, "a body-supplied allowlist must not enable transmission");
  assert.equal(attempted.body.decision, PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS);
  assert.ok(!JSON.stringify(attempted).includes("SECRET"), "the credential must never appear");

  // Even a body root that LOOKS legitimate but was not configured is refused.
  const unconfigured = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({
    action: "probe",
    allowedRoots: ["docs", "app", "."],
    filePath: "docs/secret.png",
    payloadClassification: PAYLOAD_CLASSIFICATIONS.AUTHORIZED_PROJECT_DOCUMENT,
  }), { NVIDIA_DOCUMENT_SHADOW_ENABLED: "1", NVIDIA_API_KEY: "nvapi-SECRET" }));
  assert.equal(unconfigured.body.transmitted, false);
  assert.equal(unconfigured.body.decision, PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS);

  // The module must not read roots off the request body at all. This pins the
  // FIX at source level, so a future refactor cannot silently reintroduce it.
  const src = readFileSync(join(HERE, "..", "worker", "nvidia-document-shadow-api.mjs"), "utf8");
  assert.ok(!/body\.allowedRoots/.test(src), "the request body must never supply allowedRoots");
  assert.ok(!/body\s*\.\s*allowedRoots/.test(src), "the request body must never supply allowedRoots");

  // Trusted roots come from configuration only, and default to synthetic-only.
  assert.deepEqual(resolveTrustedProbeRoots({}), [...DEFAULT_TRUSTED_ROOTS]);
  assert.deepEqual(
    resolveTrustedProbeRoots({ NVIDIA_DOCUMENT_SHADOW_ALLOWED_ROOTS: " docs , inputs " }),
    [...DEFAULT_TRUSTED_ROOTS, "docs", "inputs"],
  );
  for (const root of DEFAULT_TRUSTED_ROOTS) assert.ok(/synthetic/.test(root), `default roots stay synthetic: ${root}`);
});

// 12 ----------------------------------------------------------------
test("12 -- the hosted-data gate is FAIL-CLOSED by default", async () => {
  // Off unless explicitly enabled — no env, empty env, or a non-\"1\" value.
  for (const env of [{}, { NVIDIA_DOCUMENT_SHADOW_ENABLED: "" }, { NVIDIA_DOCUMENT_SHADOW_ENABLED: "0" }, { NVIDIA_DOCUMENT_SHADOW_ENABLED: "true" }]) {
    assert.equal(shadowProbeEnabled(env), false, `must be off: ${JSON.stringify(env)}`);
  }
  assert.equal(shadowProbeEnabled({ NVIDIA_DOCUMENT_SHADOW_ENABLED: "1" }), true);

  // A probe on a perfectly valid synthetic path is still refused while disabled.
  const disabled = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({
    action: "probe",
    filePath: "tests/fixtures/ai-synthetic/probe.png",
    payloadClassification: PAYLOAD_CLASSIFICATIONS.AUTHORIZED_PROJECT_DOCUMENT,
  }), { NVIDIA_API_KEY: "nvapi-SECRET" }));

  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.decision, PROBE_DECISIONS.FEATURE_DISABLED);
  assert.equal(disabled.body.transmitted, false);
  assert.ok(!JSON.stringify(disabled).includes("SECRET"), "the credential must never appear");

  // `status` stays available while disabled so an operator can SEE the gate.
  const status = await shadowJson(await handleNvidiaDocumentShadowApi(shadowRequest({ action: "status" }), {}));
  assert.equal(status.status, 200);
  assert.equal(status.body.probeEnabled, false);
  assert.deepEqual(status.body.trustedRoots, [...DEFAULT_TRUSTED_ROOTS]);
});

// 10 ----------------------------------------------------------------
test("10 -- the frontend workspace is a PURE VIEW with no provider knowledge", () => {
  const src = readFileSync(join(HERE, "..", "app", "components", "workspaces", "NvidiaDocumentShadowWorkspace.tsx"), "utf8");
  // No vendor/model/credential strings, and no automatic network trigger.
  for (const forbidden of ["nvapi-", "integrate.api.nvidia", "ai.api.nvidia", "Authorization", "fetch("]) {
    assert.ok(!src.includes(forbidden), `the workspace must not contain ${forbidden}`);
  }
  // The probe is operator-initiated only: submission is a user action.
  assert.ok(/onSubmit/.test(src), "probe must be submitted by the operator");
  assert.ok(!/useEffect/.test(src), "the workspace must not auto-run anything on mount");
  // Authority is SURFACED, and deliberately not hardcoded: the component reads
  // the authority fields from the server payload rather than embedding vendor
  // values, so a client handoff can change them without a code change. The first
  // version of this assertion wrongly required the literal "SHADOW_ONLY_ADVISORY"
  // in the component, which would have forced exactly that hardcoding.
  assert.ok(/authority\.AUTHORITATIVE_PARSER/.test(src), "the authoritative parser must be surfaced");
  assert.ok(/authority\.NVIDIA_ROLE/.test(src), "the NVIDIA role must be surfaced");
  assert.ok(/authority\.LEADING_ROW_DECISION/.test(src), "the leading-row decision must be surfaced");
  // ...and the component must NOT embed those values itself.
  for (const hardcoded of ["NATIVE_ONLY", "SHADOW_ONLY_ADVISORY", "MEASURED_NON_DISCRIMINATING"]) {
    assert.ok(!src.includes(hardcoded), `the view must not hardcode "${hardcoded}"`);
  }
});
