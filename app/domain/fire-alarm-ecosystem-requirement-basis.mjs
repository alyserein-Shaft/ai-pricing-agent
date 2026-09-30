// SLICE 2B -- GOVERNED PROJECT ECOSYSTEM AS A REQUIREMENT BASIS FOR THE
// RESTORED TECHNICAL REQUIREMENT ENGINE.
//
// WHY THIS EXISTS.
//
// `fire-alarm-ecosystem-decision.mjs` defines the canonical representation of a
// governed project ecosystem decision and `worker/fire-alarm-ecosystem-decision-
// api.mjs` persists and reads it. Neither has a consumer. Meanwhile the restored
// `technical-requirement-engine.mjs` requires a resolved `compatibilityTarget`
// for every Fire Alarm item, and 107 of 108 Fire Alarm BOQ items on a real
// project sat at `Missing Critical Information` purely because nothing was ever
// able to name a target.
//
// This module is the missing, and deliberately the smallest possible, seam. It
// is PURE. It performs no database access. Its whole job is to turn a persisted
// governed decision into the exact input the restored engine already accepts,
// and to classify a candidate against that basis WITHOUT ever granting a match.
//
// ---------------------------------------------------------------------------
// DESIGN RULE: INTEGRATE, DO NOT FORK
//
// The engine is the authority for `compatibilityTarget`, for project
// precedence, for source-fact authority and for R11 fail-closed panel
// compatibility. This module is not allowed to second-guess any of it, and it
// adds no second compatibilityTarget rule. It contributes exactly one thing the
// engine cannot produce by itself: a NAMED, GOVERNED, PROJECT-SCOPED target
// that a human engineering decision actually recorded.
//
// Specifically, this module does NOT and must NOT:
//   * re-implement or relax the engine's `detectMissingInformation` predicate;
//   * accept generic Source Fact compatibility evidence, protocol strings,
//     manufacturer names, product-family similarity or unreviewed internet
//     evidence as a substitute for the governed target;
//   * infer, recommend, rank or select any product;
//   * rewrite, restate or retroactively reinterpret any project document.
//
// The engine decides when a target is satisfied. This module only supplies a
// real one when a human has genuinely recorded one, and otherwise stays silent
// so the engine keeps failing closed exactly as it does today.
// ---------------------------------------------------------------------------

import { projectEcosystemCompatibilityEntry } from "./fire-alarm-ecosystem-decision.mjs";
import { fireAlarmRequiresPanelCompatibility } from "./fire-alarm-taxonomy.mjs";

export const FIRE_ALARM_ECOSYSTEM_BASIS_VERSION = "fire-alarm-ecosystem-requirement-basis-1.0.0";

// ---------------------------------------------------------------------------
// EVIDENCE CLASSES THAT MAY NEVER SATISFY A GOVERNED COMPATIBILITY TARGET
//
// Recorded as a first-class, machine-checkable list rather than prose, so that
// a later slice cannot quietly add one of them as an accepted substitute. The
// engine's own `sourceFactCompatibility` path is the live example: it produces
// protocol-compatibility EVIDENCE with `blocking: false, status: "Evidence"`,
// which is correct and must stay non-blocking.
// ---------------------------------------------------------------------------
export const NON_SUBSTITUTABLE_EVIDENCE_CLASSES = Object.freeze([
  "GENERIC_SOURCE_FACT_COMPATIBILITY",
  "PROTOCOL_STRING_ONLY",
  "MANUFACTURER_NAME_ONLY",
  "PRODUCT_FAMILY_SIMILARITY",
  "UNREVIEWED_INTERNET_EVIDENCE",
  "INFERENCE",
  "SHARED_PARENT_MANUFACTURER",
]);

// ---------------------------------------------------------------------------
// INTERFACE METHOD VOCABULARY
//
// Invariant 2 and invariant 3 are different rules and must not be collapsed.
// Addressable devices are locked to the selected ecosystem. Third-party devices
// that interface through a supervised, non-addressable method stay eligible.
// ---------------------------------------------------------------------------
export const ECOSYSTEM_INTERFACE_METHODS = Object.freeze({
  DIRECT_ADDRESSABLE: "DIRECT_ADDRESSABLE",
  ADDRESSABLE_INTERFACE_MODULE: "ADDRESSABLE_INTERFACE_MODULE",
  DRY_CONTACT: "DRY_CONTACT",
  MONITORED_INPUT: "MONITORED_INPUT",
  MONITORED_OUTPUT: "MONITORED_OUTPUT",
});

