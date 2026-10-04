// FIRE ALARM BRAND STRATEGY -- governed company policy engine.
//
// WHY THIS EXISTS
// ---------------
// Technical compatibility does NOT determine the preferred commercial brand.
// Historically the workflow went straight from requirements to product matching,
// so whichever brand happened to have the deepest technical corpus silently won.
// That is a governance defect, not a technical one: the preferred brand is a
// COMPANY commercial decision layered UNDER technical matching.
//
// The precedence is fixed and is applied in this order:
//
//   1. Mandatory Client/Consultant brand      -> that brand wins, always
//   2. Governing standards regime             -> UL/FM or EN
//   3. Company in-house brand policy          -> by regime and project scale
//   4. Technical suitability
//   5. Commercial / vendor strength
//
// Steps 4 and 5 are deliberately NOT inputs here. This module decides the
// preferred brand; it never decides that a brand is technically acceptable.
//
// SCOPE DISCIPLINE
// ----------------
// This policy applies to the FIRE ALARM system category ONLY. It is not
// extended to CCTV, access control, BMS or any other category, because the
// in-house portfolio, stock position and partnership terms differ per category
// and no governed decision covers them.
//
// PROJECT INDEPENDENCE
// --------------------
// Nothing here is specific to any project. Al Mousa is an INPUT, not a
// constant. The policy is data (IN_HOUSE_POLICY), not code branches.
import { z } from "zod";

export const BRAND_STRATEGY_VERSION = "fire-alarm-brand-strategy-1.0.0";

// The governed company Fire Alarm brand policy. Changing this table is a
// business decision, not a code change, and it must never be widened to other
// system categories without a separate governed policy.
export const IN_HOUSE_FIRE_ALARM_POLICY = Object.freeze({
  policyId: "company-fire-alarm-brand-policy-v1",
  scopeSystemCategory: "FIRE_ALARM",
  regimeScaleThresholds: Object.freeze({
    // UL/FM projects split on total addressable Fire Alarm points.
    ULF_LARGE_PROJECT_MIN_POINTS_EXCLUSIVE: 2000,
  }),
  byRegime: Object.freeze({
    ULF: Object.freeze({
      smallProjectInHouseBrand: "FARENHYT",
      largeProjectInHouseBrand: "GAMEWELL",
    }),
    EN: Object.freeze({
      inHouseBrand: "GENT",
    }),
  }),
  // Brands that may still be used, but never become the preferred solution
  // merely because they are technically compatible.
  nonInHouseBrandStatus: "TECHNICALLY_VALID_ALTERNATIVE",

  // ---------------------------------------------------------------------------
  // COMMERCIAL RELATIONSHIP REGISTRY -- drives the downstream workflow.
  // ---------------------------------------------------------------------------
  // Membership here is EXPLICIT GOVERNED COMPANY POLICY. It is deliberately NOT
  // inferred from parent-company identity: NOTIFIER is a Honeywell brand and is
  // still EXTERNAL, because the company has no comparable direct in-house
  // commercial position for it. Getting this wrong would route an in-house brand
  // into a supplier RFQ, or a non-in-house brand into internal pricing the company
  // cannot actually perform.
  companyBrandRegistry: Object.freeze({
    // The three in-house / preferred Fire Alarm brands. For these the company does
    // NOT normally issue a supplier RFQ: it selects, prices and costs internally.
    IN_HOUSE: Object.freeze(["FARENHYT", "GAMEWELL", "GENT"]),
    // Anything not listed IN_HOUSE is treated as EXTERNAL. An unknown brand has no
    // evidenced in-house commercial position, so the supplier-assisted workflow is
    // the safe and correct route. Failing toward EXTERNAL never fabricates a
    // commercial capability the company has not been governed as having.
  }),

  // The two commercial workflows. These are distinct processes with different
  // selection authorities, not variants of one.
  commercialWorkflows: Object.freeze({
    IN_HOUSE: Object.freeze({
      workflow: "INTERNAL_SELECTION_AND_PRICING",
      sequence: Object.freeze([
        "INTERNAL_DETAILED_TECHNICAL_SELECTION",
        "INTERNAL_BOM",
        "INTERNAL_COMMERCIAL_PRICING",
        "COSTING",
        "QUOTATION",
      ]),
      supplierIsSelectionAuthority: false,
      requiresSupplierRfqBeforeCosting: false,
      note:
        "The company performs technical selection, detailed BOM, commercial pricing and " +
        "costing internally, using its own stock position, partnership arrangements, " +
        "internal price data and governed price lists. The supplier is NOT the normal " +
        "selection authority for these brands. An unresolved component must be resolved " +
        "internally from governed evidence, or the exact evidence gap must be exposed -- " +
        "it must NOT be silently converted into an external supplier-selection workflow.",
    }),
    EXTERNAL: Object.freeze({
      workflow: "SUPPLIER_RFQ_AND_ENGINEER_REVIEW",
      sequence: Object.freeze([
        "PRELIMINARY_TECHNICAL_SELECTION",
        "PRELIMINARY_BOM",
        "SUPPLIER_RFQ",
        "SUPPLIER_DETAILED_SOLUTION",
        "ENGINEER_REVIEW",
        "APPROVED_BOM",
        "PRICE_APPROVAL",
        "COSTING",
        "QUOTATION",
      ]),
      supplierIsSelectionAuthority: true,
      requiresSupplierRfqBeforeCosting: true,
      note:
        "The supplier completes detailed selection and returns a proposed technical " +
        "solution, which enters as SUPPLIER_PROPOSED_TECHNICAL_SOLUTION. It does NOT " +
        "become approved automatically; engineer review is required first. This workflow " +
        "must NOT be applied automatically to an in-house brand.",
    }),
  }),
});

