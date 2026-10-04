import { BOQ_UNDERSTANDING_RESPONSE_SCHEMA } from "../app/domain/boq-understanding-engine.mjs";

export const DEFAULT_CLOUDFLARE_BOQ_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const DEFAULT_CLOUDFLARE_BOQ_ESCALATION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_CLOUDFLARE_BOQ_TIMEOUT_MS = 30_000;
const MAX_CLOUDFLARE_BOQ_TIMEOUT_MS = 60_000;
const PROVIDER_MESSAGE_LIMIT = 240;

// ── Provider identity (canonical, frozen, closed) ───────────────────────────
//
// Provider identity and MODEL identity are deliberately separate concerns. A model
// name is never usable as a provider identity, and a provider name never appears
// inside a model id, so provenance stays unambiguous downstream.
export const CLOUDFLARE_WORKERS_AI = "CLOUDFLARE_WORKERS_AI";
export const NVIDIA_NIM = "NVIDIA_NIM";
export const PROVIDER_IDENTITY_CHOICES = Object.freeze([CLOUDFLARE_WORKERS_AI, NVIDIA_NIM]);

// ── Health vocabulary (closed) ───────────────────────────────────────────────
//
// `CONFIGURED` and `HEALTHY` answer different questions. Configuration is a
// statement about the deployment; health is a claim about observed behaviour, and
// a claim needs evidence. One completed structured call proves transport,
// credentials, model routing and structured output -- and NOT stability -- so it
// reports STRUCTURED_OUTPUT_HEALTHY. Only repeated CONSECUTIVE successes may
// report HEALTHY.
export const PROVIDER_HEALTH_STATES = Object.freeze(["CONFIGURED", "HEALTHY", "UNHEALTHY", "UNKNOWN", "STRUCTURED_OUTPUT_HEALTHY"]);
// The evidence ladder, so a verdict says HOW FAR the evidence actually got rather
// than collapsing everything into one boolean.
export const PROVIDER_HEALTH_STAGES = Object.freeze([
  "CONFIGURED", "REACHABLE", "AUTHENTICATED", "MODEL_AVAILABLE", "STRUCTURED_OUTPUT_HEALTHY", "OPERATIONALLY_STABLE",
]);
export const PROVIDER_HEALTH_STAGE_STATES = Object.freeze(["CONFIRMED", "REFUTED", "UNKNOWN"]);

// Transient failures invite a retry; a rejected request or bad credential never
// does, so this classification is the retry contract, not a diagnostic nicety.
const TRANSIENT_PROVIDER_FAILURES = new Set(["AI_PROVIDER_TIMEOUT", "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_UPSTREAM_UNAVAILABLE", "AI_PROVIDER_PENDING"]);

// ── NVIDIA NIM configuration ─────────────────────────────────────────────────
//
// Default model: the ULTRA tier, per the task's stated initial target. The three
// verified hosted ids are the same ones app/domain/ai-provider-escalation-policy.mjs
// already records in NVIDIA_HOSTED_REFERENCE, so there is exactly ONE model-id
// authority in the repository.
export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NVIDIA_BOQ_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
export const DEFAULT_NVIDIA_NIM_TIMEOUT_MS = 180_000;
export const MAX_NVIDIA_NIM_TIMEOUT_MS = 600_000;
const NVIDIA_NIM_PENDING_ATTEMPTS = 2;
const NVIDIA_STABILITY_SUCCESSES_REQUIRED = 3;
const NVIDIA_STABILITY_STALLS_UNSTABLE = 2;

const safeUsage = (usage) => {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const allowed = ["prompt_tokens", "completion_tokens", "total_tokens"];
  const result = Object.fromEntries(allowed.flatMap((key) => Number.isFinite(Number(usage[key])) ? [[key, Number(usage[key])]] : []));
  return Object.keys(result).length ? result : null;
};

