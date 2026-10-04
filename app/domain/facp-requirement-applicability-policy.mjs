// GOLDEN-6 / GOLDEN-6A -- GOVERNED FACP REQUIREMENT APPLICABILITY POLICY.
//
// GOLDEN-6 closes the governed technical-requirement linkage gap across the
// seven Fire Alarm Control Panel (FACP) BOQ items WITHOUT fabricating
// completeness. GOLDEN-6A hardens the policy fail-closed: matching
// system/category classifications can never become applicability evidence by
// themselves.
//
// CORE PRINCIPLE (GOLDEN-6 mission):
//   requirement similarity != requirement applicability.
//   No linkage may be inferred from similar BOQ descriptions, same-system
//   membership, another FACP item carrying it, commercial convenience, or an
//   assumed panel identity. A (requirement, item) pair becomes a governed
//   Confirmed link ONLY through an explicit, traceable applicability basis.
//
// GOLDEN-6A CORE INVARIANT:
//   Matching classifications VALIDATE applicability. They do not ESTABLISH
//   applicability. "requirement.system == item.system AND
//   requirement.category == item.category" is never, by itself, enough to
//   produce CONFIRMED_APPLICABLE: the requirement must carry a governed scope
//   declaration (its approved extraction explicitly names the system and
//   category it governs) or another governed evidence basis. Without such
//   evidence the pair returns INSUFFICIENT_EVIDENCE
//   (RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE) -- fail closed.
//
// Evidence-source vs validation-attribute distinction (GOLDEN-6A section 7):
//   A. Evidence that ESTABLISHES scope (caller-asserted governed evidence):
//        GOVERNED_ECOSYSTEM_DECISION, SAME_EXPLICIT_SYSTEM_SCOPE (requires the
//        requirement's explicit governed scope declaration -- in this module
//        the declaration is the scope-establishing source, referenced as
//        EXPLICIT_REQUIREMENT_SCOPE), SAME_DRAWING_SYSTEM_REFERENCE,
//        APPROVED_PROJECT_WIDE_REQUIREMENT, HUMAN_ENGINEERING_DECISION,
//        EXPLICIT_BOQ_RELATIONSHIP.
//   B. Attributes used ONLY to validate a declared scope:
//        item.system, item.category, item.productFamily, item.building,
//        item.zone, requirement.system, requirement.category.
//      Attributes from group B can never independently create a governed link.
//
// RULE ORDER (fail closed):
//   1. requirement eligibility (Approved, approved_for_downstream = 1)
//   2. extraction/version currency (current row only)
//   3. ecosystem carrier gate (resolved -> may propagate; unresolved ->
//      propagation forbidden, never a temporary compatibility target)
//   4. explicit exclusion / not-applicable evidence
//   5. ambiguity (unresolved -> REQUIRES_ENGINEERING_REVIEW)
//   6. governed applicability evidence:
//        a. explicit drawing/system reference
//        b. explicit BOQ relationship
//        c. approved project-wide scope
//        d. recorded human engineering decision
//        e. governed ecosystem decision
//        f. explicit requirement scope (governedScope declaration)
//   7. validate target item against the governed scope
//   8. no governed evidence -> INSUFFICIENT_EVIDENCE. There is NO generic
//      "same system + same category -> confirmed" fallback.
//
// This module is the PURE DOMAIN decision layer that PRECEDES link creation.
// It deliberately does not touch the database. It classifies every
// (requirement, item) pair into exactly one of four statuses, then plans the
// minimal governed link set. The canonical persistence route stays the
// project's existing model:
//
//   technical_requirements (approved, current, eligible)
//     +-- requirement_compatibility (the ecosystem child row)
//     +-- boq_requirement_links   (status='Confirmed', one link per item,
//                                  UNIQUE (boq_item_id, requirement_id,
//                                  version_number))
//
// The engine's status vocabulary (APPLICABILITY_STATUSES in
// technical-requirement-engine.mjs: "Confirmed Applicable" etc.) describes
// how a link is CONSUMED once it exists. This module describes the governed
// decision that CREATES the link. The mapping is documented, not duplicated:
//
//   CONFIRMED_APPLICABLE   -> plan writes a Confirmed link
//                             -> engine resolveApplicability returns
//                                "Confirmed Applicable" for that item
//   NOT_APPLICABLE         -> no link; governed evidence says the
//                             requirement does not cover this item
//   INSUFFICIENT_EVIDENCE  -> no link; FAIL CLOSED until a governed basis
//                             exists (similarity is never a basis)
//   REQUIRES_ENGINEERING_REVIEW -> no link; surfaced for a governed human
//                             applicability decision, which is later recorded
//                             through the existing authority/provenance model
//                             and produces CONFIRMED_APPLICABLE links.
//
// ECOSYSTEM GATE (mission section 7):
//   Resolved ecosystem states (EXPLICIT_PROJECT_ECOSYSTEM, RESOLVED_FARENHYT,
//   RESOLVED_GENT -- where RESOLVED_GAMEWELL_FCI / RESOLVED_SIMPLEX are the
//   EXPLICIT_PROJECT_ECOSYSTEM targets of a governed large-system approval per
//   the GOLDEN-5 Rule D route) MAY propagate the single canonical compatibility
//   requirement to the applicable FACP items.
//   Unresolved states (LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED,
//   MISSING_FIRE_ALARM_COMPLIANCE_BASIS, PANEL_SIZING_SNAPSHOT_REQUIRED,
//   COMPLEXITY_REVIEW_REQUIRED) MUST NOT propagate compatibility and never
//   become a temporary compatibility target: staying blocked is the governed
//   posture.
//
// The propagation gate is implemented by REUSING the GOLDEN-5 policy's
// `ecosystemIsResolved` contract -- one authority, not a second copy.
//
// VERSION CORRECTNESS:
//   Only rows that are current evidence (belong to a non-superseded
//   specification extraction) AND eligible for downstream engineering
//   (review_status='Approved' AND approved_for_downstream=1 -- the canonical
//   currentTechnicalRequirementEligibleForEngineeringPredicate contract) can
//   ever be planned into a link. Obsolete, unapproved, rejected, and draft
//   rows fail closed as NOT_APPLICABLE.
//
// IDEMPOTENCY:
//   planApplicabilityLinks dedupes against the caller's already-persisted
//   links; the canonical UNIQUE (boq_item_id, requirement_id, version_number)
//   index is the persistence-side enforcer. Re-running a plan after applying
//   it yields no duplicate links and no false profile change.
import { ecosystemIsResolved, AUTHORITY_BASES } from "./fire-alarm-ecosystem-policy.mjs";

