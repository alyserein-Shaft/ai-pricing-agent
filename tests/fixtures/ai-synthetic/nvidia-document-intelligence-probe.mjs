#!/usr/bin/env node
// NVIDIA DOCUMENT-INTELLIGENCE / MODEL-LADDER PROBE (TEST-ONLY ORCHESTRATION).
//
// WHAT THIS IS
// ------------
// A benchmark harness for the NVIDIA hosted candidates. It performs NO network
// call unless a credential is actually present, and even then it refuses to
// transmit anything the privacy guard does not explicitly permit.
//
// §11 OF THE TASK: when NVIDIA_API_KEY is absent this must NOT fabricate
// results. It reports LIVE_NVIDIA_BENCHMARK_BLOCKED_BY_CONFIGURATION, and the
// caller continues with native baseline and mocked tests only.
//
// CREDENTIAL HANDLING: the key is read from the environment to answer exactly
// one question -- is it present, and how long is it. It is never printed,
// logged, returned, persisted, or placed in any error message. Every record
// this module produces carries credentialPresent: true/false and nothing else.
import { guardSyntheticInputPath, GUARD_DECISIONS } from "./synthetic-privacy-guard.mjs";
import { NVIDIA_HOSTED_REFERENCE } from "../../../app/domain/ai-provider-escalation-policy.mjs";

export const BLOCKED = "LIVE_NVIDIA_BENCHMARK_BLOCKED_BY_CONFIGURATION";

/** The document-intelligence candidates this pass may evaluate. */
export const NVIDIA_DOCUMENT_CANDIDATES = Object.freeze([
  Object.freeze({ id: "nvidia/nemotron-parse-2.0", capability: "DOCUMENT_PARSE", host: "ai.api.nvidia.com", path: "/v1/cv/nvidia/nemotron-parse-2.0", class: "HOSTED_API", requiresImage: true }),
  Object.freeze({ id: "nvidia/nemotron-page-elements-v3", capability: "PAGE_ELEMENTS", host: "ai.api.nvidia.com", path: "/v1/cv/nvidia/nemotron-page-elements-v3", class: "HOSTED_API", requiresImage: true }),
  Object.freeze({ id: "nvidia/nemotron-table-structure-v1", capability: "TABLE_STRUCTURE", host: "ai.api.nvidia.com", path: "/v1/cv/nvidia/nemotron-table-structure-v1", class: "HOSTED_API", requiresImage: true }),
  Object.freeze({ id: "nvidia/nemotron-ocr-v2", capability: "OCR", host: "ai.api.nvidia.com", path: "/v1/cv/nvidia/nemotron-ocr-v2", class: "HOSTED_API", requiresImage: true }),
]);

/** Model-ladder tiers, resolved from the project's verified reference. */
export const LADDER_TIERS = Object.freeze([
  Object.freeze({ tier: "LIGHTNING", model: NVIDIA_HOSTED_REFERENCE.verifiedModelIds.LIGHTNING, class: "HOSTED_API" }),
  Object.freeze({ tier: "SUPER", model: NVIDIA_HOSTED_REFERENCE.verifiedModelIds.SUPER, class: "HOSTED_API" }),
  Object.freeze({ tier: "ULTRA", model: NVIDIA_HOSTED_REFERENCE.verifiedModelIds.ULTRA, class: "HOSTED_API" }),
]);

/** Bounded internal error taxonomy (§27). Raw provider payloads never escape. */
export const ERROR_TAXONOMY = Object.freeze({
  AUTHORIZATION_FAILED: "AUTHORIZATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  MALFORMED_OUTPUT: "MALFORMED_OUTPUT",
  SCHEMA_INVALID: "SCHEMA_INVALID",
});

/** Map an HTTP status / thrown error onto a bounded internal class. */
export function classifyProviderFailure(statusOrError) {
  const status = Number.isInteger(statusOrError) ? statusOrError : Number(statusOrError?.status ?? NaN);
  if (status === 401 || status === 403) return ERROR_TAXONOMY.AUTHORIZATION_FAILED;
  if (status === 402) return ERROR_TAXONOMY.RATE_LIMITED;
  if (status === 429) return ERROR_TAXONOMY.RATE_LIMITED;
  if (status === 404) return ERROR_TAXONOMY.MODEL_UNAVAILABLE;
  if (status === 400 || status === 422) return ERROR_TAXONOMY.INVALID_REQUEST;
  if (status === 408 || status === 504) return ERROR_TAXONOMY.TIMEOUT;
  if (Number.isFinite(status) && status >= 500) return ERROR_TAXONOMY.UPSTREAM_UNAVAILABLE;
  const name = String(statusOrError?.name ?? "");
  if (/abort|timeout/i.test(name)) return ERROR_TAXONOMY.TIMEOUT;
  if (/fetch|network|econn/i.test(name)) return ERROR_TAXONOMY.UPSTREAM_UNAVAILABLE;
  if (Number.isFinite(status)) return ERROR_TAXONOMY.INVALID_REQUEST;
  return ERROR_TAXONOMY.UPSTREAM_UNAVAILABLE;
}

