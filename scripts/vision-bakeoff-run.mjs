// Runs the fixed Golden packet against a named candidate and records raw
// evidence. One code path for every candidate so the prompt, images and scorer
// are provably identical.
//
//   node scripts/vision-bakeoff-run.mjs <candidate>
//     baseline          Cloudflare @cf/llava-hf/llava-1.5-7b-hf (current production)
//     glm               z-ai/glm-5-3-flash
//     cosmos            nvidia/cosmos3-nano-reasoner
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CASES, VISION_PROMPT, RUBRIC, RUN_ID, OUT_DIR, scoreCase, aggregate, record, transportFor, requestMetadataFor, NEMOTRON_OMNI_MODEL } from "./vision-bakeoff-packet.mjs";

const loadEnv = () => {
  const env = {};
  for (const f of [".dev.vars", ".dev.vars.golden"]) {
    let txt; try { txt = readFileSync(f, "utf8"); } catch { continue; }
    for (const line of txt.split("\n")) { const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
    break;
  }
  return env;
};
const env = loadEnv();
const CASES_DIR = "out/benchmark/cases";

const CANDIDATES = {
  baseline: { label: "LLAVA_BASELINE", provider: "cloudflare", model: "@cf/llava-hf/llava-1.5-7b-hf" },
  glm: { label: "GLM_5_3_FLASH", provider: "nvidia_nim", model: "z-ai/glm-5.3-flash" },
  cosmos: { label: "COSMOS3_NANO_REASONER", provider: "nvidia_nim", model: "nvidia/cosmos3-nano-reasoner" },
  nemotron: { label: "NEMOTRON_3_NANO_OMNI", provider: "nvidia_nim", model: NEMOTRON_OMNI_MODEL },
};

const which = process.argv[2];
const cand = CANDIDATES[which];
if (!cand) { console.error(`usage: node scripts/vision-bakeoff-run.mjs <${Object.keys(CANDIDATES).join("|")}>`); process.exit(2); }

// Per-call deadline, matching production DEFAULT_VISION_TIMEOUT_MS.
const DEADLINE_MS = Number(process.env.VISION_BAKEOFF_TIMEOUT_MS || 30_000);

// The native Workers AI binding exposes no AbortSignal, so this reproduces the
// same bounded behaviour with an explicit controller.
const callWithDeadline = async (fn) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEADLINE_MS);
  const t0 = Date.now();
  try {
    return { ...(await fn(ac.signal)), latencyMs: Date.now() - t0 };
  } finally { clearTimeout(timer); }
};

// TRANSPORT NOTE (documented deviation, benchmark-only):
// The ceiling lives in vision-bakeoff-packet.mjs (NIM_TRANSPORT_MAX_TOKENS) as
// the single source of truth for BOTH the transmitted body and the audit row.
// max_tokens 400 was the LLaVA baseline's cap and truncates GLM mid-answer
// (observed finish_reason=length at 400, finish_reason=stop at 586 tokens).
// The task prompt, cases, truth, rubric weights and penalties are untouched.

// AUDIT FIX: the transmitted ceiling now comes from the shared transport
// resolver, so the recorded audit row and the real request cannot diverge.
const TRANSPORT = transportFor(cand);

