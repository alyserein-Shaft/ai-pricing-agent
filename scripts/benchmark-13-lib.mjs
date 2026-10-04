/**
 * AL MOUSA — GEOMETRY-FIRST FAIL-CLOSED BENCHMARK
 *
 * Architectures under test:
 *   OPTION A  deterministic geometry/text  -> text Nemotron
 *   OPTION B  deterministic context + VLM  -> text Nemotron
 *   OPTION C  geometry-first, VLM only as fallback when deterministic is thin
 *
 * Every result passes through the NON-LLM evidence gate. Benchmark truth is
 * never placed in a prompt. No governed writes of any kind.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadProjectEnv, record, parseStructured, RUN_ID, OUT_DIR } from "./benchmark-drawing-ai.mjs";
export { OUT_DIR, parseStructured, record, RUN_ID };
import { buildGeometryPacket, assessRenderValidity, rasterRegion, classifyEnclosure } from "./benchmark-10-geometry.mjs";
import { evaluateEligibility, applyGate, forcedBlockedResult, deriveEvidenceState, EVIDENCE_STATE } from "./benchmark-12-evidence-gate.mjs";

const env = loadProjectEnv();
const KEY = env.NVIDIA_API_KEY;
const CHAT = `${(env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "")}/chat/completions`;
const VLM = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
const REASON = env.BOQ_AI_MODEL;
const SCALE = 6;
const RUNS = 3;

const { loadSheet, renderPage } = await import("../out/coords/authoritative-coords.mjs");
const DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const db = new DatabaseSync(DB, { readOnly: true });
const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

// ---------------- provider call with bounded retry -------------------------
async function call({ model, messages, maxTokens, schema, label, imageIncluded, imageBase64 }) {
  const MAX_ATTEMPTS = 3;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 240000);
    try {
      const r = await fetch(CHAT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, accept: "application/json" },
        body: JSON.stringify({
          model, messages, temperature: 0, stream: false, max_tokens: maxTokens,
          response_format: { type: "json_schema", json_schema: { name: "bench", schema, strict: true } },
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: ctl.signal,
      });
      const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
      const latencyMs = Date.now() - started;
      const content = j?.choices?.[0]?.message?.content ?? null;
      record({ label, provider: "NVIDIA_NIM", model, attempt, requestMode: "json_schema", imageIncluded: imageIncluded ? "YES" : "NO", httpStatus: r.status, latencyMs, error: r.ok ? null : (j?.error?.message || txt.slice(0, 200)), rawStructuredResponse: content ? String(content).slice(0, 4000) : null });
      last = { ok: r.ok, content, latencyMs, err: r.ok ? null : (j?.error?.message || txt.slice(0, 200)) };
      if (r.ok) return last;
    } catch (e) {
      last = { ok: false, content: null, latencyMs: Date.now() - started, err: String(e?.message || e) };
      record({ label, provider: "NVIDIA_NIM", model, attempt, imageIncluded: imageIncluded ? "YES" : "NO", latencyMs: last.latencyMs, error: last.err, rawStructuredResponse: null });
    } finally { clearTimeout(t); }
    const transient = /ResourceExhausted|rate limit|429|502|503|504|timed out/i.test(String(last.err || ""));
    if (!transient || attempt === MAX_ATTEMPTS) return last;
    await new Promise(r => setTimeout(r, 5000 * attempt));
  }
  return last;
}

// ---------------- schemas --------------------------------------------------
const REASON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    TARGET: { type: "string" },
    BEST_SUPPORTED_PROJECT_CLASS: { type: "string" },
    STRUCTURAL_ROLE: { type: "string", enum: ["DEVICE_SYMBOL", "DEVICE_SCHEDULE_CELL", "GROUP_HEADER", "CHILD_COLUMN", "QUANTITY_CELL", "LEGEND_DEFINITION", "ANNOTATION", "DETAIL_SAMPLE", "NON_DEVICE_STRUCTURE", "UNKNOWN"] },
    PROJECT_EVIDENCE_USED: { type: "array", items: { type: "string" } },
    VISUAL_EVIDENCE_USED: { type: "array", items: { type: "string" } },
    CONTRADICTIONS: { type: "array", items: { type: "string" } },
    EVIDENCE_GAPS: { type: "array", items: { type: "string" } },
    CONFIDENCE_0_TO_100: { type: "integer" },
    EVIDENCE_STATE: { type: "string", enum: ["CONSISTENT", "PARTIAL", "CONFLICT", "INSUFFICIENT"] },
    RECOMMENDED_ACTION: { type: "string", enum: ["ACCEPT_FACT", "REVIEW", "KEEP_UNKNOWN"] },
  },
  required: ["TARGET", "BEST_SUPPORTED_PROJECT_CLASS", "STRUCTURAL_ROLE", "PROJECT_EVIDENCE_USED", "VISUAL_EVIDENCE_USED", "CONTRADICTIONS", "EVIDENCE_GAPS", "CONFIDENCE_0_TO_100", "EVIDENCE_STATE", "RECOMMENDED_ACTION"],
};

const VLM_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    IMAGE_VALID: { type: "string", enum: ["YES", "NO", "UNCLEAR"] },
    TARGET_LOCATED: { type: "string", enum: ["YES", "NO", "UNCLEAR"] },
    VISIBLE_TOKENS: { type: "array", items: { type: "string" } },
    TOKEN_GEOMETRY: { type: "string" },
    ENCLOSURE_SHAPE: { type: "string", enum: ["ROUND", "BOX", "NONE", "OTHER", "UNCLEAR"] },
    NEIGHBORING_TEXT: { type: "array", items: { type: "string" } },
    SYMBOL_GEOMETRY: { type: "string" },
    OCR_UNCERTAINTIES: { type: "array", items: { type: "string" } },
    OBSERVATION_CONFIDENCE: { type: "integer" },
    VISUAL_EVIDENCE_STATE: { type: "string", enum: ["TEXT_AND_GEOMETRY", "TEXT_ONLY", "GEOMETRY_ONLY", "NO_EVIDENCE"] },
  },
  required: ["IMAGE_VALID", "TARGET_LOCATED", "VISIBLE_TOKENS", "TOKEN_GEOMETRY", "ENCLOSURE_SHAPE", "NEIGHBORING_TEXT", "SYMBOL_GEOMETRY", "OCR_UNCERTAINTIES", "OBSERVATION_CONFIDENCE", "VISUAL_EVIDENCE_STATE"],
};

// ---------------- project evidence (SELECT only, no conclusions) -----------
const legend = db.prepare(`SELECT abbreviation, description, structural_confidence conf FROM drawing_structure_approved_rows
  WHERE description LIKE '%DETECTOR%' OR description LIKE '%MANUAL STATION%' OR description LIKE '%TELEPHONE%'
     OR description LIKE '%INTERFACE MODULE%' OR description LIKE '%STROBE%' OR description LIKE '%DOOR CONTACT%'
  GROUP BY abbreviation, description ORDER BY description`).all();
const notes = db.prepare(`SELECT DISTINCT text_content FROM drawing_assets
  WHERE text_content LIKE '%CEILING MOUNTED%' OR text_content LIKE '%TELEPHONE%' OR text_content LIKE '%MULTISENSOR%'
     OR text_content LIKE '%MULTI-SENSOR%' OR text_content LIKE '%COMBINED%'`).all()
  .map(r => String(r.text_content).replace(/\s+/g, " ").trim().slice(0, 160));

const EVIDENCE_BLOCK = `
GOVERNED PROJECT LEGEND ROWS (approved; abbreviation | description):
${legend.map(l => `  ${l.abbreviation ?? "(no abbrev)"} | ${l.description}`).join("\n")}

RELEVANT PROJECT DRAWING TEXT (notes / legend prose found in project documents):
${notes.map(n => `  - ${n}`).join("\n")}
`;

// ---------------- deterministic region classification ----------------------
/** Region type is DERIVED, never asked of the VLM. */
function classifyRegionDeterministic(packet, sheetLogicalName) {
  // Only tokens INSIDE the region count. Using the wider row neighbourhood made a
  // plan symbol inherit the schedule row printed above it, which is exactly the
  // legend-vs-schedule confusion this classifier exists to prevent.
  const inside = packet.tokens.inside.map(t => t.text);
  const qty = inside.filter(t => /\b\d+\s*Nos?\.?\b|\b\d+\s*No\b/i.test(t));
  const isLegendSheet = /AMS-DR-T-00-ZZZ-002/.test(sheetLogicalName);
  if (isLegendSheet) return { regionType: "LEGEND", basis: "sheet is the governing ELV legend sheet" };
  if (qty.length) return { regionType: "SCHEDULE", basis: `quantity token inside the region (${qty.join(", ")})` };
  if (/DR-T-93/.test(sheetLogicalName)) return { regionType: "PLAN", basis: "plan sheet; region contains no quantity token" };
  return { regionType: "UNKNOWN", basis: "no deterministic discriminator" };
}

// ---------------- sheet loading -------------------------------------------
const sheetCache = {};
async function getSheet(like) {
  if (!sheetCache[like]) {
    const sh = await loadSheet(like);
    sh.canvas = await renderPage(sh.page, sh.vp1, SCALE);
    sheetCache[like] = sh;
  }
  return sheetCache[like];
}

export { getSheet, SCALE, classifyRegionDeterministic, EVIDENCE_BLOCK, REASON_SCHEMA, VLM_SCHEMA, VLM, REASON, call, db, PROJECT_ID, RUNS, legend, notes,
  buildGeometryPacket, assessRenderValidity, rasterRegion, classifyEnclosure,
  evaluateEligibility, applyGate, forcedBlockedResult, deriveEvidenceState, EVIDENCE_STATE };
