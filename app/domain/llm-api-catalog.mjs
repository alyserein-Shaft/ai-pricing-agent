/** Free LLM API Catalog - awesome-free-llm-apis integration
 * 
 * Provides access to a curated list of LLM APIs with permanent free tiers.
 * Data sourced from https://github.com/mnfst/awesome-free-llm-apis
 * 
 * Usage:
 *   import { findProvider, findModel, filterByMinContext, getFreeModels } from './llm-api-catalog.mjs';
 * 
 * The catalog includes:
 * - Provider APIs (run by model trainers: Aion Labs, Cohere, Google, Mistral, Z AI)
 * - Inference providers (Cloudflare Workers AI, Groq, Hugging Face, Kilo Code, etc.)
 * - Rate limits, context windows, modalities, and model details
 */

import rawData from './llm-api-catalog.json' with { type: 'json' };

/** All providers from the catalog */
export const providers = rawData.providers;
/** Provider API category entries */
export const providerAPIs = rawData.providers.filter(p => p.category === 'provider_api');
/** Inference provider category entries */
export const inferenceProviders = rawData.providers.filter(p => p.category === 'inference_provider');
/** Glossary of abbreviations */
export const glossary = rawData.glossary;

/**
 * Find a provider by name (case-insensitive)
 * @param name - Provider name to search for
 * @returns The provider object or undefined
 */
export function findProvider(name) {
	return providers.find(p => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Find a model by ID across all providers
 * @param modelId - Model ID to search for (e.g., "gpt-4o", "nemotron-3.5-lightning:free")
 * @returns The model object or undefined
 */
export function findModel(modelId) {
	return providers.flatMap(p => p.models).find(m => m.id === modelId || m.name === modelId);
}

/**
 * Filter providers by minimum context window size (in tokens)
 * @param minContext - Minimum context window in tokens
 * @returns Array of providers matching the criteria
 */
export function filterByMinContext(minContext) {
	// Context string parser: "1M" -> 1000000, "128K" -> 131072, "131K" -> 135168
	const parseContext = (ctx) => {
		if (!ctx) return 0;
		if (ctx.endsWith('M')) return Math.floor(parseFloat(ctx) * 1000000);
		if (ctx.endsWith('K') || ctx.endsWith('k')) return Math.floor(parseFloat(ctx) * 1024);
		const num = parseFloat(ctx);
		return isNaN(num) ? 0 : num;
	};

	return providers.filter(p => {
		const maxContext = Math.max(...p.models.map(m => parseContext(m.context)));
		return maxContext >= minContext;
	});
}

/**
 * Filter providers by modality (text, image, code, etc.)
 * @param modality - Modality to filter by
 * @returns Array of providers offering the specified modality
 */
export function filterByModality(modality) {
	return providers.filter(p => 
		p.models.some(m => m.modality.toLowerCase().includes(modality.toLowerCase()))
	);
}

/**
 * Filter providers by rate limit (RPM - requests per minute)
 * @param maxRPM - Maximum RPM allowed
 * @returns Array of providers with rate limit <= maxRPM
 */
export function filterByMaxRPM(maxRPM) {
	return providers.filter(p => {
		const rateLimitStr = p.models[0]?.rateLimit || '';
		// Parse "15 RPM, 20K TPD" -> extract RPM number
		const rpmMatch = rateLimitStr.match(/(\d+)\s*RPM/);
		if (rpmMatch) {
			return parseInt(rpmMatch[1]) <= maxRPM;
		}
		return true; // No rate limit info, include it
	});
}

/**
 * Get free models (marked with :free suffix or from free-tier providers)
 * @returns Array of model objects that are in the free tier
 */
export function getFreeModels() {
	const freeModels = [];
	for (const p of providers) {
		const models = p.models || [];
		for (const m of models) {
			if (m && m.id && (m.id.includes(':free') || (p.name && p.name.toLowerCase().includes('free')))) {
				freeModels.push(m);
			}
		}
	}
	return freeModels;
}

/**
 * Get summary statistics about the catalog
 * @returns Object with count of providers, models, etc.
 */
export function getCatalogStats() {
	return {
		totalProviders: providers.length,
		totalModels: providers.flatMap(p => p.models.length),
		providerAPIsCount: providerAPIs.length,
		inferenceProvidersCount: inferenceProviders.length,
		categories: [...new Set(providers.map(p => p.category))],
	};
}

/**
 * Get models that support a specific context window size
 * @param context - Target context size in tokens
 * @returns Array of models with context >= target
 */
export function findModelsByContext(context) {
	// Context string parser: "1M" -> 1000000, "128K" -> 131072, "256K" -> 262144
	const parseContext = (ctx) => {
		if (!ctx) return 0;
		if (ctx.endsWith('M')) return Math.floor(parseFloat(ctx) * 1000000);
		if (ctx.endsWith('K') || ctx.endsWith('k')) return Math.floor(parseFloat(ctx) * 1024);
		const num = parseFloat(ctx);
		return isNaN(num) ? 0 : num;
	};

	return providers.flatMap(p => 
		p.models.filter(m => parseContext(m.context) >= context)
	);
}

// Export default for direct access
export default {
	providers,
	providerAPIs,
	inferenceProviders,
	glossary,
	findProvider,
	findModel,
	filterByMinContext,
	filterByModality,
	filterByMaxRPM,
	getFreeModels,
	getCatalogStats,
	findModelsByContext,
};