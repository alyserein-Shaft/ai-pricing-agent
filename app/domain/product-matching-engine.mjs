import { normalizeMeasurement } from "./engineering-knowledge.mjs";

export const MATCH_ENGINE_VERSION = "product-matching-engine-1.0.0";
export const MATCH_RULESET_VERSION = "matching-rules-2026-08-02";
export const MATCH_SEARCH_VERSION = "structured-library-search-1.0.0";
export const MATCH_MODEL_VERSION = "deterministic-ranking-1.0.0";

const txt = (value) => String(value ?? "").trim();
const norm = (value) => txt(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))));
const tokens = (value) => [...new Set(norm(value).split(" ").filter((entry) => entry.length > 2))];
const valuesEqual = (left, right) => norm(left) === norm(right);
const productAttributes = (product) => Array.isArray(product.attributes) ? product.attributes : [];
const attributeName = (attribute) => norm(attribute.name || attribute.attributeName || attribute.canonicalName || attribute.originalName);
const requirementAttribute = (requirement) => ({ name: requirement.attributeName || requirement.name || requirement.requirementCategory, operator: requirement.operator || requirement.comparisonOperator || "Equal", value: requirement.requiredValue ?? requirement.normalizedValue ?? requirement.parsedValue, unit: requirement.requiredUnit || requirement.normalizedUnit || requirement.originalUnit, source: requirement.sources || requirement.source || null });
const findAttribute = (product, required) => productAttributes(product).find((entry) => attributeName(entry) === norm(required.name));
const productValue = (attribute) => attribute?.normalizedValue ?? attribute?.parsedValue ?? attribute?.value ?? attribute?.originalValue;
const productUnit = (attribute) => attribute?.normalizedUnit || attribute?.unit || attribute?.originalUnit;

export const compareAttribute = (required, offered) => {
  if (!offered) return { result: "Missing Product Data", pass: false, blocking: true, required, offered: null, difference: null, conversion: null };
  let requiredValue = required.value, offeredValue = productValue(offered), conversion = null;
  if (required.unit || productUnit(offered)) {
    const left = normalizeMeasurement({ value: requiredValue, unit: required.unit, targetUnit: required.unit });
    const right = normalizeMeasurement({ value: offeredValue, unit: productUnit(offered), targetUnit: required.unit });
    conversion = { required: left, product: right };
    if (left.status !== "Normalized" || right.status !== "Normalized") return { result: "Unknown", pass: false, blocking: true, required, offered, difference: null, conversion };
    requiredValue = left.normalizedValue; offeredValue = right.normalizedValue;
  }
  const numeric = Number.isFinite(Number(requiredValue)) && Number.isFinite(Number(offeredValue)); const left = numeric ? Number(requiredValue) : norm(requiredValue); const right = numeric ? Number(offeredValue) : norm(offeredValue); const operator = required.operator;
  let pass = false;
  if (["Equal", "Equals", "Exact"].includes(operator)) pass = left === right;
  else if (["Minimum", "Greater Than or Equal"].includes(operator)) pass = right >= left;
  else if (["Maximum", "Less Than or Equal"].includes(operator)) pass = right <= left;
  else if (operator === "Greater Than") pass = right > left;
  else if (operator === "Less Than") pass = right < left;
  else if (operator === "Includes" || operator === "Supports") pass = Array.isArray(offeredValue) ? offeredValue.some((entry) => valuesEqual(entry, requiredValue)) : norm(offeredValue).includes(norm(requiredValue));
  else if (operator === "One Of") pass = (Array.isArray(requiredValue) ? requiredValue : [requiredValue]).some((entry) => valuesEqual(entry, offeredValue));
  else if (operator === "All Of") pass = (Array.isArray(requiredValue) ? requiredValue : [requiredValue]).every((entry) => norm(offeredValue).includes(norm(entry)));
  else if (operator === "Not Equal" || operator === "Excludes") pass = !valuesEqual(left, right);
  return { result: pass ? "Pass" : "Fail", pass, blocking: !pass, required, offered, difference: numeric ? Number(offeredValue) - Number(requiredValue) : null, conversion };
};

