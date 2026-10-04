#!/usr/bin/env node
// AI-SYNTHETIC TIER RUNNER -- durable, resumable, identity-gated benchmark execution.
//
// WHY THIS FILE EXISTS IN THE REPO
// ---------------------------------
// The previous tier runner and every checkpoint lived under a system temp
// directory and were DELETED, taking with them paid-for measurements that cannot be
// regenerated without re-spending provider calls. The contract, corpus and scorer
// were correctly in the repo; the execution substrate was not. This file is the
// durable substrate: version-controlled code, repo-local state.
//
// IT DOES NOT DUPLICATE BENCHMARK LOGIC
// ------------------------------------
// Prompt construction, schema validation, normalization, result classification,
// field-level scoring, aggregation and benchmark identity ALL come from the
// existing modules. This file only orchestrates: it selects cases, issues
// requests, classifies transport outcomes and persists state. A benchmark rule
// changed in one place cannot drift from what this runner measures.
//
// CREDENTIAL HANDLING
// -------------------
// `NVIDIA_API_KEY` from the environment, and nothing else. There is deliberately
// NO credential-file support: the previous runner read a mode-600 file from a temp
// directory, which is precisely what made the loss unrecoverable. A missing key
// fails immediately, before any network call, with a configuration error.
//
// No key material is ever written to disk, logged, or returned. Progress records
// carry only safe metadata (case id, tier, model, attempt, timestamps, latency,
// result class) and a scrub assertion runs over every persisted artifact.
//
// IDENTITY GATING
// ---------------
// A checkpoint is adopted only when its identity matches EXACTLY. The identity
// binds: contract/prompt/schema/predicate fingerprint, corpus CONTENT fingerprint,
// scorer source fingerprint, provider, model, model configuration, and the exact
// case list. Any change to what a result MEANS invalidates it. This is strictly
// stronger than the shared helper's `corpusSha` (which hashes case IDs only) -- see
// the note on corpusContentSha below.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const FIXTURES = join(REPO, "tests", "fixtures", "ai-synthetic");

// Durable, repo-local, gitignored state. Never an ephemeral directory.
export const STATE_DIR = join(REPO, "out", "ai-synthetic-bench");

const { BOQ_UNDERSTANDING_CASES } = await import(join(FIXTURES, "boq-understanding-corpus.mjs"));
const {
  buildCanonicalBenchmarkPrompt,
  deriveForScoring,
  verifyBenchmarkContract,
  contractFingerprint,
  FINGERPRINT_SHA,
} = await import(join(FIXTURES, "boq-benchmark-contract.mjs"));
const { scoreUnderstandingCase } = await import(join(FIXTURES, "boq-understanding-scorer.mjs"));
const { SAFETY_PREDICATES_BY_CASE } = await import(join(FIXTURES, "boq-safety-predicates-corpus.mjs"));
const H = await import(join(FIXTURES, "boq-benchmark-harness.mjs"));

// ── Model tiers ──────────────────────────────────────────────────────────────
// Kept as data so a batch can be scoped to one tier without touching logic.
export const ALL_TIERS = Object.freeze([
  { tier: "lightning", model: "nvidia/nemotron-3.5-lightning-30b-a3b" },
  { tier: "super", model: "nvidia/nemotron-3-super-120b-a12b" },
  { tier: "ultra", model: "nvidia/nemotron-3-ultra-550b-a55b" },
]);

const DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The checkpoint identity.
 *
 * `corpusContentSha` is ADDITIVE to the shared helper's `caseSha`: that helper
 * hashes only case IDs, so editing a ground-truth value would NOT invalidate a
 * checkpoint. That is a real hole -- the T2c and T2d slices changed expectations,
 * and a checkpoint keyed only on IDs could have been silently reused. Hashing the
 * corpus CONTENT closes it without weakening anything.
 */