const safeModel = (env) => String(env.BOQ_AI_MODEL || DEFAULT_CLOUDFLARE_BOQ_MODEL).trim();
const nativeBinding = (env) => typeof env.AI?.run === "function" ? env.AI.run.bind(env.AI) : null;
const safeTimeout = (env) => {
  const configured = Number(env.BOQ_AI_TIMEOUT_MS || DEFAULT_CLOUDFLARE_BOQ_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(MAX_CLOUDFLARE_BOQ_TIMEOUT_MS, Math.floor(configured))) : DEFAULT_CLOUDFLARE_BOQ_TIMEOUT_MS;
};
const safeStatus = (error) => {
  const value = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
};
const stableProviderCode = (error, timedOut = false) => {
  if (timedOut) return "AI_PROVIDER_TIMEOUT";
  const status = safeStatus(error);
  if (status === 429) return "AI_PROVIDER_RATE_LIMITED";
  if (status === 401 || status === 403) return "AI_PROVIDER_AUTHORIZATION_FAILED";
  if (status === 400 || status === 422) return "AI_PROVIDER_REQUEST_REJECTED";
  if (status && status >= 500) return "AI_PROVIDER_UPSTREAM_UNAVAILABLE";
  return "AI_PROVIDER_ERROR";
};
const sanitizedProviderMessage = (error, timedOut = false) => {
  if (timedOut) return "Cloudflare Workers AI request exceeded the configured timeout.";
  // Provider messages are untrusted and may echo request content or credentials.
  // The stable code/status retain diagnostic value without copying that payload.
  return "Cloudflare Workers AI request failed.".slice(0, PROVIDER_MESSAGE_LIMIT);
};

export function sanitizeCloudflareProviderError(error, { durationMs, model, timedOut = false } = {}) {
  return Object.freeze({
    name: timedOut ? "TimeoutError" : String(error?.name || "Error").replace(/[^A-Za-z0-9_ -]/g, "").slice(0, 64) || "Error",
    code: stableProviderCode(error, timedOut),
    status: timedOut ? null : safeStatus(error),
    message: sanitizedProviderMessage(error, timedOut),
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.floor(Number(durationMs))) : null,
    model: String(model || "").slice(0, 160),
  });
}

// ── NVIDIA NIM environment resolution ────────────────────────────────────────
//
// Keyless access is permitted ONLY for a genuine loopback NIM container, and the
// host check is an EXACT match on the parsed hostname. A lookalike host such as
// "localhost.evil.example" is not loopback, so keyless remote access stays closed.
const isLoopbackNimBaseUrl = (baseUrl) => {
  try {
    const parsed = new URL(String(baseUrl));
    return ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const nvidiaBaseUrl = (env) => String(env.NVIDIA_BASE_URL || env.NVIDIA_NIM_BASE_URL || DEFAULT_NVIDIA_BASE_URL).trim().replace(/\/+$/, "");
const nvidiaModel = (env) => {
  // BOQ_AI_MODEL may carry an explicit "NVIDIA_NIM/<model>" form, a bare model id,
  // a bare provider name, or nothing.
  //
  // Two guards matter. A bare PROVIDER name is not a model id, so it falls back to
  // the default rather than being sent upstream as a model. And a Workers AI
  // "@cf/..." value is never valid for NVIDIA, so it must not leak the other
  // vendor's model into NVIDIA provenance.
  const raw = String(env.BOQ_AI_MODEL || "").trim();
  if (!raw || raw === NVIDIA_NIM) return DEFAULT_NVIDIA_BOQ_MODEL;
  const withoutProvider = raw.startsWith(`${NVIDIA_NIM}/`) ? raw.slice(NVIDIA_NIM.length + 1).trim() : raw;
  if (!withoutProvider || withoutProvider === NVIDIA_NIM || withoutProvider.startsWith("@cf/")) return DEFAULT_NVIDIA_BOQ_MODEL;
  return withoutProvider.slice(0, 160);
};
const nvidiaApiKey = (env) => String(env.NVIDIA_API_KEY || "").trim();
const nvidiaTimeoutMs = (env) => {
  const configured = Number(env.NVIDIA_NIM_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_NVIDIA_NIM_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_NVIDIA_NIM_TIMEOUT_MS, Math.floor(configured)));
};

const nvidiaReadiness = (env) => {
  const model = nvidiaModel(env);
  const baseUrl = nvidiaBaseUrl(env);
  if (!model || !baseUrl) {
    return { state: "Misconfigured", detail: "NVIDIA NIM configuration is invalid.", model: model || DEFAULT_NVIDIA_BOQ_MODEL };
  }
  // Loopback containers accept keyless access; the HOSTED endpoint never does.
  if (!nvidiaApiKey(env) && !isLoopbackNimBaseUrl(baseUrl)) {
    return { state: "Misconfigured", detail: "NVIDIA_API_KEY is required for the hosted NVIDIA NIM endpoint.", model };
  }
  // Readiness is configuration ONLY. It never carries a health claim.
  return { state: "Ready — NVIDIA NIM configured", detail: "BOQ Understanding uses the configured NVIDIA NIM endpoint.", model };
};

// Fixed message strings only: NVIDIA responses are untrusted and may echo request
// content or credentials, so no upstream text is ever copied into our messages.
const sanitizedNvidiaMessage = (error, timedOut = false) => {
  if (timedOut) return "NVIDIA NIM request exceeded the configured timeout.";
  return "NVIDIA NIM request failed.".slice(0, PROVIDER_MESSAGE_LIMIT);
};

export function sanitizeNvidiaProviderError(error, { durationMs, model, timedOut = false } = {}) {
  return Object.freeze({
    name: timedOut ? "TimeoutError" : String(error?.name || "Error").replace(/[^A-Za-z0-9_ -]/g, "").slice(0, 64) || "Error",
    code: stableProviderCode(error, timedOut),
    status: timedOut ? null : safeStatus(error),
    message: sanitizedNvidiaMessage(error, timedOut),
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.floor(Number(durationMs))) : null,
    model: String(model || "").slice(0, 160),
  });
}

