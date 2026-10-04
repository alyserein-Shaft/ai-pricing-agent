// Production Muse vision provider -- frozen validated configuration ONLY.
//
// model:   meta/muse-glimmer-30b
// params:  temperature 0.6, top_p 0.95, max_tokens 2048, reasoning_effort low
// prompt:  short perception-first v1
// endpoint: https://integrate.api.nvidia.com/v1/chat/completions
//
// Do NOT tune here. Any configuration change requires a new MODEL_CONFIG_VERSION
// (see drawing-vision-background.mjs) so old results cannot masquerade as current.
//
// Privacy: reasoning_content is never read, never persisted, never scored. The
// credential travels only in the outbound Authorization header, never in a body,
// log line, error, or persisted artifact.
export const MUSE_VISION_MODEL = "meta/muse-glimmer-30b";
export const MUSE_VISION_TEMPERATURE = 0.6;
export const MUSE_VISION_TOP_P = 0.95;
export const MUSE_VISION_MAX_TOKENS = 2048;
export const MUSE_VISION_REASONING_EFFORT = "low";
// Async worker budget. Covers ~2.3x the worst observed Config-B call (39.5s)
// with headroom, at half the proven-safe 180s benchmark budget. The synchronous
// 30s production timeout is unchanged and untouched by this module.
export const MUSE_VISION_TIMEOUT_MS = 90_000;
export const MUSE_VISION_MODEL_CONFIG_VERSION =
  "muse-glimmer-30b-t0.6-topP0.95-mt2048-reLow-promptP1-1.0.0";

export const MUSE_VISION_PROMPT =
  "Transcribe exactly what you see in this fire-alarm drawing crop: every legible " +
  "character or string in reading order, each symbol mark (square/circle outline, " +
  "filled dot, letter inside), and spatial relations (above/below/left/right, " +
  "rows/columns). If a region is not legible, write ILLEGIBLE for it. Then add one " +
  "line stating what the evidence denotes, only if directly supported; otherwise " +
  "write NEEDS REVIEW. Do not guess. Do not infer quantity from occurrence count. " +
  "Do not invent voltages or connections.";

const TRANSPORT_RETRYABLE = new Set([
  "AI_PROVIDER_TIMEOUT", "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_SERVER_ERROR",
  "AI_PROVIDER_EMPTY_CONTENT", "AI_PROVIDER_TRUNCATED", "AI_PROVIDER_MALFORMED",
]);

export const isTransportFailure = (code) => TRANSPORT_RETRYABLE.has(code);

// Classify a raw provider outcome WITHOUT reading reasoning. Semantic
// NEEDS_REVIEW / SAFE_FAIL verdicts are valid model outcomes, never transport
// failures, and must never be retried as such.
export function classifyMuseOutcome({ status, body, durationMs }) {
  if (status === 429) return { code: "AI_PROVIDER_RATE_LIMITED", transient: true, durationMs };
  if (status >= 500) return { code: "AI_PROVIDER_SERVER_ERROR", transient: true, durationMs };
  if (status !== 200 || !body) return { code: "AI_PROVIDER_ERROR", transient: false, durationMs };
  const message = body.choices?.[0]?.message ?? null;
  const text = typeof message?.content === "string" ? message.content.trim() : "";
  if (!text) return { code: "AI_PROVIDER_EMPTY_CONTENT", transient: true, durationMs };
  if (body.choices?.[0]?.finish_reason === "length") {
    return { code: "AI_PROVIDER_TRUNCATED", transient: true, durationMs };
  }
  return { code: null, transient: false, durationMs, text, finishReason: body.choices?.[0]?.finish_reason ?? null, usage: body.usage ?? null };
}

export async function callMusePerception(env, { imageBytes, timeoutMs = MUSE_VISION_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const startedAt = Date.now();
  const key = env.NVIDIA_API_KEY;
  if (!key) {
    const error = new Error("NVIDIA credential is not configured.");
    error.code = "AI_PROVIDER_AUTH_FAILED";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MUSE_VISION_MODEL, temperature: MUSE_VISION_TEMPERATURE, top_p: MUSE_VISION_TOP_P,
        max_tokens: MUSE_VISION_MAX_TOKENS, reasoning_effort: MUSE_VISION_REASONING_EFFORT,
        messages: [{ role: "user", content: [
          { type: "text", text: MUSE_VISION_PROMPT },
          { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}` } },
        ] }],
      }),
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    const outcome = classifyMuseOutcome({ status: response.status, body, durationMs: Date.now() - startedAt });
    if (outcome.code) {
      const error = new Error("Muse vision request did not produce usable perception.");
      error.code = outcome.code;
      error.transient = outcome.transient;
      error.status = response.status;
      error.durationMs = outcome.durationMs;
      throw error;
    }
    return { ...outcome, durationMs: Date.now() - startedAt };
  } catch (cause) {
    if (cause?.code) throw cause;
    const timedOut = cause?.name === "AbortError";
    const error = new Error(timedOut ? "Muse vision request timed out." : "Muse vision request failed.");
    error.code = timedOut ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_ERROR";
    error.transient = timedOut;
    error.durationMs = Date.now() - startedAt;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