export const FACP_APPLICABILITY_POLICY_VERSION = "facp-requirement-applicability-policy-1.1.0";

// GOLDEN-6A vocabulary (mission section 7): the scope-ESTABLISHING evidence
// source behind the SAME_EXPLICIT_SYSTEM_SCOPE basis is the requirement's
// explicit governed scope declaration. The declaration is recorded on the
// classification as `scopeEvidence`; the classification `basis` keeps the
// GOLDEN-6 name required by mission section 10.
export const EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE = "EXPLICIT_REQUIREMENT_SCOPE";

// GOLDEN-6A (mission section 13): the ecosystem DECISION AUTHORITY is a
// distinct concept from the ecosystem RESULT (decisionState / resolvedEcosystem
// / compatibilityTarget). GOLDEN-5 already models the authority internally as
// `basis`; this surface makes the distinction explicit for the applicability
// policy and its callers:
//   resolvedEcosystem: "FARENHYT"  +  decisionAuthority: "ENGINEERING_POLICY_RESOLUTION"
//   resolvedEcosystem: "GENT"      +  decisionAuthority: "ENGINEERING_POLICY_RESOLUTION"
//   resolvedEcosystem: "GAMEWELL_FCI" + decisionAuthority: "PROJECT_REQUIREMENT" (Rule A)
//   resolvedEcosystem: "GAMEWELL_FCI" + decisionAuthority: "HUMAN_ENGINEERING_DECISION" (Rule D)
// An authority is NEVER encoded inside a decision state name.
export const ECOSYSTEM_DECISION_AUTHORITIES = Object.freeze([...AUTHORITY_BASES]);