// Response format: when the canonical BOQ schema is supplied, the OpenAI-compatible
// `json_schema` envelope gives schema-CONSTRAINED decoding -- the same structural
// enforcement the Workers AI path already has. The SCHEMA stays canonical and
// identical across providers; only the wire envelope differs. The health probe
// passes no schema and keeps the minimal json_object mode.
const nvidiaChatRequestBody = (model, messages, maxTokens, schema = null) => ({
  model,
  messages,
  temperature: 0,
  stream: false,
  max_tokens: maxTokens,
  response_format: schema
    ? { type: "json_schema", json_schema: { name: "boq_understanding", schema, strict: true } }
    : { type: "json_object" },
  // Governed NVIDIA BOQ setting: thinking disabled (documented mechanism).
  // Only a template flag is ever set; reasoning traces are never read, returned,
  // logged or persisted.
  chat_template_kwargs: { enable_thinking: false },
});

const nvidiaMessageContent = (body) => {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (content && typeof content === "object") return content;
  return null;
};

const nvidiaOutputInvalidError = (message) => {
  const error = new Error(message);
  error.code = "AI_OUTPUT_INVALID";
  error.providerCode = "AI_OUTPUT_INVALID";
  error.providerDiagnostic = Object.freeze({ name: "OutputInvalidError", code: "AI_OUTPUT_INVALID", status: null, message, durationMs: null, model: null });
  return error;
};

/**
 * One bounded HTTP attempt. A 202 is PENDING, not a failure: NVIDIA can accept a
 * request and complete it asynchronously, so retrying once is correct and
 * reporting a failure would be wrong.
 */
