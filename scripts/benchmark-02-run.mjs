/**
 * §7-§13 THE BENCHMARK.
 *
 * Two-stage in-product architecture:
 *   STAGE 1  vision VLM  -> structured VISUAL observations only (no meaning)
 *   STAGE 2  Nemotron    -> engineering reconciliation vs project evidence
 *
 * Both stages call PROJECT-OWNED provider abstractions with PROJECT credentials.
 * The coding agent's own vision is never used to answer.
 * Benchmark truth is never placed in a prompt.
 * No governed writes of any kind.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  loadProjectEnv, record, SCHEMA, parseStructured, auditShape,
  RUN_ID, OUT_DIR, PROJECT_ID,
} from "./benchmark-drawing-ai.mjs";

const env = loadProjectEnv();
const KEY = env.NVIDIA_API_KEY;
const CHAT = `${(env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "")}/chat/completions`;
const VISION_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
const REASON_MODEL = env.BOQ_AI_MODEL;
const EVIDENCE = JSON.parse(readFileSync("out/benchmark/cases/evidence.json", "utf8"));
mkdirSync(OUT_DIR, { recursive: true });

const fmt = (rows, keys) => rows.map(r => keys.map(k => r[k]).join(" | ")).join("\n");

const PROJECT_EVIDENCE_BLOCK = `
GOVERNED PROJECT LEGEND ROWS (approved, from the project's ELV legend sheet):
${fmt(EVIDENCE.governedLegendRows, ["abbreviation", "description"])}

APPROVED DRAWING SYMBOL DEFINITIONS (current recognition authority):
${fmt(EVIDENCE.approvedSymbolDefinitions, ["abbreviation", "description"])}

RELEVANT DRAWING NOTE / LEGEND TEXT FOUND IN THE PROJECT DOCUMENTS:
${EVIDENCE.drawingNotes.map(n => `- ${String(n).replace(/\s+/g, " ").slice(0, 150)}`).join("\n")}
`;

async function callModel({ model, messages, maxTokens, schema, label, imageIncluded }) {
  // Bounded retry ONLY for transient upstream exhaustion. A rate limit is not a
  // signal to retry harder, and a model refusal is never retried.
  const MAX_ATTEMPTS = 3;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await callModelOnce({ model, messages, maxTokens, schema, label, imageIncluded, attempt });
    if (last.ok) return last;
    const transient = /ResourceExhausted|rate limit|429|502|503|504|timed out/i.test(String(last.err || ""));
    if (!transient || attempt === MAX_ATTEMPTS) return last;
    const backoff = 4000 * attempt;
    console.log(`      [retry ${attempt}/${MAX_ATTEMPTS - 1}] transient upstream issue; backing off ${backoff}ms`);
    await new Promise(r => setTimeout(r, backoff));
  }
  return last;
}

async function callModelOnce({ model, messages, maxTokens, schema, label, imageIncluded, attempt = 1 }) {
  const started = Date.now();
  const body = {
    model, messages, temperature: 0, stream: false, max_tokens: maxTokens,
    ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "bench", schema, strict: true } } } : { response_format: { type: "json_object" } }),
    chat_template_kwargs: { enable_thinking: false },
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 240000);
  try {
    const r = await fetch(CHAT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, accept: "application/json" },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch {}
    const latencyMs = Date.now() - started;
    const content = json?.choices?.[0]?.message?.content ?? null;
    record({
      label, provider: "NVIDIA_NIM", model, attempt,
      requestMode: schema ? "json_schema" : "json_object",
      imageIncluded: imageIncluded ? "YES" : "NO",
      projectEvidenceIds: EVIDENCE.governedLegendRows.map(r => `legend:${r.abbreviation}`).slice(0, 12),
      webEvidenceIds: [],
      promptVersion: label.split("/")[0],
      httpStatus: r.status, latencyMs,
      error: r.ok ? null : (json?.error?.message || txt.slice(0, 300)),
      rawStructuredResponse: content ? String(content).slice(0, 4000) : null,
      usage: json?.usage ?? null,
    });
    return { ok: r.ok, content, latencyMs, status: r.status, err: r.ok ? null : (json?.error?.message || "http error") };
  } catch (e) {
    record({ label, provider: "NVIDIA_NIM", model, attempt, imageIncluded: imageIncluded ? "YES" : "NO", latencyMs: Date.now() - started, error: String(e?.message || e), rawStructuredResponse: null });
    return { ok: false, content: null, err: String(e?.message || e), latencyMs: Date.now() - started };
  } finally { clearTimeout(t); }
}

// ---------------- CASE DEFINITIONS (no truth disclosed) --------------------
const CASES = [
  {
    id: "A", name: "T-symbol",
    question: "What project device or class does the target in the image represent?",
    images: ["A-T-device"],
    extra: "The image is a crop from a fire-alarm plan sheet.",
  },
  {
    id: "B", name: "S-plus-C",
    question: `In the image, a schedule cell shows a drawn enclosure containing the letter "S", followed immediately to the right by a second letter.
Is that second letter "C" best understood as: (a) an independent device class, (b) a modifier or qualifier of the enclosure, (c) a schedule/table structural element, or (d) unresolved?`,
    images: ["B-Splus-modifier", "B-context-row"],
    extra: "The second image is the wider schedule row containing the target cell.",
  },
  {
    id: "C", name: "S-plus-H",
    question: `Two images are supplied. Image 1 is a schedule cell showing a drawn enclosure containing "S" with a second letter beside it. Image 2 is the project's governing ELV legend block for detectors.
Identify the semantic relation the legend establishes for this structure, and say which project class it corresponds to.`,
    images: ["C-combined-cell", "C-legend-detectors"],
    extra: "",
  },
  {
    id: "D", name: "HC-unknown",
    question: `In the image, a schedule cell shows a drawn enclosure containing the letter "S", followed immediately to the right by the two-letter token "HC".
What does "HC" mean in this project?`,
    images: ["D-unknown-token"],
    extra: `If the project evidence does not establish a meaning for "HC", you MUST answer UNKNOWN / INSUFFICIENT EVIDENCE. Do NOT expand the abbreviation from general industry practice, and do NOT invent a meaning. A confident guess is a failure.`,
  },
];

const VLM_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    VISIBLE_TEXT: { type: "array", items: { type: "string" } },
    VISIBLE_GLYPHS: { type: "array", items: { type: "string" } },
    GLYPH_COUNT: { type: "integer" },
    ENCLOSURE_SHAPE: { type: "string" },
    LETTER_INSIDE_ENCLOSURE: { type: "string" },
    TEXT_TO_RIGHT_OF_ENCLOSURE: { type: "string" },
    QUANTITY_TEXT_VISIBLE: { type: "string" },
    GROUPING: { type: "string" },
    NEIGHBOURING_TOKENS: { type: "array", items: { type: "string" } },
    IS_THIS_A_LEGEND_DEFINITION_ROW: { type: "string", enum: ["YES", "NO", "UNCLEAR"] },
    OBSERVATION_CONFIDENCE_0_TO_100: { type: "integer" },
  },
  required: ["VISIBLE_TEXT", "VISIBLE_GLYPHS", "GLYPH_COUNT", "ENCLOSURE_SHAPE", "LETTER_INSIDE_ENCLOSURE",
    "TEXT_TO_RIGHT_OF_ENCLOSURE", "QUANTITY_TEXT_VISIBLE", "GROUPING", "NEIGHBOURING_TOKENS",
    "IS_THIS_A_LEGEND_DEFINITION_ROW", "OBSERVATION_CONFIDENCE_0_TO_100"],
};

const imgById = Object.fromEntries(EVIDENCE.images.map(i => [i.id, i]));

function stage1(caseDef, runN) {
  const content = [{ type: "text", text:
`You are performing a VISUAL OBSERVATION pass on a fire-alarm engineering drawing crop.
Describe ONLY what is visibly present. Do NOT interpret, classify, or assign any engineering meaning.
Do not guess at abbreviations. Report glyphs exactly as they appear.

${caseDef.extra}

${caseDef.question}` }];
  for (const id of caseDef.images) {
    const img = imgById[id];
    const b64 = readFileSync(img.file).toString("base64");
    content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } });
    content.push({ type: "text", text: `(above: image ${id} from sheet ${img.sheet}, cropped at viewport x=${Math.round(img.x)} y=${Math.round(img.y)})` });
  }
  return callModel({
    model: VISION_MODEL, messages: [{ role: "user", content }],
    maxTokens: 1500, schema: VLM_SCHEMA, label: `${caseDef.id}/run${runN}/stage1-vision`, imageIncluded: true,
  });
}

function stage2(caseDef, runN, visual) {
  const sys = `You are reconciling a fire-alarm drawing observation against GOVERNED PROJECT EVIDENCE for project ${PROJECT_ID}.
Rules you must follow:
- Base conclusions ONLY on the supplied project evidence. Never on general industry convention.
- If the evidence does not establish something, say UNKNOWN and set EVIDENCE_GAPS.
- You MUST be allowed to answer UNKNOWN. An honest UNKNOWN is correct; a confident guess is a failure.
- Distinguish a drawn enclosure + letter from a plain-text abbreviation.
Return JSON only.`;
  const user = `STAGE 1 VISUAL OBSERVATIONS (from the vision model on the actual drawing crop):
${JSON.stringify(visual, null, 2)}

${PROJECT_EVIDENCE_BLOCK}

QUESTION:
${caseDef.question}

Return the required JSON object.`;
  return callModel({
    model: REASON_MODEL,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    maxTokens: 1800, schema: SCHEMA, label: `${caseDef.id}/run${runN}/stage2-reason`, imageIncluded: false,
  });
}

const results = [];
const only = process.argv[2];
for (const caseDef of CASES) {
  if (only && caseDef.id !== only) continue;
  for (const runN of [1, 2]) {
    const s1 = await stage1(caseDef, runN);
    const vis = s1.ok ? parseStructured(s1.content) : null;
    const vShape = auditShape(vis);
    if (!vis) console.log(`  [${caseDef.id} run${runN}] STAGE1 FAILED: ${s1.err || "unparseable"}`);
    const s2 = await stage2(caseDef, runN, vis || { error: "vision stage unavailable" });
    const out = s2.ok ? parseStructured(s2.content) : null;
    const rShape = auditShape(out);
    results.push({ case: caseDef.id, name: caseDef.name, run: runN, vision: vis, visionShape: vShape.ok, final: out, finalShape: rShape.ok, visionMissing: rShape.missing, stage2Err: s2.err });
    console.log(`  [${caseDef.id} run${runN}] vision=${vis ? "OK" : "FAIL"} final=${out ? "OK" : "FAIL"} ${s2.latencyMs}ms`);
    if (out) console.log(`      CLASS=${JSON.stringify(out.BEST_SUPPORTED_PROJECT_CLASS)} STATE=${out.EVIDENCE_STATE} ACTION=${out.RECOMMENDED_ACTION} CONF=${out.CONFIDENCE_0_TO_100}`);
  }
}
writeFileSync(`${OUT_DIR}/results-${RUN_ID}.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT_DIR}/results-${RUN_ID}.json`);