export function runnerIdentity({ tier, model, endpoint, temperature, maxTokens, caseIds, cases }) {
  const base = H.benchmarkIdentity({
    provider: "nvidia-integrate",
    model,
    providerConfigFingerprint: { endpoint, temperature, maxTokens, mode: "chat-completions" },
    caseIds,
  });
  const identity = {
    ...base,
    tier,
    // Content fingerprints that the ID-only caseSha cannot see.
    corpusContentSha: sha(cases.map((c) => ({ id: c.caseId, expected: c.expected, mustRemainUnknown: c.mustRemainUnknown }))),
    scorerSha: sha(readFileSync(join(FIXTURES, "boq-understanding-scorer.mjs"), "utf8")),
    predicatesSha: sha(readFileSync(join(FIXTURES, "boq-safety-predicates-corpus.mjs"), "utf8")),
    contractDetailSha: sha(contractFingerprint()),
  };
  return Object.freeze({ ...identity, id: sha(identity) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Durable persistence: atomic write + secret scrub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refuse to persist anything carrying key material.
 *
 * The previous harness already scrubbed artifacts; this repeats the assertion
 * because the loss of the temp directory means artifacts can no longer be
 * assumed disposable, and a durable artifact is far more likely to be read,
 * diffed or committed by someone.
 */
export function assertNoSecretMaterial(serialized) {
  const key = process.env.NVIDIA_API_KEY;
  if (key && key.length >= 8 && serialized.includes(key)) {
    throw new Error("SECRET_LEAK_BLOCKED: NVIDIA_API_KEY would be written to a durable artifact");
  }
  if (/"authorization"\s*:\s*"[^"]+"/i.test(serialized)) {
    throw new Error("SECRET_LEAK_BLOCKED: an Authorization header would be written to a durable artifact");
  }
  return true;
}

/** Atomic write: temp file in the SAME directory, then rename. */
export function writeAtomic(path, contents) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

export function writeJsonDurable(path, value) {
  const serialized = JSON.stringify(value);
  assertNoSecretMaterial(serialized);
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, serialized);
}

/** Append one progress record. Safe metadata only -- never a payload or a header. */
export function appendProgress(path, record) {
  const safe = {
    caseId: record.caseId,
    tier: record.tier,
    model: record.model,
    attempt: record.attempt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    latencyMs: record.latencyMs,
    resultClass: record.resultClass,
    ...(record.status !== undefined ? { status: record.status } : {}),
  };
  const line = JSON.stringify(safe);
  assertNoSecretMaterial(line);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${line}\n`);
}

export function readCheckpoint(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A corrupt checkpoint is ignored, never partially adopted: blending half a
    // file would be worse than re-running.
    return null;
  }
}

/**
 * Decide whether a checkpoint may be resumed. Exact identity match only.
 * @returns {{resume:boolean, reason:string, reused:string[]}}
 */
export function planResume(checkpoint, identity, pendingCaseIds) {
  if (!checkpoint) return { resume: false, reason: "no checkpoint", reused: [] };
  if (checkpoint.identityId !== identity.id) {
    const differing = Object.keys(identity)
      .filter((k) => k !== "id" && checkpoint.identity?.[k] !== identity[k])
      .slice(0, 6);
    return { resume: false, reason: `identity mismatch (${differing.join(", ") || "unknown"})`, reused: [] };
  }
  const completed = Object.keys(checkpoint.results ?? {});
  // Never re-schedule a completed case, and only adopt results for cases still in
  // scope -- a narrowed batch must not inherit a wider run's results.
  const reused = completed.filter((id) => pendingCaseIds.includes(id));
  return { resume: true, reason: "identity matched", reused };
}

// ─────────────────────────────────────────────────────────────────────────────
// Case selection
// ─────────────────────────────────────────────────────────────────────────────

export function selectCases({ caseIds, limit } = {}) {
  if (caseIds?.length) {
    const byId = new Set(caseIds);
    const missing = caseIds.filter((id) => !BOQ_UNDERSTANDING_CASES.some((c) => c.caseId === id));
    if (missing.length) throw new Error(`BENCH_CASE_IDS not in corpus: ${missing.join(", ")}`);
    // Corpus order, not request order, so two batches naming the same set produce
    // the same identity.
    return BOQ_UNDERSTANDING_CASES.filter((c) => byId.has(c.caseId));
  }
  return BOQ_UNDERSTANDING_CASES.slice(0, limit ?? BOQ_UNDERSTANDING_CASES.length);
}

export function selectTiers(tierNames) {
  if (!tierNames?.length) return [...ALL_TIERS];
  const wanted = new Set(tierNames);
  const chosen = ALL_TIERS.filter((t) => wanted.has(t.tier));
  const unmatched = [...wanted].filter((t) => !ALL_TIERS.some((x) => x.tier === t));
  if (unmatched.length) throw new Error(`unknown tier(s): ${unmatched.join(", ")}`);
  if (!chosen.length) throw new Error("no tiers selected");
  return chosen;
}

// ─────────────────────────────────────────────────────────────────────────────
// One request
// ─────────────────────────────────────────────────────────────────────────────

export function makeRequestBody({ model, prompt, temperature, maxTokens }) {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    stream: false,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    // MEASURED (2026-10-02): without this, Nemotron emits a visible reasoning
    // preamble and exhausts max_tokens mid-thought (finish_reason="length"), so no
    // JSON ever arrives. This is the same governed flag the production provider
    // already sets, applied identically to every tier so the comparison stays
    // like-for-like.
    chat_template_kwargs: { enable_thinking: false },
  };
}

/**
 * Issue one request and classify it. Never throws; always returns a classified
 * outcome so a transport failure is never mistaken for a model answer.
 */
export async function runCase({ spec, caseSpec, endpoint, apiKey, temperature, maxTokens, timeoutMs, retries, progressPath, fetchImpl }) {
  const body = makeRequestBody({ model: spec.model, prompt: buildCanonicalBenchmarkPrompt(caseSpec), temperature, maxTokens });
  const doFetch = fetchImpl ?? fetch;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let status = null, raw = null, networkError = null, timedOut = false;
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      status = res.status;
      const text = await res.text();
      try { raw = JSON.parse(text); } catch { raw = { __unparseable: text.slice(0, 400) }; }
    } catch (error) {
      timedOut = error?.name === "AbortError" || ac.signal.aborted;
      networkError = timedOut ? null : String(error?.name || "NetworkError");
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - t0;
    const completedAt = new Date().toISOString();

    const transportClass = H.classifyTransport({ status, timedOut, networkError });
    if (transportClass !== H.RESULT_CLASSES.MODEL_RESULT) {
      if (progressPath) appendProgress(progressPath, { tier: spec.tier, model: spec.model, caseId: caseSpec.caseId, attempt, startedAt, completedAt, latencyMs, resultClass: transportClass, status });
      if (attempt <= retries) continue;
      return { resultClass: transportClass, latencyMs, attempt, status };
    }

    // A 200 can still carry an unusable body; classify the content, never the status.
    const normalized = H.normalizeStructuredOutput(raw);
    if (normalized.resultClass === H.RESULT_CLASSES.MODEL_RESULT) {
      if (progressPath) appendProgress(progressPath, { tier: spec.tier, model: spec.model, caseId: caseSpec.caseId, attempt, startedAt, completedAt, latencyMs, resultClass: "MODEL_RESULT", status });
      return { resultClass: "MODEL_RESULT", latencyMs, attempt, status, prediction: normalized.prediction };
    }
    if (progressPath) appendProgress(progressPath, { tier: spec.tier, model: spec.model, caseId: caseSpec.caseId, attempt, startedAt, completedAt, latencyMs, resultClass: normalized.resultClass, status });
    if (attempt <= retries) continue;
    return { resultClass: normalized.resultClass, latencyMs, attempt, status, problems: normalized.problems };
  }
  return { resultClass: H.RESULT_CLASSES.UPSTREAM_UNSTABLE, latencyMs: null, attempt: retries + 1 };
}

/** Turn one classified outcome into a stored record. Only MODEL_RESULT is scored. */
export function buildRecord({ spec, caseSpec, call }) {
  const base = { resultClass: call.resultClass, caseId: caseSpec.caseId, difficulty: caseSpec.difficulty, tier: spec.tier, latencyMs: call.latencyMs, status: call.status ?? null };
  if (call.resultClass !== H.RESULT_CLASSES.MODEL_RESULT) {
    return { ...base, problems: call.problems ?? null };
  }
  const derived = deriveForScoring(caseSpec, call.prediction);
  const scored = scoreUnderstandingCase({ caseSpec, predicted: derived });
  const fields = H.scoreFields({ caseSpec, predicted: derived });
  const predicates = SAFETY_PREDICATES_BY_CASE[caseSpec.caseId] ?? [];
  return {
    ...base,
    caseFullyCorrect: scored.passed === true,
    fieldAccuracy: fields.fieldAccuracy,
    attributeAccuracy: fields.attributeAccuracy,
    unknownPreservation: fields.unknownPreservation,
    safetyAccuracy: predicates.length ? (scored.unsupportedAssertions.length === 0 ? 1 : 0) : null,
    safetyPredicatesApplicable: predicates.length,
    safetyViolationCount: scored.unsupportedAssertions.length,
    fabricatedFieldCount: scored.fabricatedFields.length,
    fieldsCompared: fields.records.length,
    categoryCorrect: !scored.wrongFields.some((w) => w.field === "category"),
    productFamilyCorrect: !scored.wrongFields.some((w) => w.field === "productFamily"),
    wrongFields: scored.wrongFields,
    fabricatedFields: scored.fabricatedFields,
    violations: scored.unsupportedAssertions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one tier's batch. Checkpoint written after EVERY completed case, so a crash
 * or a kill loses at most the single in-flight call.
 */
export async function runTier({
  spec, cases, endpoint, apiKey, temperature, maxTokens, timeoutMs, retries,
  stateDir = STATE_DIR, fetchImpl, log = () => {},
}) {
  mkdirSync(stateDir, { recursive: true });
  const progressPath = join(stateDir, `progress-${spec.tier}.jsonl`);
  const checkpointPath = join(stateDir, `checkpoint-${spec.tier}.json`);

  const identity = runnerIdentity({
    tier: spec.tier, model: spec.model, endpoint, temperature, maxTokens,
    caseIds: cases.map((c) => c.caseId), cases,
  });

  const existing = readCheckpoint(checkpointPath);
  const plan = planResume(existing, identity, cases.map((c) => c.caseId));
  const results = {};
  for (const id of plan.resume ? plan.reused : []) results[id] = existing.results[id];
  if (existing) {
    log(`${spec.tier}: checkpoint ${plan.resume ? `RESUMED (${plan.reused.length} results)` : `DISCARDED -- ${plan.reason}`}`);
  } else {
    log(`${spec.tier}: no prior checkpoint`);
  }
  log(`${spec.tier}: identity ${identity.id.slice(0, 12)} | ${cases.length} case(s) | ${plan.resume ? `${cases.length - plan.reused.length} to run` : "all to run"}`);

  const persist = () => writeJsonDurable(checkpointPath, {
    identityId: identity.id, identity,
    tier: spec.tier, model: spec.model,
    updatedAt: new Date().toISOString(),
    results,
  });

  for (const caseSpec of cases) {
    if (results[caseSpec.caseId]) { log(`  ${spec.tier} ${caseSpec.caseId} resumed (not re-run)`); continue; }
    const call = await runCase({ spec, caseSpec, endpoint, apiKey, temperature, maxTokens, timeoutMs, retries, progressPath, fetchImpl });
    results[caseSpec.caseId] = buildRecord({ spec, caseSpec, call });
    persist();
    log(`  ${spec.tier} ${caseSpec.caseId} ${results[caseSpec.caseId].resultClass} ${call.latencyMs}ms`);
  }

  const outcomes = cases.map((c) => results[c.caseId]).filter(Boolean);
  const summary = { tier: spec.tier, model: spec.model, identity: identity.id, ...H.aggregateOutcomes(outcomes) };
  writeJsonDurable(join(stateDir, `summary-${spec.tier}.json`), summary);
  return { identity, results, summary, checkpointPath, progressPath };
}

export function runMetadata({ tiers, cases, endpoint, temperature, maxTokens, timeoutMs, retries, contractSha }) {
  return {
    startedAt: new Date().toISOString(),
    contractSha,
    contractFingerprint: contractFingerprint(),
    endpoint,
    modelConfig: { temperature, maxTokens, timeoutMs, retries, enableThinking: false, responseFormat: "json_object" },
    tiers: tiers.map((t) => ({ tier: t.tier, model: t.model })),
    caseIds: cases.map((c) => c.caseId),
    stateDir: STATE_DIR,
    // Presence only. The value is never recorded.
    credentialPresent: Boolean(process.env.NVIDIA_API_KEY),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const arg = (name, fallback = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const tiers = selectTiers(arg("tiers")?.split(",").map((t) => t.trim()).filter(Boolean));
  const cases = selectCases({
    caseIds: arg("cases")?.split(",").map((c) => c.trim()).filter(Boolean),
    limit: Number(arg("limit")) || undefined,
  });
  const endpoint = arg("endpoint", DEFAULT_ENDPOINT);
  const temperature = Number(arg("temperature", "0"));
  const maxTokens = Number(arg("max-tokens", "1200"));
  const timeoutMs = Number(arg("timeout-ms", "60000"));
  const retries = Number(arg("retries", "1"));

  // Credential gate FIRST: fail before any network call, and before writing state.
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error("CONFIGURATION_ERROR: NVIDIA_API_KEY is not set.");
    console.error("  This runner reads the credential from the environment only -- there is no");
    console.error("  credential-file fallback, because a file in an ephemeral directory is what");
    console.error("  made the previous run's measurements unrecoverable when it was deleted.");
    console.error("  Set NVIDIA_API_KEY in the environment and re-run. No provider call was made.");
    process.exit(2);
  }

  let contract;
  try {
    contract = verifyBenchmarkContract();
  } catch (error) {
    console.error(`${error.message}`);
    process.exit(2);
  }
  console.log(`contract verified: ${contract.version} fields=${contract.fields} sha=${FINGERPRINT_SHA.slice(0, 12)}`);

  mkdirSync(STATE_DIR, { recursive: true });
  writeJsonDurable(join(STATE_DIR, "run-metadata.json"), runMetadata({
    tiers, cases, endpoint, temperature, maxTokens, timeoutMs, retries, contractSha: FINGERPRINT_SHA,
  }));

  console.log(`batch: tiers=[${tiers.map((t) => t.tier).join(",")}] cases=${cases.length} [${cases.map((c) => c.caseId).join(",")}]`);
  console.log(`state: ${STATE_DIR}`);

  for (const spec of tiers) {
    const { summary } = await runTier({ spec, cases, endpoint, apiKey, temperature, maxTokens, timeoutMs, retries });
    console.log(`\n${spec.tier.toUpperCase()} ${JSON.stringify(summary)}\n`);
  }
  console.log(`done. state in ${STATE_DIR}`);
}

export { BOQ_UNDERSTANDING_CASES, H };