async function nvidiaChatCompletion({ env, model, messages, maxTokens, schema }) {
  const baseUrl = nvidiaBaseUrl(env);
  const key = nvidiaApiKey(env);
  const controller = new AbortController();
  const timeoutMs = nvidiaTimeoutMs(env);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const headers = { "content-type": "application/json" };
    // The credential appears ONLY in the outbound Authorization header, never in
    // the request body, a log line, an error, or any persisted artifact.
    if (key) headers.authorization = `Bearer ${key}`;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(nvidiaChatRequestBody(model, messages, maxTokens, schema)), signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    if (response.status === 202) {
      const error = new Error("NVIDIA NIM request is still pending.");
      // Governed TRANSIENT coarse code so retry semantics apply; PENDING is the
      // classified cause, never a failure class.
      error.code = "AI_PROVIDER_TIMEOUT";
      error.providerCode = "AI_PROVIDER_PENDING";
      error.transient = true;
      error.durationMs = Date.now() - startedAt;
      throw error;
    }
    if (!response.ok) {
      const durationMs = Date.now() - startedAt;
      const diagnostic = sanitizeNvidiaProviderError(Object.assign(new Error("upstream"), { status: response.status }), { durationMs, model });
      const error = new Error("NVIDIA NIM could not complete the request.");
      error.status = response.status;
      // Coarse governed code UNCHANGED; the finer cause is additive.
      error.code = "AI_PROVIDER_ERROR";
      error.providerCode = diagnostic.code;
      error.transient = TRANSIENT_PROVIDER_FAILURES.has(diagnostic.code);
      error.durationMs = durationMs;
      error.providerDiagnostic = Object.freeze(diagnostic);
      throw error;
    }
    return { body, durationMs: Date.now() - startedAt };
  } catch (cause) {
    if (cause?.providerCode) { cause.durationMs = Number.isFinite(cause.durationMs) ? cause.durationMs : Date.now() - startedAt; throw cause; }
    const timedOut = cause?.name === "AbortError"
      || controller.signal.aborted
      || /timed?\s*out|timeout|ETIMEDOUT/i.test(String(cause?.message || ""));
    const diagnostic = sanitizeNvidiaProviderError(cause, { durationMs: Date.now() - startedAt, model, timedOut });
    const error = new Error(timedOut ? "NVIDIA NIM request timed out." : "NVIDIA NIM could not complete the request.");
    // The coarse governed code is UNCHANGED (downstream retry policy and every
    // persisted attempt depend on it); the finer cause survives alongside it.
    error.code = timedOut ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_ERROR";
    error.providerCode = diagnostic.code;
    error.transient = timedOut;
    error.providerDiagnostic = Object.freeze(diagnostic);
    error.durationMs = diagnostic.durationMs;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded pending-retry: one resume attempt, then report pending. */
async function nvidiaChatCompletionWithPendingResume(args) {
  for (let attempt = 1; attempt <= NVIDIA_NIM_PENDING_ATTEMPTS; attempt += 1) {
    try {
      return await nvidiaChatCompletion(args);
    } catch (error) {
      if (error?.providerCode === "AI_PROVIDER_PENDING" && attempt < NVIDIA_NIM_PENDING_ATTEMPTS) continue;
      throw error;
    }
  }
  return nvidiaChatCompletion(args);
}

/**
 * The NVIDIA NIM structured provider. OpenAI-compatible chat-completions over
 * plain fetch -- NVIDIA Build/NIM exposes exactly that shape, so no custom
 * networking layer is introduced.
 */
export function createConfiguredNvidiaNimStructuredProvider(env = {}, { schema, maxTokens = 2048, diagnosticLogger = null } = {}) {
  const readiness = nvidiaReadiness(env);
  if (readiness.state !== "Ready — NVIDIA NIM configured") return null;
  const model = readiness.model;
  const provider = {
    metadata: {
      provider: NVIDIA_NIM,
      model,
      modelVersion: String(env.BOQ_AI_MODEL_VERSION || model),
      escalationModel: null,
      escalationEnabled: false,
    },
    readiness,
    lastCallMetadata: null,
    async interpret({ prompt }) {
      const messages = [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }];
      const { body, durationMs } = await nvidiaChatCompletionWithPendingResume({ env, model, messages, maxTokens, schema });
      const usage = safeUsage(body?.usage);
      provider.lastCallMetadata = { durationMs, usage };
      const content = nvidiaMessageContent(body);
      if (content === null) throw nvidiaOutputInvalidError("NVIDIA NIM returned no structured content.");
      if (typeof content !== "string") return content;
      // Fail closed: malformed output is NEVER repaired from prose, and reasoning
      // traces are never read, so they cannot reach the canonical output.
      try { return JSON.parse(content); }
      catch { throw nvidiaOutputInvalidError("NVIDIA NIM returned invalid structured output."); }
    },
  };
  return provider;
}

// ── Health: evidence stages, so a verdict says how far the evidence got ───────

const UNCONFIRMED_STAGE = Object.freeze({ status: "UNKNOWN", reason: null });

