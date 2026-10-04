// BOQ BENCHMARK HARNESS -- result classification, output normalization,
// field-level scoring, and resumable checkpointing.
//
// THE PRINCIPLE
// -------------
// A provider that is down has not answered a single question badly. If a timeout
// is scored as "wrong system, wrong family, hallucinated", then tier comparison
// silently measures endpoint reliability and calls it model quality -- and the
// cheaper or luckier tier wins for reasons that have nothing to do with
// understanding. Every outcome is therefore classified into exactly one
// RESULT CLASS first, and semantic quality is computed ONLY from MODEL_RESULT.
//
// FAIL CLOSED
// -----------
// A malformed or semantically foreign answer is never repaired from prose and
// never partially credited. The system does not guess what a model meant; in a
// governed pricing workflow an inferred attribute is indistinguishable from a
// stated one once it leaves the process.
import { createHash } from "node:crypto";

import { COMPARED_FIELDS } from "./boq-understanding-corpus.mjs";
import {
  CANONICAL_RESPONSE_SCHEMA,
  FINGERPRINT_SHA,
  validateCanonicalPrediction,
} from "./boq-benchmark-contract.mjs";
import { isUnknown } from "./boq-safety-predicates.mjs";

export const RESULT_CLASSES = Object.freeze({
  MODEL_RESULT: "MODEL_RESULT",
  TIMEOUT: "TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  UPSTREAM_UNSTABLE: "UPSTREAM_UNSTABLE",
  MALFORMED_OUTPUT: "MALFORMED_OUTPUT",
  SCHEMA_INVALID: "SCHEMA_INVALID",
  FOREIGN_RESPONSE: "FOREIGN_RESPONSE",
});

/** Only MODEL_RESULT may contribute to any semantic or safety metric. */
export const SEMANTIC_CLASSES = Object.freeze([RESULT_CLASSES.MODEL_RESULT]);

const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

// ─────────────────────────────────────────────────────────────────────────────
// Transport -> result class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a transport outcome. Deliberately conservative: an unrecognised
 * status is UNSTABLE, never silently a MODEL_RESULT.
 */
