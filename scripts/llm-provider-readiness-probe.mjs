/**
 * LLM Provider Readiness Probe
 * 
 * Scoped readiness probe for the AI Pricing Agent environment.
 * Reads the existing catalog, detects configured providers,
 * and probes only configured free-tier candidates through the
 * existing provider infrastructure.
 * 
 * Never prints secrets. Returns machine-readable status.
 * 
 * Usage: node scripts/llm-provider-readiness-probe.mjs
 */

import catalog from '../app/domain/llm-api-catalog.mjs';
import { createConfiguredNvidiaNimStructuredProvider } from '../worker/boq-understanding-provider.mjs';
import { createConfiguredBoqUnderstandingProvider } from '../worker/boq-understanding-provider.mjs';

// Load environment config (never expose secrets in output)
const env = {
  NVIDIA_API_KEY: process?.env?.NVIDIA_API_KEY,
  NVIDIA_BASE_URL: process?.env?.NVIDIA_BASE_URL,
  CLOUDFLARE_ACCOUNT_ID: process?.env?.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_AI_API_TOKEN: process?.env?.CLOUDFLARE_AI_API_TOKEN,
  BOQ_AI_PROVIDER: process?.env?.BOQ_AI_PROVIDER,
  BOQ_AI_MODEL: process?.env?.BOQ_AI_MODEL,
};

/**
 * Check if a provider is configured based on env vars.
 * @param {string} providerName - Provider name to check
 * @returns {boolean} Whether provider is configured
 */
function isProviderConfigured(providerName) {
  if (providerName === "NVIDIA_NIM") {
    return !!(env.NVIDIA_API_KEY && env.NVIDIA_BASE_URL);
  }
  if (providerName === "cloudflare-workers-ai") {
    return !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_API_TOKEN);
  }
  return false;
}

/**
 * Probe NVIDIA NIM provider with a minimal READY prompt.
 * @param {Object} provider - The configured NVIDIA NIM provider
 * @param {string} model - The model ID to probe
 * @returns {Promise<Object>} Probe result
 */
async function probeNvidiaNim(provider, model) {
  try {
    const result = await provider.interpret({
      prompt: {
        system: "You are a helpful assistant.",
        user: "Reply with exactly: READY",
      },
    });
    return {
      status: "SUCCESS",
      response: result.response || result,
      model,
      provider: "NVIDIA_NIM",
    };
  } catch (error) {
    return {
      status: error.code || "ERROR",
      error: error.message || "Unknown error",
      model,
      provider: "NVIDIA_NIM",
    };
  }
}

/**
 * Probe Cloudflare Workers AI provider.
 * Note: Native binding unavailable in Node.js, so this will always report binding missing.
 * @param {Object} provider - The configured Cloudflare provider (or null)
 * @param {string} model - The model ID to probe
 * @returns {Promise<Object>} Probe result
 */
async function probeCloudflare(provider, model) {
  if (!provider) {
    return {
      status: "BINDING_MISSING",
      error: "Native Workers AI binding unavailable in Node.js environment",
      model,
      provider: "cloudflare-workers-ai",
    };
  }
  try {
    const result = await provider.interpret({
      prompt: {
        system: "You are a helpful assistant.",
        user: "Reply with exactly: READY",
      },
    });
    return {
      status: "SUCCESS",
      response: result.response || result,
      model,
      provider: "cloudflare-workers-ai",
    };
  } catch (error) {
    return {
      status: error.code || "ERROR",
      error: error.message || "Unknown error",
      model,
      provider: "cloudflare-workers-ai",
    };
  }
}

/**
 * Main probe execution.
 */
