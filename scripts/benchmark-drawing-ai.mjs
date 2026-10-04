/**
 * AL MOUSA — IN-PRODUCT DRAWING AI BENCHMARK HARNESS (diagnostic only).
 *
 * AUTHORITY: none. This harness performs NO database writes, NO governed
 * approvals and NO Product Knowledge promotion. It only calls the project's
 * own AI provider abstractions and records what they returned.
 *
 * It reuses project-owned code paths:
 *   - app/domain/nvidia-drawing-probe.mjs   (vision: image_url payloads)
 *   - worker/boq-understanding-provider.mjs  (text reasoning: chat completions)
 *
 * The coding agent's own multimodal ability is NOT used for any semantic answer.
 * Benchmark truth is never placed in a prompt.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

export const RUN_ID = process.env.BENCH_RUN_ID || "bench-drawing-ai-run1";
export const OUT_DIR = "out/benchmark";

// --- project credentials, read from the project's own env file -------------
export function loadProjectEnv() {
  const env = {};
  for (const f of [".dev.vars", ".dev.vars.golden"]) {
    let txt;
    try { txt = readFileSync(f, "utf8"); } catch { continue; }
    for (const line of txt.split("\n")) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    break;
  }
  return env;
}

export const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

/** Never log a secret. Only its presence and length. */
export const secretFingerprint = (v) => (v ? `present(len=${String(v).length})` : "ABSENT");

const trace = [];
export function record(entry) {
  const row = { runId: RUN_ID, ...entry };
  trace.push(row);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/trace-${RUN_ID}.json`, JSON.stringify(trace, null, 2));
  return row;
}
export const getTrace = () => trace;

// --- structured output contract the model must satisfy --------------------
export const REQUIRED_FIELDS = [
  "TARGET", "VISUAL_OBSERVATION", "STRUCTURAL_ROLE", "BEST_SUPPORTED_PROJECT_CLASS",
  "PROJECT_EVIDENCE_USED", "MANUFACTURER_OR_WEB_EVIDENCE_USED", "CONTRADICTIONS",
  "EVIDENCE_GAPS", "CONFIDENCE_0_TO_100", "EVIDENCE_STATE", "RECOMMENDED_ACTION",
];

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    TARGET: { type: "string" },
    VISUAL_OBSERVATION: { type: "string" },
    STRUCTURAL_ROLE: {
      type: "string",
      enum: ["DEVICE_SYMBOL", "DEVICE_SCHEDULE_COLUMN", "GROUP_HEADER", "CHILD_COLUMN",
        "QUANTITY_CELL", "LEGEND_DEFINITION", "ANNOTATION", "DETAIL_SAMPLE",
        "NON_DEVICE_STRUCTURE", "UNKNOWN"],
    },
    BEST_SUPPORTED_PROJECT_CLASS: { type: "string" },
    PROJECT_EVIDENCE_USED: { type: "array", items: { type: "string" } },
    MANUFACTURER_OR_WEB_EVIDENCE_USED: { type: "array", items: { type: "string" } },
    CONTRADICTIONS: { type: "array", items: { type: "string" } },
    EVIDENCE_GAPS: { type: "array", items: { type: "string" } },
    CONFIDENCE_0_TO_100: { type: "integer" },
    EVIDENCE_STATE: { type: "string", enum: ["CONSISTENT", "PARTIAL", "CONFLICT", "INSUFFICIENT"] },
    RECOMMENDED_ACTION: { type: "string", enum: ["ACCEPT_FACT", "REVIEW", "KEEP_UNKNOWN"] },
  },
  required: REQUIRED_FIELDS,
};

/** Extract JSON from a model reply that may be wrapped in prose or fences. */
export function parseStructured(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/** Which required fields are missing / off-vocabulary. */
export function auditShape(obj) {
  if (!obj) return { ok: false, missing: REQUIRED_FIELDS, notes: ["unparseable"] };
  const missing = REQUIRED_FIELDS.filter((f) => !(f in obj));
  return { ok: missing.length === 0, missing, notes: [] };
}
