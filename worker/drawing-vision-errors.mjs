// Typed provider errors for the canonical Drawing Vision call.
//
// AUTHORITY NOTE
// Drawing Vision is AI_PROPOSAL only. Nothing in this module creates drawing
// facts, quantities, product identity, or any other technical authority. Its
// only job is to make a failed vision call DISTINGUISHABLE and FAIL CLOSED.
//
// VOCABULARY NOTE (house convention, matching worker/boq-understanding-provider.mjs)
// The COARSE governed code stays one of the values downstream governance and the
// persisted `drawing_visual_runs.error_code` column already understand:
//   AI_PROVIDER_TIMEOUT | AI_PROVIDER_ERROR | AI_OUTPUT_INVALID | ...
// The precise, provider-NEUTRAL cause travels additively as `providerCode`.
// Cloudflare's numeric Workers AI codes are evidence about one provider, not the
// domain contract, so they are translated here and never surfaced verbatim as a
// domain code.
//
// This module performs CLASSIFICATION ONLY. It never retries, never falls back to
// another provider, and never returns a successful/empty vision result.

/**
 * Provider-neutral, semantically distinct vision failure classes.
 * These are the domain contract. A provider-specific code must be translated
 * into exactly one of these before leaving this module.
 */
export const VISION_FAILURE = Object.freeze({
  DEADLINE_EXCEEDED: "AI_DEADLINE_EXCEEDED",
  PROVIDER_TIMEOUT: "AI_PROVIDER_TIMEOUT",
  PROVIDER_ABORTED: "AI_PROVIDER_ABORTED",
  REQUEST_TOO_LARGE: "AI_REQUEST_TOO_LARGE",
  CAPACITY_UNAVAILABLE: "AI_PROVIDER_CAPACITY_UNAVAILABLE",
  QUOTA_EXHAUSTED: "AI_PROVIDER_QUOTA_EXHAUSTED",
  INVALID_INPUT: "AI_INVALID_INPUT",
  AUTH_FAILED: "AI_PROVIDER_AUTH_FAILED",
  GENERIC: "AI_PROVIDER_ERROR",
});

// Cloudflare Workers AI numeric error codes, observed on the real endpoint.
// Kept PRIVATE to this module as translation evidence only.
const CF_AI_CODE = Object.freeze({
  3006: VISION_FAILURE.REQUEST_TOO_LARGE,
  3007: VISION_FAILURE.PROVIDER_TIMEOUT,
  3008: VISION_FAILURE.PROVIDER_ABORTED,
  3036: VISION_FAILURE.QUOTA_EXHAUSTED,
  3040: VISION_FAILURE.CAPACITY_UNAVAILABLE,
  5004: VISION_FAILURE.INVALID_INPUT,
  8007: VISION_FAILURE.INVALID_INPUT, // observed: image width/height below minimum
});

// Retryability is a CLASSIFICATION for downstream governance to consult.
// This module never acts on it.
const RETRYABILITY = Object.freeze({
  [VISION_FAILURE.DEADLINE_EXCEEDED]: {
    transient: false,
    rationale: "Application deadline is a fixed budget; unchanged input would exceed the same deadline. Retry only after an explicit input or budget change.",
  },
  [VISION_FAILURE.PROVIDER_TIMEOUT]: {
    transient: true,
    rationale: "Provider-side timeout is a transport/timing condition; the same request may complete on a later attempt.",
  },
  [VISION_FAILURE.PROVIDER_ABORTED]: {
    transient: true,
    rationale: "Aborted/cancelled upstream operation is a transport interruption, not evidence the request is invalid.",
  },
  [VISION_FAILURE.CAPACITY_UNAVAILABLE]: {
    transient: true,
    rationale: "Provider capacity unavailability is temporary; the request itself is well-formed.",
  },
  [VISION_FAILURE.QUOTA_EXHAUSTED]: {
    transient: false,
    administrative: true,
    rationale: "Quota/allocation exhaustion is administrative. Immediate blind retry cannot succeed and must not be automated.",
  },
  [VISION_FAILURE.REQUEST_TOO_LARGE]: {
    transient: false,
    rationale: "Non-transient until the input changes; retrying an oversized request reproduces the rejection.",
  },
  [VISION_FAILURE.INVALID_INPUT]: {
    transient: false,
    rationale: "The provider rejected the request content itself; an identical retry is rejected identically.",
  },
  [VISION_FAILURE.AUTH_FAILED]: {
    transient: false,
    administrative: true,
    rationale: "Credential/configuration fault; administrative remedy, not a retry.",
  },
  [VISION_FAILURE.GENERIC]: Object.freeze({
    transient: false,
    rationale: "Unclassified provider failure. Fail closed; never assumed retryable.",
  }),
});

export const visionFailureRetryability = (providerCode) =>
  RETRYABILITY[providerCode] || RETRYABILITY[VISION_FAILURE.GENERIC];

// Pull a numeric Workers AI code out of whatever shape the binding/HTTP layer
// produced. The binding throws an Error carrying `.code`; the REST envelope is
// `{ success: false, errors: [{ code, message }] }`.
const numericProviderCodes = (cause) => {
  const found = [];
  const push = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) found.push(n);
  };
  if (cause && typeof cause === "object") {
    push(cause.code);
    if (Array.isArray(cause.errors)) for (const e of cause.errors) if (e && typeof e === "object") push(e.code);
  }
  // "AiError: ... (uuid)" style text carries no code; some builds inline it.
  const text = String(cause?.message ?? cause ?? "");
  for (const m of text.matchAll(/\b(?:code|error)\D{0,4}(\d{4})\b/gi)) push(m[1]);
  return found;
};

