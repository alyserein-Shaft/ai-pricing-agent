import { BOQ_UNDERSTANDING_RESPONSE_SCHEMA } from "../app/domain/boq-understanding-engine.mjs";

export const DEFAULT_CLOUDFLARE_BOQ_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const DEFAULT_CLOUDFLARE_BOQ_ESCALATION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_CLOUDFLARE_BOQ_TIMEOUT_MS = 30_000;
const MAX_CLOUDFLARE_BOQ_TIMEOUT_MS = 60_000;
const PROVIDER_MESSAGE_LIMIT = 240;

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

export function boqUnderstandingProviderReadiness(env = {}) {
  const provider = String(env.BOQ_AI_PROVIDER || "cloudflare").trim();
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

// BOQ Understanding production/runtime selection is deliberately native-only.
// Diagnostic REST tooling, if ever needed, must live outside this factory and
// require a separate explicit invocation; it is never an automatic fallback.
export function createConfiguredBoqUnderstandingProvider(env = {}, options = {}) {
  return createConfiguredCloudflareStructuredProvider(env, {
    schema: BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
    maxTokens: 900,
    diagnosticLogger: options.diagnosticLogger || null,
  });
}