// The four decision statuses a (requirement, item) pair may receive.
export const FACP_APPLICABILITY_STATUSES = Object.freeze([
  "CONFIRMED_APPLICABLE",
  "NOT_APPLICABLE",
  "INSUFFICIENT_EVIDENCE",
  "REQUIRES_ENGINEERING_REVIEW",
]);

// The ONLY governed evidence bases that may justify a confirmed link (mission
// section 6). Every base is asserted by the CALLER as governed evidence; the
// classifier never invents scope from description similarity.
export const APPLICABILITY_EVIDENCE_BASES = Object.freeze([
  // The GOLDEN-5 governed ecosystem decision (compatible family requirement).
  "GOVERNED_ECOSYSTEM_DECISION",
  // The requirement's governed extraction scope names the same explicit
  // system + category scope in the specification.
  "SAME_EXPLICIT_SYSTEM_SCOPE",
  // A drawing / system reference explicitly ties the requirement to named
  // BOQ items.
  "SAME_DRAWING_SYSTEM_REFERENCE",
  // The approved requirement is a genuine project-wide obligation covering
  // every FACP item.
  "APPROVED_PROJECT_WIDE_REQUIREMENT",
  // A recorded human engineering applicability decision (which requirement,
  // which items, why, scope, authority).
  "HUMAN_ENGINEERING_DECISION",
  // An existing modeled BOQ/system relationship explicitly attaches the
  // requirement to named items.
  "EXPLICIT_BOQ_RELATIONSHIP",
]);

export const APPLICABILITY_RULES = Object.freeze({
  ECOSYSTEM_RESOLVED: "RULE_1_RESOLVED_ECOSYSTEM_PROPAGATION",
  ECOSYSTEM_UNRESOLVED: "RULE_1B_UNRESOLVED_ECOSYSTEM_NO_PROPAGATION",
  REQUIREMENT_NOT_ELIGIBLE: "RULE_2_REQUIREMENT_NOT_ELIGIBLE",
  SUPERSEDED_VERSION: "RULE_3_SUPERSEDED_REQUIREMENT_VERSION",
  EXPLICIT_SYSTEM_SCOPE: "RULE_4_EXPLICIT_SYSTEM_SCOPE",
  // GOLDEN-6A (mission section 10): a requirement that DOES declare an explicit
  // governed scope but whose declared scope does not cover this item's
  // classification is governed out-of-scope (not applicable) -- explicit scope
  // is never broadened beyond its declared boundaries.
  SCOPE_MISMATCH: "RULE_4B_EXPLICIT_SCOPE_MISMATCH",
  DRAWING_SYSTEM_REFERENCE: "RULE_5_DRAWING_SYSTEM_REFERENCE",
  PROJECT_WIDE: "RULE_6_APPROVED_PROJECT_WIDE",
  HUMAN_DECISION: "RULE_7_HUMAN_ENGINEERING_DECISION",
  EXPLICIT_RELATIONSHIP: "RULE_8_EXPLICIT_BOQ_RELATIONSHIP",
  SUBSET_EXCLUDED: "RULE_9_SUBSET_SCOPE_EXCLUDES_ITEM",
  AMBIGUOUS: "RULE_10_ENGINEERING_REVIEW_REQUIRED",
  // GOLDEN-6A (mission section 5): there is NO permissive no-evidence
  // fallback. Same system/category/product-family/description is never
  // applicability evidence; a pair without any governed basis is fail-closed.
  NO_GOVERNED_APPLICABILITY_EVIDENCE: "RULE_11_NO_GOVERNED_APPLICABILITY_EVIDENCE",
});