export const BRAND_RELATIONSHIPS = Object.freeze(["IN_HOUSE", "EXTERNAL"]);

/**
 * Resolve the commercial relationship of a brand from EXPLICIT governed policy.
 *
 * Never infer IN_HOUSE from a parent company. A brand is IN_HOUSE only if the
 * governed registry lists it. Anything else is EXTERNAL, which routes to the
 * supplier-assisted workflow.
 */
export const resolveBrandRelationship = (brand, policy = IN_HOUSE_FIRE_ALARM_POLICY) => {
  const name = String(brand ?? "").trim().toUpperCase();
  if (!name) return "EXTERNAL";
  return policy.companyBrandRegistry.IN_HOUSE.includes(name) ? "IN_HOUSE" : "EXTERNAL";
};

/** Attach the commercial workflow that the resolved brand relationship implies. */
export const commercialWorkflowFor = (brand, policy = IN_HOUSE_FIRE_ALARM_POLICY) => {
  const relationship = resolveBrandRelationship(brand, policy);
  const w = policy.commercialWorkflows[relationship];
  return {
    brandRelationship: relationship,
    // Both names are exposed: `commercialWorkflow` is the governed field downstream
    // routing reads; `workflow` is retained as the short alias.
    commercialWorkflow: w.workflow,
    workflow: w.workflow,
    sequence: w.sequence,
    supplierIsSelectionAuthority: w.supplierIsSelectionAuthority,
    requiresSupplierRfqBeforeCosting: w.requiresSupplierRfqBeforeCosting,
    commercialWorkflowNote: w.note,
  };
};

export const STANDARDS_REGIMES = Object.freeze(["ULF", "EN"]);

export const BrandStrategyInputSchema = z.object({
  systemCategory: z.literal("FIRE_ALARM"),
  // null means: no brand is contractually mandated. It must be asserted, never
  // defaulted, because "not yet checked" and "checked, none found" are
  // different states and only the second may drive a preference.
  mandatoryBrand: z.string().min(1).nullable(),
  mandatoryBrandEvidence: z.array(z.string().min(1)).default([]),
  standardsRegime: z.enum(STANDARDS_REGIMES),
  addressablePointCount: z.number().int().nonnegative(),
  pointCountBasis: z.string().min(1),
});

export const VALIDATION_CODES = Object.freeze({
  CATEGORY_NOT_FIRE_ALARM: "BRAND_STRATEGY_CATEGORY_NOT_FIRE_ALARM",
  MANDATORY_BRANCH_MISSING_EVIDENCE: "BRAND_STRATEGY_MANDATORY_BRANCH_MISSING_EVIDENCE",
  MANDATORY_BRANCH_UNRESOLVED_EVIDENCE: "BRAND_STRATEGY_MANDATORY_BRANCH_UNRESOLVED_EVIDENCE",
  REGIME_UNSUPPORTED: "BRAND_STRATEGY_REGIME_UNSUPPORTED",
  POINT_COUNT_NEGATIVE: "BRAND_STRATEGY_POINT_COUNT_NEGATIVE",
});