export const buildSearchScope = (profile) => ({ system: profile.boqItem?.system || null, category: profile.boqItem?.category || null, productFamily: profile.boqItem?.productFamily || null, manufacturer: profile.boqItem?.manufacturer || null, partNumber: profile.boqItem?.partNumber || null, approvedManufacturers: (profile.manufacturers || []).filter((entry) => /approved|required|basis/i.test(entry.status || entry.type || "")).map((entry) => entry.manufacturer || entry.name), prohibitedManufacturers: (profile.manufacturers || []).filter((entry) => /prohibited|excluded/i.test(entry.status || entry.type || "")).map((entry) => entry.manufacturer || entry.name), standards: profile.standards || [], compatibility: profile.compatibility || [], mode: profile.boqItem?.partNumber ? "Exact Identity" : profile.boqItem?.productFamily ? "Product Family" : "Discovery Only" });

export const generateCandidates = ({ profile, products }) => {
  const scope = buildSearchScope(profile); const descriptionTokens = tokens(profile.boqItem?.normalizedDescription || profile.boqItem?.description); const stages = [];
  for (const product of products) {
    const exact = scope.partNumber && [product.partNumber, product.normalizedPartNumber].some((value) => norm(value) === norm(scope.partNumber)); const manufacturerModel = scope.manufacturer && scope.partNumber && valuesEqual(product.manufacturer, scope.manufacturer) && norm(`${product.partNumber} ${product.description}`).includes(norm(scope.partNumber)); const manufacturerFamily = scope.manufacturer && scope.productFamily && valuesEqual(product.manufacturer, scope.manufacturer) && norm(product.family).includes(norm(scope.productFamily)); const family = scope.productFamily && (norm(product.family) === norm(scope.productFamily) || norm(product.family).includes(norm(scope.productFamily)) || norm(scope.productFamily).includes(norm(product.family))); const category = scope.category && norm(product.category) === norm(scope.category); const shared = descriptionTokens.filter((term) => norm(`${product.description} ${product.family}`).includes(term));
    if (exact) stages.push({ product, stage: "Exact Identity", searchScore: 100, basis: ["Exact Part Number"] });
    else if (manufacturerModel) stages.push({ product, stage: "Manufacturer Model", searchScore: 95, basis: ["Exact Manufacturer + Model"] });
    else if (manufacturerFamily) stages.push({ product, stage: "Manufacturer Family", searchScore: 88, basis: ["Manufacturer + Product Family"] });
    else if (family || category) stages.push({ product, stage: "Structured", searchScore: family ? 80 : 65, basis: [family ? "Product Family" : "Category"] });
    else if (shared.length >= 2) stages.push({ product, stage: "Semantic Discovery", searchScore: Math.min(55, shared.length * 10), basis: ["Semantic Discovery"], discoveryOnly: true, sharedTerms: shared });
  }
  return { scope, candidates: [...new Map(stages.sort((a, b) => b.searchScore - a.searchScore || String(a.product.id).localeCompare(String(b.product.id))).map((entry) => [entry.product.id, entry])).values()].slice(0, 10) };
};