// GOLDEN-5 contract mirror (ECOSYSTEM_DECISION_STATES). Resolved states carry
// a compatibilityTarget; unresolved states never do. RESOLVED_GAMEWELL_FCI /
// RESOLVED_SIMPLEX are not separate states: they are the compatibilityTargets
// recorded by the governed large-system approval under
// EXPLICIT_PROJECT_ECOSYSTEM (GOLDEN-5 Rule D).
export const ECOSYSTEM_RESOLVED_STATES = Object.freeze([
  "EXPLICIT_PROJECT_ECOSYSTEM",
  "RESOLVED_FARENHYT",
  "RESOLVED_GENT",
]);

export const ECOSYSTEM_UNRESOLVED_STATES = Object.freeze([
  "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED",
  "MISSING_FIRE_ALARM_COMPLIANCE_BASIS",
  "PANEL_SIZING_SNAPSHOT_REQUIRED",
  "COMPLEXITY_REVIEW_REQUIRED",
]);

// One authority for "may the compatibility requirement propagate?" -- the
// GOLDEN-5 resolution test itself. An unresolved or absent ecosystem decision
// forbids propagation; no compatibilityTarget is ever created or propagated.
export const ecosystemPropagationPermitted = (ecosystem) =>
  Boolean(ecosystem && ecosystemIsResolved(ecosystem));

// GOLDEN-6A -- EXPLICIT GOVERNED SCOPE REPRESENTATION (mission sections 4, 5,
// 7, 10). A requirement carries a governed scope declaration ONLY when its
// approved extraction explicitly declares the system/category scope it
// governs (`requirement.governedScope = { system, category }`). The item's own
// classification (system/category/productFamily/...) is used ONLY to VALIDATE
// whether the item falls inside an already-declared scope; it can never
// declare a scope by matching the requirement's classification columns.
const hasExplicitGovernedScope = (requirement) => {
  const scope = requirement?.governedScope;
  return Boolean(scope && typeof scope === "object" && scope.system && scope.category);
};

const itemWithinDeclaredScope = (requirement, item) =>
  hasExplicitGovernedScope(requirement) &&
  requirement.governedScope.system === item.system &&
  requirement.governedScope.category === item.category;

/**
 * Classify ONE (requirement, item) pair. Pure and deterministic; never reads
 * the database and never inspects description similarity as a basis.
 *
 * @param {{ id: string, reviewStatus: string, approvedForDownstream: number,
 *           extractionIsCurrent: boolean, system?: string, category?: string,
 *           governedScope?: { system: string, category: string }|null,
 *           ecosystemCarrier?: boolean, ambiguity?: boolean }} requirement
 * @param {{ id: string, system: string, category: string }} item
 * @param {object|null} ecosystem  the GOLDEN-5 decision object (or null)
 * @param {{ base?: string, scopeItemIds?: string[]|null, ambiguous?: boolean }|null} evidence
 */