// Interface methods that do NOT place a device on the addressable loop and so
// are NOT ecosystem-locked. Governed, exhaustive, fail-closed: an unknown or
// absent method is never treated as one of these.
export const NON_ADDRESSABLE_INTERFACE_METHODS = Object.freeze([
  ECOSYSTEM_INTERFACE_METHODS.DRY_CONTACT,
  ECOSYSTEM_INTERFACE_METHODS.MONITORED_INPUT,
  ECOSYSTEM_INTERFACE_METHODS.MONITORED_OUTPUT,
]);

// The governed supervision requirement for each non-addressable method. A
// third-party device on one of these is eligible ONLY when its supervision /
// integration requirement is actually proven.
export const THIRD_PARTY_SUPERVISION_REQUIREMENT = Object.freeze({
  [ECOSYSTEM_INTERFACE_METHODS.DRY_CONTACT]: "Supervised dry contact at a governed Initiating Device Circuit, with alarm/trouble/supervisory states individually proven.",
  [ECOSYSTEM_INTERFACE_METHODS.MONITORED_INPUT]: "Supervised monitored input at a governed Initiating Device Circuit or addressable input module, with end-of-line and open-circuit supervision proven.",
  [ECOSYSTEM_INTERFACE_METHODS.MONITORED_OUTPUT]: "Supervised monitored output or relay at a governed Notification Appliance Circuit / control output, with feedback and isolation proven.",
});

// ---------------------------------------------------------------------------
// ELIGIBILITY VERDICTS
//
// Every verdict is a TECHNICAL ELIGIBILITY state. None of them is a match, a
// selection, a Consultant approval, or a contractual acceptance. They mirror
// `PANEL_FAMILY_ELIGIBILITY` in the decision module and never widen it.
// ---------------------------------------------------------------------------
export const ECOSYSTEM_ELIGIBILITY = Object.freeze({
  // No governed decision exists. The engine keeps failing closed; this module
  // contributes nothing at all.
  NO_GOVERNED_DECISION: "NO_GOVERNED_DECISION",
  // Category is not addressable-loop locked and needs no ecosystem match.
  NOT_ECO_SYSTEM_LOCKED: "NOT_ECOSYSTEM_LOCKED",
  // Addressable device inside the decided ecosystem: eligible WITHIN the basis.
  ADDRESSABLE_WITHIN_ECO_SYSTEM: "ADDRESSABLE_WITHIN_ECOSYSTEM",
  // Addressable device from another ecosystem: BLOCKED unless governed
  // evidence proves an approved compatible integration method.
  ADDRESSABLE_OUTSIDE_ECO_SYSTEM_BLOCKED: "ADDRESSABLE_OUTSIDE_ECOSYSTEM_BLOCKED",
  // Third-party device on a proven supervised interface: remains eligible.
  THIRD_PARTY_INTERFACE_ELIGIBLE: "THIRD_PARTY_INTERFACE_ELIGIBLE",
  // Third-party interface claimed but supervision/integration not proven.
  THIRD_PARTY_INTERFACE_UNPROVEN_BLOCKED: "THIRD_PARTY_INTERFACE_UNPROVEN_BLOCKED",
  // Candidate identity is not established well enough to classify at all.
  CANDIDATE_IDENTITY_UNRESOLVED: "CANDIDATE_IDENTITY_UNRESOLVED",
});

// Verdicts that block. Everything else is a conditional technical eligibility.
export const BLOCKING_ECOSYSTEM_ELIGIBILITY = Object.freeze([
  ECOSYSTEM_ELIGIBILITY.NO_GOVERNED_DECISION,
  ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_OUTSIDE_ECO_SYSTEM_BLOCKED,
  ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_UNPROVEN_BLOCKED,
  ECOSYSTEM_ELIGIBILITY.CANDIDATE_IDENTITY_UNRESOLVED,
]);

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const isTruthy = (value) => value === true || value === "true" || value === 1 || value === "1";