const standardKey = (value) => norm(`${value.body || value.issuingBody || ""} ${value.number || value.standard || ""} ${value.part || ""}`);
const evaluateStandards = (required, product) => required.map((standard) => { const offered = (product.standards || []).find((entry) => standardKey(entry) === standardKey(standard)); const result = offered?.evidence || offered?.source ? "Verified Compliant" : offered ? "Claimed Compliant" : "Evidence Missing"; return { requirement: standard, productStandard: offered || null, result, pass: Boolean(offered), blocking: !offered, evidence: offered?.source || offered?.evidence || null }; });
const evaluateManufacturer = (scope, product) => { const prohibited = scope.prohibitedManufacturers.some((name) => valuesEqual(name, product.manufacturer)); const required = scope.approvedManufacturers; const approved = !required.length || required.some((name) => valuesEqual(name, product.manufacturer)); return { result: prohibited ? "Prohibited" : approved ? "Approved" : "Not Approved", pass: !prohibited && approved, blocking: prohibited || !approved, required, offered: product.manufacturer }; };
const evaluateCompatibility = (required, product) => required.map((entry) => { const target = entry.targetItem || entry.rightEntityId || entry.target || entry.value; const offered = (product.compatibility || []).find((candidate) => valuesEqual(candidate.targetItem || candidate.target || candidate.rightEntityId, target)); const incompatible = offered && /does not|incompatible/i.test(offered.relationshipType || offered.type || ""); return { requirement: entry, offered: offered || null, result: incompatible ? "Incompatible" : offered ? "Verified Compatible" : "Evidence Missing", pass: Boolean(offered) && !incompatible, blocking: !offered || incompatible }; });
const evaluateLifecycle = (product) => { const state = product.lifecycleStatus || "Unknown"; const blocked = /discontinued|end of sale/i.test(state) && !/replacement candidate/i.test(state); const warning = /limited|end of support|replaced|unknown/i.test(state); return { state, result: blocked ? "Blocked" : warning ? "Warning" : "Pass", pass: !blocked, blocking: blocked, warning }; };
const evaluateAccessories = (required, product) => required.map((entry) => { const name = entry.accessory || entry.targetItem || entry.output?.accessory || entry.statement; const offered = [...(product.accessories || []), ...(product.includedAccessories || [])].find((candidate) => norm(candidate.accessory || candidate.name || candidate) === norm(name)); return { requirement: entry, accessory: name, offered: offered || null, result: offered ? "Pass" : "Missing Accessory", pass: Boolean(offered), blocking: !offered }; });
const commercialState = (prices, productId, projectId) => { const applicable = prices.filter((price) => price.productId === productId && (!price.projectId || price.projectId === projectId)); const current = applicable.filter((price) => price.approvalStatus === "Approved" && price.validUntil && new Date(price.validUntil) >= new Date()); if (current.some((price) => price.projectId === projectId)) return "Project Price Available"; if (current.length) return "Valid Current Price Available"; if (applicable.some((price) => price.validUntil && new Date(price.validUntil) < new Date())) return "Expired Price Only"; if (applicable.length) return "Historical Price Only"; return "Supplier RFQ Required"; };
const explanation = (candidate) => { const passed = candidate.comparisons.filter((entry) => entry.pass).map((entry) => entry.requirement?.normalizedRequirement || entry.required?.name).filter(Boolean); const failed = candidate.comparisons.filter((entry) => !entry.pass).map((entry) => entry.requirement?.normalizedRequirement || entry.required?.name).filter(Boolean); return `${candidate.product.manufacturer || "Unknown manufacturer"} ${candidate.product.partNumber || candidate.product.description} was found through ${candidate.matchingBasis.join(", ")}. ${passed.length ? `${passed.length} evaluated technical criterion${passed.length === 1 ? " passed" : "s passed"}.` : "No technical criterion has verified evidence."} ${failed.length ? `${failed.length} criterion${failed.length === 1 ? " requires" : " require"} review or failed.` : "No evaluated mandatory failure was found."} Commercial state: ${candidate.commercialAvailability}.`; };

