// NVIDIA DOCUMENT INTELLIGENCE — SHADOW API.
//
// WHAT THIS IS
// ------------
// A read-only, ADVISORY surface for the NVIDIA document-AI shadow benchmark. It
// exposes two actions:
//
//   status : native-vs-NVIDIA benchmark outcome, per-tier comparison, and the
//            authoritative TABLE_TITLE decision. No network, no credentials.
//   probe  : an ON-DEMAND live call against the NVIDIA hosted document models for
//            ONE caller-supplied document, returned alongside the native parse so
//            a human can compare them. Explicitly not automatic and not wired
//            into extraction.
//
// AUTHORITY — READ THIS FIRST
// --------------------------
// NOTHING HERE IS AUTHORITATIVE. The native parser remains the extraction
// authority. No NVIDIA output is persisted, promoted, auto-fused, or used to
// alter a BOQ row, a quantity, a match or a price. The probe is a comparison
// instrument for a human, and its result is explicitly labelled `shadow`.
// The escalation policy is untouched: it remains MEASURED_NON_DISCRIMINATING.
//
// PROVIDER CONFIGURATION IS EXTERNALISED (§14)
// -------------------------------------------
// base URL, model ids, timeouts and the credential are all supplied through the
// `env`/config object. Domain logic never hardcodes a vendor, a model or a key,
// so a client handoff replaces configuration only -- no code rewrite.
//
// PRIVACY (§1)
// ------------
// `probe` refuses any path that matches a known project/private source location
// before a byte is transmitted. The guard is fail-closed: an unrecognised path
// is refused too, because this endpoint has no legitimate reason to send a file
// it cannot prove is synthetic or caller-approved. CREDENTIALS ARE NEVER
// RETURNED, LOGGED OR STORED -- presence is reported as a boolean only.
import { extname, resolve, relative, isAbsolute } from "node:path";

// LOCAL FILESYSTEM ACCESS IS RESOLVED LAZILY, AND IT IS NOT A ROUTER DEPENDENCY.
//
// This module is now loaded into the Cloudflare Worker entry graph via
// `worker/index.ts`, and that runtime has no local filesystem. A static
// `node:fs/promises` import would bind the whole bundle to a filesystem the
// Worker does not have. The probe is an on-demand LOCAL instrument: it reads a
// file and returns. Where no filesystem exists the read throws, is caught by
// the existing refusal path, and NOTHING is transmitted. Fail-closed.
const readLocalFile = async (path) => {
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
};

/** Same response convention as every other worker handler. */
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

// --- provider configuration (external; overridable at handoff) --------------
export const DEFAULT_NVIDIA_CONFIG = Object.freeze({
  baseUrl: "https://ai.api.nvidia.com/v1/cv/nvidia",
  chatBaseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
  models: Object.freeze({
    ocr: "nemotron-ocr-v2",
    pageElements: "nemotron-page-elements-v3",
    tableStructure: "nemotron-table-structure-v1",
    parse: "nvidia/nemotron-parse-2.0",
  }),
  timeoutMs: 120_000,
  // An inline-image ceiling. Applied uniformly, never per case.
  maxImageBase64Chars: 180_000,
});

export const SHADOW_STATUS = Object.freeze({
  AUTHORITATIVE_PARSER: "NATIVE_ONLY",
  NVIDIA_ROLE: "SHADOW_ONLY_ADVISORY",
  ESCALATION_POLICY: "MEASURED_NON_DISCRIMINATING",
  LEADING_ROW_DECISION: "TABLE_TITLE_UNLESS_INDEPENDENT_HIERARCHY_EVIDENCE",
});

