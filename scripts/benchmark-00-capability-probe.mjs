/**
 * §2-§4 capability audit + §3 deterministic runtime probe.
 * READ-ONLY. No governed writes. No benchmark truth in any prompt.
 */
import { loadProjectEnv, record, secretFingerprint, SCHEMA, parseStructured, auditShape, getTrace } from "./benchmark-drawing-ai.mjs";

const env = loadProjectEnv();
const BOQ_BASE = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const KEY = env.NVIDIA_API_KEY;

console.log("=== A. PROJECT CONFIG (secrets never printed) ===");
console.log(`  BOQ_AI_PROVIDER        = ${env.BOQ_AI_PROVIDER}`);
console.log(`  BOQ_AI_MODEL           = ${env.BOQ_AI_MODEL}`);
console.log(`  NVIDIA_BASE_URL        = ${BOQ_BASE}`);
console.log(`  NVIDIA_API_KEY         = ${secretFingerprint(KEY)}`);
console.log(`  NVIDIA_CV chatBaseUrl  = https://ai.api.nvidia.com/v1/chat/completions (project constant)`);

const CHAT = `${BOQ_BASE}/chat/completions`;

async function chat({ model, messages, maxTokens = 512, schema = null, label }) {
  const started = Date.now();
  const body = {
    model, messages, temperature: 0, stream: false, max_tokens: maxTokens,
    ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "bench", schema, strict: true } } } : { response_format: { type: "json_object" } }),
    chat_template_kwargs: { enable_thinking: false },
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180000);
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
    const err = !r.ok ? (json?.error?.message || txt.slice(0, 300)) : null;
    record({
      label, provider: "NVIDIA_NIM", model, requestMode: schema ? "json_schema" : "json_object",
      imageIncluded: false, httpStatus: r.status, latencyMs, error: err,
      rawResponse: r.ok ? String(content).slice(0, 2000) : String(txt).slice(0, 600),
      usage: json?.usage ?? null,
    });
    return { ok: r.ok, status: r.status, latencyMs, content, err, json };
  } catch (e) {
    const latencyMs = Date.now() - started;
    record({ label, provider: "NVIDIA_NIM", model, imageIncluded: false, latencyMs, error: String(e?.message || e), rawResponse: null });
    return { ok: false, status: 0, latencyMs, content: null, err: String(e?.message || e) };
  } finally { clearTimeout(t); }
}

console.log("\n=== B. TRANSPORT / CREDENTIAL / ROUTING PROBE (neutral, no project answer) ===");
const ping = await chat({
  label: "probe/ping",
  model: env.BOQ_AI_MODEL,
  messages: [
    { role: "system", content: "Return one JSON object only." },
    { role: "user", content: 'Return JSON: {"ok":true,"echo":"TRANSPORT_OK"}' },
  ],
  maxTokens: 128,
});
console.log(`  configured model (${env.BOQ_AI_MODEL}): HTTP ${ping.status} ok=${ping.ok} ${ping.latencyMs}ms`);
if (ping.content) console.log(`  reply: ${String(ping.content).slice(0, 200)}`);
if (ping.err) console.log(`  error: ${ping.err}`);

console.log("\n=== C. STRUCTURED-OUTPUT COMPLIANCE (neutral schema, no project answer) ===");
const struct = await chat({
  label: "probe/structured",
  model: env.BOQ_AI_MODEL,
  messages: [
    { role: "system", content: "You classify a FICTIONAL fire-alarm drawing token. Return JSON only." },
    { role: "user", content: 'Fictional token "ZZ". No legend exists. Classify it. If nothing supports a meaning, say UNKNOWN.' },
  ],
  maxTokens: 600, schema: SCHEMA,
});
let shape = { ok: false, missing: [], notes: ["not run"] };
if (struct.ok) {
  const obj = parseStructured(struct.content);
  shape = auditShape(obj);
  console.log(`  HTTP ${struct.status}; schema-shaped=${shape.ok}; missing=${JSON.stringify(shape.missing)}`);
  console.log(`  reply: ${String(struct.content).slice(0, 700)}`);
  if (obj) console.log(`  EVIDENCE_STATE=${obj.EVIDENCE_STATE} ACTION=${obj.RECOMMENDED_ACTION} CLASS=${JSON.stringify(obj.BEST_SUPPORTED_PROJECT_CLASS)} CONF=${obj.CONFIDENCE_0_TO_100}`);
} else console.log(`  failed: ${struct.err}`);

console.log("\n=== D. VISION MODEL ROUTING PROBE (does the account serve a VLM?) ===");
// 1x1 PNG - proves an image-bearing request is accepted vs rejected, no project content.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
for (const m of [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-parse-2.0",
]) {
  const v = await chat({
    label: `probe/vision/${m}`,
    model: m,
    messages: [{ role: "user", content: [
      { type: "text", text: "Reply with JSON {\"ok\":true} only." },
      { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
    ] }],
    maxTokens: 200,
  });
  console.log(`  ${m}: HTTP ${v.status} ok=${v.ok} ${v.latencyMs}ms ${v.err ? "err=" + String(v.err).slice(0, 160) : "reply=" + String(v.content).slice(0, 120)}`);
}

console.log("\n=== SUMMARY ===");
for (const t of getTrace()) {
  console.log(`  ${t.label} | ${t.model} | http=${t.httpStatus ?? "-"} | ${t.latencyMs}ms | err=${t.error ? "YES" : "no"}`);
}
