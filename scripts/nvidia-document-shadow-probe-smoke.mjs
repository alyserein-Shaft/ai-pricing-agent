#!/usr/bin/env node
// NVIDIA DOCUMENT SHADOW — ROUTED RUNTIME PROBE (synthetic only).
//
// WHAT THIS PROVES
// ----------------
// That the newly registered route reaches the shadow handler end-to-end and that
// the hosted-data gate and the trusted-root allowlist are enforced AT THE ROUTE,
// not merely in the unit tests.
//
// WHAT IT DELIBERATELY NEVER DOES
// -------------------------------
// * It never sends a real project document. `allowNetwork` defaults to FALSE, so
//   the default run transmits ZERO bytes to NVIDIA and requires no credential.
// * It never prints a credential. Only presence-as-boolean is ever reported.
// * It never writes. The handler takes no DB binding.
//
// The synthetic fixture is generated in-memory under the already-trusted
// `tests/fixtures/ai-synthetic` root, so the file on disk is not a real document.
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  handleNvidiaDocumentShadowApi, SHADOW_ROUTE_PATH, PROBE_DECISIONS,
} from "../worker/nvidia-document-shadow-api.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SYNTHETIC_ROOT = "tests/fixtures/ai-synthetic";
const FIXTURE = `${SYNTHETIC_ROOT}/runtime-probe-smoke.png`;

// Tiny valid PNG, authored here. Not project data.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const call = async (payload, env, method = "POST") => {
  const response = await handleNvidiaDocumentShadowApi(
    new Request(`https://app.invalid${SHADOW_ROUTE_PATH}`, {
      method,
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
    }),
    env,
    { repoRoot: REPO },
  );
  return { status: response.status, body: await response.json() };
};

const checks = [];
const check = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

await mkdir(join(REPO, SYNTHETIC_ROOT), { recursive: true });
await (await import("node:fs/promises")).writeFile(join(REPO, FIXTURE), PNG_1x1);

try {
  // 1 -- route reachability -----------------------------------------------------
  const status = await call({ action: "status" }, {}, "GET");
  check("route is reachable and answers status", status.status === 200 && status.body.authority?.AUTHORITATIVE_PARSER === "NATIVE_ONLY");
  check("status reports the gate as CLOSED by default", status.body.probeEnabled === false);
  check("status discloses no credential material", !/nvapi-/.test(JSON.stringify(status.body)));

  // 2 -- hosted-data gate, at the route ----------------------------------------
  const gated = await call(
    { action: "probe", filePath: FIXTURE, payloadClassification: "AUTHORIZED_PROJECT_DOCUMENT" },
    { NVIDIA_API_KEY: "nvapi-SMOKE-SECRET-NOT-REAL" },
  );
  check("probe is refused while the gate is disabled", gated.status === 403 && gated.body.decision === PROBE_DECISIONS.FEATURE_DISABLED);
  check("a gated refusal transmits nothing", gated.body.transmitted === false);
  check("a gated refusal leaks no credential", !/nvapi-/.test(JSON.stringify(gated.body)));

  // 3 -- client cannot widen the allowlist, even with the gate ON ---------------
  const widened = await call(
    {
      action: "probe",
      filePath: "docs/private.png",
      allowedRoots: ["/"],
      payloadClassification: "AUTHORIZED_PROJECT_DOCUMENT",
    },
    { NVIDIA_DOCUMENT_SHADOW_ENABLED: "1", NVIDIA_API_KEY: "nvapi-SMOKE-SECRET-NOT-REAL" },
  );
  check("body-supplied allowedRoots:['/'] is ignored", widened.body.transmitted === false);
  check("an outside path is refused by the trusted roots", widened.body.decision === PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS);
  check("the refusal leaks no credential", !/nvapi-/.test(JSON.stringify(widened.body)));

  // 4 -- gate ON + trusted synthetic root: reaches the read, still no network ---
  // No NVIDIA_API_KEY is supplied, so this resolves to NO_CREDENTIAL AFTER the
  // path is accepted. That proves the allowlist admitted the file without
  // transmitting a single byte.
  const permitted = await call(
    { action: "probe", filePath: FIXTURE, payloadClassification: "AUTHORIZED_PROJECT_DOCUMENT" },
    { NVIDIA_DOCUMENT_SHADOW_ENABLED: "1" },
  );
  check(
    "trusted synthetic root is admitted, then refused for lack of credential",
    permitted.body.transmitted === false && permitted.body.decision === PROBE_DECISIONS.NO_CREDENTIAL,
    `decision=${permitted.body.decision}`,
  );

  // 5 -- restricted payload still refused even inside a trusted root -----------
  const restricted = await call(
    { action: "probe", filePath: FIXTURE, payloadClassification: "RESTRICTED_PII" },
    { NVIDIA_DOCUMENT_SHADOW_ENABLED: "1", NVIDIA_API_KEY: "nvapi-SMOKE-SECRET-NOT-REAL" },
  );
  check("restricted payload is refused inside a trusted root", restricted.body.transmitted === false && restricted.body.decision === PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD);

  // 6 -- authority is unchanged ------------------------------------------------
  check("authority stays NATIVE_ONLY / advisory", status.body.authority.NVIDIA_ROLE === "SHADOW_ONLY_ADVISORY");
} finally {
  await rm(join(REPO, FIXTURE), { force: true });
}

const failed = checks.filter((c) => !c.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. No document was transmitted.`);
process.exit(failed.length ? 1 : 0);