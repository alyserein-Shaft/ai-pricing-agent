import { createHash } from "node:crypto";
import { stableStringify } from "./boq-understanding-engine.mjs";

export const PRODUCT_RANKING_PROMPT_VERSION = "product-ranking-prompt-v1";
export const PRODUCT_RANKING_SCHEMA_VERSION = "product-ranking-schema-v1";
const STATES = new Set(["STRONG", "POSSIBLE", "WEAK", "REJECT"]);
const RECOMMENDATIONS = new Set(["CANDIDATES_READY_FOR_REVIEW", "INSUFFICIENT_EVIDENCE", "NO_SUITABLE_CANDIDATE"]);
const unsafeKey = /(^|_)(manufacturer|model|part_?number|product_?id|price|cost|approval|approved|selected|certification|compatibility)(_|$)/i;
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const hash = (value) => createHash("sha256").update(stableStringify(value)).digest("hex");
const unwrap = (fact) => { const entry = fact && typeof fact === "object" && "value" in fact ? fact : { value: fact ?? null, origin: fact == null ? "MISSING" : "EXTRACTED", confidence: fact == null ? 0 : 100 }; return Array.isArray(entry.value) || (entry.value && typeof entry.value === "object") ? { value: null, origin: "MISSING", confidence: 0 } : entry; };
const unwrapList = (value) => (Array.isArray(value) ? value : []).map(unwrap);

export function buildProductSearchProfile({ boqItem, understanding }) {
  const interpreted = understanding?.interpretation || understanding || {};
  const scalar = (name, fallback = null) => unwrap(interpreted[name] ?? fallback);
  const attributes = Object.fromEntries(Object.entries(interpreted.attributes || {}).map(([name, value]) => [name, unwrap(value)]));
  return {
    boqItemId: boqItem.id || boqItem.boqItemId,
    normalizedDescription: scalar("normalizedDescription", boqItem.description),
    system: scalar("system", boqItem.system), category: scalar("category", boqItem.category), subcategory: scalar("subcategory", boqItem.subcategory),
    equipmentType: scalar("equipmentType"), productFamily: scalar("productFamily"),
    manufacturerHints: unwrapList(interpreted.manufacturerPreferences),
    manufacturerRestrictions: unwrapList(interpreted.manufacturerRestrictions),
    explicitModelHints: [boqItem.model, boqItem.partNumber].filter(Boolean).map((value) => ({ value, origin: "EXTRACTED", confidence: 100 })),
    requiredAttributes: attributes, preferredAttributes: {}, standards: unwrapList(interpreted.standards),
    compatibilityRequirements: unwrapList(interpreted.compatibilityRequirements), accessories: unwrapList(interpreted.requiredAccessories),
    exclusions: unwrapList(interpreted.manufacturerRestrictions), searchTerms: unwrapList(interpreted.searchTerms),
    missingInformation: unwrapList(interpreted.missingInformation), ambiguities: unwrapList(interpreted.ambiguities),
  };
}

export function projectSearchProfileToRequirementProfile(searchProfile, existingProfile = {}) {
  const value = (fact) => fact?.value ?? null;
  // This fallback is retrieval text only. The source search profile continues
  // to preserve Product Family as MISSING, so it cannot become technical fact.
  const retrievalFamily = value(searchProfile.productFamily) || value(searchProfile.equipmentType) || value(searchProfile.normalizedDescription);
  return {
    ...existingProfile,
    boqItem: {
      ...(existingProfile.boqItem || {}), id: searchProfile.boqItemId,
      description: value(searchProfile.normalizedDescription), normalizedDescription: value(searchProfile.normalizedDescription),
      system: value(searchProfile.system), category: value(searchProfile.category), subcategory: value(searchProfile.subcategory),
      productFamily: retrievalFamily, manufacturer: searchProfile.manufacturerHints[0]?.value || null,
      partNumber: searchProfile.explicitModelHints[0]?.value || null,
    },
  };
}

export const PRODUCT_RANKING_RESPONSE_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    recommendationState: { type: "string", enum: [...RECOMMENDATIONS] },
    candidates: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      candidateId: { type: "string" }, rank: { type: "integer", minimum: 1 }, fitScore: { type: "integer", minimum: 0, maximum: 100 },
      matchState: { type: "string", enum: [...STATES] }, matchedCriteria: { type: "array", items: { type: "string" } },
      mismatchedCriteria: { type: "array", items: { type: "string" } }, missingEvidence: { type: "array", items: { type: "string" } },
      explanation: { type: "string" }, engineerReviewNotes: { type: "string" },
    }, required: ["candidateId","rank","fitScore","matchState","matchedCriteria","mismatchedCriteria","missingEvidence","explanation","engineerReviewNotes"] } },
  }, required: ["recommendationState","candidates"],
});