/**
 * Resolve a health verdict for a CONFIGURED provider.
 *
 * `attempted:false` is CONFIGURED, never HEALTHY: a configuration statement is not
 * an observation. Fail-closed: a reported failure class wins over a contradictory
 * `ok` flag, so `ok` alone can never produce HEALTHY.
 */
export function resolveProviderHealth(readiness, { attempted = false, ok = null, failureClass = null } = {}) {
  const configured = String(readiness?.state || "Misconfigured").startsWith("Ready");
  if (!configured) {
    const isBinding = String(readiness?.state || "").startsWith("Unavailable");
    return Object.freeze({
      configured: false, state: "UNKNOWN", probed: false, model: readiness?.model ?? null,
      failureClass: isBinding ? "AI_BINDING_MISSING" : "PROVIDER_MISCONFIGURED",
      transient: false,
      detail: String(readiness?.detail || "The provider is not configured."),
    });
  }
  const base = { configured: true, model: readiness?.model ?? null };
  if (attempted !== true) {
    return Object.freeze({
      ...base, state: "CONFIGURED", probed: false, failureClass: null, transient: null,
      detail: "Configuration is present; live health has not been probed.",
    });
  }
  if (ok === true && failureClass == null) {
    return Object.freeze({
      ...base, state: "HEALTHY", probed: true, failureClass: null, transient: false,
      detail: "A real provider call completed successfully.",
    });
  }
  const code = failureClass || "AI_PROVIDER_ERROR";
  return Object.freeze({
    ...base, state: "UNHEALTHY", probed: true, failureClass: code, transient: TRANSIENT_PROVIDER_FAILURES.has(code),
    detail: "A real provider call was attempted and did not complete successfully.",
  });
}

// Per-model ledgers. Keyed by provider+model so one model's stability never
// refutes another's -- a healthy Lightning call says nothing about Super.
const NVIDIA_HEALTH_LEDGERS = new Map();
const nvidiaLedger = (model) => {
  if (!NVIDIA_HEALTH_LEDGERS.has(model)) NVIDIA_HEALTH_LEDGERS.set(model, { consecutiveSuccesses: 0, consecutiveStalls: 0 });
  return NVIDIA_HEALTH_LEDGERS.get(model);
};
export const resetNvidiaHealthLedgers = () => NVIDIA_HEALTH_LEDGERS.clear();

/**
 * Live health probe: exactly one real request.
 *
 * A single completed structured call proves transport, credentials, model routing
 * and structured output -- so STRUCTURED_OUTPUT_HEALTHY, never HEALTHY. Only
 * NVIDIA_STABILITY_SUCCESSES_REQUIRED CONSECUTIVE successes may report HEALTHY, and
 * repeated consecutive STALLS actively refute stability rather than inviting more
 * calls.
 */