export const PROBE_DECISIONS = Object.freeze({
  OK: "OK",
  REFUSED_PRIVATE_PATH: "REFUSED_PRIVATE_PATH",
  REFUSED_OUTSIDE_ALLOWED_ROOTS: "REFUSED_OUTSIDE_ALLOWED_ROOTS",
  NO_CREDENTIAL: "NO_CREDENTIAL",
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  REFUSED_RESTRICTED_PAYLOAD: "REFUSED_RESTRICTED_PAYLOAD",
  UPSTREAM_FAILED: "UPSTREAM_FAILED",
  /**
   * The hosted-data gate refused the probe before any path was even considered.
   * Distinct from every path/payload refusal on purpose: an operator must be able
   * to tell "the feature is switched off" apart from "your file was rejected".
   */
  FEATURE_DISABLED: "FEATURE_DISABLED",
});

// --- route + hosted-data gate -----------------------------------------------

/**
 * SHADOW / SECOND_OPINION / NON_AUTHORITATIVE route.
 *
 * Lives under `/api/dev/` beside the other non-canonical engineering
 * diagnostics, so it is never mistaken for a governed commercial endpoint.
 */
export const SHADOW_ROUTE_PATH = "/api/dev/nvidia-document-shadow";

/**
 * TRUSTED, SERVER-SIDE ROOTS. Client input can select a file WITHIN these roots
 * and nothing else. It can never add, replace or widen them — see
 * `handleNvidiaDocumentShadowApi`, which never reads `allowedRoots` off the body.
 *
 * WHY THE DEFAULT IS SYNTHETIC-ONLY: the hosted NVIDIA catalog's terms for
 * confidential data are UNRESOLVED. Until that is settled, real project documents
 * must stay refused. Naming a real location here requires an operator to add it
 * in trusted server configuration; it is never something a caller can grant
 * itself at request time.
 */
export const DEFAULT_TRUSTED_ROOTS = Object.freeze([
  "tests/fixtures/ai-synthetic",
  "out/ai-synthetic-bench",
]);

/**
 * Resolve the trusted root allowlist from trusted configuration ONLY.
 * Absent configuration yields the synthetic defaults, which is a deny for
 * everything else — fail-closed by construction.
 */