// ---------------------------------------------------------------------------
// REQUIREMENT BASIS
//
// Turns a persisted governed decision into the single relationship object the
// restored engine already consumes. It REUSES the parked decision module's own
// `projectEcosystemCompatibilityEntry` rather than restating it, and adds only
// what the engine needs to treat it honestly: explicit scope, explicit
// provenance, and an explicit statement of what it is NOT.
//
// Returns `null` when there is no governed decision. Returning `null` is the
// entire fail-closed mechanism: no basis, no named target, engine blocks exactly
// as it does before Slice 2B.
// ---------------------------------------------------------------------------
export const buildEcosystemRequirementBasis = (current) => {
  if (!current || !current.decision) return null;
  const decision = current.decision;
  const entry = projectEcosystemCompatibilityEntry(current);
  if (!entry) return null;

  const projectId = current.projectId || null;

  return {
    basisVersion: FIRE_ALARM_ECOSYSTEM_BASIS_VERSION,
    decisionId: current.id,
    projectId,
    ecosystem: decision.ecosystem,
    ecosystemState: decision.ecosystemState,
    compatibilityTarget: decision.compatibilityTarget,
    primaryProtocol: decision.primaryProtocol || null,
    selectedProtocolMode: decision.selectedProtocolMode || null,
    allowedLegacyProtocols: decision.allowedLegacyProtocols || [],
    decidedBy: decision.decidedBy,
    decidedRole: decision.decidedRole,
    decidedAt: current.decidedAt || null,
    specificationVersion: decision.specificationVersion || null,

    // Exactly the object to append to the engine's `relationships` input.
    // Explicitly project-scoped so the engine's own relationship scope filter
    // admits it deliberately rather than by falling through an absent scope.
    compatibilityRelationship: {
      ...entry,
      scopeType: "Project",
      scope_id: projectId,
      scopeId: projectId,
      project_id: projectId,
      // Provenance, carried on the relationship itself so no downstream reader
      // can mistake this for a product-verified capability.
      basis: "HUMAN_ENGINEERING_DECISION",
      authority: "PROJECT_ECOSYSTEM_DECISION",
      scope: "PROJECT_REQUIREMENT",
      ecosystem: decision.ecosystem,
      decisionId: current.id,
      productCompatibilityClaimed: false,
      productCompatibilityState: "NOT_EVALUATED_NO_PRODUCT_EVIDENCE",
    },

    // What satisfied the target, stated positively, and -- just as important --
    // what did NOT.
    compatibilityTargetSatisfiedBy: "GOVERNED_PROJECT_DECISION_NAMED_TARGET",
    nonSubstitutableEvidenceClasses: [...NON_SUBSTITUTABLE_EVIDENCE_CLASSES],

    // The single most important boundary in this file.
    productCompatibilityClaimed: false,
    productCompatibilityState: "NOT_EVALUATED_NO_PRODUCT_EVIDENCE",

    // Compliance and contract authority are NOT established by this basis.
    complianceBasisState: decision.complianceBasisState || null,
    contractualManufacturerAcceptance: decision.contractualManufacturerAcceptance || null,
    substitutionAuthority: decision.substitutionAuthority || null,
  };
};

// Convenience: the engine input. Returns [] when no decision governs, so a
// caller can spread it unconditionally without special-casing null.
export const ecosystemBasisRelationships = (current) => {
  const basis = buildEcosystemRequirementBasis(current);
  return basis ? [basis.compatibilityRelationship] : [];
};