/** Fail-closed validation. Throws on any unsupported input. */
export const validateBrandStrategyInput = (input) => {
  if (input?.systemCategory !== "FIRE_ALARM") {
    const e = new Error(VALIDATION_CODES.CATEGORY_NOT_FIRE_ALARM);
    e.code = VALIDATION_CODES.CATEGORY_NOT_FIRE_ALARM;
    throw e;
  }
  if (!STANDARDS_REGIMES.includes(input.standardsRegime)) {
    const e = new Error(VALIDATION_CODES.REGIME_UNSUPPORTED);
    e.code = VALIDATION_CODES.REGIME_UNSUPPORTED;
    throw e;
  }
  if (!Number.isInteger(input.addressablePointCount) || input.addressablePointCount < 0) {
    const e = new Error(VALIDATION_CODES.POINT_COUNT_NEGATIVE);
    e.code = VALIDATION_CODES.POINT_COUNT_NEGATIVE;
    throw e;
  }
  // A mandatory brand must never be asserted without evidence attached.
  if (input.mandatoryBrand && (!Array.isArray(input.mandatoryBrandEvidence) || input.mandatoryBrandEvidence.length === 0)) {
    const e = new Error(VALIDATION_CODES.MANDATORY_BRANCH_MISSING_EVIDENCE);
    e.code = VALIDATION_CODES.MANDATORY_BRANCH_MISSING_EVIDENCE;
    throw e;
  }
  return {
    systemCategory: input.systemCategory,
    mandatoryBrand: input.mandatoryBrand ?? null,
    mandatoryBrandEvidence: input.mandatoryBrandEvidence ?? [],
    standardsRegime: input.standardsRegime,
    addressablePointCount: input.addressablePointCount,
    pointCountBasis: input.pointCountBasis,
  };
};

/**
 * Resolve the preferred commercial brand.
 *
 * Returns a decision that records WHICH precedence step decided it, so a later
 * reader can tell a policy outcome from a mandate outcome.
 */