/**
 * Existence check for a build.nvidia.com model page.
 *
 * CRITICAL, AND PROVEN BY NEGATIVE CONTROL: build.nvidia.com returns HTTP 200
 * for EVERY path, including slugs that do not exist. A naive status check would
 * "verify" a dead model. The sound discriminator observed on 2026-10-01 is:
 *   real model page  ~300-345 KB and embeds chat/completions templates
 *   soft-404 shell   ~86 KB, no templates
 * so a body-size floor plus a template marker is used, never the status alone.
 */
export const REAL_PAGE_MIN_BYTES = 150_000;
export const REAL_PAGE_TEMPLATE_MARKER = "chat/completions";

export function classifyModelPage({ status, bodyBytes, hasTemplate }) {
  if (status === 404 || status === 410) return "ABSENT_CONFIRMED";
  if (Number.isFinite(bodyBytes) && bodyBytes >= REAL_PAGE_MIN_BYTES && hasTemplate) return "PRESENT";
  if (Number.isFinite(bodyBytes) && bodyBytes < REAL_PAGE_MIN_BYTES) return "SOFT_404_SHELL";
  return "INDETERMINATE";
}

/**
 * Build the complete, honest probe record.
 *
 * @param {object} options
 * @param {Record<string,string>} [options.env]  defaults to process.env
 * @param {boolean} [options.allowNetwork] when false, never probes
 */
export function probeNvidiaAvailability({ env = process.env, allowNetwork = true } = {}) {
  // Presence only. The value is never read into any output.
  const key = typeof env?.NVIDIA_API_KEY === "string" ? env.NVIDIA_API_KEY : "";
  const credentialPresent = key.length > 0;
  const liveEligible = credentialPresent && allowNetwork;

  return Object.freeze({
    status: liveEligible ? "LIVE_PROBE_ELIGIBLE" : BLOCKED,
    liveBenchmarkPossible: liveEligible,
    credentialPresent,
    // The key length is operational metadata only and is deliberately omitted
    // from every record to keep the key's shape out of logs and evidence files.
    allowNetwork,
    documentCandidates: Object.freeze(NVIDIA_DOCUMENT_CANDIDATES.map((c) => Object.freeze({ ...c }))),
    ladderTiers: Object.freeze(LADDER_TIERS.map((t) => Object.freeze({ ...t }))),
    // The unversioned OCR slug is recorded as a known dead link so the harness
    // does not re-attempt it on every run.
    knownSoft404Slugs: NVIDIA_HOSTED_REFERENCE.soft404Slugs,
    nextAction: liveEligible
      ? "Run the synthetic document and understanding benchmarks against the hosted endpoints."
      : "Set NVIDIA_API_KEY (server-side only) to enable live benchmarking, or continue with native baseline and mocked tests.",
  });
}

/**
 * Guard a benchmark manifest before any transmission is attempted.
 * Returns the refusal list; an empty list means every path is permitted.
 */
export function authoriseTransmission(paths, options = {}) {
  const results = (Array.isArray(paths) ? paths : []).map((p) => guardSyntheticInputPath(p, options));
  return Object.freeze({
    authorised: results.every((r) => r.decision === GUARD_DECISIONS.ALLOW_SYNTHETIC),
    refusals: Object.freeze(results.filter((r) => !r.allowed).map((r) => Object.freeze({ path: r.normalizedPath, decision: r.decision, reason: r.reason, matchedFragment: r.matchedFragment }))),
  });
}

// --- CLI -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const probe = probeNvidiaAvailability();
  console.log("NVIDIA PROBE");
  console.log("  status:", probe.status);
  console.log("  credentialPresent:", probe.credentialPresent);
  console.log("  liveBenchmarkPossible:", probe.liveBenchmarkPossible);
  console.log("  nextAction:", probe.nextAction);
  console.log("\n  document candidates:");
  for (const c of probe.documentCandidates) console.log(`    ${c.id}  [${c.class}]  ${c.capability}`);
  console.log("\n  ladder tiers:");
  for (const t of probe.ladderTiers) console.log(`    ${t.tier.padEnd(9)} ${t.model}  [${t.class}]`);
  console.log("\n  known soft-404 slugs:", probe.knownSoft404Slugs.join(", "));
  console.log("\n  error taxonomy:", Object.values(ERROR_TAXONOMY).join(", "));
}