export const evaluateCandidate = ({ profile, generated, prices = [], projectId = null, weights = {} }) => {
  const product = generated.product, scope = buildSearchScope(profile); const requirements = profile.consolidatedRequirements || []; const attributeComparisons = requirements.flatMap((requirement) => (requirement.attributes || []).map((entry) => ({ comparisonType: "Attribute", requirement, ...compareAttribute(requirementAttribute(entry), findAttribute(product, requirementAttribute(entry))) }))); const structuredRequirementIds = new Set([...attributeComparisons.map((entry) => entry.requirement?.id), ...(profile.standards || []).map((entry) => entry.requirementId), ...(profile.compatibility || []).map((entry) => entry.requirementId), ...(profile.accessories || []).map((entry) => entry.requirementId)].filter(Boolean)); const unstructuredComparisons = requirements.filter((requirement) => ["Critical Mandatory", "Mandatory", "Conditional Mandatory"].includes(requirement.priority) && !(requirement.attributes || []).length && !structuredRequirementIds.has(requirement.id)).map((requirement) => ({ requirement, result: "Missing Product Data", pass: false, blocking: true, offered: null, evidence: null })); const standards = evaluateStandards(profile.standards || [], product); const manufacturer = evaluateManufacturer(scope, product); const compatibility = evaluateCompatibility(profile.compatibility || [], product); const accessories = evaluateAccessories([...(profile.accessories || []), ...(profile.derivedRequirements || []).filter((entry) => entry.output?.accessory)], product); const lifecycle = evaluateLifecycle(product); const comparisons = [
    ...attributeComparisons,
    ...unstructuredComparisons.map((entry) => ({
      comparisonType: "Technical Requirement",
      ...entry,
    })),
    ...standards.map((entry) => ({
      comparisonType: "Standard",
      requirement: entry.requirement,
      ...entry,
    })),
    ...compatibility.map((entry) => ({
      comparisonType: "Compatibility",
      requirement: entry.requirement,
      ...entry,
    })),
    ...accessories.map((entry) => ({
      comparisonType: "Accessory",
      requirement: entry.requirement,
      ...entry,
    })),
  ]; const mandatoryFailures = comparisons.filter((entry) => entry.blocking); if (manufacturer.blocking) mandatoryFailures.push({ type: "Manufacturer", ...manufacturer }); if (lifecycle.blocking) mandatoryFailures.push({ type: "Lifecycle", ...lifecycle });
  const defaultWeights = { mandatory: 40, attributes: 20, standards: 10, compatibility: 10, manufacturer: 5, accessories: 5, lifecycle: 5, source: 3, commercial: 2 }; const w = { ...defaultWeights, ...weights }; const ratio = (rows) => rows.length ? rows.filter((entry) => entry.pass).length / rows.length : 0; const components = { mandatoryCompliance: mandatoryFailures.length ? 0 : w.mandatory, technicalAttributes: ratio(attributeComparisons) * w.attributes, standards: ratio(standards) * w.standards, compatibility: ratio(compatibility) * w.compatibility, manufacturer: manufacturer.pass ? w.manufacturer : 0, accessories: ratio(accessories) * w.accessories, lifecycle: lifecycle.pass ? w.lifecycle : 0, sourceReliability: /verified|reviewed/i.test(product.reviewStatus || product.sourceReliability || "") ? w.source : 0, commercialAvailability: commercialState(prices, product.id, projectId) === "Valid Current Price Available" ? w.commercial : 0 }; const score = clamp(Object.values(components).reduce((sum, value) => sum + value, 0)); const profileBlocked = !["Ready for Matching", "Ready with Warnings"].includes(profile.readiness?.status); const discovery = generated.discoveryOnly || profileBlocked; const technicalStatus = mandatoryFailures.length ? "Non-Compliant" : discovery ? "Discovery Only" : comparisons.some((entry) => !entry.pass) || lifecycle.warning ? "Compliant with Warnings" : "Technically Compliant"; const confidenceCeiling = discovery ? 49 : mandatoryFailures.some((entry) => entry.result === "Evidence Missing" || entry.result === "Missing Product Data") ? 59 : generated.stage === "Exact Identity" ? 95 : generated.stage === "Structured" ? 85 : 49; const completeness = comparisons.length ? ratio(comparisons) * 100 : 0; const confidenceScore = clamp(Math.min(confidenceCeiling, generated.searchScore * 0.4 + completeness * 0.4 + Number(product.reviewStatus === "Reviewed") * 20)); const confidence = discovery ? "Discovery Only" : confidenceScore >= 90 ? "Verified" : confidenceScore >= 75 ? "High Confidence" : confidenceScore >= 55 ? "Medium Confidence" : "Low Confidence"; const tier = mandatoryFailures.length ? "Rejected Candidate" : discovery ? "Discovery Candidate" : technicalStatus === "Technically Compliant" ? "Recommended Candidate" : "Conditional Alternative";
  const candidate = { product, searchStage: generated.stage, matchingBasis: generated.basis, components, score, technicalStatus, recommendationTier: tier, confidence, confidenceScore, comparisons, standards, manufacturer, compatibility, accessories, lifecycle, commercialAvailability: commercialState(prices, product.id, projectId), mandatoryFailures, approvalReady: false, reviewStatus: "Needs Review", provenance: { productSource: product.source || null, requirementProfileVersion: profile.versionNumber, engineVersion: MATCH_ENGINE_VERSION, rulesetVersion: MATCH_RULESET_VERSION, searchVersion: MATCH_SEARCH_VERSION, modelVersion: MATCH_MODEL_VERSION } }; candidate.explanation = explanation(candidate); return candidate;
};