// ---------------------------------------------------------------------------
// CANDIDATE CLASSIFICATION
//
// Answers one question: is this candidate inside, outside, or exempt from the
// governed ecosystem basis? It never answers "does this product match".
//
// `candidate` is a plain descriptor. Nothing here reads the database and nothing
// here invents a product identity; an unresolvable candidate is BLOCKED, never
// guessed.
// ---------------------------------------------------------------------------
export const classifyEcosystemCompatibility = (current, candidate = {}) => {
  const basis = buildEcosystemRequirementBasis(current);

  const finish = (eligibility, detail = {}) => ({
    basisVersion: FIRE_ALARM_ECOSYSTEM_BASIS_VERSION,
    eligibility,
    blocking: BLOCKING_ECOSYSTEM_ELIGIBILITY.includes(eligibility),
    decisionId: basis?.decisionId || null,
    projectId: basis?.projectId || null,
    ecosystem: basis?.ecosystem || null,
    compatibilityTarget: basis?.compatibilityTarget || null,
    // Invariant 4, restated on every single verdict.
    productCompatibilityClaimed: false,
    compatibilityTargetSatisfiedByThis: false,
    ...detail,
  });

  if (!basis) {
    return finish(ECOSYSTEM_ELIGIBILITY.NO_GOVERNED_DECISION, {
      reason: "No governed project Fire Alarm ecosystem decision exists. Compatibility is unresolved and the requirement engine must remain fail-closed.",
    });
  }

  const interfaceMethod = text(candidate.interfaceMethod) || null;
  const manufacturer = text(candidate.manufacturer) || null;
  const category = text(candidate.category) || null;
  const family = text(candidate.productFamily) || null;
  const system = text(candidate.system) || "Fire Alarm";

  if (system !== "Fire Alarm") {
    return finish(ECOSYSTEM_ELIGIBILITY.NO_GOVERNED_DECISION, {
      reason: `A Fire Alarm ecosystem decision has no meaning on system "${system}".`,
    });
  }

  // Reuse the EXISTING governed classification. Whether a category is
  // addressable-loop locked is already decided by the taxonomy; this module
  // must not restate or widen it.
  let panelCompatibilityRequired;
  try {
    panelCompatibilityRequired = fireAlarmRequiresPanelCompatibility(category, family);
  } catch {
    panelCompatibilityRequired = true; // fail closed on an unusable classification
  }

  const nonAddressable = interfaceMethod !== null && NON_ADDRESSABLE_INTERFACE_METHODS.includes(interfaceMethod);

  // -- Invariant 3: third-party through a proven supervised interface -------
  if (nonAddressable) {
    if (!isTruthy(candidate.supervisionProven)) {
      return finish(ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_UNPROVEN_BLOCKED, {
        interfaceMethod,
        supervisionRequirement: THIRD_PARTY_SUPERVISION_REQUIREMENT[interfaceMethod] || null,
        reason: `A third-party device interfacing through ${interfaceMethod} remains eligible ONLY where its supervision and integration requirements are proven. They are not proven here, so this is blocked rather than assumed.`,
      });
    }
    return finish(ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_ELIGIBLE, {
      interfaceMethod,
      supervisionRequirement: THIRD_PARTY_SUPERVISION_REQUIREMENT[interfaceMethod] || null,
      conditionalOn: "Proven supervision and integration at the governed interface.",
      reason: `A third-party device on a proven, supervised ${interfaceMethod} interface is not ecosystem-locked and remains eligible. This is a technical eligibility state, not a match.`,
    });
  }

  // -- Not addressable-loop locked -----------------------------------------
  if (!panelCompatibilityRequired) {
    return finish(ECOSYSTEM_ELIGIBILITY.NOT_ECO_SYSTEM_LOCKED, {
      interfaceMethod,
      reason: "This governed category is not addressable-loop locked, so the ecosystem basis does not constrain it.",
    });
  }

  // -- Invariant 2: addressable, ecosystem-locked --------------------------
  if (!manufacturer || !interfaceMethod) {
    return finish(ECOSYSTEM_ELIGIBILITY.CANDIDATE_IDENTITY_UNRESOLVED, {
      interfaceMethod,
      reason: "An addressable, panel-locked candidate must state both its manufacturer ecosystem and its interface method before compatibility can be classified. It is not guessed.",
    });
  }

  const candidateEcosystem = text(candidate.ecosystem) || manufacturer;
  if (candidateEcosystem === basis.ecosystem) {
    return finish(ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_WITHIN_ECO_SYSTEM, {
      interfaceMethod,
      candidateEcosystem,
      conditionalOn: "Real product-level compatibility evidence, which does not exist from an ecosystem decision alone.",
      reason: `An addressable device in the decided ${basis.ecosystem} ecosystem is eligible WITHIN the governed technical design basis. This grants no product match and no selection.`,
    });
  }

  const approvedIntegration = isTruthy(candidate.governedCompatibleIntegrationEvidence);
  if (approvedIntegration) {
    return finish(ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_ELIGIBLE, {
      interfaceMethod,
      candidateEcosystem,
      conditionalOn: "The recorded governed compatible-integration evidence, which must itself be reviewed before use.",
      reason: "Governed evidence records an approved compatible integration method, so this is eligible on that evidence rather than on ecosystem similarity.",
    });
  }

  return finish(ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_OUTSIDE_ECO_SYSTEM_BLOCKED, {
    interfaceMethod,
    candidateEcosystem,
    reason: `An addressable device from ${candidateEcosystem} is outside the governed ${basis.ecosystem} basis. Shared parent manufacturer, protocol name or family similarity never satisfies this; only proven approved compatible-integration evidence does.`,
  });
};
