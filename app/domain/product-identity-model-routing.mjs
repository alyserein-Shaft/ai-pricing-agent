// PRODUCT IDENTITY / MATCHING MODEL ROUTING (benchmark-approved two-tier policy).
//
// The benchmark is FINAL for this slice:
//   SIMPLE   -> Cloudflare @cf/meta/llama-3.1-8b-instruct-fast
//   COMPLEX  -> Cloudflare @cf/meta/llama-3.3-70b-instruct-fp8-fast
//   Nemotron -> NOT_RECOMMENDED for Product Identity / Matching
//
// THE GAP THIS CLOSES. `worker/boq-understanding-provider.mjs` already declares both
// Cloudflare models (`DEFAULT_CLOUDFLARE_BOQ_MODEL` = 8B,
// `DEFAULT_CLOUDFLARE_BOQ_ESCALATION_MODEL` = 70B) and the Product Identity call site
// already builds a Cloudflare provider -- but that provider hard-codes
// `escalationEnabled: false` and always invokes `model` (the 8B). The 70B therefore
// exists as a constant and is never selected. This module adds the missing
// deterministic complexity decision that chooses between them.
//
// ROUTING IS COMPLEXITY-BASED, NEVER FALLBACK-BASED. A provider failure (transport,
// timeout, invalid schema, fabricated evidence id, invalid candidate id) returns the
// governed NEEDS_REVIEW / HUMAN_REVIEW state. It NEVER calls the other model, and it
// never jumps to NVIDIA. Changing the model changes no authority: both tiers use the
// identical evidence packet contract, schema, evidence-ID validation, candidate-ID
// validation and authority firewall, because both are the SAME provider factory with a
// different model id.

export const PRODUCT_IDENTITY_MODEL_ROUTING_VERSION = "product-identity-model-routing-1.0.0";

export const PRODUCT_IDENTITY_SIMPLE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const PRODUCT_IDENTITY_COMPLEX_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Recorded explicitly so a grep can prove Nemotron is never a Product Identity target.
export const PRODUCT_IDENTITY_NEMOTRON_ENABLED = false;

const COMPLEXITY_CONDITIONS = Object.freeze([
  "multiple_materially_viable_candidates",
  "compatibility_reasoning_required",
  "conflicting_requirements_exist",
  "unresolved_requirement_applicability_affects_selection",
  "required_product_attributes_incomplete",
  "substitution_or_equivalence_reasoning_required",
  "safety_critical_compatibility_question",
  "candidate_family_ambiguity",
  "explicit_contradiction",
  "no_dominant_candidate_from_deterministic_matching",
]);

const SIMPLE_CONDITIONS = Object.freeze([
  "one_dominant_candidate",
  "no_material_compatibility_conflict",
  "required_attributes_available",
  "no_unresolved_contradictory_requirement",
  "no_material_substitution_or_equivalence_question",
  "no_safety_critical_ambiguity",
]);

const isNonEmpty = (value) => Array.isArray(value) ? value.length > 0 : value != null && value !== false && value !== "";

