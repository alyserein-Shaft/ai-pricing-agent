// Pure deterministic Knowledge Fact -> Product Identity resolver (policy core).
//
// Stage 3B policy implementation. This module is intentionally free of worker
// runtime, database, env, and HTTP dependencies: the caller supplies
// already-collected facts, candidate products (with pre-resolved canonical
// information), existing links, and open-conflict flags. It returns a decision
// only — never a write.
//
// Part-number representations (Stage 3B):
// - originalPartNumber: verbatim source value, never mutated, preserved in evidence.
// - comparisonPartNumber: trim + collapse whitespace + uppercase, punctuation
//   preserved. The ONLY string form that may support an identity decision.
// - searchPartNumberKey: uppercase alphanumeric-only. Candidate discovery ONLY;
//   equality here MUST NEVER prove identity.

import {
  canonicalManufacturerName,
  sameManufacturerIdentity,
} from "./manufacturer-identity.mjs";

export const RESOLVER_VERSION = "knowledge-product-identity-resolver-v1";

export const RESOLVER_OUTCOMES = Object.freeze([
  "EXACT_UNIQUE_TARGET",
  "NO_TARGET",
  "AMBIGUOUS_TARGET",
  "ALREADY_LINKED",
  "REPAIRABLE_NEW_PRODUCT_CANDIDATE",
  "EXISTING_LINK_CONFLICT",
  "MULTIPLE_EXISTING_LINKS",
  "BROKEN_CANONICAL_CHAIN",
]);

const text = (value) => String(value ?? "");

/** Punctuation-preserving deterministic comparison form. */
export const comparisonPartNumber = (value) =>
  text(value).trim().replace(/\s+/g, " ").toUpperCase();

/** Aggressive candidate-discovery key. NEVER proves identity on its own. */
export const searchPartNumberKey = (value) =>
  text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

const SUBSTITUTE_PATTERN = /substitut|replacement|alternative|accessory|kit\b|package/i;
const isSubstituteRelationship = (relationshipType) =>
  Boolean(text(relationshipType).trim()) && SUBSTITUTE_PATTERN.test(text(relationshipType));

const isVisibleScope = (candidate, context) => {
  const scope = text(candidate?.libraryScope);
  if (scope === "Global Library") return true;
  if (scope === "Organization Library") {
    return Boolean(candidate?.organizationId)
      && candidate.organizationId === context?.organizationId;
  }
  if (scope === "Project Library") {
    if (!candidate?.libraryProjectId || candidate.libraryProjectId !== context?.libraryProjectId) return false;
    if (candidate.organizationId && candidate.organizationId !== context?.organizationId) return false;
    return true;
  }
  return false;
};

const manufacturerAgrees = (candidateManufacturer, factManufacturer) =>
  Boolean(text(candidateManufacturer).trim())
  && Boolean(text(factManufacturer).trim())
  && sameManufacturerIdentity(candidateManufacturer, factManufacturer);

const candidateManufacturerKey = (candidate) => {
  const canonical = canonicalManufacturerName(candidate?.manufacturer).canonical;
  return canonical ? canonical.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() : null;
};

const baseResult = (outcome, fields = {}) => ({
  outcome,
  deterministic: outcome !== "AMBIGUOUS_TARGET",
  selectedTarget: null,
  engineerReviewRequired:
    outcome === "AMBIGUOUS_TARGET"
    || outcome === "EXISTING_LINK_CONFLICT"
    || outcome === "MULTIPLE_EXISTING_LINKS"
    || outcome === "BROKEN_CANONICAL_CHAIN",
  reasonCodes: [],
  evidence: {},
  candidatesConsidered: [],
  recommendedAction: "NO_ACTION",
  ...fields,
});

/**
 * Pure identity decision.
 *
 * input: {
 *   fact: { factId, originalPartNumber, manufacturer?, organizationId?, libraryProjectId? },
 *   candidates: [{ productId, partNumber, manufacturer?, libraryScope?,
 *     organizationId?, libraryProjectId?, identityStatus?,
 *     canonicalProductId?, canonicalPartNumber?, canonicalStatus?,
 *     canonicalPath?, canonicalResolutionError?, relationshipType? }],
 *   existingLinks: [{ id, partNumber?, existingProductId?, linkState? }],
 *   openIdentityConflicts: [productOrCanonicalId...]
 * }
 */