export function resolveTrustedProbeRoots(env = {}) {
  const configured = String(env.NVIDIA_DOCUMENT_SHADOW_ALLOWED_ROOTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Object.freeze([...DEFAULT_TRUSTED_ROOTS, ...configured]);
}

/** The probe is OFF unless an operator has explicitly enabled it. */
export function shadowProbeEnabled(env = {}) {
  return env.NVIDIA_DOCUMENT_SHADOW_ENABLED === "1";
}

/**
 * RESTRICTED-COMMERCIAL PATH FRAGMENTS -- the ONLY paths this guard refuses by name.
 *
 * WHY THIS LIST SHRANK (governance correction)
 * ---------------------------------------------
 * This list previously also carried PROJECT IDENTITY patterns -- "al-mousa",
 * "al_mousa", "inputs/central-kitchen", "central-kitchen", "source-boq",
 * "outputs", "uploads", "project-upload". Under the accepted policy
 * PROJECT_DATA_DISCLOSURE_POLICY = AUTHORIZED those were wrong: a document must
 * not be refused merely because it is a real project BOQ, specification or
 * drawing, or merely because it sits in a project directory. Project identity,
 * project filenames and project paths are NOT privacy blockers.
 *
 * They were also redundant. Path safety is enforced by the caller-supplied
 * `allowedRoots` allowlist below, which is fail-closed: with no roots configured
 * nothing is permitted, and anything outside every permitted root is refused.
 * The name list is a second layer that only ever over-blocked.
 *
 * What remains is the genuinely restricted COMMERCIAL class: supplier pricing,
 * supplier quotations and price lists. Those are refused because of what they
 * contain, not who owns them.
 */
const RESTRICTED_COMMERCIAL_PATH_FRAGMENTS = Object.freeze([
  "final-quotation", "supplier-price", "supplier_price", "price-list", "pricelist",
]);

/**
 * PAYLOAD CLASSIFICATIONS -- the payload-specific restriction axis.
 *
 * WHY THIS EXISTS: path names cannot express PII, INTERNAL_ONLY, or
 * confidential third-party/manufacturer material. An image has no inspectable
 * path semantics, so those restrictions are carried as an explicit, bounded
 * classification the caller must supply. The vocabulary is closed on purpose --
 * an unrecognised or absent classification is REFUSED, never assumed safe.
 */
export const PAYLOAD_CLASSIFICATIONS = Object.freeze({
  /** Ordinary authorised project document: BOQ, specification, drawing, datasheet. */
  AUTHORIZED_PROJECT_DOCUMENT: "AUTHORIZED_PROJECT_DOCUMENT",
  /** Supplier pricing, quotations, price lists. */
  RESTRICTED_SUPPLIER_COMMERCIAL: "RESTRICTED_SUPPLIER_COMMERCIAL",
  /** Personal data of any identifiable person. */
  RESTRICTED_PII: "RESTRICTED_PII",
  /** Marked internal-only by the owner. */
  RESTRICTED_INTERNAL_ONLY: "RESTRICTED_INTERNAL_ONLY",
  /** Confidential third-party or manufacturer material. */
  RESTRICTED_CONFIDENTIAL_THIRD_PARTY: "RESTRICTED_CONFIDENTIAL_THIRD_PARTY",
});

export const RESTRICTED_PAYLOAD_CLASSIFICATIONS = Object.freeze([
  PAYLOAD_CLASSIFICATIONS.RESTRICTED_SUPPLIER_COMMERCIAL,
  PAYLOAD_CLASSIFICATIONS.RESTRICTED_PII,
  PAYLOAD_CLASSIFICATIONS.RESTRICTED_INTERNAL_ONLY,
  PAYLOAD_CLASSIFICATIONS.RESTRICTED_CONFIDENTIAL_THIRD_PARTY,
]);

/**
 * Fail-closed payload guard. Pure, side-effect free, reads nothing.
 * Returns OK only for an explicitly declared AUTHORIZED_PROJECT_DOCUMENT.
 * An absent or unrecognised classification is a REFUSAL, not a pass.
 */
export function guardProbePayload(classification) {
  const declared = typeof classification === "string" ? classification.trim().toUpperCase() : "";
  if (!declared) {
    return {
      decision: PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD,
      reason: "No payload classification was declared. Fail-closed: this endpoint transmits nothing unless the caller states the document is AUTHORIZED_PROJECT_DOCUMENT.",
    };
  }
  if (RESTRICTED_PAYLOAD_CLASSIFICATIONS.includes(declared)) {
    return {
      decision: PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD,
      reason: `Payload is classified ${declared}. Restricted content is never transmitted to hosted model endpoints.`,
      classification: declared,
    };
  }
  if (declared !== PAYLOAD_CLASSIFICATIONS.AUTHORIZED_PROJECT_DOCUMENT) {
    return {
      decision: PROBE_DECISIONS.REFUSED_RESTRICTED_PAYLOAD,
      reason: `Unrecognised payload classification "${classification}". The vocabulary is closed; unknown classifications are refused.`,
      classification: declared,
    };
  }
  return { decision: PROBE_DECISIONS.OK, reason: "Payload declared AUTHORIZED_PROJECT_DOCUMENT.", classification: declared };
}

/**
 * Fail-closed privacy guard. Narrow by design: it inspects a path only, never
 * walks directories and never blocks the filesystem.
 */
export function guardProbePath(candidatePath, { repoRoot = process.cwd(), allowedRoots = [] } = {}) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    return { decision: PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS, reason: "A file path is required." };
  }
  const normalized = isAbsolute(candidatePath) ? candidatePath : resolve(repoRoot, candidatePath);
  const hay = normalized.replaceAll("\\", "/").toLowerCase();
  const hit = RESTRICTED_COMMERCIAL_PATH_FRAGMENTS.find((f) => hay.includes(f.toLowerCase()));
  if (hit) {
    return { decision: PROBE_DECISIONS.REFUSED_PRIVATE_PATH, reason: `Path names restricted commercial material ("${hit}"): supplier pricing, quotation or price list. Restricted content is never transmitted to hosted model endpoints.`, normalizedPath: normalized, matchedFragment: hit };
  }
  const inside = allowedRoots.some((root) => {
    const rel = relative(resolve(repoRoot, root), normalized);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!inside) {
    return { decision: PROBE_DECISIONS.REFUSED_OUTSIDE_ALLOWED_ROOTS, reason: `Path is outside every permitted root (${allowedRoots.join(", ") || "none configured"}). This endpoint transmits only explicitly approved files.`, normalizedPath: normalized };
  }
  return { decision: PROBE_DECISIONS.OK, reason: "Path is inside a permitted root.", normalizedPath: normalized };
}