export async function probeNvidiaNimProviderHealth(env = {}, options = {}) {
  const readiness = nvidiaReadiness(env);
  const model = readiness.model;
  const ledger = nvidiaLedger(model);
  const stages = Object.freeze({
    configured: Object.freeze({ status: "CONFIRMED", reason: null }),
    reachable: Object.freeze({ ...UNCONFIRMED_STAGE }),
    authenticated: Object.freeze({ ...UNCONFIRMED_STAGE }),
    modelAvailable: Object.freeze({ ...UNCONFIRMED_STAGE }),
    structuredOutputHealthy: Object.freeze({ ...UNCONFIRMED_STAGE }),
    operationallyStable: Object.freeze({ ...UNCONFIRMED_STAGE }),
  });
  const finish = (state, extra) => Object.freeze({
    provider: NVIDIA_NIM, model, stages, configured: readiness.state === "Ready — NVIDIA NIM configured",
    probed: false, ...extra,
  });
  if (readiness.state !== "Ready — NVIDIA NIM configured") {
    return finish("UNKNOWN", { state: "UNKNOWN", configured: false, failureClass: null, transient: null, detail: readiness.detail });
  }
  // The probe payload is FICTIONAL. No project, BOQ-row or client content is sent.
  const messages = [
    { role: "system", content: "Return one JSON object only." },
    { role: "user", content: "Return JSON with the key ok set to true, for this fictional line: Addressable optical smoke detector." },
  ];
  let ok = false, failureClass = null, transient = null;
  try {
    const { body } = await nvidiaChatCompletionWithPendingResume({ env, model, messages, maxTokens: 64, schema: null });
    // A 200 proves REACHABILITY and nothing more. Structured output is proven only
    // when a structured object actually came back, so the probe parses and rejects
    // an empty or prose body instead of reporting a health claim it did not earn.
    const content = nvidiaMessageContent(body);
    if (content === null) { const invalid = nvidiaOutputInvalidError("NVIDIA NIM returned no structured content."); throw invalid; }
    if (typeof content === "string") { try { JSON.parse(content); } catch { throw nvidiaOutputInvalidError("NVIDIA NIM returned invalid structured output."); } }
    ok = true;
  } catch (error) {
    failureClass = error?.providerCode === "AI_PROVIDER_PENDING" ? "AI_PROVIDER_PENDING" : (error?.providerCode || "AI_PROVIDER_ERROR");
    transient = failureClass === "AI_PROVIDER_PENDING" ? true : TRANSIENT_PROVIDER_FAILURES.has(failureClass);
  }
  const settled = resolveProviderHealth(readiness, { attempted: true, ok, failureClass: ok ? null : failureClass });
  if (ok) {
    ledger.consecutiveSuccesses += 1;
    ledger.consecutiveStalls = 0;
  } else {
    ledger.consecutiveSuccesses = 0;
    ledger.consecutiveStalls = failureClass === "AI_PROVIDER_TIMEOUT" ? ledger.consecutiveStalls + 1 : 0;
  }
  const unstable = ledger.consecutiveStalls >= NVIDIA_STABILITY_STALLS_UNSTABLE;
  const stable = ledger.consecutiveSuccesses >= NVIDIA_STABILITY_SUCCESSES_REQUIRED;
  const nextStages = Object.freeze({
    ...stages,
    reachable: Object.freeze({ status: ok || failureClass === "AI_PROVIDER_PENDING" ? "CONFIRMED" : "REFUTED", reason: null }),
    authenticated: Object.freeze({ status: ok || failureClass === "AI_PROVIDER_PENDING" ? "CONFIRMED" : failureClass === "AI_PROVIDER_AUTHORIZATION_FAILED" ? "REFUTED" : "UNKNOWN", reason: null }),
    modelAvailable: Object.freeze({ status: ok ? "CONFIRMED" : "UNKNOWN", reason: null }),
    structuredOutputHealthy: Object.freeze({ status: ok ? "CONFIRMED" : "REFUTED", reason: ok ? null : failureClass === "AI_OUTPUT_INVALID" ? "INVALID_OUTPUT" : failureClass }),
    operationallyStable: Object.freeze({
      status: stable ? "CONFIRMED" : unstable ? "REFUTED" : "UNKNOWN",
      reason: stable ? "CONSECUTIVE_SUCCESSES" : unstable ? "UPSTREAM_UNSTABLE" : null,
    }),
  });
  if (failureClass === "AI_PROVIDER_PENDING") {
    return finish("CONFIGURED", { state: "CONFIGURED", configured: true, probed: false, pending: true, failureClass: null, transient: true, stages: nextStages, detail: "The provider accepted the request and has not completed it yet." });
  }
  const state = ok ? (stable ? "HEALTHY" : "STRUCTURED_OUTPUT_HEALTHY") : "UNHEALTHY";
  return Object.freeze({
    provider: NVIDIA_NIM, model, stages: nextStages,
    configured: true, probed: true, pending: false,
    state,
    failureClass: ok ? null : failureClass,
    transient: ok ? false : settled.transient,
    detail: ok
      ? (stable ? "Repeated consecutive structured calls completed successfully." : "A single completed structured call proves structured output, not operational stability.")
      : "A real provider call was attempted and did not complete successfully.",
  });
}