export function classifyRequirementApplicability({ requirement, item, ecosystem = null, evidence = null }) {
  const r = requirement || {};
  const base = evidence?.base ?? null;
  const scopeIds = evidence?.scopeItemIds ?? null;
  const inScope = Array.isArray(scopeIds) && scopeIds.includes(item.id);
  const scopeDeclared = Array.isArray(scopeIds);

  const notApplicable = (ruleId, reason, extra = {}) =>
    ({ status: "NOT_APPLICABLE", basis: null, ruleId, reason, ...extra });
  const confirmed = (basis, ruleId, reason, extra = {}) =>
    ({ status: "CONFIRMED_APPLICABLE", basis, ruleId, reason, ...extra });
  const insufficient = (reason) =>
    ({ status: "INSUFFICIENT_EVIDENCE", basis: null, ruleId: APPLICABILITY_RULES.NO_GOVERNED_APPLICABILITY_EVIDENCE, reason });
  const review = (reason) =>
    ({ status: "REQUIRES_ENGINEERING_REVIEW", basis: base, ruleId: APPLICABILITY_RULES.AMBIGUOUS, reason });

  // RULE-2 -- downstream eligibility is a pre-condition for ANY link. This is
  // the canonical currentTechnicalRequirementEligibleForEngineeringPredicate
  // contract (review_status='Approved' AND approved_for_downstream=1). Draft,
  // rejected, unapproved, and not-approved-for-downstream rows never link.
  if (r.reviewStatus !== "Approved" || Number(r.approvedForDownstream) !== 1) {
    return notApplicable(
      APPLICABILITY_RULES.REQUIREMENT_NOT_ELIGIBLE,
      "A requirement that is not both review_status='Approved' and approved_for_downstream=1 can never receive a downstream Confirmed link.",
    );
  }

  // RULE-3 -- version correctness: only the CURRENT extraction's rows are live
  // evidence. A requirement belonging to a superseded extraction is obsolete
  // and can never be planned into a new link.
  if (r.extractionIsCurrent === false) {
    return notApplicable(
      APPLICABILITY_RULES.SUPERSEDED_VERSION,
      "The requirement belongs to a superseded specification extraction; it is not current evidence and can never be linked for downstream propagation.",
    );
  }

  // RULE-1 / RULE-1B -- the ecosystem gate. The single canonical compatibility
  // requirement (created from the GOLDEN-5 decision) propagates to every FACP
  // item ONLY when the ecosystem is genuinely resolved. An unresolved state
  // NEVER becomes a temporary compatibility target and NEVER propagates.
  const isEcosystemCarrier = r.ecosystemCarrier === true || base === "GOVERNED_ECOSYSTEM_DECISION";
  if (isEcosystemCarrier) {
    if (ecosystemPropagationPermitted(ecosystem)) {
      return confirmed(
        "GOVERNED_ECOSYSTEM_DECISION",
        APPLICABILITY_RULES.ECOSYSTEM_RESOLVED,
        `The governed ecosystem decision (${ecosystem.decisionState}) resolves a compatibility family; the single canonical compatibility requirement propagates to this FACP item.`,
        // GOLDEN-6A (mission section 13): the ecosystem RESULT is the resolved
        // family; the decision AUTHORITY is the way the resolution was reached.
        // The two are distinct surfaces and are recorded separately.
        {
          resolvedEcosystem: ecosystem.resolvedEcosystem ?? null,
          compatibilityTarget: ecosystem.compatibilityTarget ?? null,
          decisionAuthority: ecosystem.basis ?? null,
        },
      );
    }
    return {
      status: "NOT_APPLICABLE",
      basis: "GOVERNED_ECOSYSTEM_DECISION",
      ruleId: APPLICABILITY_RULES.ECOSYSTEM_UNRESOLVED,
      propagationForbidden: true,
      decisionAuthority: ecosystem?.basis ?? null,
      reason: `The ecosystem decision is unresolved (${ecosystem?.decisionState ?? "no decision recorded"}); compatibility must not propagate and no temporary compatibilityTarget may exist. Staying blocked is the governed posture.`,
    };
  }

  // RULE-10 -- ambiguous / contested applicability evidence never auto-links;
  // it is surfaced so a governed human applicability decision can resolve it.
  // A RECORDED human decision is exactly the instrument that resolves the
  // ambiguity, so the gate yields when one exists (it is evaluated below).
  if ((r.ambiguity === true || evidence?.ambiguous === true) && base !== "HUMAN_ENGINEERING_DECISION") {
    return review(
      "Applicability evidence is ambiguous or contested; a governed human engineering applicability decision is required before any link may be planned.",
    );
  }

  // Governed evidence bases (RULE-5/6/7/8/9). Similarity is NEVER consulted.
  switch (base) {
    case "SAME_DRAWING_SYSTEM_REFERENCE":
    case "EXPLICIT_BOQ_RELATIONSHIP": {
      if (inScope) {
        return confirmed(
          base,
          base === "SAME_DRAWING_SYSTEM_REFERENCE"
            ? APPLICABILITY_RULES.DRAWING_SYSTEM_REFERENCE
            : APPLICABILITY_RULES.EXPLICIT_RELATIONSHIP,
          "Governed scope evidence names this BOQ item directly.",
        );
      }
      if (scopeDeclared) {
        return notApplicable(
          APPLICABILITY_RULES.SUBSET_EXCLUDED,
          "Governed scope evidence names other BOQ items; this item is explicitly outside its scope.",
        );
      }
      return insufficient(
        `${base} evidence does not name any BOQ item; a drawing/system reference alone is not enough to confirm applicability.`,
      );
    }
    case "HUMAN_ENGINEERING_DECISION": {
      if (inScope) {
        return confirmed(
          "HUMAN_ENGINEERING_DECISION",
          APPLICABILITY_RULES.HUMAN_DECISION,
          "A governed human engineering decision recorded this requirement as applicable to this BOQ item.",
        );
      }
      if (scopeDeclared) {
        return notApplicable(
          APPLICABILITY_RULES.SUBSET_EXCLUDED,
          "The human decision names other BOQ items; this item is outside its decided scope.",
        );
      }
      return insufficient(
        "A governed human applicability decision must name the BOQ items it covers; none were recorded.",
      );
    }
    case "APPROVED_PROJECT_WIDE_REQUIREMENT":
      return confirmed(
        "APPROVED_PROJECT_WIDE_REQUIREMENT",
        APPLICABILITY_RULES.PROJECT_WIDE,
        "The approved requirement is a genuine project-wide obligation that governs every Fire Alarm Control Panel item.",
      );
    case "SAME_EXPLICIT_SYSTEM_SCOPE":
      // GOLDEN-6A (mission section 4): this basis is valid ONLY when the
      // requirement itself carries an explicit governed scope declaration. The
      // item's classification then CONFIRMS the item falls within an
      // already-established scope; it never invents that scope.
      if (!hasExplicitGovernedScope(r)) {
        return insufficient(
          "The evidence base claims an explicit governed requirement scope, but the requirement carries no explicit governed scope declaration. Same system/category classifications only VALIDATE applicability; they do not establish it.",
        );
      }
      if (itemWithinDeclaredScope(r, item)) {
        return confirmed(
          "SAME_EXPLICIT_SYSTEM_SCOPE",
          APPLICABILITY_RULES.EXPLICIT_SYSTEM_SCOPE,
          "The requirement carries an explicit governed scope declaration (its approved extraction names the system and category it governs); this item's governed classification falls within that declared scope.",
          {
            scopeEvidence: EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE,
            declaredScope: { ...r.governedScope },
          },
        );
      }
      return notApplicable(
        APPLICABILITY_RULES.SCOPE_MISMATCH,
        "The requirement declares an explicit governed scope that does not cover this item's system/category classification; the item is governed out-of-scope and explicit scope is never broadened beyond its declared boundaries.",
      );
    case null: {
      // GOLDEN-6A (mission sections 5, 8, 9): the requirement's OWN explicit
      // governed scope declaration is the scope-ESTABLISHING evidence. Without
      // any governed basis -- no explicit declaration, no project-wide
      // evidence, no drawing/system reference, no BOQ relationship, no human
      // decision -- matching system/category/product-family/description
      // attributes produce INSUFFICIENT_EVIDENCE, NEVER a link. There is no
      // "same system + same category -> confirmed" fallback.
      if (hasExplicitGovernedScope(r)) {
        if (itemWithinDeclaredScope(r, item)) {
          return confirmed(
            "SAME_EXPLICIT_SYSTEM_SCOPE",
            APPLICABILITY_RULES.EXPLICIT_SYSTEM_SCOPE,
            "The requirement carries an explicit governed scope declaration; this item's governed classification falls within it.",
            {
              scopeEvidence: EXPLICIT_REQUIREMENT_SCOPE_EVIDENCE,
              declaredScope: { ...r.governedScope },
            },
          );
        }
        return notApplicable(
          APPLICABILITY_RULES.SCOPE_MISMATCH,
          "The requirement's explicit governed scope declaration does not cover this item's classification; the item is governed out-of-scope.",
        );
      }
      return insufficient(
        "No governed scope evidence exists for this requirement -- no explicit governed scope declaration, no project-wide evidence, no drawing/system reference, no BOQ relationship, no human engineering decision. Matching system/category/product-family classifications and identical descriptions only VALIDATE applicability; they do not ESTABLISH it. This pair stays fail-closed -- never a link.",
      );
    }
    default:
      return insufficient(base
        ? `Unknown governed evidence base '${base}'; fail closed.`
        : "No governed evidence basis was provided.");
  }
}