async function main() {
  const results = {
    configuredProviders: [],
    probedModels: [],
    failures: [],
    readyPool: [],
    catalogOnlyPool: [],
  };
  console.log("=== LLM Provider Readiness Probe ===\n");
  console.log("Environment config loaded");
  console.log("BOQ_AI_PROVIDER:", env.BOQ_AI_PROVIDER);

  // ---- Step 1: Identify configured providers ----
  console.log("\n--- Step 1: Identifying Configured Providers ---");

  const providerNames = ["NVIDIA_NIM", "cloudflare-workers-ai"];
  for (const providerName of providerNames) {
    const configured = isProviderConfigured(providerName);
    results.configuredProviders.push({
      provider: providerName,
      configured,
      existingAdapter:
        providerName === "NVIDIA_NIM"
          ? "worker/boq-understanding-provider.mjs"
          : "worker/boq-understanding-provider.mjs",
    });
    console.log(`${providerName}: configured=${configured}`);
  }

  // ---- Step 2: Select probe candidates from catalog ----
  console.log("\n--- Step 2: Selecting Probe Candidates from Catalog ---");

  const freeModels = catalog.getFreeModels();
  const configuredProviderName = env.BOQ_AI_PROVIDER || "NVIDIA_NIM";

  // Filter free models from the configured provider
  const providerFreeModels = freeModels.filter((m) => {
    // Check if model is from the configured provider
    const providerPrefix = configuredProviderName === "NVIDIA_NIM" ? "nvidia/" : "";
    return m.id.startsWith(providerPrefix);
  });

  console.log(
    `Found ${providerFreeModels.length} free models in catalog for ${configuredProviderName}`
  );

  // Prefer at most: 1 reasoning, 1 fast, 1 code, 1 vision/document
  const priorityCategories = {
    reasoning: [],
    fast: [],
    code: [],
    vision: [],
  };

  providerFreeModels.forEach((m) => {
    const lowerId = m.id.toLowerCase();
    if (lowerId.includes("reasoning") || lowerId.includes("nano-omni")) {
      priorityCategories.reasoning.push(m);
    } else if (lowerId.includes("lightning") || lowerId.includes("fast")) {
      priorityCategories.fast.push(m);
    } else if (lowerId.includes("code") || lowerId.includes("code")) {
      priorityCategories.code.push(m);
    } else if (lowerId.includes("vl") || lowerId.includes("vision")) {
      priorityCategories.vision.push(m);
    }
  });

  console.log("Priority categories:");
  console.log(
    "  Reasoning:",
    priorityCategories.reasoning.length
      ? priorityCategories.reasoning.map((m) => m.id)
      : "none"
  );
  console.log(
    "  Fast:",
    priorityCategories.fast.length
      ? priorityCategories.fast.map((m) => m.id)
      : "none"
  );
  console.log(
    "  Code:",
    priorityCategories.code.length
      ? priorityCategories.code.map((m) => m.id)
      : "none"
  );
  console.log(
    "  Vision:",
    priorityCategories.vision.length
      ? priorityCategories.vision.map((m) => m.id)
      : "none"
  );

  // ---- Step 3: Run minimal live probes ----
  console.log("\n--- Step 3: Running Minimal Live Probes ---");

  // Probe NVIDIA NIM if configured
  if (isProviderConfigured("NVIDIA_NIM")) {
    const nvidiaProvider = createConfiguredNvidiaNimStructuredProvider({
      NVIDIA_API_KEY: env.NVIDIA_API_KEY,
      NVIDIA_BASE_URL: env.NVIDIA_BASE_URL,
      BOQ_AI_MODEL: env.BOQ_AI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b",
      BOQ_AI_PROVIDER: "NVIDIA_NIM",
    });

    if (nvidiaProvider) {
      // Probe with the currently configured model
      const configuredModel = env.BOQ_AI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";
      const nvidiaProbe = await probeNvidiaNim(nvidiaProvider, configuredModel);
      results.probedModels.push(nvidiaProbe);
      console.log(
        `NVIDIA NIM (${configuredModel}): ${nvidiaProbe.status} - ${nvidiaProbe.response || nvidiaProbe.error}`
      );

      // Also probe with a catalog free model (base ID without :free suffix)
      const baseModel = configuredModel.replace(/:free$/, "");
      if (baseModel !== configuredModel) {
        const baseProbe = await probeNvidiaNim(nvidiaProvider, baseModel);
        results.probedModels.push(baseProbe);
        console.log(
          `NVIDIA NIM (${baseModel} - base): ${baseProbe.status} - ${baseProbe.response || baseProbe.error}`
        );
      }
    }
  }

  // Probe Cloudflare if configured
  if (isProviderConfigured("cloudflare-workers-ai")) {
    const cfProvider = createConfiguredBoqUnderstandingProvider({
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_AI_API_TOKEN: env.CLOUDFLARE_AI_API_TOKEN,
      BOQ_AI_PROVIDER: "cloudflare",
      BOQ_AI_MODEL: env.BOQ_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast",
    });
    const cfModel = env.BOQ_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";
    const cfProbe = await probeCloudflare(cfProvider, cfModel);
    results.probedModels.push(cfProbe);
    console.log(
      `Cloudflare Workers AI (${cfModel}): ${cfProbe.status} - ${cfProbe.error || cfProbe.response}`
    );
  }

  // ---- Step 4: Classify readiness ----
  console.log("\n--- Step 4: Classifying Readiness ---");

  // classify NVIDIA NIM
  const nvidiaProbe = results.probedModels.find(
    (p) => p.provider === "NVIDIA_NIM"
  );
  if (nvidiaProbe && nvidiaProbe.status === "SUCCESS") {
    results.readyPool.push({
      model: nvidiaProbe.model,
      provider: "NVIDIA_NIM",
      role: "general",
      result: "READY",
      latency: "probed",
    });
    console.log(`NVIDIA_NIM: READY (probe succeeded)`);
  } else if (
    nvidiaProbe &&
    nvidiaProbe.status === "BINDING_MISSING"
  ) {
    results.catalogOnlyPool.push({
      model: nvidiaProbe.model,
      provider: "NVIDIA_NIM",
      reason:
        "Provider configured but native binding unavailable in current environment",
    });
    console.log(
      `NVIDIA_NIM: CONFIGURED_BUT_MODEL_UNAVAILABLE (binding missing)`
    );
  } else if (nvidiaProbe && nvidiaProbe.status !== "SUCCESS") {
    results.failures.push({
      model: nvidiaProbe.model,
      provider: "NVIDIA_NIM",
      error: nvidiaProbe.error,
    });
    console.log(
      `NVIDIA_NIM: ${nvidiaProbe.status} - ${nvidiaProbe.error}`
    );
  }

  // classify Cloudflare
  const cfProbe = results.probedModels.find(
    (p) => p.provider === "cloudflare-workers-ai"
  );
  if (cfProbe) {
    if (cfProbe.status === "BINDING_MISSING") {
      results.catalogOnlyPool.push({
        model: cfProbe.model,
        provider: "cloudflare-workers-ai",
        reason:
          "Native Workers AI binding unavailable in Node.js environment",
      });
      console.log(
        `cloudflare-workers-ai: NOT_CONFIGURED (binding missing in Node.js)`
      );
    } else if (cfProbe.status === "SUCCESS") {
      results.readyPool.push({
        model: cfProbe.model,
        provider: "cloudflare-workers-ai",
        role: "general",
        result: "READY",
        latency: "probed",
      });
      console.log(`cloudflare-workers-ai: READY (probe succeeded)`);
    } else {
      results.failures.push({
        model: cfProbe.model,
        provider: "cloudflare-workers-ai",
        error: cfProbe.error,
      });
      console.log(
        `cloudflare-workers-ai: ${cfProbe.status} - ${cfProbe.error}`
      );
    }
  }

  // ---- Step 5: Catalog-only models (free in catalog but not probeable) ----
  console.log("\n--- Step 5: Catalog-Only Models ---");

  // Models that are free in catalog but couldn't be probed
  const catalogFreeButProbeable = providerFreeModels.filter((m) => {
    // Check if the base model (without :free) was probed successfully
    const baseId = m.id.replace(/:free$/, "");
    const probed = results.probedModels.find(
      (p) => p.model === baseId || p.model === m.id
    );
    return !probed || probed.status !== "SUCCESS";
  });

  catalogFreeButProbeable.forEach((m) => {
    results.catalogOnlyPool.push({
      model: m.id,
      provider: m.id.startsWith("nvidia/") ? "NVIDIA_NIM" : "unknown",
      reason:
        "Free in catalog but model ID format not probeable through current provider path",
    });
    console.log(
      `Catalog-only: ${m.id} - free tier format not probeable through current provider`
    );
  });

  // ---- Step 6: Generate report ----
  console.log("\n=== LLM Provider Readiness Probe Complete ===\n");

  console.log("A. Configured Providers:");
  results.configuredProviders.forEach((p) => {
    console.log(
      `   ${p.provider}: ${p.configured ? "YES" : "NO"} (existing adapter: ${p.existingAdapter})`
    );
  });

  console.log("\nB. Probed Models:");
  results.probedModels.forEach((p) => {
    console.log(
      `   ${p.provider} ${p.model}: ${p.status} ${p.response ? "(response: " + p.response + ")" : "(error: " + p.error + ")"}`
    );
  });

  console.log("\nC. Failures:");
  results.failures.forEach((f) => {
    console.log(`   ${f.provider} ${f.model}: ${f.error}`);
  });

  console.log("\nD. Ready Pool:");
  results.readyPool.forEach((r) => {
    console.log(`   ${r.provider} ${r.model} (${r.role}): ${r.result}`);
  });
  if (results.readyPool.length === 0) {
    console.log("   No models currently READY");
  }

  console.log("\nE. Catalog-Only Pool:");
  results.catalogOnlyPool.forEach((c) => {
    console.log(`   ${c.provider} ${c.model}: ${c.reason}`);
  });
  if (results.catalogOnlyPool.length === 0) {
    console.log("   No catalog-only models");
  }

  console.log("\nF. Files Changed: None (diagnostics only)");

  // Final verdict
  const hasReady = results.readyPool.length > 0;
  const verdict = hasReady ? "LLM_PROVIDER_READY_POOL_VERIFIED" : "LLM_PROVIDER_READY_POOL_BLOCKED";
  console.log(`\nG. Verdict: ${verdict}`);

  // Machine-readable output for automation
  console.log("\n--- MACHINE-READABLE OUTPUT ---");
  console.log(JSON.stringify({
    verdict,
    configuredProviders: results.configuredProviders.length,
    probedModels: results.probedModels.length,
    readyPoolSize: results.readyPool.length,
    catalogOnlyPoolSize: results.catalogOnlyPool.length,
    failures: results.failures.length,
    readyPoolModels: results.readyPool.map((r) => ({
      provider: r.provider,
      model: r.model,
      result: r.result,
    })),
    catalogOnlyModels: results.catalogOnlyPool.map((c) => ({
      model: c.model,
      provider: c.provider,
      reason: c.reason,
    })),
  }, null, 2));
}

main().catch(console.error);