// Order matters: the most specific signal wins, because a single failure can
// carry several markers (e.g. an aborted request that also looks like a timeout).
const MESSAGE_SIGNALS = [
  [/too many requests|rate limit|quota|allocation/i, VISION_FAILURE.QUOTA_EXHAUSTED],
  [/capacity|overloaded|no available|too many concurrent/i, VISION_FAILURE.CAPACITY_UNAVAILABLE],
  [/too large|payload too|request entity|exceeds? (?:the )?maximum/i, VISION_FAILURE.REQUEST_TOO_LARGE],
  [/width must be|height must be|image (?:is )?(?:invalid|malformed|unsupported)|unsupported image|invalid (?:image|input|argument|parameter)/i, VISION_FAILURE.INVALID_INPUT],
  [/unauthoriz|forbidden|invalid (?:api )?key|authentication|credential/i, VISION_FAILURE.AUTH_FAILED],
  [/timed?\s*out|timeout|ETIMEDOUT/i, VISION_FAILURE.PROVIDER_TIMEOUT],
  [/abort|cancel/i, VISION_FAILURE.PROVIDER_ABORTED],
];

/** Map an arbitrary thrown value onto exactly one provider-neutral class. */
export const classifyVisionFailure = (cause) => {
  if (cause?.name === "AbortError") return VISION_FAILURE.PROVIDER_ABORTED;
  if (cause?.visionFailure) return cause.visionFailure; // already classified upstream
  for (const code of numericProviderCodes(cause)) {
    const mapped = CF_AI_CODE[code];
    if (mapped) return mapped;
  }
  const text = String(cause?.message ?? cause ?? "");
  for (const [pattern, mapped] of MESSAGE_SIGNALS) if (pattern.test(text)) return mapped;
  return VISION_FAILURE.GENERIC;
};

// Never let a credential, token, or authorization value reach a persisted
// diagnostic, a log line, or a returned error.
const scrub = (value, limit = 200) =>
  String(value ?? "")
    .replace(/\b(bearer)\s+[\w.\-]+/gi, "$1 [redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password)\b\s*[:=]\s*\S+/gi, "$1 [redacted]")
    .slice(0, limit);

/**
 * Build the typed vision error.
 *
 * `coarseCode` stays inside the governed vocabulary already persisted by
 * drawing-extraction-api.mjs, so downstream persistence and existing consumers
 * need no change; `providerCode` carries the precise neutral cause.
 */
export const visionError = ({ providerCode, message, stage, model = null, durationMs = null, providerEvidence = null, status = null }) => {
  const code = providerCode || VISION_FAILURE.GENERIC;
  const retry = visionFailureRetryability(code);
  // Coarse mapping keeps the governed surface stable and semantically honest:
  // a deadline IS a timeout; everything else is a provider failure until proven
  // otherwise by the pipeline that consumes it.
  const coarseCode =
    code === VISION_FAILURE.PROVIDER_TIMEOUT || code === VISION_FAILURE.DEADLINE_EXCEEDED
      ? "AI_PROVIDER_TIMEOUT"
      : "AI_PROVIDER_ERROR";
  return Object.assign(new Error(message), {
    code: coarseCode,
    providerCode: code,
    visionFailure: code,
    stage,
    model: model ? String(model).slice(0, 160) : null,
    status,
    durationMs,
    // Classification only. No consumer may treat this as authorization to retry.
    transient: retry.transient,
    retryClassification: Object.freeze({ ...retry }),
    providerDiagnostic: Object.freeze({
      providerCode: code,
      stage,
      status,
      durationMs,
      // Evidence, never the credential or the request body.
      providerEvidence: scrub(providerEvidence) || null,
    }),
  });
};

/**
 * Run `task` under an explicit application deadline.
 *
 * Abortability is reported honestly: the native Workers AI binding exposes no
 * AbortSignal, so on expiry the underlying provider call is ABANDONED (its
 * result is discarded and any later rejection is absorbed) rather than
 * cancelled. The deadline is always enforced from the caller's side, so an
 * unresponsive vision call can never hang a request indefinitely.
 */
export const withVisionDeadline = async ({ timeoutMs, stage, model, task }) => {
  const startedAt = Date.now();
  let timer = null;
  let expired = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(visionError({
        providerCode: VISION_FAILURE.DEADLINE_EXCEEDED,
        message: `Drawing vision ${stage} exceeded its ${timeoutMs}ms application deadline.`,
        stage, model, durationMs: Date.now() - startedAt,
        providerEvidence: "application deadline elapsed before the provider returned",
      }));
    }, timeoutMs);
  });
  // The provider promise keeps its own rejection handler so an abandoned call
  // that later fails cannot surface as an unhandled rejection.
  const work = Promise.resolve().then(task);
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer); // deterministic cleanup on every path
    if (expired) {
      // Deadline won: the abandoned call's outcome is discarded by design.
      work.catch(() => {});
    }
  }
};