/**
 * NVIDIA DRAWING PROBE — thin, isolated, advisory only.
 *
 * SCOPE AND AUTHORITY
 * ------------------
 * This module is an ADAPTER, not an authority. It performs no database access at
 * all: it cannot write governed drawing facts, BOQ classifications, sizing
 * snapshots or technical approvals, because it has no database handle. Its only
 * job is to make a bounded, citable call to an NVIDIA hosted model and return a
 * structured result that a caller may compare against the native extraction.
 *
 * It is deliberately NOT wired into any extraction pipeline.
 *
 * WHY IT EXISTS
 * -------------
 * The Agent 6 audit established two facts this adapter encodes rather than
 * re-discovers:
 *
 *  1. `nvidia/nemotron-parse-2.0` is served through /v1/chat/completions with a
 *     HARD output cap: max_tokens above 4096 is rejected with
 *     "cannot be greater than max_model_len=max_total_tokens=4096". A large-format
 *     CAD drawing page cannot fit in that budget, so a caller must chunk by region
 *     and must never assume a whole page will parse.
 *  2. A general reasoning VLM (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`)
 *     returns a confidently worded answer together with coordinates it cannot
 *     substantiate. Ungrounded output is acceptable as a SHADOW comparison and is
 *     never acceptable as evidence, so every result is stamped advisory and every
 *     caller is required to re-derive provenance from the native extraction.
 *
 * PROVENANCE IS MANDATORY
 * -----------------------
 * A probe with no provenance cannot be constructed: `probeDrawingRegion` rejects
 * a region that does not carry project, document, page and bounding-box identity.
 * That is the difference between a measurement and a rumour.
 */

/**
 * Verified server-side output cap for the Parse family on the chat endpoint.
 *
 * EXCLUSIVE, and verified as such: max_tokens=4096 is REJECTED with HTTP 400
 * ("cannot be greater than max_model_len=max_total_tokens=4096") and
 * max_tokens=4000 is accepted but always returns finish_reason="length" on a
 * real CAD schedule region, emitting degenerate filler instead of text.
 */
export const NEMOTRON_PARSE_MAX_OUTPUT_TOKENS = 4095;

export const PROBE_CAPABILITIES = Object.freeze({
  /** Full-page / region text and layout extraction. */
  TEXT_EXTRACTION: "text_extraction",
  /** Table cell structure. Never authoritative for merged cells. */
  TABLE_STRUCTURE: "table_structure",
  /** Visual/grounded reasoning over a region. Advisory only. */
  VISUAL_REASONING: "visual_reasoning",
});

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The ONLY verdict vocabulary a reasoning model may use. A model that cannot
 * support a claim must say so; it may never be pushed into an answer. These are
 * the values the benchmark returned verbatim.
 */
export const SEMANTIC_VERDICTS = Object.freeze(["SUPPORTED", "AMBIGUOUS", "NOT_VISIBLE", "CONFLICTING"]);

/**
 * The NVIDIA CV services, verified live against real Al Mousa CAD regions.
 *
 * ROUTE IS THE WHOLE STORY. These services answer on
 *   https://ai.api.nvidia.com/v1/cv/nvidia/<id>
 * where <id> is the BARE name ("nemotron-ocr-v2"). Passing the catalog form
 * ("nvidia/nemotron-ocr-v2") yields .../cv/nvidia/nvidia/nemotron-ocr-v2 and a
 * 404. Two earlier 404 findings were entirely this defect, not unavailability.
 * Mirrors DEFAULT_NVIDIA_CONFIG in worker/nvidia-document-shadow-api.mjs.
 */
export const NVIDIA_CV_BASE_URL = "https://ai.api.nvidia.com/v1/cv/nvidia";

export const NVIDIA_CV_SERVICES = Object.freeze([
  Object.freeze({ model: "nemotron-ocr-v2", role: "text", returns: "text + normalised box" }),
  Object.freeze({ model: "nemotron-page-elements-v3", role: "regions", returns: "element classes + normalised box, NO text" }),
  Object.freeze({ model: "nemotron-table-structure-v1", role: "geometry", returns: "row/column/cell boxes, NO text" }),
]);