export const resolveKnowledgeProductIdentity = (input = {}) => {
  const fact = input.fact || {};
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const existingLinks = Array.isArray(input.existingLinks) ? input.existingLinks : [];
  const conflicts = new Set(Array.isArray(input.openIdentityConflicts) ? input.openIdentityConflicts : []);
  const context = {
    organizationId: fact.organizationId || null,
    libraryProjectId: fact.libraryProjectId || null,
  };

  const factOriginal = text(fact.originalPartNumber);
  const factComparison = comparisonPartNumber(factOriginal);
  const factSearchKey = searchPartNumberKey(factOriginal);
  const factManufacturer = text(fact.manufacturer).trim() || null;

  const evidence = {
    resolverVersion: RESOLVER_VERSION,
    factId: fact.factId || null,
    originalPartNumber: factOriginal,
    factComparison,
    factSearchKey,
    factManufacturer,
    manufacturerBasis: null,
  };

  // Step 1-2: existing link cardinality (all rows, never collapsed).
  if (existingLinks.length > 1) {
    return baseResult("MULTIPLE_EXISTING_LINKS", {
      reasonCodes: ["MULTIPLE_PERSISTED_LINKS"],
      evidence: {
        ...evidence,
        linkIds: existingLinks.map((link) => link?.id || null),
        linkCount: existingLinks.length,
      },
      candidatesConsidered: candidates.map((candidate) => ({ productId: candidate?.productId || null, evaluated: false })),
      recommendedAction: "ENGINEER_TRIAGE_MULTIPLE_LINKS",
    });
  }

  // Step 3: visibility + substitute exclusion, with per-candidate accounting.
  const considered = [];
  const visibleIdentity = [];
  for (const candidate of candidates) {
    const entry = {
      productId: candidate?.productId || null,
      visible: false,
      excludedReason: null,
      comparisonEqual: false,
      searchKeyEqual: false,
      resolvedCanonicalId: null,
      wasSuperseded: false,
    };
    if (!isVisibleScope(candidate, context)) {
      entry.excludedReason = "SCOPE_NOT_VISIBLE";
      considered.push(entry);
      continue;
    }
    entry.visible = true;
    if (isSubstituteRelationship(candidate?.relationshipType)) {
      entry.excludedReason = "COMMERCIAL_SUBSTITUTE_NOT_IDENTITY";
      considered.push(entry);
      continue;
    }
    const candidateComparison = comparisonPartNumber(candidate?.partNumber);
    entry.comparisonEqual = candidateComparison === factComparison && factComparison.length > 0;
    entry.searchKeyEqual = searchPartNumberKey(candidate?.partNumber) === factSearchKey && factSearchKey.length > 0;
    entry.candidateComparison = candidateComparison;
    visibleIdentity.push({ candidate, entry });
    considered.push(entry);
  }

  // Step 4: canonical resolution outcomes (pre-resolved by the caller).
  const broken = [];
  const resolved = [];
  for (const { candidate, entry } of visibleIdentity) {
    if (text(candidate?.identityStatus) === "Superseded") {
      if (candidate?.canonicalResolutionError || !candidate?.canonicalProductId) {
        entry.canonicalError = candidate?.canonicalResolutionError || "MISSING_SUCCESSOR";
        broken.push({ candidate, entry });
        continue;
      }
      entry.resolvedCanonicalId = candidate.canonicalProductId;
      entry.wasSuperseded = true;
      entry.canonicalPath = Array.isArray(candidate.canonicalPath) ? candidate.canonicalPath : [];
      resolved.push({ candidate, entry, canonicalId: candidate.canonicalProductId });
      continue;
    }
    entry.resolvedCanonicalId = candidate?.productId || null;
    resolved.push({ candidate, entry, canonicalId: candidate?.productId || null });
  }

  const comparisonHits = resolved.filter(({ entry }) => entry.comparisonEqual);
  const searchOnlyHits = resolved.filter(({ entry }) => !entry.comparisonEqual && entry.searchKeyEqual);

  // Step 5-7: comparison-equality grouping by canonical identity + manufacturer policy.
  let decision = null;
  if (comparisonHits.length > 0) {
    const groups = new Map();
    for (const hit of comparisonHits) {
      const key = hit.canonicalId || `row:${hit.candidate?.productId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(hit);
    }
    if (groups.size === 1) {
      const [[canonicalId, members]] = [...groups.entries()];
      const memberKeys = new Set(
        members.map(({ candidate }) => candidateManufacturerKey(candidate)).filter(Boolean),
      );
      if (factManufacturer) {
        const agreeing = members.filter(({ candidate }) => manufacturerAgrees(candidate?.manufacturer, factManufacturer));
        const disagreeing = members.filter(({ candidate }) =>
          text(candidate?.manufacturer).trim()
          && !manufacturerAgrees(candidate?.manufacturer, factManufacturer));
        if (agreeing.length > 0 && disagreeing.length === 0) {
          decision = { canonicalId, manufacturerBasis: "MATCHED", reasonCodes: ["COMPARISON_UNIQUE", "MANUFACTURER_MATCHED"] };
        } else {
          decision = null;
          evidence.ambiguityCause = "MANUFACTURER_CONFLICT";
        }
      } else if (memberKeys.size <= 1) {
        decision = { canonicalId, manufacturerBasis: "UNKNOWN_SINGLETON", reasonCodes: ["COMPARISON_UNIQUE", "MANUFACTURER_UNKNOWN_SINGLETON"] };
      } else {
        decision = null;
        evidence.ambiguityCause = "MANUFACTURER_CONFLICT";
      }
      if (decision && members.some(({ entry }) => entry.wasSuperseded)) {
        decision.reasonCodes.push("CANONICAL_CONVERGENCE");
      }
    } else {
      evidence.ambiguityCause = "MULTIPLE_CANONICAL_TARGETS";
    }
  }

  // Step 8: unresolved identity conflicts block determinism.
  if (decision && (conflicts.has(decision.canonicalId)
    || comparisonHits.some(({ candidate }) => conflicts.has(candidate?.productId)))) {
    return baseResult("AMBIGUOUS_TARGET", {
      reasonCodes: ["UNRESOLVED_IDENTITY_CONFLICT"],
      evidence: { ...evidence, conflictingTarget: decision.canonicalId },
      candidatesConsidered: considered,
      recommendedAction: "ENGINEER_REVIEW_IDENTITY_CONFLICT",
    });
  }

  if (decision) {
    evidence.manufacturerBasis = decision.manufacturerBasis;
    // Step 10: existing single-link state against the deterministic target.
    const link = existingLinks[0] || null;
    if (!link) {
      return baseResult("EXACT_UNIQUE_TARGET", {
        selectedTarget: decision.canonicalId,
        reasonCodes: decision.reasonCodes,
        evidence,
        candidatesConsidered: considered,
        recommendedAction: "LINK_FACT_TO_CANONICAL_TARGET",
      });
    }
    const storedTarget = link.existingProductId || null;
    if (!storedTarget) {
      return baseResult("REPAIRABLE_NEW_PRODUCT_CANDIDATE", {
        selectedTarget: decision.canonicalId,
        reasonCodes: [...decision.reasonCodes, "NPC_NULL_TARGET_REPAIR"],
        evidence: { ...evidence, repairableLinkId: link.id || null, repairableLinkState: link.linkState || null },
        candidatesConsidered: considered,
        recommendedAction: "REPAIR_NPC_LINK_TO_CANONICAL_TARGET",
      });
    }
    if (storedTarget === decision.canonicalId) {
      return baseResult("ALREADY_LINKED", {
        selectedTarget: decision.canonicalId,
        reasonCodes: [...decision.reasonCodes, "LINK_ALREADY_TARGETS_CANONICAL"],
        evidence: { ...evidence, linkedLinkId: link.id || null },
        candidatesConsidered: considered,
        recommendedAction: "NO_ACTION",
      });
    }
    return baseResult("EXISTING_LINK_CONFLICT", {
      reasonCodes: [...decision.reasonCodes, "LINK_TARGETS_DIFFERENT_PRODUCT"],
      evidence: {
        ...evidence,
        conflictingLinkId: link.id || null,
        storedTarget,
        deterministicTarget: decision.canonicalId,
      },
      candidatesConsidered: considered,
      recommendedAction: "ENGINEER_REVIEW_LINK_CONFLICT",
    });
  }

  // No deterministic target: broken chain, search-only ambiguity, or no target.
  const brokenComparison = broken.filter(({ candidate }) =>
    comparisonPartNumber(candidate?.partNumber) === factComparison && factComparison.length > 0);
  if (brokenComparison.length > 0) {
    return baseResult("BROKEN_CANONICAL_CHAIN", {
      reasonCodes: ["CANONICAL_RESOLUTION_FAILED"],
      evidence: {
        ...evidence,
        brokenProducts: brokenComparison.map(({ candidate, entry }) => ({
          productId: candidate?.productId || null,
          error: entry.canonicalError,
        })),
      },
      candidatesConsidered: considered,
      recommendedAction: "ENGINEER_REVIEW_CANONICAL_CHAIN",
    });
  }
  if (comparisonHits.length > 0 || searchOnlyHits.length > 0) {
    const codes = ["CANDIDATE_MATCH_NOT_DETERMINISTIC"];
    if (evidence.ambiguityCause === "MANUFACTURER_CONFLICT") codes.push("MANUFACTURER_CONFLICT");
    if (evidence.ambiguityCause === "MULTIPLE_CANONICAL_TARGETS") codes.push("MULTIPLE_CANONICAL_TARGETS");
    if (searchOnlyHits.length > 0 && comparisonHits.length === 0) codes.push("SEARCH_KEY_ONLY_NEVER_PROVES_IDENTITY");
    return baseResult("AMBIGUOUS_TARGET", {
      reasonCodes: codes,
      evidence,
      candidatesConsidered: considered,
      recommendedAction: "ENGINEER_REVIEW_AMBIGUOUS_CANDIDATES",
    });
  }
  return baseResult("NO_TARGET", {
    reasonCodes: ["NO_VISIBLE_CANDIDATE"],
    evidence,
    candidatesConsidered: considered,
    recommendedAction: "AWAIT_FUTURE_RECONCILIATION",
  });
};