/** Bounded error taxonomy. Raw upstream payloads never escape. */
export const UPSTREAM_ERRORS = Object.freeze({
  AUTHORIZATION_FAILED: "AUTHORIZATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
});

export function classifyUpstream(status) {
  if (status === 401 || status === 403) return UPSTREAM_ERRORS.AUTHORIZATION_FAILED;
  if (status === 402 || status === 429) return UPSTREAM_ERRORS.RATE_LIMITED;
  if (status === 404) return UPSTREAM_ERRORS.MODEL_UNAVAILABLE;
  if (status === 400 || status === 422) return UPSTREAM_ERRORS.INVALID_REQUEST;
  if (status === 408 || status === 504) return UPSTREAM_ERRORS.TIMEOUT;
  if (Number.isFinite(status) && status >= 500) return UPSTREAM_ERRORS.UPSTREAM_UNAVAILABLE;
  return UPSTREAM_ERRORS.UPSTREAM_UNAVAILABLE;
}

/** Stable, redacted shape of one model response. Never includes headers. */
function summariseComponent(model, role, status, payload, ms) {
  const box = payload?.data?.[0] ?? null;
  const bb = box?.bounding_boxes;
  const boxes = Array.isArray(bb) ? bb : bb && typeof bb === "object" ? Object.values(bb).flat() : [];
  // Extract confidence where available from bounding box data
  const boxConfidence = box?.confidence !== undefined ? box.confidence : null;
  // Extract row/column span where available from bounding box metadata
  const rowSpan = box?.row_span !== undefined ? box.row_span : null;
  const colSpan = box?.col_span !== undefined ? box.col_span : null;
  // Extract text content where available
  const detectedText = box?.text !== undefined ? box.text : null;
  // Extract column classification where available
  const columnClass = bb && typeof bb === "object" ? Object.keys(bb).find(k => k.toLowerCase().includes('column')) : null;
  // Extract row classification where available
  const rowClassification = bb && typeof bb === "object" ? Object.keys(bb).find(k => k.toLowerCase().includes('row')) : null;
  return {
    model, role, status, latencyMs: ms,
    ok: status === 200,
    detections: boxes.length,
    // Bounding box preservation
    boundingBoxes: bb ?? null,
    // Detected text
    text: detectedText ?? null,
    // Confidence where available
    confidence: boxConfidence ?? null,
    // Row/Column span where available
    rowSpan, colSpan,
    // Row/Column classification where available
    rowClassification, columnClass,
    // Existing fields
    classes: Array.isArray(bb) ? [] : Object.keys(bb ?? {}),
    textDetections: Array.isArray(box?.text_detections) ? box.text_detections.length : 0,
    // Verbatim provider text detections. Preserved UNMODIFIED and shadow-only so a
    // benchmark can compare extracted strings against an independent ground truth.
    // Without this, cell text, quantities and repeated-scope preservation are
    // unmeasurable from the provider response. Never authoritative; never persisted
    // by this module; never able to alter extraction.
    textDetectionDetail: Array.isArray(box?.text_detections) ? box.text_detections : null,
    errorClass: status === 200 ? null : classifyUpstream(status),
  };
}

/**
 * `status` action — no network, no credential.
 * Returns the recorded shadow-benchmark facts for display.
 */