export function boqUnderstandingProviderReadiness(env = {}) {
  const provider = String(env.BOQ_AI_PROVIDER || "cloudflare").trim();
  if (provider === NVIDIA_NIM) return nvidiaReadiness(env);
  const model = safeModel(env);
  if (provider !== "cloudflare" || !model || !model.startsWith("@cf/")) {
    return { state: "Misconfigured", detail: "Workers AI server configuration is invalid.", model: model || DEFAULT_CLOUDFLARE_BOQ_MODEL };
  }
  if (!nativeBinding(env)) {
    return { state: "Unavailable — binding missing", detail: "The native Workers AI binding is unavailable.", model };
  }
  return { state: "Ready — native Workers AI binding", detail: "BOQ Understanding uses the server-side AI binding.", model };
}

export function createConfiguredCloudflareStructuredProvider(env = {}, { schema, maxTokens = 1800, diagnosticLogger = null } = {}) {
  const readiness = boqUnderstandingProviderReadiness(env);
  if (readiness.state !== "Ready — native Workers AI binding") return null;
  const model = readiness.model;
  const escalationModel = String(env.BOQ_AI_ESCALATION_MODEL || DEFAULT_CLOUDFLARE_BOQ_ESCALATION_MODEL).trim();
  const run = nativeBinding(env);
  const timeoutMs = safeTimeout(env);
  const provider = {
    metadata: { provider: "cloudflare-workers-ai-binding", model, modelVersion: String(env.BOQ_AI_MODEL_VERSION || model), escalationModel, escalationEnabled: false },
    readiness,
    lastCallMetadata: null,
    async interpret({ prompt }) {
      const startedAt = Date.now();
      let result;
      let timeoutHandle;
      try {
        const invocation = Promise.resolve(run(model, {
          messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
          response_format: { type: "json_schema", json_schema: schema },
          temperature: 0,
          max_tokens: maxTokens,
        }));
        const timeout = new Promise((_, reject) => { timeoutHandle = setTimeout(() => {
          const error = new Error("Workers AI request timed out.");
          error.code = "AI_PROVIDER_TIMEOUT";
          reject(error);
        }, timeoutMs); });
        result = await Promise.race([invocation, timeout]);
      } catch (cause) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const timedOut = cause?.code === "AI_PROVIDER_TIMEOUT";
        const diagnostic = sanitizeCloudflareProviderError(cause, { durationMs, model, timedOut });
        if (typeof diagnosticLogger === "function") diagnosticLogger(diagnostic);
        const error = new Error(timedOut ? "Workers AI request timed out." : "Workers AI could not complete the request.");
        error.code = timedOut ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_ERROR";
        throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        provider.lastCallMetadata = { durationMs: Math.max(0, Date.now() - startedAt) };
      }
      provider.lastCallMetadata = { ...provider.lastCallMetadata, usage: safeUsage(result?.usage) };
      const value = result?.response ?? result;
      if (typeof value !== "string") return value;
      try { return JSON.parse(value); }
      catch {
        const error = new Error("Workers AI returned invalid structured output.");
        error.code = "AI_OUTPUT_INVALID";
        throw error;
      }
    },
  };
  return provider;
}

