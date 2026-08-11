import { BOQ_UNDERSTANDING_RESPONSE_SCHEMA } from "../app/domain/boq-understanding-engine.mjs";

export function createConfiguredCloudflareStructuredProvider(env = {}, { schema, maxTokens = 1800, runtime = {} } = {}) {
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
        response_format: { type: "json_schema", json_schema: schema },
        temperature: 0,
        max_tokens: maxTokens,
      });
      const value = result?.response ?? result;
      return typeof value === "string" ? JSON.parse(value) : value;
    },
  };
}

const goldenFact = (value, origin = "INFERRED", confidence = 90) => ({
  value,
  origin,
  confidence,
});

const goldenMissing = () => goldenFact(null, "MISSING", 0);

const goldenUnderstandingOutput = (input = {}) => {
  const description = String(input.description || "").trim();
  const partNumber = String(input.modelText || "").trim();
  const lower = description.toLowerCase();

  const base = {
    normalizedDescription: goldenFact(description, "EXTRACTED", 100),
    system: goldenFact(input.system || "Fire Alarm", input.system ? "EXTRACTED" : "INFERRED", input.system ? 100 : 90),
    category: goldenMissing(),
    subcategory: goldenMissing(),
    equipmentType: goldenMissing(),
    productFamily: goldenMissing(),
    attributes: {},
    manufacturerPreferences: [],
    manufacturerRestrictions: [],
    standards: [],
    compatibilityRequirements: [],
    requiredAccessories: [],
    searchTerms: [],
    missingInformation: [],
    ambiguities: [],
    engineeringNotes: [],
    confidence: "MEDIUM",
  };

  if (partNumber === "GOLDEN-FA-001") {
    return {
      ...base,
      category: goldenFact("Detection Device"),
      subcategory: goldenFact("Smoke Detector"),
      equipmentType: goldenFact("Addressable Detector"),
      productFamily: goldenFact("Addressable Detector"),
      manufacturerPreferences: [goldenFact("Golden Manufacturer")],
      searchTerms: [
        goldenFact("GOLDEN-FA-001", "EXTRACTED", 100),
        goldenFact("addressable detector"),
      ],
      engineeringNotes: [
        goldenFact("Exact model remains subject to governed Product Matching and engineer review."),
      ],
      confidence: "HIGH",
    };
  }

  if (lower.includes("interface module")) {
    return {
      ...base,
      category: goldenFact("Interface Module"),
      subcategory: goldenFact("Addressable Interface Module"),
      equipmentType: goldenFact("Addressable Interface Module"),
      productFamily: goldenFact("Interface Module"),
      searchTerms: [goldenFact("addressable interface module", "EXTRACTED", 100)],
      missingInformation: [
        goldenFact("Manufacturer"),
        goldenFact("Exact model"),
      ],
      ambiguities: [
        goldenFact("Manufacturer and exact model are not stated in the supplied evidence."),
      ],
      engineeringNotes: [
        goldenFact("Identity must remain unresolved until engineer clarification."),
      ],
      confidence: "LOW",
    };
  }

  if (partNumber === "GOLDEN-NOMATCH-001") {
    return {
      ...base,
      category: goldenFact("Annunciator"),
      subcategory: goldenFact("Specialized Annunciator"),
      equipmentType: goldenFact("Specialized Annunciator"),
      productFamily: goldenFact("Annunciator"),
      manufacturerPreferences: [goldenFact("Golden Manufacturer")],
      searchTerms: [
        goldenFact("GOLDEN-NOMATCH-001", "EXTRACTED", 100),
        goldenFact("specialized annunciator"),
      ],
      engineeringNotes: [
        goldenFact("No catalog product is inferred by BOQ Understanding."),
      ],
      confidence: "HIGH",
    };
  }

  return {
    ...base,
    missingInformation: [goldenFact("Engineering classification")],
    ambiguities: [goldenFact("Golden fixture row is outside the deterministic understanding cases.")],
    confidence: "LOW",
  };
};

export function createConfiguredBoqUnderstandingProvider(env = {}, runtime = {}) {
  if (
    String(env.GOLDEN_E2E || "") === "1" &&
    String(env.GOLDEN_BOQ_UNDERSTANDING_PROVIDER || "") === "deterministic"
  ) {
    return {
      metadata: {
        provider: "golden-e2e",
        model: "deterministic-fixture",
        modelVersion: "1",
      },
      async interpret({ input }) {
        return goldenUnderstandingOutput(input);
      },
    };
  }

  return createConfiguredCloudflareStructuredProvider(env, {
    schema: BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
    maxTokens: 1800,
    runtime,
  });
}