export function buildShadowStatus({ benchmark = null, credentialPresent = false, native = null, probeEnabled = false } = {}) {
  return {
    authority: SHADOW_STATUS,
    credentialPresent,                      // boolean only; never the value
    // The gate is REPORTED, so an operator can see WHY a probe refuses instead
    // of guessing. Boolean only; it reveals no configuration value.
    probeEnabled,
    trustedRoots: [...DEFAULT_TRUSTED_ROOTS],
    native: native ?? { status: "NOT_PROVIDED" },
    nvidia: benchmark ?? { status: "NOT_RUN", reason: "No three-tier or adapter benchmark has been recorded for this deployment." },
    disclaimer: "Advisory only. The native parser remains the extraction authority; no NVIDIA output is persisted, promoted or used to alter a BOQ row, match or price.",
  };
}

/**
 * `probe` action — one on-demand live comparison for a single approved file.
 * Requires a caller-supplied `allowedRoots` list; there is no default that
 * would permit an arbitrary path.
 */
export async function runShadowProbe({ filePath, allowedRoots = [], env = {}, config = DEFAULT_NVIDIA_CONFIG, repoRoot = process.cwd(), nativeResult = null, payloadClassification = null }) {
  const key = String(env.NVIDIA_API_KEY ?? "");
  const credentialPresent = key.length > 0;

  const guard = guardProbePath(filePath, { repoRoot, allowedRoots });
  if (guard.decision !== PROBE_DECISIONS.OK) {
    return { decision: guard.decision, reason: guard.reason, transmitted: false, authority: SHADOW_STATUS };
  }
  const ext = extname(guard.normalizedPath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    return { decision: PROBE_DECISIONS.UNSUPPORTED_TYPE, reason: `Only rendered images are supported for a vision probe; received "${ext || "none"}".`, transmitted: false, authority: SHADOW_STATUS };
  }
  if (!credentialPresent) {
    return { decision: PROBE_DECISIONS.NO_CREDENTIAL, reason: "No server-side NVIDIA credential is configured for this deployment.", transmitted: false, authority: SHADOW_STATUS };
  }
  // Payload-specific restriction, fail-closed. Runs after the credential check
  // (a missing credential is already a refusal) but BEFORE any file is read and
  // before any byte is sent, so a restricted payload is never transmitted.
  const payload = guardProbePayload(payloadClassification);
  if (payload.decision !== PROBE_DECISIONS.OK) {
    return { decision: payload.decision, reason: payload.reason, classification: payload.classification ?? null, transmitted: false, authority: SHADOW_STATUS };
  }

  let bytes;
  try {
    bytes = await readLocalFile(guard.normalizedPath);
  } catch {
    // Includes the filesystem-less runtime case: no local file is readable, so
    // nothing is transmitted. Fail-closed, never a silent success.
    return { decision: PROBE_DECISIONS.UPSTREAM_FAILED, reason: "The approved file could not be read on this runtime; nothing was transmitted.", transmitted: false, authority: SHADOW_STATUS };
  }
  // Uniform, non-negotiable size policy — never per-case tuning.
  const b64 = bytes.toString("base64");
  if (b64.length > config.maxImageBase64Chars) {
    return { decision: PROBE_DECISIONS.INVALID_REQUEST, reason: `Image exceeds the configured inline limit (${b64.length} > ${config.maxImageBase64Chars} base64 chars). Re-render at the standard size.`, transmitted: false, authority: SHADOW_STATUS };
  }

  const components = [];
  // Each component has ONE responsibility; none overwrites another.
  for (const [role, model] of [["text", config.models.ocr], ["regions", config.models.pageElements], ["geometry", config.models.tableStructure]]) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const res = await fetch(`${config.baseUrl}/${model}`, {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: [{ type: "image_url", url: `data:image/png;base64,${b64}` }] }),
      });
      clearTimeout(timer);
      const text = await res.text();
      let payload = null; try { payload = JSON.parse(text); } catch {}
      components.push(summariseComponent(model, role, res.status, payload, Date.now() - started));
    } catch (e) {
      components.push({ model, role, status: 0, ok: false, detections: 0, latencyMs: Date.now() - started, errorClass: /abort/i.test(String(e?.name)) ? UPSTREAM_ERRORS.TIMEOUT : UPSTREAM_ERRORS.UPSTREAM_UNAVAILABLE });
    }
  }

  return {
    decision: PROBE_DECISIONS.OK,
    transmitted: true,
    bytesSent: b64.length,
    authority: SHADOW_STATUS,
    // Disagreements between components are REPORTED, never silently reconciled.
    reconciliation: {
      componentCount: components.length,
      componentsSucceeded: components.filter((c) => c.ok).length,
      note: "Components are reported side by side. No component overwrites another, and no fused value is treated as authoritative.",
    },
    components,
    native: nativeResult,
    disclaimer: "Shadow comparison only. Nothing here is persisted, promoted, or used to alter extraction, matching or commercial output.",
  };
}