export function classifyTransport({ status = null, timedOut = false, networkError = null } = {}) {
  if (timedOut) return RESULT_CLASSES.TIMEOUT;
  if (networkError) return RESULT_CLASSES.UPSTREAM_UNSTABLE;
  if (status === 429) return RESULT_CLASSES.RATE_LIMITED;
  if (status === 408) return RESULT_CLASSES.TIMEOUT;
  // 5xx from a hosted inference endpoint is the provider's problem, never ours
  // and never the model's understanding.
  if (typeof status === "number" && status >= 500) return RESULT_CLASSES.UPSTREAM_UNAVAILABLE;
  if (typeof status === "number" && status >= 400) return RESULT_CLASSES.MALFORMED_OUTPUT;
  if (status === null) return RESULT_CLASSES.UPSTREAM_UNSTABLE;
  return RESULT_CLASSES.MODEL_RESULT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured output normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic extraction of a JSON object from a raw completion.
 *
 * Accepted, in order, with NO semantic repair at any stage:
 *   1. direct JSON                       -- the content is the object
 *   2. canonical response JSON           -- the provider envelope, unwrapped
 *   3. fenced JSON                       -- ONLY when the fence is unambiguous
 *                                           and the payload validates
 *
 * Explicitly NOT done: pulling a value out of prose or a reasoning trace. A
 * reasoned-but-unstated answer is not a structured answer, and treating it as one
 * would let a model be credited for something it never actually returned.
 */
export function normalizeStructuredOutput(raw) {
  const envelope = (() => {
    if (raw && typeof raw === "object") {
      const content = raw?.choices?.[0]?.message?.content;
      if (typeof content === "string") return content;
      if (raw && typeof raw === "object" && !Array.isArray(raw) && "system" in raw) return raw;
    }
    if (typeof raw === "string") return raw;
    return "";
  })();

  const trimmed = String(envelope ?? "").trim();
  if (!trimmed) {
    return { ok: false, resultClass: RESULT_CLASSES.MALFORMED_OUTPUT, prediction: null, problems: ["empty completion"], extraction: "none" };
  }

  const candidates = [];
  // 1. direct JSON. (The canonical provider envelope was already unwrapped
  // above, so an envelope-wrapped payload arrives here as this candidate.)
  candidates.push({ extraction: "direct", text: trimmed });
  // 3. fenced JSON -- deterministic, single unambiguous fence only.
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fence) candidates.push({ extraction: "fenced", text: fence[1].trim() });

  for (const c of candidates) {
    let obj = null;
    try { obj = JSON.parse(c.text); } catch { continue; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

    // FOREIGN vs MALFORMED vs SCHEMA_INVALID are three different operational
    // facts and must be distinguished BEFORE validation. Validating first would
    // report a semantically foreign answer (a refusal, an echo, another task) as
    // a mere schema violation and lose the operational signal entirely.
    const overlap = Object.keys(obj).filter((k) => k in CANONICAL_RESPONSE_SCHEMA.properties).length;
    if (overlap === 0) {
      return { ok: false, resultClass: RESULT_CLASSES.FOREIGN_RESPONSE, prediction: null, problems: [`response shares no key with the canonical schema (${Object.keys(obj).slice(0, 5).join(", ")})`], extraction: c.extraction };
    }
    const validation = validateCanonicalPrediction(obj);
    return {
      ok: validation.valid,
      resultClass: validation.valid ? RESULT_CLASSES.MODEL_RESULT : RESULT_CLASSES.SCHEMA_INVALID,
      prediction: obj,
      problems: validation.problems,
      extraction: c.extraction,
    };
  }

  // Distinguish "prose refusal" from "broken JSON" for operational reporting.
  const looksProse = /^\s*(i\b|sorry|unfortunately|as an ai|this (document|request))/i.test(trimmed) || !/[{}[\]]/.test(trimmed);
  return {
    ok: false,
    resultClass: looksProse ? RESULT_CLASSES.FOREIGN_RESPONSE : RESULT_CLASSES.MALFORMED_OUTPUT,
    prediction: null,
    problems: [looksProse ? "non-JSON prose response" : "unparseable JSON"],
    extraction: "none",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field-level scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record each field INDEPENDENTLY, then derive the aggregate metrics separately.
 *
 * The previous primary metric was a 9-field all-or-nothing AND, which cannot
 * distinguish "got 90% right" from "got 10% right" and therefore hides exactly the
 * partial lift a tier comparison is trying to detect.
 */
export function scoreFields({ caseSpec, predicted, expectedUnknownHandling = true }) {
  const records = [];
  for (const field of COMPARED_FIELDS) {
    const expected = caseSpec.expected?.[field];
    if (expected === undefined) continue;
    const got = predicted?.[field] ?? null;
    // Same authority as the scorer: a disclosed "UNKNOWN" token is a correct
    // unknown-preservation answer, not a mismatch against a null answer key.
    const gotNorm = isUnknown(got) ? null : String(got).trim().toLowerCase();
    const expNorm = isUnknown(expected) ? null : String(expected).trim().toLowerCase();
    const isUnknownField = expNorm === null;
    records.push({
      field,
      expected: expected ?? null,
      got: got ?? null,
      // An unknown-preservation case is scored on whether the model also stayed
      // unknown, not on string equality with null.
      correct: gotNorm === expNorm,
      kind: isUnknownField ? "UNKNOWN_HANDLING" : "ATTRIBUTE",
    });
  }
  const total = records.length || 1;
  const attributes = records.filter((r) => r.kind === "ATTRIBUTE");
  const unknowns = records.filter((r) => r.kind === "UNKNOWN_HANDLING");
  return Object.freeze({
    records: Object.freeze(records),
    fieldAccuracy: Number((records.filter((r) => r.correct).length / total).toFixed(4)),
    attributeAccuracy: attributes.length ? Number((attributes.filter((r) => r.correct).length / attributes.length).toFixed(4)) : null,
    unknownPreservation: unknowns.length ? Number((unknowns.filter((r) => r.correct).length / unknowns.length).toFixed(4)) : null,
  });
}

/** Aggregate a batch of outcomes, keeping semantic and operational apart. */
export function aggregateOutcomes(outcomes) {
  const total = outcomes.length;
  const byClass = {};
  for (const o of outcomes) byClass[o.resultClass] = (byClass[o.resultClass] || 0) + 1;

  const semantic = outcomes.filter((o) => SEMANTIC_CLASSES.includes(o.resultClass));
  const latencies = outcomes.map((o) => o.latencyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  // Nearest-rank for high percentiles...
  const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : null);
  // ...but a genuine median. Reporting nearest-rank under the name "median" made a
  // 4-sample distribution read 900ms when the true median is 550ms, which would
  // misstate a timeout tail as ordinary latency.
  const median = (() => {
    if (!latencies.length) return null;
    const mid = latencies.length >> 1;
    return latencies.length % 2 ? latencies[mid] : Math.round((latencies[mid - 1] + latencies[mid]) / 2);
  })();

  // Unsupported-inference rate is measured ONLY over real model answers: a
  // fabrication is a statement made, and a provider that never answered has
  // made none.
  const fabricated = semantic.reduce((a, o) => a + (o.fabricatedFieldCount ?? 0), 0);
  const fieldsSeen = semantic.reduce((a, o) => a + (o.fieldsCompared ?? 0), 0);
  const safetyViolations = semantic.reduce((a, o) => a + (o.safetyViolationCount ?? 0), 0);
  const safetyApplicable = semantic.reduce((a, o) => a + (o.safetyPredicatesApplicable ?? 0), 0);

  return Object.freeze({
    total,
    byClass,
    semanticCount: semantic.length,
    // SEMANTIC -- valid model results only
    caseFullyCorrect: semantic.filter((o) => o.caseFullyCorrect).length,
    fieldAccuracy: semantic.length ? Number((semantic.reduce((a, o) => a + (o.fieldAccuracy ?? 0), 0) / semantic.length).toFixed(4)) : null,
    attributeAccuracy: semantic.length ? Number((semantic.reduce((a, o) => a + (o.attributeAccuracy ?? 0), 0) / semantic.length).toFixed(4)) : null,
    unknownPreservation: semantic.length ? Number((semantic.reduce((a, o) => a + (o.unknownPreservation ?? 0), 0) / semantic.length).toFixed(4)) : null,
    safetyAccuracy: safetyApplicable ? Number(((safetyApplicable - safetyViolations) / safetyApplicable).toFixed(4)) : null,
    unsupportedInferenceRate: fieldsSeen ? Number((fabricated / fieldsSeen).toFixed(4)) : null,
    // OPERATIONS -- all attempts, regardless of class
    completionRate: total ? Number(((byClass[RESULT_CLASSES.MODEL_RESULT] || 0) / total).toFixed(4)) : 0,
    schemaValidRate: total ? Number(((byClass[RESULT_CLASSES.MODEL_RESULT] || 0) / total).toFixed(4)) : 0,
    foreignResponseRate: total ? Number(((byClass[RESULT_CLASSES.FOREIGN_RESPONSE] || 0) / total).toFixed(4)) : 0,
    timeoutRate: total ? Number(((byClass[RESULT_CLASSES.TIMEOUT] || 0) / total).toFixed(4)) : 0,
    medianLatencyMs: median,
    p90LatencyMs: pct(0.9),
    maxLatencyMs: latencies.length ? latencies[latencies.length - 1] : null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumable checkpointing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Benchmark identity. Two runs may share results ONLY if every one of these
 * matches. Changing the corpus, the scorer, a predicate, the prompt or the
 * provider config must invalidate prior results rather than blend with them.
 */
export function benchmarkIdentity({ provider, model, providerConfigFingerprint = null, caseIds }) {
  const identity = {
    contractSha: FINGERPRINT_SHA,
    provider: String(provider ?? ""),
    model: String(model ?? ""),
    providerConfigSha: sha(providerConfigFingerprint ?? ""),
    caseSha: sha([...(caseIds ?? [])].join(",")),
  };
  return Object.freeze({ ...identity, id: sha(identity) });
}

/** In-memory checkpoint store; a file-backed one writes after every case. */
export function createCheckpointStore(initial = {}) {
  const state = { __id: initial?.identityId ?? null, ...(initial?.results ?? {}) };
  return {
    get identityId() { return state.__id; },
    /** Adopt a checkpoint only when its identity matches exactly. */
    adopt(checkpoint) {
      if (!checkpoint || typeof checkpoint !== "object") return { adopted: false, reason: "no checkpoint" };
      if (!state.__id) return { adopted: false, reason: "store has no identity to match against" };
      if (checkpoint.identityId !== state.__id) return { adopted: false, reason: "identity mismatch" };
      const before = Object.keys(state).length - 1;
      for (const [k, v] of Object.entries(checkpoint.results ?? {})) state[k] = v;
      return { adopted: true, reused: Object.keys(state).length - 1 - before };
    },
    has: (key) => Object.prototype.hasOwnProperty.call(state, key),
    get: (key) => state[key],
    set: (key, value) => { state[key] = value; },
    keys: () => Object.keys(state).filter((k) => k !== "__id"),
    snapshot: () => ({ identityId: state.__id, results: Object.fromEntries(Object.entries(state).filter(([k]) => k !== "__id")) }),
  };
}

export { FINGERPRINT_SHA };