const criterionSet = (candidate) => new Set([
  ...(candidate.matchingBasis || []),
  ...(candidate.comparisons || []).map((entry) => entry.requirement?.normalizedRequirement || entry.required?.name || entry.result),
].map(clean).filter(Boolean));
const missingSet = (candidate) => new Set((candidate.mandatoryFailures || []).map((entry) => clean(entry.result || entry.type || entry.required?.name)).filter(Boolean));
const subset = (values, allowed) => values.every((value) => allowed.has(clean(value)));

export function validateProductRanking(response, retrievedCandidates) {
  if (!response || typeof response !== "object" || Array.isArray(response) || !RECOMMENDATIONS.has(response.recommendationState) || !Array.isArray(response.candidates)) throw new Error("AI ranking output is malformed.");
  const allowed = new Map(retrievedCandidates.map((candidate) => [candidate.product.id, candidate]));
  const seen = new Set();
  const validated = response.candidates.map((entry) => {
    for (const key of Object.keys(entry || {})) if (unsafeKey.test(key) && key !== "candidateId") throw new Error(`Unsafe AI ranking field: ${key}`);
    if (!entry || !allowed.has(entry.candidateId) || seen.has(entry.candidateId)) throw new Error("AI ranking referenced an unknown or duplicate candidate ID.");
    seen.add(entry.candidateId);
    if (!Number.isInteger(entry.rank) || !Number.isInteger(entry.fitScore) || entry.fitScore < 0 || entry.fitScore > 100 || !STATES.has(entry.matchState)) throw new Error("AI ranking score or state is invalid.");
    for (const name of ["matchedCriteria","mismatchedCriteria","missingEvidence"]) if (!Array.isArray(entry[name]) || entry[name].some((value) => typeof value !== "string")) throw new Error(`AI ranking ${name} is invalid.`);
    const candidate = allowed.get(entry.candidateId); const criteria = criterionSet(candidate); const missing = missingSet(candidate);
    if (!subset(entry.matchedCriteria, criteria) || !subset(entry.mismatchedCriteria, criteria) || !subset(entry.missingEvidence, missing)) throw new Error("AI ranking introduced unsupported technical evidence.");
    return { candidateId: entry.candidateId, rank: entry.rank, fitScore: entry.fitScore, matchState: entry.matchState, matchedCriteria: entry.matchedCriteria.map(clean), mismatchedCriteria: entry.mismatchedCriteria.map(clean), missingEvidence: entry.missingEvidence.map(clean), explanation: clean(entry.explanation), engineerReviewNotes: clean(entry.engineerReviewNotes) };
  });
  if (validated.length !== retrievedCandidates.length || new Set(validated.map((entry) => entry.rank)).size !== validated.length) throw new Error("AI ranking must rank every retrieved candidate exactly once.");
  return { recommendationState: response.recommendationState, candidates: validated.sort((a,b) => a.rank-b.rank) };
}

export function buildProductRankingPrompt(searchProfile, candidates) {
  const safeCandidates = candidates.map((candidate) => ({ candidateId: candidate.product.id, deterministicScore: candidate.score, matchingBasis: [...criterionSet(candidate)], missingEvidence: [...missingSet(candidate)], technicalStatus: candidate.technicalStatus, sourceProvenance: candidate.product.source || null }));
  return { system: "Rank only the supplied canonical candidate IDs for engineer review. Never create or state manufacturers, models, part numbers, products, prices, approvals, certifications, compatibility, stock or availability. Use matched/mismatched criteria and missing evidence verbatim from each candidate's supplied lists. Return strict JSON only.", user: stableStringify({ searchProfile, candidates: safeCandidates, schemaVersion: PRODUCT_RANKING_SCHEMA_VERSION }) };
}

export const productRankingInputFingerprint = (profile) => hash(profile);
export const productRankingCandidateFingerprint = (candidates) => hash(candidates.map((entry) => ({ id: entry.product.id, score: entry.score, basis: entry.matchingBasis, failures: entry.mandatoryFailures, source: entry.product.source })));
export const productRankingConfigFingerprint = (metadata) => hash({ ...metadata, promptVersion: PRODUCT_RANKING_PROMPT_VERSION, schemaVersion: PRODUCT_RANKING_SCHEMA_VERSION });

export async function rankProductCandidates({ searchProfile, candidates, provider }) {
  if (!candidates.length) return { status: "NO_CANDIDATES", validated: { recommendationState: "NO_SUITABLE_CANDIDATE", candidates: [] }, raw: null };
  if (!provider) return { status: "AI_UNAVAILABLE", validated: null, raw: null };
  try { const raw = await provider.interpret({ prompt: buildProductRankingPrompt(searchProfile, candidates) }); return { status: "COMPLETED", validated: validateProductRanking(raw, candidates), raw }; }
  catch (error) { return { status: "FAILED", validated: null, raw: null, error: { code: "AI_RANKING_INVALID", message: error instanceof Error ? error.message : "AI ranking failed validation." } }; }
}