// DETERMINISTIC complexity classification. No AI call may decide which model it
// receives, and model confidence is never a routing input.
//
// Inputs are the SAME evidence the deterministic matcher already produced, so this
// adds no new authority and no new data source:
//   candidates      the deterministic shortlist (already scored)
//   profile         the requirement profile for the item
//   deterministic   the deterministic matching result
export const classifyProductIdentityComplexity = ({ candidates = [], profile = null, deterministic = null } = {}) => {
  const reasons = [];
  const viable = (candidates || []).filter((c) => !Array.isArray(c.mandatoryFailures) || c.mandatoryFailures.length === 0);
  const has = (path) => {
    const parts = String(path).split(".");
    let node = profile;
    for (const part of parts) { if (node == null) return false; node = node[part]; }
    return isNonEmpty(node);
  };

  // --- COMPLEX triggers (ANY true => COMPLEX) ---
  if (viable.length > 1) reasons.push("multiple_materially_viable_candidates");
  if (has("compatibility") || has("compatibilityRequirements")) reasons.push("compatibility_reasoning_required");
  if (has("conflicts") || has("contradictions")) reasons.push("conflicting_requirements_exist");
  if (has("unresolvedApplicability") || has("applicabilityConflicts")) reasons.push("unresolved_requirement_applicability_affects_selection");
  if (has("missingAttributes") || has("incompleteAttributes")) reasons.push("required_product_attributes_incomplete");
  if (has("substitutionRequired") || has("equivalenceRequired")) reasons.push("substitution_or_equivalence_reasoning_required");
  if (has("safetyCritical") || has("safetyCriticalCompatibility")) reasons.push("safety_critical_compatibility_question");
  if (has("familyAmbiguity") || has("candidateFamilyAmbiguity")) reasons.push("candidate_family_ambiguity");
  if (has("explicitContradiction")) reasons.push("explicit_contradiction");
  if (deterministic && deterministic.status && deterministic.status !== "No Match" && viable.length !== 1) reasons.push("no_dominant_candidate_from_deterministic_matching");

  if (reasons.length) return { complexityClass: "COMPLEX", complexityReasons: reasons };

  // --- SIMPLE requires EVERY safe condition to hold. Fail conservative: if any
  // cannot be established from deterministic evidence, the case is COMPLEX.
  const simpleReasons = [];
  if (viable.length === 1) simpleReasons.push("one_dominant_candidate");
  if (!has("compatibility") && !has("compatibilityRequirements")) simpleReasons.push("no_material_compatibility_conflict");
  if (!has("missingAttributes") && !has("incompleteAttributes")) simpleReasons.push("required_attributes_available");
  if (!has("conflicts") && !has("contradictions")) simpleReasons.push("no_unresolved_contradictory_requirement");
  if (!has("substitutionRequired") && !has("equivalenceRequired")) simpleReasons.push("no_material_substitution_or_equivalence_question");
  if (!has("safetyCritical") && !has("safetyCriticalCompatibility")) simpleReasons.push("no_safety_critical_ambiguity");

  const allSafe = SIMPLE_CONDITIONS.every((condition) => simpleReasons.includes(condition));
  if (allSafe) return { complexityClass: "SIMPLE", complexityReasons: simpleReasons };
  return { complexityClass: "COMPLEX", complexityReasons: ["unknown_complexity_fails_conservative_to_complex"] };
};

// The model id for a classified case. PURE: this module never imports a provider
// factory, because `app/domain/*.mjs` must never import from `worker/*.mjs` (the
// established direction is worker -> domain). The WORKER supplies the factory, so
// both tiers are built by the SAME factory and therefore share the identical
// evidence packet contract, schema, evidence-ID validation, candidate-ID validation
// and authority firewall by construction -- changing the model cannot change
// authority.
export const productIdentityModelForComplexity = (complexityClass) =>
  complexityClass === "SIMPLE" ? PRODUCT_IDENTITY_SIMPLE_MODEL : PRODUCT_IDENTITY_COMPLEX_MODEL;

// The env scope that selects a tier. The worker passes this to its own provider
// factory; no model selection happens inside the domain layer.
export const productIdentityModelEnv = (env = {}, complexityClass = "COMPLEX") => ({
  ...env,
  BOQ_AI_PROVIDER: "cloudflare",
  BOQ_AI_MODEL: productIdentityModelForComplexity(complexityClass),
  BOQ_AI_ESCALATION_MODEL: PRODUCT_IDENTITY_COMPLEX_MODEL,
});

// Model PROVENANCE. This is metadata about which model was asked, never decision
// authority: it records the routing inputs so a reviewer can see why a case was sent
// to the 70B, and it always reports fallbackUsed = false because routing is
// complexity-based and a failure never switches models.
export const buildProductIdentityProvenance = ({ complexityClass, complexityReasons = [], model, attempt = 1, latency = null, schemaValid = null, evidenceValidationResult = null }) => ({
  complexityClass,
  complexityReasons,
  provider: "cloudflare-workers-ai-binding",
  model,
  attempt,
  latency,
  schemaValid,
  evidenceValidationResult,
  fallbackUsed: false,
});

export { COMPLEXITY_CONDITIONS, SIMPLE_CONDITIONS };
