import {
  buildBoqUnderstandingPrompt,
  prepareBoqUnderstandingInput,
  validateAndMergeBoqInterpretation,
  validateBoqUnderstandingResponseSchema,
} from "../app/domain/boq-understanding-engine.mjs";
import {
  boqUnderstandingProviderReadiness,
  createConfiguredBoqUnderstandingProvider,
} from "./boq-understanding-provider.mjs";

const PATH = "/api/dev/boq-ai/native-smoke";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const localHost = (hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
const provenanceStates = (value) => {
  const states = new Set();
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return;
    if (typeof entry.origin === "string") states.add(entry.origin);
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return [...states].sort();
};

export async function handleBoqAiDiagnosticApi(request, env = {}) {
  const url = new URL(request.url);
  if (url.pathname !== PATH) return null;
  if (env.BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED !== "1" || !localHost(url.hostname)) {
    return json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
  }
  if (!['GET', 'POST'].includes(request.method)) return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405);
  if (url.search) return json({ error: { code: "FIXED_PAYLOAD_ONLY", message: "This diagnostic accepts no request parameters." } }, 400);
  const body = await request.text();
  if (body.trim()) return json({ error: { code: "FIXED_PAYLOAD_ONLY", message: "This diagnostic accepts no request payload." } }, 400);

  const readiness = boqUnderstandingProviderReadiness(env);
  const provider = createConfiguredBoqUnderstandingProvider(env, {
    diagnosticLogger: (diagnostic) => console.error("BOQ_AI_PROVIDER_DIAGNOSTIC", JSON.stringify(diagnostic)),
  });
  if (!provider) return json({ reachedCloudflare: false, readiness, errorCategory: readiness.state === "Misconfigured" ? "MISCONFIGURED" : "AI_BINDING_MISSING" }, 503);

  const input = prepareBoqUnderstandingInput({
    id: "fictional-native-smoke",
    description: "Addressable optical smoke detector with built-in isolator",
    numericQuantity: 10,
    normalizedUnit: "No",
  });
  try {
    const raw = await provider.interpret({ input, prompt: buildBoqUnderstandingPrompt(input) });
    validateBoqUnderstandingResponseSchema(raw);
    const validated = validateAndMergeBoqInterpretation(input, raw);
    return json({
      reachedCloudflare: true,
      readiness,
      provider: provider.metadata.provider,
      model: provider.metadata.model,
      schemaValid: true,
      jsonModeHonored: true,
      status: validated.status,
      result: validated.interpretation,
      provenanceStates: provenanceStates(validated.interpretation),
      durationMs: provider.lastCallMetadata?.durationMs ?? null,
      usage: provider.lastCallMetadata?.usage ?? null,
      errorCategory: null,
    });
  } catch (error) {
    const timedOut = error?.code === "AI_PROVIDER_TIMEOUT";
    const providerError = timedOut || error?.code === "AI_PROVIDER_ERROR";
    return json({
      reachedCloudflare: !providerError,
      readiness: providerError ? { ...readiness, state: "Provider error", detail: "Workers AI could not complete the request." } : readiness,
      provider: provider.metadata.provider,
      model: provider.metadata.model,
      schemaValid: false,
      jsonModeHonored: false,
      result: null,
      provenanceStates: [],
      durationMs: provider.lastCallMetadata?.durationMs ?? null,
      usage: provider.lastCallMetadata?.usage ?? null,
      errorCategory: timedOut ? "AI_PROVIDER_TIMEOUT" : providerError ? "AI_PROVIDER_ERROR" : "AI_OUTPUT_INVALID",
    }, 502);
  }
}