/** Builds the CV route. Refuses a prefixed id so the double-nvidia 404 cannot recur. */
export const nvidiaCvRoute = (model) => {
  const id = String(model ?? "").trim();
  if (!id) throw new Error("A CV service id is required.");
  if (id.includes("/")) {
    throw new Error(
      `CV route takes a BARE service id (${NVIDIA_CV_SERVICES.map((s) => s.model).join(", ")}), not "${id}". ` +
      "A prefixed id builds a doubled path segment and returns HTTP 404.",
    );
  }
  return `${NVIDIA_CV_BASE_URL}/${id}`;
};

/** The exact body worker/nvidia-document-shadow-api.mjs sends. */
export const nvidiaCvRequestBody = (imageBase64) => ({
  input: [{ type: "image_url", url: `data:image/png;base64,${imageBase64}` }],
});

/**
 * Every CV geometry service returns boxes in NORMALISED 0..1 coordinates, not
 * page points. Verified on real sheets: OCR returns 4 corner points in 0..1,
 * and the element/table services return {x_min,y_min,x_max,y_max} in 0..1.
 * They therefore cannot be stored as page-space bboxes without OUR transform,
 * which is why they stay advisory.
 */
export const NVIDIA_CV_COORDINATE_SPACE = "NORMALISED_0_1";

/**
 * Models whose availability is UNKNOWN, not disproven.
 *
 * These returned HTTP 404 when probed, but through the wrong service class: both
 * were sent to /v1/chat/completions, which is not where an embedding model or a
 * reasoning VLM necessarily lives. Recording them as unavailable would repeat
 * exactly the mistake that produced the false CV 404, so they are recorded as
 * unverified. Re-probing requires the correct per-model endpoint first.
 */
export const AVAILABILITY_UNVERIFIED = Object.freeze([
  Object.freeze({ model: "nvidia/cosmos-reason2-8b", role: "spatial reasoning", last_result: "HTTP 404", why_unverified: "probed on /v1/chat/completions; correct endpoint for this model was never established" }),
  Object.freeze({ model: "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1", role: "VLM retrieval", last_result: "HTTP 404", why_unverified: "probed on /v1/chat/completions; an embedding model belongs on /v1/embeddings" }),
]);

/**
 * A model-supplied coordinate is never evidence. This strips coordinates from a
 * model answer so they cannot travel into provenance, and reports that it did so.
 */
export const stripModelCoordinates = (text) => {
  const raw = String(text ?? "");
  const cleaned = raw
    .replace(/\[[\s-]*-?\d+[\s,]*(?:-?\d+[\s,]*,?){1,3}\]/g, "[coordinate removed]")
    .replace(/\b(bbox|bounding box|pixel coordinates?)\b\s*[:=]?\s*[^,.;\n]*/gi, "$1 [coordinate removed]")
    .trim();
  return { text: cleaned, coordinatesRemoved: cleaned !== raw };
};

/**
 * True when a response is filler rather than content: the same short token
 * repeated, or essentially no letters at all. Verified against real responses
 * from nemotron-parse-2.0 on CAD schedule regions, which returned exactly this.
 */
export const isDegenerate = (text) => {
  const value = String(text ?? "");
  if (!/[A-Za-z]{2}/.test(value)) return true;
  const tokens = value.trim().split(/\s+/);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const top = Math.max(...counts.values());
  const total = tokens.length || 1;
  // A single token making up most of the response, or an extremely small set of
  // tokens repeated, is filler rather than extraction.
  return top / total >= 0.6 || new Set(tokens.map((t) => t.toLowerCase())).size <= 3;
};

/** Throws when a region lacks the identity needed to make its answer citable. */
export const assertProvenance = (provenance) => {
  const required = ["projectId", "documentId", "pageNumber"];
  const missing = required.filter((field) => {
    const value = provenance?.[field];
    return value === undefined || value === null || value === "";
  });
  const box = provenance?.boundingBox;
  if (!missing.length && (!box || !Number.isFinite(Number(box.x)) || !Number.isFinite(Number(box.y))
    || !Number.isFinite(Number(box.width)) || !Number.isFinite(Number(box.height)))) {
    missing.push("boundingBox");
  }
  if (missing.length) {
    throw Object.assign(
      new Error(`Drawing probe requires provenance; missing: ${missing.join(", ")}`),
      { code: "PROBE_PROVENANCE_REQUIRED", missing },
    );
  }
  return true;
};