export const resolveFireAlarmBrandStrategy = (rawInput, policy = IN_HOUSE_FIRE_ALARM_POLICY) => {
  const input = validateBrandStrategyInput(rawInput);

  // --- Step 1: mandatory brand overrides everything, including in-house preference.
  if (input.mandatoryBrand) {
    // A mandated brand still has to be routed by its OWN commercial relationship. A
    // mandate for a non-in-house brand does not conjure an in-house commercial
    // position, so it routes EXTERNAL even though it is mandatory.
    const route = commercialWorkflowFor(input.mandatoryBrand, policy);
    return Object.freeze({
      version: BRAND_STRATEGY_VERSION,
      policyId: policy.policyId,
      preferredBrand: input.mandatoryBrand,
      decidedByStep: 1,
      decidedBy: "MANDATORY_CLIENT_CONSULTANT_BRAND",
      ...route,
      standardsRegime: input.standardsRegime,
      addressablePointCount: input.addressablePointCount,
      pointCountBasis: input.pointCountBasis,
      isInHouseBrand: null,
      rationale:
        `A brand is contractually mandated (${input.mandatoryBrand}). Company in-house preference is ` +
        `NOT applied, even where another brand is commercially preferred.`,
      evidence: input.mandatoryBrandEvidence,
      alternativeBrandStatus: null,
    });
  }

  // --- Steps 2, 3, 4: standards regime, then project scale, then in-house policy.
  let brand;
  let isLargeProject = null;
  if (input.standardsRegime === "EN") {
    brand = policy.byRegime.EN.inHouseBrand;
  } else {
    const largeThreshold = policy.regimeScaleThresholds.ULF_LARGE_PROJECT_MIN_POINTS_EXCLUSIVE;
    isLargeProject = input.addressablePointCount > largeThreshold;
    brand = isLargeProject
      ? policy.byRegime.ULF.largeProjectInHouseBrand
      : policy.byRegime.ULF.smallProjectInHouseBrand;
  }
  const isInHouse = true;
  // Routing is resolved from the governed company-brand registry, never inferred
  // from the fact that the brand happens to sit under a shared parent company.
  const route = commercialWorkflowFor(brand, policy);

  return Object.freeze({
    version: BRAND_STRATEGY_VERSION,
    policyId: policy.policyId,
    preferredBrand: brand,
    // Routing: what the commercial process actually is for this brand.
    ...route,
    // The company policy document defines a six-step precedence. A policy-driven
    // outcome is decided at step 4 (in-house preference), on inputs taken at
    // step 2 (standards regime) and step 3 (project scale). Steps 5 and 6 are
    // explicitly NOT inputs here.
    decidedByStep: 4,
    decidedBy:
      input.standardsRegime === "EN"
        ? "STANDARDS_REGIME_EN__IN_HOUSE_POLICY"
        : isLargeProject
          ? "STANDARDS_REGIME_ULF__LARGE_PROJECT_SCALE__IN_HOUSE_POLICY"
          : "STANDARDS_REGIME_ULF__SMALL_PROJECT_SCALE__IN_HOUSE_POLICY",
    precedenceTrail: Object.freeze([
      { step: 1, rule: "MANDATORY_CLIENT_CONSULTANT_BRAND", outcome: "NOT_APPLICABLE__NO_MANDATE_FOUND" },
      { step: 2, rule: "STANDARDS_REGIME", outcome: input.standardsRegime },
      { step: 3, rule: "PROJECT_SCALE_TOTAL_FIRE_ALARM_POINTS", outcome: isLargeProject === null ? "NOT_APPLICABLE__EN_REGIME" : (isLargeProject ? "LARGE__OVER_THRESHOLD" : "SMALL__AT_OR_UNDER_THRESHOLD") },
      { step: 4, rule: "COMPANY_IN_HOUSE_FIRE_ALARM_BRAND", outcome: brand },
      { step: 5, rule: "TECHNICAL_SUITABILITY", outcome: "NOT_AN_INPUT__EVALUATED_DOWNSTREAM__CAN_ONLY_DISQUALIFY" },
      { step: 6, rule: "COMMERCIAL_VENDOR_CONSIDERATIONS", outcome: "NOT_AN_INPUT__EVALUATED_DOWNSTREAM__CAN_ONLY_DISQUALIFY" },
    ]),
    standardsRegime: input.standardsRegime,
    addressablePointCount: input.addressablePointCount,
    pointCountBasis: input.pointCountBasis,
    isInHouseBrand: isInHouse,
    rationale:
      `No brand is contractually mandated. The governing equipment-listing regime is ${input.standardsRegime}. ` +
      `The governed Fire Alarm addressable point count is ${input.addressablePointCount} (${input.pointCountBasis}), ` +
      (isLargeProject === null
        ? `and EN projects select a single in-house brand. `
        : `which places the project in the ${isLargeProject ? "large" : "small"} project band against the ${policy.regimeScaleThresholds.ULF_LARGE_PROJECT_MIN_POINTS_EXCLUSIVE}-point threshold. `) +
      `Company in-house Fire Alarm policy therefore selects ${brand}. This is a COMMERCIAL preference, not a ` +
      `claim of technical superiority. Technical suitability and commercial access are NOT inputs to this ` +
      `decision; they are evaluated afterwards and can only disqualify a brand, never promote one.`,
    evidence: input.mandatoryBrandEvidence,
    alternativeBrandStatus: policy.nonInHouseBrandStatus,
  });
};

/**
 * Reclassify a brand that was previously the project basis.
 *
 * Superseding is never destructive: the prior basis is carried forward with the
 * reason it was chosen and the reason it no longer holds.
 */
export const reclassifySupersededBrand = (priorBasis, decision, supersession) => {
  if (!priorBasis) return null;
  return Object.freeze({
    priorBrand: priorBasis.brand,
    priorSelectedBecause: priorBasis.selectedBecause,
    priorSelectedOn: priorBasis.selectedOn,
    newStatus: decision.alternativeBrandStatus ?? "TECHNICALLY_VALID_ALTERNATIVE",
    supersededBecause: supersession.reason,
    supersededBy: decision.preferredBrand,
    authority: supersession.authority,
    supersededOn: supersession.on,
    technicalEvidenceRetained: true,
    note:
      "Technical compatibility evidence for the prior brand remains valid and is retained unchanged. " +
      "It is no longer the preferred commercial basis for this project, which is a commercial " +
      "brand-strategy outcome, not a technical failure.",
  });
};
