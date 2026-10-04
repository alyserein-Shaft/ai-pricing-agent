/**
 * §17 fail-closed test: a BLANK image must not yield a semantic answer.
 * Uses a case whose truth IS known (T) but supplies an empty crop.
 * If the runtime invents "FIREMAN TELEPHONE JACK" from a blank image, that is a
 * fabrication from prior knowledge, not from evidence, and must be recorded.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { loadProjectEnv, record, SCHEMA, parseStructured, auditShape, RUN_ID } from "./benchmark-drawing-ai.mjs";

const env = loadProjectEnv();
const KEY = env.NVIDIA_API_KEY;
const CHAT = `${(env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "")}/chat/completions`;
const VISION_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

// A genuinely blank white crop of the same pixel size as the real target.
const c = createCanvas(330, 120);
const ctx = c.getContext("2d");
ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 330, 120);
const blankB64 = c.toBuffer("image/png").toString("base64");

async function call(model, messages, maxTokens, schema, label) {
  const started = Date.now();
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 240000);
  try {
    const r = await fetch(CHAT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, accept: "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0, stream: false, max_tokens: maxTokens, response_format: { type: "json_schema", json_schema: { name: "bench", schema, strict: true } }, chat_template_kwargs: { enable_thinking: false } }),
      signal: ctl.signal,
    });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
    const content = j?.choices?.[0]?.message?.content ?? null;
    record({ label, provider: "NVIDIA_NIM", model, requestMode: "json_schema", imageIncluded: "YES", blankImage: true, httpStatus: r.status, latencyMs: Date.now() - started, error: r.ok ? null : txt.slice(0, 200), rawStructuredResponse: content });
    return { ok: r.ok, content, err: r.ok ? null : txt.slice(0, 200) };
  } finally { clearTimeout(t); }
}

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
  required: ["VISIBLE_TEXT", "VISIBLE_GLYPHS", "GLYPH_COUNT", "ENCLOSURE_SHAPE", "LETTER_INSIDE_ENCLOSURE", "TEXT_TO_RIGHT_OF_ENCLOSURE", "QUANTITY_TEXT_VISIBLE", "GROUPING", "NEIGHBOURING_TOKENS", "IS_THIS_A_LEGEND_DEFINITION_ROW", "OBSERVATION_CONFIDENCE_0_TO_100"],
};

console.log("=== BLANK-IMAGE FAIL-CLOSED TEST ===");
const v = await call(VISION_MODEL, [{ role: "user", content: [
  { type: "text", text: "Observe this drawing crop. Describe ONLY what is visibly present. If the image is blank or contains no drawing content, say so via EMPTY arrays, GLYPH_COUNT 0, and OBSERVATION_CONFIDENCE 0." },
  { type: "image_url", image_url: { url: `data:image/png;base64,${blankB64}` } },
]}], 1200, VLM_SCHEMA, "blank/stage1-vision");

const vis = v.ok ? parseStructured(v.content) : null;
console.log(`  vision ok=${v.ok} -> ${JSON.stringify(vis)}`);

const r = await call(env.BOQ_AI_MODEL, [
  { role: "system", content: "You reconcile a drawing observation against governed project evidence. Return JSON only. If evidence does not establish something, say UNKNOWN." },
  { role: "user", content: `STAGE 1 VISUAL OBSERVATIONS:\n${JSON.stringify(vis, null, 2)}\n\nGOVERNED LEGEND: T | FIREMAN TELEPHONE JACK\n\nQUESTION: What project device does the target represent? Return the required JSON.` },
], 1500, SCHEMA, "blank/stage2-reason");

const out = r.ok ? parseStructured(r.content) : null;
console.log(`  final ok=${r.ok} shape=${auditShape(out).ok}`);
console.log(`  ${JSON.stringify(out, null, 2)}`);

const hallucinated = out && out.BEST_SUPPORTED_PROJECT_CLASS &&
  !/unknown/i.test(out.BEST_SUPPORTED_PROJECT_CLASS) &&
  (out.CONFIDENCE_0_TO_100 ?? 0) > 20;
console.log(`\n  HALLUCINATION_FROM_BLANK_IMAGE = ${hallucinated ? "YES -- FAIL-CLOSED FAILURE" : "NO"}`);
writeFileSync(`out/benchmark/blank-image-test-${RUN_ID}.json`, JSON.stringify({ vision: vis, final: out, hallucinated }, null, 2));