/**
 * One chat-completions call against an NVIDIA hosted model.
 * `fetchImpl` is injected so this is unit-testable without a network and
 * without credentials.
 */
export const callNvidiaModel = async ({
  model,
  prompt,
  image,
  mediaType = "image/png",
  maxTokens = 1024,
  temperature = 0,
  baseUrl = "https://integrate.api.nvidia.com/v1",
  apiKey = process.env.NVIDIA_API_KEY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  now = () => Date.now(),
}) => {
  if (!apiKey) throw Object.assign(new Error("NVIDIA_API_KEY is not configured"), { code: "NVIDIA_CREDENTIAL_MISSING" });
  if (!image) throw Object.assign(new Error("an image is required"), { code: "PROBE_IMAGE_REQUIRED" });
  // Clamp rather than let the server reject: the cap is a hard server limit.
  const capped = Math.min(Math.max(1, Number(maxTokens) || 1), NEMOTRON_PARSE_MAX_OUTPUT_TOKENS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: capped,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    const latencyMs = now() - startedAt;
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message || `NVIDIA request failed with HTTP ${response.status}`),
        { code: "NVIDIA_REQUEST_FAILED", status: response.status, latencyMs },
      );
    }
    const choice = payload?.choices?.[0];
    const text = choice?.message?.content ?? "";
    return {
      ok: true,
      advisory: true,
      model: payload?.model || model,
      text,
      // `length` means the model ran out of output budget: for a drawing region
      // that is a truncation signal the caller MUST treat as incomplete, not as
      // "nothing there".
      finishReason: choice?.finish_reason ?? null,
      truncated: choice?.finish_reason === "length",
      usage: payload?.usage ?? null,
      latencyMs,
      maxTokensRequested: maxTokens,
      maxTokensApplied: capped,
    };
  } catch (error) {
    if (error?.code === "NVIDIA_REQUEST_FAILED") throw error;
    throw Object.assign(
      new Error(error?.name === "AbortError" ? "NVIDIA request timed out" : String(error?.message || error)),
      { code: error?.name === "AbortError" ? "PROBE_TIMEOUT" : "PROBE_TRANSPORT_FAILED", latencyMs: now() - startedAt },
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Advisory probe of ONE drawing region. Returns a provenance-bound result the
 * caller can compare with the native extraction; it never asserts truth.
 */
export const probeDrawingRegion = async ({
  capability,
  model,
  prompt,
  image,
  mediaType,
  maxTokens,
  provenance,
  fetchImpl,
  baseUrl,
  apiKey,
  timeoutMs,
}) => {
  assertProvenance(provenance);
  const result = await callNvidiaModel({
    model, prompt, image, mediaType, maxTokens, baseUrl, apiKey, timeoutMs, fetchImpl,
  });
  // Any coordinate the model emitted is removed before it can be stored or
  // compared: our native bbox is the only provenance this module emits.
  const sanitised = stripModelCoordinates(result.text);
  return {
    capability,
    advisory: true,
    authoritative: false,
    provenance: {
      projectId: provenance.projectId,
      documentId: provenance.documentId,
      pageNumber: Number(provenance.pageNumber),
      boundingBox: {
        x: Number(provenance.boundingBox.x),
        y: Number(provenance.boundingBox.y),
        width: Number(provenance.boundingBox.width),
        height: Number(provenance.boundingBox.height),
      },
      coordinateMode: provenance.coordinateMode || "pixels",
      source: provenance.source || "drawing-region",
    },
    output: sanitised.text,
    modelCoordinatesRemoved: sanitised.coordinatesRemoved,
    // Degenerate filler is a distinct failure from a clean refusal, and must not
    // be read as "nothing was on the page".
    degenerate: isDegenerate(sanitised.text),
    truncated: result.truncated,
    finishReason: result.finishReason,
    usage: result.usage,
    latencyMs: result.latencyMs,
    model: result.model,
  };
};