/**
 * Router — SHADOW / SECOND_OPINION / NON_AUTHORITATIVE.
 *
 * Follows the repository `handle*Api` convention: `(request, env, options)`,
 * returns `null` for any other path so `worker/index.ts` can fall through.
 *
 * ┌─ TRUST BOUNDARY ─────────────────────────────────────────────────────────┐
 * │ `allowedRoots` is taken from TRUSTED SERVER CONFIGURATION ONLY.            │
 * │ The request body is NOT a source of roots. A caller that sends             │
 * │ `allowedRoots: ["/"]` gains nothing: the value is never read.             │
 * │ Client input may only SELECT a path that already sits inside the           │
 * │ server's allowlist, and it is then re-checked by the unchanged fail-closed │
 * │ path guard and payload guard below.                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function handleNvidiaDocumentShadowApi(request, env = {}, options = {}) {
  // Not a routed HTTP request (direct programmatic/test use): nothing to serve.
  if (!(request instanceof Request)) return null;
  const url = new URL(request.url);
  if (url.pathname !== SHADOW_ROUTE_PATH) return null;
  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405);
  }

  const config = options.config || DEFAULT_NVIDIA_CONFIG;
  const repoRoot = options.repoRoot || process.cwd();
  // TRUSTED CONFIGURATION ONLY — see the trust boundary above.
  const allowedRoots = Array.isArray(options.allowedRoots)
    ? Object.freeze([...options.allowedRoots])
    : resolveTrustedProbeRoots(env);

  let body = {};
  if (request.method === "POST") {
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } }, 400);
      }
    }
  }

  const action = String(body.action ?? url.searchParams.get("action") ?? "status");

  if (action === "status") {
    // No network, no credential, no filesystem. Always available so an operator
    // can SEE that the gate is closed.
    return json(buildShadowStatus({
      benchmark: body.benchmark ?? null,
      credentialPresent: String(env.NVIDIA_API_KEY ?? "").length > 0,
      native: body.native ?? null,
      probeEnabled: shadowProbeEnabled(env),
    }));
  }

  if (action === "probe") {
    // HOSTED-DATA GATE — fail-closed, checked before any path is even resolved.
    if (!shadowProbeEnabled(env)) {
      return json({
        decision: PROBE_DECISIONS.FEATURE_DISABLED,
        reason: "The NVIDIA document second-opinion probe is disabled for this deployment. It transmits nothing until an operator enables it AND names the document as authorised.",
        transmitted: false,
        probeEnabled: false,
        authority: SHADOW_STATUS,
      }, 403);
    }
    const result = await runShadowProbe({
      filePath: body.filePath,
      // Server allowlist. A body-supplied `allowedRoots` is deliberately NOT
      // consulted — see the trust boundary above.
      allowedRoots,
      env, config, repoRoot,
      nativeResult: body.native ?? null,
      payloadClassification: body.payloadClassification ?? null,
    });
    return json(result, result.decision === PROBE_DECISIONS.OK ? 200 : 400);
  }

  return json({ error: "UNSUPPORTED_ACTION", supported: ["status", "probe"] }, 400);
}