const callNim = async (model, imageBytes, prompt, signal) => {
  const base = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: TRANSPORT.temperature ?? 0, max_tokens: TRANSPORT.maxTokens,
      // Official Nemotron reasoning control. Transmitted only when the profile
      // defines one; recorded verbatim in the audit row via requestMetadataFor.
      ...(TRANSPORT.reasoningBudget ? { reasoning_budget: TRANSPORT.reasoningBudget } : {}),
      // NOTE: chat_template_kwargs.enable_thinking=false was verified to be
      // IGNORED by this endpoint (reasoning_tokens still ~330). Reasoning is
      // therefore never suppressed by request; instead only
      // choices[0].message.content is scored and reasoning_content is never read,
      // never recorded, and never persisted.
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${imageBytes.toString("base64")}` } },
      ] }],
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    let code = null, msg = text;
    try { code = JSON.parse(text)?.error?.code ?? null; msg = JSON.parse(text)?.error?.message ?? text; } catch {}
    throw Object.assign(new Error(`HTTP ${r.status}: ${msg}`), { code, status: r.status, providerRaw: text.slice(0, 300) });
  }
  const j = JSON.parse(text);
  // Reasoning is an internal diagnostic only: never scored, never persisted.
  // Only the FINAL answer content is read.
  return {
    text: String(j.choices?.[0]?.message?.content ?? ""),
    usage: j.usage ?? null,
    // Operational metadata only -- enables truncation counting.
    finishReason: j.choices?.[0]?.finish_reason ?? null,
    reasoningTokens: j.usage?.completion_tokens_details?.reasoning_tokens ?? null,
  };
};

const results = [];
for (const c of CASES) {
  const bytes = readFileSync(`${CASES_DIR}/${c.file}`);
  const started = Date.now();
  let text = "", errored = false, errInfo = null, usage = null, status = null;
  let finishReason = null, reasoningTokens = null;
  try {
    const out = await callWithDeadline(
      (signal) => cand.provider === "cloudflare"
        ? fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${cand.model}`, {
            method: "POST", signal,
            headers: { Authorization: `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ image: Array.from(bytes), prompt: VISION_PROMPT, max_tokens: TRANSPORT.maxTokens }),
          }).then(async (r) => {
            const t = await r.text();
            if (!r.ok) { let code = null, m = t; try { const j = JSON.parse(t); code = j?.errors?.[0]?.code ?? null; m = j?.errors?.[0]?.message ?? t; } catch {} throw Object.assign(new Error(`HTTP ${r.status}: ${m}`), { code, status: r.status }); }
            const j = JSON.parse(t);
            return { text: typeof j.result === "string" ? j.result : String(j.result?.description ?? ""), usage: j.usage ?? null };
          })
        : callNim(cand.model, bytes, VISION_PROMPT, signal),
    );
    text = out.text; usage = out.usage;
    finishReason = out.finishReason ?? null;
    reasoningTokens = out.reasoningTokens ?? null;
  } catch (e) {
    errored = true;
    errInfo = { message: String(e.message).slice(0, 300), code: e.code ?? null, status: e.status ?? null, name: e.name ?? null };
    status = e.status ?? null;
  }
  const latencyMs = Date.now() - started;
  const parseOk = typeof text === "string" && text.trim().length > 0;
  const sc = scoreCase(c, { text, parseOk, latencyMs, errored });
  results.push(sc);
  record({
    runId: RUN_ID, candidate: cand.label, provider: cand.provider, model: cand.model,
    caseId: c.id, caseKind: c.kind, imageFile: c.file, imageBytes: bytes.length,
    promptVersion: "golden-drawing-vision/1", promptSha: VISION_PROMPT.length,
    request: requestMetadataFor(cand, DEADLINE_MS),
    httpStatus: status, latencyMs, error: errInfo, usage,
    // Operational metadata only. Reasoning TEXT is never read or persisted;
    // only a provider-reported token count, which cannot leak chain-of-thought.
    finishReason, reasoningTokens,
    finalResponse: text ? String(text).slice(0, 4000) : null,
    parseOk, scorerResult: sc,
    referenceExpected: c.expected,
  });
  console.log(`[${cand.label}] ${c.id} (${c.kind}) ${latencyMs}ms ${errored ? `ERR ${errInfo.code ?? errInfo.status}` : `score ${sc.score.toFixed(1)}`} ${errored ? "" : `penalties=[${sc.penalties.join(",")}]`}`);
}

const agg = aggregate(results);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/score-${which}.json`, JSON.stringify({
  runId: RUN_ID, candidate: cand.label, provider: cand.provider, model: cand.model,
  rubric: RUBRIC, cases: results, aggregate: agg,
}, null, 2));
console.log(`\n${cand.label} (${cand.model}) TOTAL = ${agg.total}/100`);
console.log(`  dimensions: ${JSON.stringify(agg.dimensionScores)}`);
console.log(`  penaltyTotal=${agg.penaltyTotal} hallucinatedPrintedQuantities=${agg.hallucinatedPrintedQuantities}`);