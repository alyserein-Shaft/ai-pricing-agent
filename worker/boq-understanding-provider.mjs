import { BOQ_UNDERSTANDING_RESPONSE_SCHEMA } from "../app/domain/boq-understanding-engine.mjs";

export function createConfiguredBoqUnderstandingProvider(env = {}, runtime = {}) {
  const providerName = String(env.BOQ_AI_PROVIDER || "").trim();
  const model = String(env.BOQ_AI_MODEL || "").trim();
  const nativeRun = env.AI?.run?.bind(env.AI);
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(env.CLOUDFLARE_AI_API_TOKEN || "").trim();
  const restEnabled = String(env.BOQ_AI_REST_ENABLED || "") === "1";
  const request = runtime.fetch || globalThis.fetch;
  const restRun = restEnabled && accountId && apiToken
    ? async (selectedModel, input) => {
        const response = await request(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${selectedModel}`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const envelope = await response.json().catch(() => null);
        if (!response.ok || envelope?.success === false) throw new Error(`Workers AI request failed with HTTP ${response.status}.`);
        return envelope?.result ?? envelope;
      }
    : null;
  const run = nativeRun || restRun;
  if (providerName !== "cloudflare" || !model || !run) return null;
  return {
    metadata: { provider: "cloudflare", model, modelVersion: String(env.BOQ_AI_MODEL_VERSION || model) },
    async interpret({ prompt }) {
      const result = await run(model, {
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
        response_format: { type: "json_schema", json_schema: BOQ_UNDERSTANDING_RESPONSE_SCHEMA },
        temperature: 0,
        max_tokens: 1800,
      });
      const value = result?.response ?? result;
      return typeof value === "string" ? JSON.parse(value) : value;
    },
  };
}