export const runProductMatching = ({ profile, products, prices = [], projectId = null, previousVersion = 0, weights }) => {
  const technicallyReady = ["Ready for Matching", "Ready with Warnings", "Needs Technical Review"].includes(profile.readiness?.status);
  const discoveryReady = Boolean(profile.boqItem?.description && profile.boqItem?.system && (profile.boqItem?.category || profile.boqItem?.productFamily));
  if (!technicallyReady && !discoveryReady) return { versionNumber: previousVersion + 1, status: "Not Ready", candidates: [], noMatch: { reason: "The BOQ item is not classified for product discovery.", blockers: profile.readiness?.blockingReasons || [], suggestedAction: "Confirm the item discipline and equipment category." } };
  const generated = generateCandidates({ profile, products }); const evaluated = generated.candidates.map((candidate) => evaluateCandidate({ profile, generated: candidate, prices, projectId, weights })).sort((left, right) => Number(left.mandatoryFailures.length > 0) - Number(right.mandatoryFailures.length > 0) || right.score - left.score).map((candidate, index) => ({ ...candidate, rank: index + 1 })); const valid = evaluated.filter((candidate) => !candidate.mandatoryFailures.length && candidate.recommendationTier !== "Discovery Candidate"); const status = valid.length ? "Needs Review" : evaluated.length ? "Discovery Only" : "No Match"; return { engineVersion: MATCH_ENGINE_VERSION, rulesetVersion: MATCH_RULESET_VERSION, searchVersion: MATCH_SEARCH_VERSION, modelVersion: MATCH_MODEL_VERSION, versionNumber: previousVersion + 1, status, searchScope: generated.scope, candidateCountEvaluated: evaluated.length, candidates: evaluated, noMatch: valid.length ? null : { reason: evaluated.length ? "No technically recommendable candidate passed every mandatory gate." : "No product was found within the controlled search scope.", exclusionReasons: evaluated.flatMap((candidate) => candidate.mandatoryFailures.map((failure) => ({ productId: candidate.product.id, reason: failure.result || failure.type }))), missingLibraryCoverage: evaluated.length === 0, suggestedClarification: profile.clarifications || [], suggestedAction: evaluated.length ? "Review failed evidence or import an approved alternative." : "Import relevant product data or issue a supplier RFQ." }, generatedAt: new Date().toISOString() };
};

export const compareCandidates = (candidates) => candidates.map((candidate) => ({ productId: candidate.product.id, manufacturer: candidate.product.manufacturer, partNumber: candidate.product.partNumber, technicalStatus: candidate.technicalStatus, mandatoryFailures: candidate.mandatoryFailures.length, standards: candidate.standards.map((entry) => entry.result), compatibility: candidate.compatibility.map((entry) => entry.result), accessories: candidate.accessories.map((entry) => entry.result), lifecycle: candidate.lifecycle.state, commercialAvailability: candidate.commercialAvailability, confidence: candidate.confidence, score: candidate.score }));