/**
 * Plan the minimal governed Confirmed-link set for every (requirement, item)
 * pair. Pure and deterministic.
 *
 * @param {{ requirements: object[], items: object[], ecosystem: object|null,
 *           evidenceByRequirement: Record<string, object>,
 *           existingLinks: {requirementId,itemId,versionNumber}[] }} input
 * @returns {{ policyVersion, propagationPermitted, ecosystem, classifications,
 *             linksToCreate, confirmedPairs, reviewPairs }}
 */
export function planApplicabilityLinks({
  requirements = [],
  items = [],
  ecosystem = null,
  evidenceByRequirement = {},
  existingLinks = [],
}) {
  const classifications = [];
  const linksToCreate = [];
  const linkKey = (link) => `${link.requirementId}|${link.itemId}|${Number(link.versionNumber ?? 1)}`;
  const existingKeys = new Set(existingLinks.map(linkKey));

  for (const requirement of requirements) {
    const evidence = evidenceByRequirement[requirement.id] ?? null;
    for (const item of items) {
      const classification = classifyRequirementApplicability({ requirement, item, ecosystem, evidence });
      classifications.push({ requirementId: requirement.id, itemId: item.id, ...classification });
      if (classification.status !== "CONFIRMED_APPLICABLE") continue;
      const link = {
        requirementId: requirement.id,
        itemId: item.id,
        versionNumber: 1,
        linkMethod: "Governed Applicability Policy",
        confidence: 100,
        basis: classification.basis,
        ruleId: classification.ruleId,
        evidence: [
          {
            basis: classification.basis,
            policyVersion: FACP_APPLICABILITY_POLICY_VERSION,
            ruleId: classification.ruleId,
            requirementId: requirement.id,
            itemId: item.id,
          },
        ],
      };
      if (!existingKeys.has(linkKey(link))) linksToCreate.push(link);
    }
  }

  return {
    policyVersion: FACP_APPLICABILITY_POLICY_VERSION,
    propagationPermitted: ecosystemPropagationPermitted(ecosystem),
    ecosystem: ecosystem
      ? {
        decisionState: ecosystem.decisionState ?? null,
        resolvedEcosystem: ecosystem.resolvedEcosystem ?? null,
        compatibilityTarget: ecosystem.compatibilityTarget ?? null,
        // GOLDEN-6A (mission section 13): the ecosystem RESULT and the
        // decision AUTHORITY are distinct concepts. The authority is the
        // GOLDEN-5 `basis` through which the result was reached; it is never
        // encoded inside the decision state name.
        decisionAuthority: ecosystem.basis ?? null,
      }
      : null,
    classifications,
    linksToCreate,
    confirmedPairs: classifications.filter((entry) => entry.status === "CONFIRMED_APPLICABLE").length,
    reviewPairs: classifications
      .filter((entry) => entry.status === "REQUIRES_ENGINEERING_REVIEW")
      .map((entry) => ({ requirementId: entry.requirementId, itemId: entry.itemId, reason: entry.reason })),
  };
}