// DETERMINISTIC HERMETIC PROVIDER (test-only seam).
//
// The Golden E2E journey is a governed acceptance gate, but BOQ Understanding
// resolved to the REMOTE Workers AI binding. Two identical runs of the same seed
// produced different governed outcomes (observed: 1 COMPLETED + 2 NEEDS_REVIEW, then
// 1 COMPLETED + 1 NEEDS_REVIEW + 1 FAILED), because a remote model is neither
// deterministic nor reliably reachable from a hermetic run. A governed gate whose
// result moves between identical runs is not a gate.
//
// This seam replaces ONLY the external model inference. Everything downstream is
// untouched: the same schema, the same normalizeBoqUnderstandingModelResponse, the
// same persistence, the same governance, readiness and downstream consumers.
// Fail-closed semantics are unchanged -- a line with missing mandatory identity still
// yields a missing fact and downstream readiness still blocks it.
//
// It activates ONLY when GOLDEN_HERMETIC_AI=1, which only scripts/run-golden-e2e.sh sets, so
// the canonical runtime and any deployment keep using the real provider. It never
// widens the accepted status vocabulary and never skips understanding persistence.
export function createDeterministicHermeticProvider(env = {}) {
  if (String(env.GOLDEN_HERMETIC_AI || "") !== "1") return null;
  const fact = (value, origin, confidence) => ({ value, origin, confidence });
  const missing = () => fact(null, "MISSING", 0);
  return {
    metadata: {
      provider: "hermetic-deterministic-boq-understanding",
      model: "hermetic-fixture-v1",
      modelVersion: "hermetic-fixture-v1",
      escalationModel: null,
      escalationEnabled: false,
    },
    readiness: {
      state: "Ready \u2014 hermetic deterministic provider",
      detail: "BOQ Understanding uses the deterministic hermetic fixture provider (GOLDEN_HERMETIC_AI).",
      model: "hermetic-fixture-v1",
    },
    lastCallMetadata: null,
    async interpret({ prompt }) {
      // The description is recovered from the prompt so each BOQ line is interpreted
      // on its own text rather than on a constant, but text -> governed output is a
      // total, deterministic function.
      const user = String((prompt && prompt.user) || "");
      const described = /"description"\s*:\s*"([^"]+)"/i.exec(user)?.[1]
        || /Description:\s*(.+)/i.exec(user)?.[1]
        || null;
      const description = String(described || "Hermetic fixture BOQ line").replace(/\s+/g, " ").trim();
      // A line whose own text carries an engineering-grade identity (a model/part
      // token AND a technical qualifier) is reported as confidently understood.
      // Anything less is honestly reported as needing review. This is a deterministic
      // function of the input, and it never asserts a value it did not read.
      const hasModelToken = /\b[A-Z]{2,}[-_ ]?\d{2,}[A-Z0-9-]*\b/.test(description);
      const hasQualifier = /\b\d+\s*V\b|\b\d+\s*W\b|\bUL\s*\d+|\b\d+\s*dB\b|\bIP\d{2}\b/i.test(description);
      const confident = hasModelToken && hasQualifier;
      const origin = confident ? "EXTRACTED" : "INFERRED";
      const confidence = confident ? 100 : 60;
      // The response schema sets additionalProperties:false, so ONLY the declared
      // properties may be returned. The boq item id is supplied by the caller, not
      // by the model, and must not be echoed here.
      return {
        normalizedDescription: fact(description.slice(0, 240), origin, confidence),
        system: confident ? fact("Fire Alarm", "INFERRED", 70) : missing(),
        category: confident ? fact("Detection Devices", "INFERRED", 70) : missing(),
        equipmentType: confident ? fact("Detector", "INFERRED", 70) : missing(),
        productFamily: missing(),
        taxonomyCandidateKey: missing(),
        technicalAttributes: [],
        standards: [],
        manufacturerEvidence: [],
        compatibilityRequirements: [],
        requiredAccessories: [],
        searchTerms: [],
        missingInformation: [],
        ambiguities: [],
        confidence: confident ? "HIGH" : "MEDIUM",
      };
    },
  };
}

// BOQ Understanding production/runtime selection is deliberately native-only.
// Diagnostic REST tooling, if ever needed, must live outside this factory and
// require a separate explicit invocation; it is never an automatic fallback.
export function createConfiguredBoqUnderstandingProvider(env = {}, options = {}) {
  // Hermetic deterministic provider first, and only for an explicitly flagged test
  // environment. Every other environment is completely unaffected.
  const hermetic = createDeterministicHermeticProvider(env);
  if (hermetic) return hermetic;
  // Explicit provider selection only. A selected-but-unconfigured provider returns
  // null: falling back to a DIFFERENT vendor would silently reinterpret governed
  // provenance and let a misconfiguration look like a healthy system.
  if (String(env.BOQ_AI_PROVIDER || "cloudflare").trim() === NVIDIA_NIM) {
    return createConfiguredNvidiaNimStructuredProvider(env, {
      schema: BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
      maxTokens: 2048,
      diagnosticLogger: options.diagnosticLogger || null,
    });
  }
  return createConfiguredCloudflareStructuredProvider(env, {
    schema: BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
    maxTokens: 900,
    diagnosticLogger: options.diagnosticLogger || null,
  });
}
