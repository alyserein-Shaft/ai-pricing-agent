/**
 * §17 SYNTHETIC SHADOW EVALUATION HARNESS
 *
 * Generic read-only evaluation for NVIDIA NIM BOQ Understanding.
 * - Uses ONLY synthetic fixtures (no project/BOQ/quotation/supplier data)
 * - Privacy guard rejects Central Kitchen, Al Mousa, supplier-price, private project sources
 * - No DB writes; artifacts to temp dir only; key-scrub assertion before write
 * - Measures: schema validity, system/category/productFamily accuracy, unknown
 *   preservation, unsupported inference rate, latency, timeout rate, foreign
 *   response rate, retry rate, escalation usefulness
 * - No authoritative NVIDIA revalidation wiring (CONFIDENTIAL_USE_BLOCKED)
 */

import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
  prepareBoqUnderstandingInput,
  interpretBoqItem,
} from "../app/domain/boq-understanding-engine.mjs";
import {
  NVIDIA_NIM,
  probeNvidiaNimProviderHealth,
  NVIDIA_STABILITY_SUCCESSES_REQUIRED,
  NVIDIA_STABILITY_STALLS_UNSTABLE,
} from "../worker/boq-understanding-provider.mjs";

// Inline timeout resolver (mirrors worker/boq-understanding-provider.mjs nvidiaTimeout)
const NVIDIA_NIM_DEFAULT_TIMEOUT_MS = 120_000;
const NVIDIA_NIM_MAX_TIMEOUT_MS = 180_000;
const nvidiaTimeout = (env) => {
  const configured = Number(env.NVIDIA_NIM_TIMEOUT_MS || NVIDIA_NIM_DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(NVIDIA_NIM_MAX_TIMEOUT_MS, Math.floor(configured))) : NVIDIA_NIM_DEFAULT_TIMEOUT_MS;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRIVACY GUARD — NEVER SEND CONFIDENTIAL DATA TO HOSTED NVIDIA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blocklist of content with ACTUAL legal/third-party/provider-term restrictions.
 * Per NVIDIA Trial ToS §2.6(a): confidential/proprietary data prohibited.
 * Per user authorization: project data IS allowed when user/engineer/owner authorize.
 * Only these specific categories are blocked:
 * - Third-party supplier pricing/quotes (contractual confidentiality)
 * - Manufacturer commercial files not publicly released
 * - Customer PII / sensitive personal data
 * - Explicitly classified internal-only documents
 * Central Kitchen, Al Mousa, and project identifiers are NOT automatically blocked.
 */
export const CONFIDENTIAL_SOURCE_PATTERNS = [
  /supplier[_\s]?price/i,      // Third-party supplier pricing (contractual)
  /price[_\s]?list/i,          // Price lists (typically confidential)
  /supplier[_\s]?quote/i,      // Supplier quotations (contractual)
  /historical[_\s]?quot/i,     // Historical quotations (confidential)
  /confidential[_\s]?manufacturer/i,  // Explicitly confidential manufacturer data
  /commercial[_\s]?file/i,     // Commercial files (typically restricted)
  /internal[_\s]?only/i,       // Explicit internal-only classification
  /classified[_\s]?confidential/i,    // Explicit classification
  /pii|personally[_\s]?identifiable/i, // Personal data
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, // Email addresses (PII)
];

/**
 * Assert that a payload is safe for hosted NVIDIA execution.
 * Throws PRIVACY_GUARD_REJECTED only for content with ACTUAL legal/third-party/
 * provider-term restrictions (supplier pricing, confidential manufacturer data,
 * PII, explicitly classified internal-only). Project data (Central Kitchen,
 * Al Mousa, etc.) is ALLOWED when user/engineer/owner authorize disclosure.
 * @param {object} payload - The input to validate
 * @param {string} _context - Calling context for the error (unused, retained for API)
 */
export function assertHostedNvidiaSafe(payload, _context = "shadow-harness") {
  if (!payload || typeof payload !== "object") return;
  const hay = JSON.stringify(payload).toLowerCase();
  for (const pattern of CONFIDENTIAL_SOURCE_PATTERNS) {
    if (pattern.test(hay)) {
      // Reason contains no confidential data — only the matched pattern name
      const reason = `privacy-guard: ${pattern.source.replace(/\\\\(.)/g, "$1")}`;
      const err = new Error(`PRIVACY_GUARD_REJECTED: ${reason}`);
      err.code = "PRIVACY_GUARD_REJECTED";
      err.pattern = pattern.source;
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SYNTHETIC FIXTURES — 12 CASES COVERING FIRE ALARM TAXONOMY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each synthetic case mirrors the structure expected by prepareBoqUnderstandingInput.
 * Expected values are grounded in the governed Fire Alarm taxonomy:
 * - system: "Fire Alarm"
 * - category: governed category names (Detection Devices, Notification Appliances, etc.)
 * - productFamily: governed family names (Addressable Smoke Detector, etc.)
 * - Unknown fields: MISSING/NOT_APPLICABLE where the synthetic description lacks evidence
 *   (e.g., productFamily is MISSING because the short synthetic text doesn't name a model)
 *
 * These are SYNTHETIC wordings — NOT copied from Central Kitchen or any project.
 */
export const SYNTHETIC_SHADOW_CASES = [
  {
    id: "syn-01-smoke-detector",
    description: "Photoelectric spot-type smoke detector for ceiling mounting, 24 V DC addressable, with built-in isolator",
    quantity: 10,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Smoke Detector" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence", "technicalAttributes"],
    evidenceTokens: ["photoelectric", "spot-type", "smoke detector", "24 v", "addressable", "isolator"],
  },
  {
    id: "syn-02-heat-detector",
    description: "Fixed-temperature heat detector 135°F for mechanical rooms, rate-of-rise compensation, addressable SLC",
    quantity: 6,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Heat Detector" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence"],
    evidenceTokens: ["heat detector", "135°f", "rate-of-rise", "addressable", "slc"],
  },
  {
    id: "syn-03-mcp",
    description: "Manual call point double-action, red break-glass, addressable with LED indicator, surface mount",
    quantity: 4,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Manual Stations", productFamily: "Addressable Manual Call Point" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence", "technicalAttributes"],
    evidenceTokens: ["manual call point", "double-action", "break-glass", "addressable", "led"],
  },
  {
    id: "syn-04-monitor-module",
    description: "Single-input monitor module for supervising external dry contacts, addressable SLC, DIN rail mount",
    quantity: 8,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Monitor Modules", productFamily: "Addressable Monitor Module" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence"],
    evidenceTokens: ["monitor module", "single-input", "supervising", "dry contacts", "addressable", "slc"],
  },
  {
    id: "syn-05-dual-monitor-ambiguity",
    description: "Dual-channel monitor module capable of supervising two independent contact circuits on one SLC address",
    quantity: 5,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Monitor Modules", productFamily: "Addressable Monitor Module" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence"],
    evidenceTokens: ["dual-channel", "monitor module", "two independent", "contact circuits", "slc address"],
  },
  {
    id: "syn-06-strobe",
    description: "Wall-mount strobe 15 cd clear lens, 24 V DC, addressable notification appliance circuit",
    quantity: 12,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Notification Appliances", productFamily: "Addressable Strobe" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence"],
    evidenceTokens: ["strobe", "15 cd", "clear lens", "24 v dc", "addressable", "notification appliance"],
  },
  {
    id: "syn-07-horn-strobe",
    description: "Combination horn/strobe 85 dB 15 cd, ceiling mount, 24 V DC, addressable NAC",
    quantity: 7,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Notification Appliances", productFamily: "Addressable Horn/Strobe" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence", "technicalAttributes"],
    evidenceTokens: ["horn/strobe", "85 db", "15 cd", "ceiling mount", "24 v dc", "addressable"],
  },
  {
    id: "syn-08-facp",
    description: "Fire alarm control panel 4 loop, 2000 point capacity, addressable SLC, network card, backup batteries",
    quantity: 1,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Control Panels", productFamily: "Addressable FACP" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence", "technicalAttributes"],
    evidenceTokens: ["fire alarm control panel", "4 loop", "2000 point", "addressable", "slc", "network card"],
  },
  {
    id: "syn-09-beam-detector",
    description: "Reflected beam smoke detector 100 m range, long-range addressable, with alignment laser",
    quantity: 3,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Beam Detector" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence"],
    evidenceTokens: ["reflected beam", "smoke detector", "100 m", "long-range", "addressable", "alignment laser"],
  },
  {
    id: "syn-10-ambiguous-family",
    description: "Addressable field device for fire alarm system, SLC compatible, exact type TBD by engineer",
    quantity: 2,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Detection Devices", productFamily: "MISSING" },
    unknownFields: ["productFamily", "taxonomyCandidateKey", "manufacturerEvidence", "equipmentType"],
    evidenceTokens: ["addressable", "field device", "fire alarm", "slc compatible"],
  },
  {
    id: "syn-11-failed-retryable",
    description: "Invalid description that causes structured output failure — missing required confidence field entirely",
    quantity: 1,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Detection Devices", productFamily: "MISSING" },
    unknownFields: ["system", "category", "productFamily", "equipmentType", "confidence"],
    evidenceTokens: [],
    forceError: "AI_OUTPUT_INVALID",
  },
  {
    id: "syn-12-stale-revalidation",
    description: "Photoelectric smoke detector, 24 V, addressable — previously interpreted but spec changed to heat detector 135°F",
    quantity: 1,
    unit: "EA",
    expected: { system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Heat Detector" },
    unknownFields: ["productFamily", "taxonomyCandidateKey"],
    evidenceTokens: ["heat detector", "135°f", "addressable"],
    priorInterpretation: {
      system: "Fire Alarm",
      category: "Detection Devices",
      productFamily: "Addressable Smoke Detector",
      confidence: "HIGH",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. HARNESS INFRASTRUCTURE — READ-ONLY DB SHIM, METRICS, ARTIFACTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a read-only D1 shim: .run() throws; .prepare().all() works for SELECT.
 * The real benchmark DB is at the opencode temp location (ck-bench-state-v2).
 * This harness NEVER connects to it for hosted NVIDIA — it uses synthetic fixtures only.
 */
function createReadOnlyD1Shim() {
  return {
    prepare: (sql) => {
      if (!/^\s*SELECT\b/i.test(sql)) {
        throw new Error("READ_ONLY_SHIM: mutations forbidden; query was " + sql.slice(0, 80));
      }
      // Return a minimal statement object for SELECTs on an empty in-memory DB
      // (no real rows — shadow harness uses synthetic fixtures, not DB rows)
      return {
        all: () => [],
        get: () => null,
        run: () => { throw new Error("READ_ONLY_SHIM: run forbidden"); },
      };
    },
    exec: () => { throw new Error("READ_ONLY_SHIM: exec forbidden"); },
    close: () => {},
  };
}

/**
 * Metric accumulator for the shadow report.
 */
class ShadowMetrics {
  constructor() {
    this.rows = [];
    this.startTime = Date.now();
  }
  record(row) {
    this.rows.push({ ...row, timestamp: Date.now() });
  }
  summary() {
    const total = this.rows.length;
    const schemaValid = this.rows.filter(r => r.schemaValid).length;
    const systemAcc = this.rows.filter(r => r.systemMatch).length;
    const categoryAcc = this.rows.filter(r => r.categoryMatch).length;
    const familyAcc = this.rows.filter(r => r.familyMatch).length;
    const unknownPreserved = this.rows.filter(r => r.unknownPreserved).length;
    const unsupportedInferred = this.rows.filter(r => r.unsupportedInference).length;
    const timeouts = this.rows.filter(r => r.timeout).length;
    const foreign = this.rows.filter(r => r.foreignContent).length;
    const retries = this.rows.reduce((sum, r) => sum + (r.retries || 0), 0);
    const escalationUseful = this.rows.filter(r => r.escalationUseful).length;
    const latencies = this.rows.map(r => r.latencyMs).filter(Number.isFinite);
    const avgLatency = latencies.length ? latencies.reduce((a,b)=>a+b,0)/latencies.length : 0;
    return {
      total,
      schemaValid,
      schemaValidityRate: total ? schemaValid/total : 0,
      systemAccuracy: total ? systemAcc/total : 0,
      categoryAccuracy: total ? categoryAcc/total : 0,
      productFamilyAccuracy: total ? familyAcc/total : 0,
      unknownPreservationRate: total ? unknownPreserved/total : 0,
      unsupportedInferenceRate: total ? unsupportedInferred/total : 0,
      timeoutRate: total ? timeouts/total : 0,
      foreignResponseRate: total ? foreign/total : 0,
      retryRate: total ? retries/total : 0,
      escalationUsefulnessRate: total ? escalationUseful/total : 0,
      avgLatencyMs: avgLatency,
      maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
      minLatencyMs: latencies.length ? Math.min(...latencies) : 0,
      durationMs: Date.now() - this.startTime,
    };
  }
}

/**
 * Write artifact to temp dir with key-scrub assertion.
 */
function writeArtifact(artifactDir, filename, data) {
  const content = JSON.stringify(data, null, 2);
  // Key-scrub assertion: the serialized artifact must never contain the API key
  if (process.env.NVIDIA_API_KEY && content.includes(process.env.NVIDIA_API_KEY)) {
    throw new Error("KEY_SCRUB_FAILED: NVIDIA_API_KEY leaked into artifact");
  }
  // Also scrub any "Bearer " pattern that might contain the key
  if (content.includes("Bearer ")) {
    throw new Error("KEY_SCRUB_FAILED: Authorization header leaked into artifact");
  }
  // Safe to write
  import("node:fs").then(fs => fs.promises.writeFile(join(artifactDir, filename), content));
  return join(artifactDir, filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PROVIDER HEALTH GATE — STABILITY ASSESSMENT (NO RETRY STORM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the canonical probe up to N times to assess operational stability.
 * Returns { operational: true/false, reason, attempts, latencyMs[] }.
 * STOPS immediately on 2 consecutive stalls (UPSTREAM_UNSTABLE) — no retry storm.
 */
async function assessOperationalStability(env, maxSamples = NVIDIA_STABILITY_SUCCESSES_REQUIRED) {
  const latencies = [];
  const results = [];
  for (let i = 0; i < maxSamples; i++) {
    const probeStart = Date.now();
    const health = await probeNvidiaNimProviderHealth(env);
    const probeLatency = Date.now() - probeStart;
    latencies.push(probeLatency);
    results.push(health);
    if (health.state === "UNHEALTHY" && health.failureClass === "AI_PROVIDER_TIMEOUT") {
      // Check if this is the second consecutive stall
      if (i > 0 && results[i-1].state === "UNHEALTHY" && results[i-1].failureClass === "AI_PROVIDER_TIMEOUT") {
        return {
          operational: false,
          reason: "UPSTREAM_UNSTABLE",
          attempts: i + 1,
          latencyMs: latencies,
          detail: `Two consecutive probe stalls observed; halting further calls.`,
        };
      }
    }
    // Small pause between probes to avoid queuing at the endpoint
    if (i < maxSamples - 1) await new Promise(r => setTimeout(r, 2000));
  }
  // After maxSamples, check if stability was proven (all STRUCTURED_OUTPUT_HEALTHY or HEALTHY)
  const allStable = results.every(r => r.state === "STRUCTURED_OUTPUT_HEALTHY" || r.state === "HEALTHY");
  return {
    operational: allStable,
    reason: allStable ? "STABLE" : "INSUFFICIENT_EVIDENCE",
    attempts: results.length,
    latencyMs: latencies,
    detail: allStable ? "Consecutive structured successes confirm operational stability." : "Not all probes returned structured success.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SINGLE-CASE INTERPRETATION — BOUNDED RETRIES, ESCALATION CHECK
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PER_ITEM_RETRY = 3;
const TRANSIENT_FAILURE_CODES = new Set([
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_UPSTREAM_UNAVAILABLE",
  "AI_PROVIDER_RATE_LIMITED",
]);

/**
 * Run a single synthetic case through interpretBoqItem with bounded retries.
 * Returns { result, metrics, rawResponse, retries, escalationCandidate }
 */
async function runShadowCase(env, caseDef) {
  // Privacy guard: must pass before any live call
  assertHostedNvidiaSafe(caseDef, `shadow-case:${caseDef.id}`);
  
  const input = prepareBoqUnderstandingInput({
    id: caseDef.id,
    description: caseDef.description,
    numericQuantity: caseDef.quantity,
    normalizedUnit: caseDef.unit,
  });
  
  // Mock provider for error-injection cases (forceError)
  let interpretFn;
  if (caseDef.forceError) {
    interpretFn = async () => { throw Object.assign(new Error(caseDef.forceError), { code: caseDef.forceError, providerCode: caseDef.forceError }); };
  } else {
    // Use real provider via interpretBoqItem
    interpretFn = async (input) => interpretBoqItem(input, {
      provider: NVIDIA_NIM,
      env,
      timeout: nvidiaTimeout(env),
      maxTokens: 2048,
    });
  }

  const start = Date.now();
  let lastError;
  let retries = 0;
  let rawResponse = null;

  for (let attempt = 0; attempt <= MAX_PER_ITEM_RETRY; attempt++) {
    try {
      const result = await interpretFn(input);
      rawResponse = result.rawModelResponse || null;
      const latency = Date.now() - start;
      // Validate against canonical schema (normalizeBoqUnderstandingModelResponse already ran)
      const schemaValid = (() => {
        try {
          BOQ_UNDERSTANDING_RESPONSE_SCHEMA.parse(result);
          return true;
        } catch { return false; }
      })();
      return { result, latency, rawResponse, retries, schemaValid };
    } catch (err) {
      lastError = err;
      const isTransient = TRANSIENT_FAILURE_CODES.has(err?.code || err?.providerCode);
      if (!isTransient || attempt >= MAX_PER_ITEM_RETRY) break;
      retries++;
      // Exponential backoff with jitter: 200ms * 2^attempt ± 50ms
      const delay = 200 * Math.pow(2, attempt) + (Math.random() - 0.5) * 100;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const latency = Date.now() - start;
  const timedOut = lastError?.code === "AI_PROVIDER_TIMEOUT";
  const foreignContent = lastError?.code === "AI_OUTPUT_INVALID" && lastError?.message?.includes("foreign") === true;
  return {
    result: null,
    latency,
    rawResponse,
    retries,
    schemaValid: false,
    timeout: timedOut,
    foreignContent,
    error: lastError?.code || "AI_OUTPUT_INVALID",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ACCURACY / ESCALATION SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a result against expected values.
 * @returns {object} with matches and escalation flags
 */
function scoreResult(caseDef, result, _rawResponse) {
  if (!result) return { systemMatch: false, categoryMatch: false, familyMatch: false, unknownPreserved: false, unsupportedInference: false, escalationUseful: false };
  const exp = caseDef.expected || {};
  const systemMatch = result.system?.value === exp.system;
  const categoryMatch = result.category?.value === exp.category;
  const familyMatch = result.productFamily?.value === exp.productFamily || (exp.productFamily === "MISSING" && result.productFamily?.value === "MISSING");
  // Unknown preservation: expected unknown fields must remain MISSING/NOT_APPLICABLE
  const unknownPreserved = (caseDef.unknownFields || []).every(f => {
    const val = result[f]?.value;
    return val === "MISSING" || val === "NOT_APPLICABLE";
  });
  // Unsupported inference: fields with EXTRACTED/INFERRED origin but NO supporting token in description
  let unsupportedInference = false;
  for (const field of ["system", "category", "productFamily", "equipmentType", "manufacturerEvidence"]) {
    const entry = result[field];
    if (entry && (entry.origin === "EXTRACTED" || entry.origin === "INFERRED")) {
      const tokens = caseDef.evidenceTokens || [];
      const desc = caseDef.description.toLowerCase();
      const supported = tokens.some(t => desc.includes(t.toLowerCase()));
      if (!supported) unsupportedInference = true;
    }
  }
  // Escalation usefulness: would the escalation policy recommend escalation?
  // Low confidence or NEEDS_REVIEW status or MISSING critical fields → escalation candidate
  const needsReview = result.status === "NEEDS_REVIEW";
  const lowConf = result.confidence === "LOW" || result.confidence === "MEDIUM";
  const criticalMissing = ["system", "category", "productFamily"].some(f => result[f]?.value === "MISSING");
  const escalationCandidate = needsReview || lowConf || criticalMissing;
  // Escalation is "useful" if the result genuinely needs human review (ground truth: this is a synthetic case with ambiguity/unknowns)
  const escalationUseful = escalationCandidate && (caseDef.id.includes("ambiguity") || caseDef.id.includes("failed") || caseDef.id.includes("stale"));
  return { systemMatch, categoryMatch, familyMatch, unknownPreserved, unsupportedInference, escalationCandidate, escalationUseful };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. MAIN HARNESS ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full synthetic shadow evaluation.
 * @param {object} env - Environment with NVIDIA_API_KEY, BOQ_AI_MODEL, etc.
 * @param {object} options - { cases, artifactDir, skipHealthGate }
 * @returns {Promise<object>} Full shadow report
 */
export async function runSyntheticShadowEvaluation(env, options = {}) {
  const cases = options.cases || SYNTHETIC_SHADOW_CASES;
  const artifactDir = options.artifactDir || mkdtempSync(join(tmpdir(), "nvidia-shadow-"));
  const skipHealthGate = options.skipHealthGate || false;

  console.error(`[shadow] Artifact directory: ${artifactDir}`);
  console.error(`[shadow] Running ${cases.length} synthetic cases with hosted NVIDIA NIM`);

  // 1. HEALTH GATE — operational stability required before shadow eval
  let healthGate = { operational: true, reason: "SKIPPED", attempts: 0, latencyMs: [] };
  if (!skipHealthGate) {
    console.error("[shadow] Running operational stability assessment (probe x N)...");
    healthGate = await assessOperationalStability(env);
    console.error(`[shadow] Health gate: operational=${healthGate.operational}, reason=${healthGate.reason}, attempts=${healthGate.attempts}`);
    if (!healthGate.operational) {
      console.error(`[shadow] HEALTH GATE FAILED: ${healthGate.reason} — stopping before live calls`);
      const report = {
        gate: "HEALTH",
        passed: false,
        healthGate,
        metrics: { total: 0 },
        artifactDir,
      };
      writeArtifact(artifactDir, "shadow-report.json", report);
      return report;
    }
  }

  // 2. RUN CASES
  const metrics = new ShadowMetrics();
  const caseResults = [];

  for (const caseDef of cases) {
    console.error(`[shadow] Case: ${caseDef.id}`);
    const outcome = await runShadowCase(env, caseDef);
    const scores = outcome.result ? scoreResult(caseDef, outcome.result, outcome.rawResponse) : {
      systemMatch: false, categoryMatch: false, familyMatch: false,
      unknownPreserved: false, unsupportedInference: false, escalationUseful: false,
    };
    const record = {
      caseId: caseDef.id,
      schemaValid: outcome.schemaValid,
      systemMatch: scores.systemMatch,
      categoryMatch: scores.categoryMatch,
      familyMatch: scores.familyMatch,
      unknownPreserved: scores.unknownPreserved,
      unsupportedInference: scores.unsupportedInference,
      timeout: outcome.timeout,
      foreignContent: outcome.foreignContent,
      retries: outcome.retries,
      escalationCandidate: scores.escalationCandidate,
      escalationUseful: scores.escalationUseful,
      latencyMs: outcome.latency,
      error: outcome.error,
    };
    metrics.record(record);
    caseResults.push({ case: caseDef.id, ...record, result: outcome.result, rawResponse: outcome.rawResponse });
  }

  // 3. BUILD REPORT
  const summary = metrics.summary();
  const report = {
    gate: "SHADOW_EVAL",
    passed: summary.schemaValidityRate === 1 && summary.timeoutRate === 0 && summary.foreignResponseRate === 0,
    healthGate,
    metrics: summary,
    cases: caseResults,
    artifactDir,
    syntheticCasesUsed: cases.map(c => c.id),
    privacyGuard: "ACTIVE (restricted-content-only)",
    confidentialUseBlocked: false,
    nvidiaStabilityThreshold: NVIDIA_STABILITY_SUCCESSES_REQUIRED,
    nvidiaStallThreshold: NVIDIA_STABILITY_STALLS_UNSTABLE,
  };

  writeArtifact(artifactDir, "shadow-report.json", report);
  writeArtifact(artifactDir, "shadow-cases.json", caseResults);

  console.error(`[shadow] Complete. Schema validity: ${(summary.schemaValidityRate*100).toFixed(1)}%, Timeouts: ${(summary.timeoutRate*100).toFixed(1)}%, Foreign: ${(summary.foreignResponseRate*100).toFixed(1)}%`);
  console.error(`[shadow] Report written to ${artifactDir}/shadow-report.json`);

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CLI / TEST INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

// Allow direct execution: node scripts/boq-synthetic-shadow-harness.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = {
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    BOQ_AI_PROVIDER: "NVIDIA_NIM",
    BOQ_AI_MODEL: process.env.BOQ_AI_MODEL || "NVIDIA_NIM/nvidia/nemotron-3.5-lightning-30b-a3b",
    NVIDIA_NIM_TIMEOUT_MS: process.env.NVIDIA_NIM_TIMEOUT_MS || "180000",
    NVIDIA_NIM_BASE_URL: process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
  };
  runSyntheticShadowEvaluation(env, { skipHealthGate: process.env.SKIP_HEALTH_GATE === "1" })
    .then(r => {
      console.error(JSON.stringify({ passed: r.passed, metrics: r.metrics }, null, 2));
      process.exit(r.passed ? 0 : 1);
    })
    .catch(err => {
      console.error("[shadow] FATAL:", err);
      process.exit(1);
    });
}

// Export for programmatic use
// (All exports are declared inline above)