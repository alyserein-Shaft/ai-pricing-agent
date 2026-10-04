// STAGE 4A -- ENGINEERING EVIDENCE AUTHORITY POLICY.
//
// Pure domain foundation for the question every technical comparison must be
// able to answer: "why is this evidence authoritative enough to support,
// fail, or block this engineering dimension?"
//
// HARD DESIGN INVARIANT: there is NO global numeric authority rank. A
// universal hierarchy such as
//
//     PROJECT > REGULATORY > ENGINEERING
//
// is FORBIDDEN here. Authority is DOMAIN-SPECIFIC: an authority CLASS
// describes what KIND of claim a source is authoritative for, and the
// per-dimension matrix (AUTHORITY_DOMAIN_POLICY) -- declared as DATA, not as
// nested system-specific conditionals -- is the only place that relationship
// is expressed. The kept default document-source precedence policy
// (drawing-authority-policy.mjs's AUTHORITY_TIERS / statusAwareSourceAuthority)
// remains as the WITHIN-PROJECT_CONTRACT-class document precedence; it never
// becomes a cross-domain winner.
//
// This module is score-inert, ranking-inert, approval-path-inert,
// migration-free, and backward compatible by construction: it only produces
// authoritative/conflict metadata. Unknown values fail closed.
//
// Pure domain logic: no DOM, no fetch, no DB, no Math.random.

// The canonical evidence authority classes. No ordering is implied by this
// array (it is NOT a rank); classes are identified by exact string equality.
export const AUTHORITY_CLASSES = Object.freeze([
  "PROJECT_CONTRACT",
  "REGULATORY",
  "ENGINEERING_DESIGN",
  "PRODUCT_TECHNICAL",
  "CERTIFICATION_LISTING",
  "COMMERCIAL",
  "HISTORICAL_ORGANIZATIONAL",
  "AI_INFERENCE",
]);

// Explicit statement of the anti-invariant: there is no global numeric rank.
// A universal PROJECT > REGULATORY > ENGINEERING winner does not exist.
export const GLOBAL_NUMERIC_AUTHORITY_RANK = null;

// The roles a source plays relative to a claim. A source may DEFINE what is
// required/true, VERIFY a claim it is the right kind of source for,
// ARBITRATE a conflict within its own domain, or REFUTE a claim that its own
// scope contradicts. An empty role set for a (dimension, class) pair means
// that source class has NO authority over that dimension.
export const CLAIM_ROLES = Object.freeze([
  "DEFINING",
  "VERIFYING",
  "ARBITRATING",
  "REFUTING",
]);

// Human-readable labels for the claim roles, used by the engineer-facing
// projection (4A-7). Never exposed as jargony internals by default.
export const CLAIM_ROLE_LABELS = Object.freeze({
  DEFINING: "Defines what is required",
  VERIFYING: "Verifies the claim",
  ARBITRATING: "Arbitrates within its own domain",
  REFUTING: "Can refute the claim",
});

// Evidence kinds (4A-4). EXPLICIT = source-backed governed fact.
// DERIVED = deterministic result over governed inputs/rule/calculation.
// INFERRED = AI/model suggestion. An INFERRED claim can never become EXPLICIT
// purely because model confidence is high.
export const EVIDENCE_KINDS = Object.freeze([
  "EXPLICIT",
  "DERIVED",
  "INFERRED",
]);

// The only authorized evidence-kind trust rule. Both EXPLICIT and DERIVED are
// GOVERNED evidence; INFERRED is never authoritative. Within a governing pair
// (EXPLICIT vs DERIVED) no universal winner exists -- a conflict between them
// is resolved by the cross-domain/dimension conflict policy, never by a
// blanket kind hierarchy.
export const EVIDENCE_KIND_TRUST = Object.freeze({
  EXPLICIT: "governed source-backed fact",
  DERIVED: "governed deterministic result with complete trace",
  INFERRED: "never authoritative; suggestion only",
});

// Comparison/conflict states a single claim or a pair of claims may land in.
// These are semantic states, never scores.
export const CONFLICT_STATES = Object.freeze([
  "AGREES",
  "CONFLICTS",
  "SUPERSEDED",
  "NOT_APPLICABLE",
  "INSUFFICIENT_AUTHORITY",
  "MISSING_EVIDENCE",
  "AMBIGUOUS",
  "UNKNOWN",
]);

// Blocking cross-domain conflict vocabulary (see the Stage 4A authority
// closure). All of these are BLOCKING and route to engineer/AHJ/consultant
// clarification. Conflicts are never averaged.
export const CROSS_DOMAIN_CONFLICT_STATES = Object.freeze([
  "BOTH_CONSTRAINTS_APPLY",
  "REGULATORY_CONFLICT",
  "AUTHORITY_CONFLICT",
  "TECHNICAL_CONFLICT",
  "CERTIFICATION_CONFLICT",
  "UNKNOWN_PRECEDENCE",
]);

// Fail-safe precedence state: used when two claims cannot be ranked because
// governed storage for authoritative custom precedence is unavailable (or no
// governing document exists). Contradictions are never force-resolved.
export const UNKNOWN_PRECEDENCE = "UNKNOWN_PRECEDENCE";

// Applicability scopes. Specificity ordering below is APPLICABILITY
// SPECIFICITY -- how precisely a claim pins down what it applies to -- and is
// explicitly NOT authority strength.
export const APPLICABILITY_SCOPES = Object.freeze([
  "PROJECT",
  "SYSTEM",
  "SUBSYSTEM",
  "EQUIPMENT_FAMILY",
  "EXACT_BOQ_ITEM",
  "ZONE_AREA",
  "DRAWING",
  "EXACT_MODEL",
]);

// Applicability specificity: a more specific scope describes a narrower set
// of governed objects. Higher = more specific. This is NEVER called authority
// strength; see the module header comment.
export const APPLICABILITY_SPECIFICITY = Object.freeze({
  PROJECT: 1,
  SYSTEM: 2,
  SUBSYSTEM: 3,
  EQUIPMENT_FAMILY: 4,
  EXACT_BOQ_ITEM: 5,
  ZONE_AREA: 6,
  DRAWING: 7,
  EXACT_MODEL: 8,
});

// The current governed matching dimensions (4A-2). These are the dimensions
// the matrix and the comparison envelope reason about. Unknown dimension/source
// pairs fail closed to INSUFFICIENT_AUTHORITY.
export const MATCHING_DIMENSIONS = Object.freeze([
  "protocol",
  "addressing",
  "facp_compatibility",
  "detector_base_compatibility",
  "device_category_function",
  "indoor_outdoor",
  "ip_rating",
  "voltage",
  "capacity",
  "manufacturer",
  "standards",
  "certification_listing",
  "mounting",
  "lifecycle",
]);

// ---------------------------------------------------------------------------
// Source-type -> authority-class mapping (DATA). Maps the source types this
// codebase actually produces (see drawing-authority-policy.mjs's
// SOURCE_TYPE_PRODUCTION_STATUS and technical-requirement-engine.mjs's
// SOURCE_PRECEDENCE) plus the regulatory/certification/commercial/design
// source names the governed pipeline may carry. An unrecognized source type
// maps to null and FAILS CLOSED (INSUFFICIENT_AUTHORITY), never to a guess.
// ---------------------------------------------------------------------------
export const SOURCE_TYPE_AUTHORITY_CLASS = Object.freeze({
  // Project / contract documents: define what the PROJECT requires.
  "Formal Client Clarification": "PROJECT_CONTRACT",
  "Approved Clarification": "PROJECT_CONTRACT",
  "Approved RFI Response": "PROJECT_CONTRACT",
  "Technical Bulletin": "PROJECT_CONTRACT",
  Addendum: "PROJECT_CONTRACT",
  Specification: "PROJECT_CONTRACT",
  Drawing: "PROJECT_CONTRACT",
  BOQ: "PROJECT_CONTRACT",
  "Approved Vendor List": "PROJECT_CONTRACT",
  // Codes / standards / AHJ: define applicable regulatory/AHJ constraints.
  Code: "REGULATORY",
  Standard: "REGULATORY",
  "AHJ Requirement": "REGULATORY",
  "Civil Defense": "REGULATORY",
  Regulatory: "REGULATORY",
  // Governed design decisions / calculations.
  "Engineering Design": "ENGINEERING_DESIGN",
  "Design Calculation": "ENGINEERING_DESIGN",
  Calculation: "ENGINEERING_DESIGN",
  "Approved Design": "ENGINEERING_DESIGN",
  // Product technical evidence: verifies actual product properties.
  Manufacturer: "PRODUCT_TECHNICAL",
  Datasheet: "PRODUCT_TECHNICAL",
  "Product Data": "PRODUCT_TECHNICAL",
  "Product Library": "PRODUCT_TECHNICAL",
  // Certification / listing evidence: verifies exact listing scope.
  Certification: "CERTIFICATION_LISTING",
  Listing: "CERTIFICATION_LISTING",
  Certificate: "CERTIFICATION_LISTING",
  // Commercial evidence: verifies commercial facts only.
  Supplier: "COMMERCIAL",
  Quote: "COMMERCIAL",
  "Price List": "COMMERCIAL",
  Commercial: "COMMERCIAL",
  // Precedent / organization rules: advisory unless explicitly governed.
  "Previous Project": "HISTORICAL_ORGANIZATIONAL",
  "Organization Rule": "HISTORICAL_ORGANIZATIONAL",
  Historical: "HISTORICAL_ORGANIZATIONAL",
  // AI / model output: suggestion only.
  "AI Inference": "AI_INFERENCE",
  Inference: "AI_INFERENCE",
});

// ---------------------------------------------------------------------------
// Validators -- fail closed on unknown values.
// ---------------------------------------------------------------------------
export const isAuthorityClass = (value) => AUTHORITY_CLASSES.includes(value);
export const isClaimRole = (value) => CLAIM_ROLES.includes(value);
export const isEvidenceKind = (value) => EVIDENCE_KINDS.includes(value);
export const isConflictState = (value) =>
  CONFLICT_STATES.includes(value) || CROSS_DOMAIN_CONFLICT_STATES.includes(value);
export const isApplicabilityScope = (value) => APPLICABILITY_SCOPES.includes(value);
export const isMatchingDimension = (value) => MATCHING_DIMENSIONS.includes(value);

// Resolve the authority class for a source-type string produced by the
// requirement/drawing pipeline, or null (fail closed) when unknown.
export const resolveAuthorityClassForSource = (sourceType) =>
  SOURCE_TYPE_AUTHORITY_CLASS[String(sourceType || "")] ?? null;

// ---------------------------------------------------------------------------
// AUTHORITY_DOMAIN_POLICY -- the declarative claim-specific authority matrix
// (4A-2). DATA, not nested conditionals. For each matching dimension, each
// authority class declares the roles it may play. An empty role set for a
// (dimension, class) pair means that class has NO authority over that
// dimension (COMMERCIAL/HISTORICAL/AI are excluded from every technical
// dimension for exactly this reason).
// ---------------------------------------------------------------------------
const basis = (text) => text;
const DEFINING_LIST = (list) => list;
export const AUTHORITY_DOMAIN_POLICY = Object.freeze({
  protocol: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING", "REFUTING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
    CERTIFICATION_LISTING: DEFINING_LIST(["VERIFYING"]),
  },
  addressing: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING", "REFUTING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
    CERTIFICATION_LISTING: DEFINING_LIST(["VERIFYING"]),
  },
  facp_compatibility: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING", "REFUTING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
    CERTIFICATION_LISTING: DEFINING_LIST(["VERIFYING"]),
  },
  detector_base_compatibility: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  device_category_function: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  indoor_outdoor: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  ip_rating: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  voltage: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  capacity: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  manufacturer: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    HISTORICAL_ORGANIZATIONAL: DEFINING_LIST(["ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING"]),
    COMMERCIAL: DEFINING_LIST(["VERIFYING"]),
  },
  standards: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    CERTIFICATION_LISTING: DEFINING_LIST(["VERIFYING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING"]),
  },
  certification_listing: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    CERTIFICATION_LISTING: DEFINING_LIST(["VERIFYING", "ARBITRATING", "REFUTING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING"]),
  },
  mounting: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    REGULATORY: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["DEFINING", "ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING", "REFUTING"]),
  },
  lifecycle: {
    PROJECT_CONTRACT: DEFINING_LIST(["DEFINING"]),
    ENGINEERING_DESIGN: DEFINING_LIST(["ARBITRATING"]),
    PRODUCT_TECHNICAL: DEFINING_LIST(["VERIFYING"]),
    COMMERCIAL: DEFINING_LIST(["VERIFYING"]),
  },
});

// What each authority class is authoritative FOR, globally (class-level
// definition from the Stage 4A brief). Used as human-readable basis text.
export const AUTHORITY_CLASS_BASIS = Object.freeze({
  PROJECT_CONTRACT: basis("Defines what the project requires."),
  REGULATORY: basis("Defines applicable regulatory/AHJ constraints."),
  ENGINEERING_DESIGN: basis("Defines governed design decisions/calculation outputs."),
  PRODUCT_TECHNICAL: basis("Verifies actual product properties."),
  CERTIFICATION_LISTING: basis("Verifies exact listing/certification scope."),
  COMMERCIAL: basis("Verifies commercial facts only -- never compliance."),
  HISTORICAL_ORGANIZATIONAL: basis("Precedent/advisory only unless explicitly governed as an organization requirement."),
  AI_INFERENCE: basis("Suggestion only -- never authoritative fact."),
});

// ---------------------------------------------------------------------------
// authorityDomainPolicy(dimension, authorityClass)
//
// Pure lookup into AUTHORITY_DOMAIN_POLICY. Unknown dimension or unknown
// authority class FAILS CLOSED to { authoritative: false } with an
// INSUFFICIENT_AUTHORITY reason -- an unmodeled pairing is never guessed.
// ---------------------------------------------------------------------------
export const authorityDomainPolicy = (dimension, authorityClass) => {
  if (!isMatchingDimension(dimension) || !isAuthorityClass(authorityClass)) {
    return { authoritative: false, roles: [], status: "INSUFFICIENT_AUTHORITY", reason: "Unrecognized dimension or authority class; failing closed." };
  }
  const roles = (AUTHORITY_DOMAIN_POLICY[dimension] || {})[authorityClass] || [];
  return {
    authoritative: roles.length > 0,
    roles,
    basis: AUTHORITY_CLASS_BASIS[authorityClass] || null,
    status: roles.length ? "AUTHORITATIVE" : "NOT_AUTHORITATIVE",
    reason: roles.length ? null : `An ${authorityClass} source has no authority over the ${dimension} dimension.`,
  };
};

// A claim carries an explicit requested role; return whether that class may
// play that role for that dimension. An explicit role settles the pair even
// when the class otherwise has no authority -- a REFUTING commercial claim,
// for example, is still not authoritative.
export const authorityRoleForClaim = ({ dimension, authorityClass, claimRole }) => {
  const policy = authorityDomainPolicy(dimension, authorityClass);
  if (!policy.authoritative) return policy;
  if (!isClaimRole(claimRole)) return { ...policy, status: "INSUFFICIENT_AUTHORITY", reason: "Unrecognized claim role; failing closed." };
  if (!policy.roles.includes(claimRole)) return { ...policy, status: "INSUFFICIENT_AUTHORITY", reason: `An ${authorityClass} source may not ${claimRole} a ${dimension} claim.` };
  return { ...policy, status: "AUTHORITATIVE", claimRole };
};

// ---------------------------------------------------------------------------
// Cross-domain conflict policies (4A-3). Semantic policies ONLY -- never a
// numeric winner. resolveCrossDomainConflict returns a semantic state and what
// must happen (blocking engineer review vs. satisfying one side vs. applying
// both constraints).
// ---------------------------------------------------------------------------
export const WITHIN_DOMAIN_POLICY = Object.freeze({
  PROJECT_CONTRACT: "Existing project/document precedence (with revision/issue state) governs; supersession respected.",
  REGULATORY: "Jurisdiction + applicability + edition/version + AHJ decision governs.",
  ENGINEERING_DESIGN: "Approved design authority + current revision governs.",
  PRODUCT_TECHNICAL: "Exact model + current manufacturer revision + supersession governs.",
  CERTIFICATION_LISTING: "Exact model/scope/standard edition/validity governs.",
  COMMERCIAL: "Approved/current commercial fact governs within its own scope.",
  HISTORICAL_ORGANIZATIONAL: "Governed organization rule only; otherwise advisory.",
  AI_INFERENCE: "Never governs.",
});

// Ordered cross-domain policy table. The pair is normalized so the table only
// needs one entry per unordered pair; the label is directionally neutral.
export const CROSS_DOMAIN_POLICY = Object.freeze({
  "PROJECT_CONTRACT:REGULATORY": {
    label: "BOTH_CONSTRAINTS_APPLY",
    relation: "Neither globally outranks the other; both constraints apply together.",
    conflictLabel: "REGULATORY_CONFLICT",
    blocking: true,
  },
  "PROJECT_CONTRACT:ENGINEERING_DESIGN": {
    label: "ENGINEERING_MUST_SATISFY_PROJECT",
    relation: "Engineering must satisfy the project unless a governed deviation exists.",
    conflictLabel: "AUTHORITY_CONFLICT",
    blocking: true,
  },
  "REGULATORY:ENGINEERING_DESIGN": {
    label: "ENGINEERING_MUST_SATISFY_REGULATION",
    relation: "Engineering must satisfy the regulation.",
    conflictLabel: "REGULATORY_CONFLICT",
    blocking: true,
  },
  "PROJECT_CONTRACT:PRODUCT_TECHNICAL": {
    label: "REQUIREMENT_DEFINES_PRODUCT_VERIFIES",
    relation: "The requirement defines; the product verifies. A mismatch is a technical conflict.",
    conflictLabel: "TECHNICAL_CONFLICT",
    blocking: true,
  },
  "ENGINEERING_DESIGN:PRODUCT_TECHNICAL": {
    label: "CALCULATION_DEFINES_PRODUCT_VERIFIES",
    relation: "The governed calculation defines required capacity; the product verifies it can provide it. A calculated shortfall is a technical conflict.",
    conflictLabel: "TECHNICAL_CONFLICT",
    blocking: true,
  },
  "REGULATORY:PRODUCT_TECHNICAL": {
    label: "REQUIREMENT_DEFINES_PRODUCT_VERIFIES",
    relation: "The requirement defines; the product verifies. A mismatch is a technical conflict.",
    conflictLabel: "TECHNICAL_CONFLICT",
    blocking: true,
  },
  "PRODUCT_TECHNICAL:CERTIFICATION_LISTING": {
    label: "EXACT_SCOPE_EACH",
    relation: "Each is authoritative only for its own scope -- no universal winner. A certification proves only its own exact listing scope, never general suitability.",
    conflictLabel: "CERTIFICATION_CONFLICT",
    blocking: true,
  },
  "REGULATORY:CERTIFICATION_LISTING": {
    label: "REGULATION_REQUIRES_LISTING_VERIFIES",
    relation: "The regulation requires the listing; the certification verifies its exact scope. A certification proves only its own exact listing scope, never general suitability.",
    conflictLabel: "CERTIFICATION_CONFLICT",
    blocking: true,
  },
  "PROJECT_CONTRACT:CERTIFICATION_LISTING": {
    label: "PROJECT_REQUIRES_LISTING_VERIFIES",
    relation: "The project requires the listing; the certification verifies its exact scope. A certification proves only its own exact listing scope, never general suitability.",
    conflictLabel: "CERTIFICATION_CONFLICT",
    blocking: true,
  },
  "PRODUCT_TECHNICAL:COMMERCIAL": {
    label: "COMMERCIAL_NEVER_OVERRIDES",
    relation: "Commercial evidence verifies commercial facts only and can never override technical authority.",
    conflictLabel: "UNKNOWN_PRECEDENCE",
    blocking: true,
  },
  "PRODUCT_TECHNICAL:HISTORICAL_ORGANIZATIONAL": {
    label: "HISTORICAL_NEVER_OVERRIDES",
    relation: "Precedent/advisory never overrides technical authority unless explicitly governed.",
    conflictLabel: "UNKNOWN_PRECEDENCE",
    blocking: true,
  },
  "PRODUCT_TECHNICAL:AI_INFERENCE": {
    label: "AI_NEVER_OVERRIDES",
    relation: "AI inference is a suggestion and can never override explicit/derived technical evidence.",
    conflictLabel: "UNKNOWN_PRECEDENCE",
    blocking: true,
  },
});

const pairKey = (leftClass, rightClass) => {
  // Normalize to a canonical ordered pair so the table stays small and
  // direction-independent.
  const classes = [leftClass, rightClass];
  if (!isAuthorityClass(leftClass) || !isAuthorityClass(rightClass)) return null;
  const rank = AUTHORITY_CLASSES.indexOf(leftClass);
  const other = AUTHORITY_CLASSES.indexOf(rightClass);
  return rank <= other ? `${classes[0]}:${classes[1]}` : `${classes[1]}:${classes[0]}`;
};

// Within-class consistency: two claims from the same authority class about the
// same dimension agree (AGREES), conflict (CONFLICTS -> decided by the
// within-domain policy), or one supersedes the other (SUPERSEDED).
const withinDomainResolution = (leftClass, consistent, superseded) => {
  if (superseded) return { state: "SUPERSEDED", label: "SUPERSEDED", relation: `The superseded ${leftClass} claim does not clear a gate; the current revision governs.`, blocking: true };
  if (consistent) return { state: "AGREES", label: "AGREES", relation: "Both claims agree on the dimension.", blocking: false };
  return { state: "CONFLICTS", label: "CONFLICTS", relation: WITHIN_DOMAIN_POLICY[leftClass] || WITHIN_DOMAIN_POLICY.AI_INFERENCE, blocking: true };
};

// resolveCrossDomainConflict
//
// left/right: { authorityClass, role, ... }
// options: { consistent, superseded, dimension }
//   consistent  -- whether the two claims agree in value for the same scope.
//   superseded  -- whether one claim is from a source/version known to be
//                  superseded by the other (within-domain supersession).
//
// Returns a semantic state, a human label, explanation, and whether it blocks.
// A conflict NEVER averages the two claims; it blocks toward clarification.
export const resolveCrossDomainConflict = (left, right, options = {}) => {
  const leftClass = left?.authorityClass || null;
  const rightClass = right?.authorityClass || null;
  const consistent = options.consistent === true;
  const superseded = options.superseded === true;
  const dimension = options.dimension || null;

  if (!isAuthorityClass(leftClass) || !isAuthorityClass(rightClass)) {
    return {
      state: "INSUFFICIENT_AUTHORITY",
      label: "INSUFFICIENT_AUTHORITY",
      relation: "One side of the comparison has no recognizable authority class; failing closed rather than inventing a winner.",
      blocking: true,
      dimension,
    };
  }

  if (leftClass === rightClass) {
    const within = withinDomainResolution(leftClass, consistent, superseded);
    return { ...within, dimension, leftAuthoritative: true, rightAuthoritative: true };
  }

  const key = pairKey(leftClass, rightClass);
  const policy = key ? CROSS_DOMAIN_POLICY[key] : null;
  if (!policy) {
    return {
      state: "UNKNOWN_PRECEDENCE",
      label: "UNKNOWN_PRECEDENCE",
      relation: `No governed cross-domain policy exists between ${leftClass} and ${rightClass}; failing closed (blocking) rather than inventing precedence.`,
      blocking: true,
      dimension,
    };
  }

  const BOTH = ["BOTH_CONSTRAINTS_APPLY"].includes(policy.label);
  const SATISFY = policy.label.startsWith("ENGINEERING_MUST_SATISFY");
  const VERIFY = policy.label === "REQUIREMENT_DEFINES_PRODUCT_VERIFIES";
  const NEVER = policy.label.endsWith("_NEVER_OVERRIDES");

  if (NEVER) {
    return {
      state: policy.label,
      label: policy.label,
      relation: policy.relation,
      blocking: true,
      dimension,
      refuted: true,
    };
  }

  if (SATISFY) {
    // Engineering evidence yields to the project/regulatory constraint; a
    // contradiction between them is still blocking.
    return {
      state: consistent ? policy.label : policy.conflictLabel,
      label: consistent ? policy.label : policy.conflictLabel,
      relation: policy.relation,
      blocking: !consistent,
      dimension,
      governingClass: policy.label === "ENGINEERING_MUST_SATISFY_PROJECT" ? "PROJECT_CONTRACT" : "REGULATORY",
    };
  }

  if (BOTH || VERIFY) {
    // Both constraints apply, or requirement defines / product verifies. When
    // the two claims genuinely agree on value and scope this is a clean pass;
    // ANY disagreement in value is a hard conflict.
    if (consistent) {
      return { state: policy.label, label: policy.label, relation: policy.relation, blocking: false, dimension };
    }
    return { state: policy.conflictLabel, label: policy.conflictLabel, relation: `Claims on the ${dimension || "same"} dimension disagree and cannot be averaged: ${policy.relation}`, blocking: true, dimension };
  }

  // CERTIFICATION_LISTING vs PRODUCT_TECHNICAL -- each authoritative only for
  // its own scope. Agreement confirms; disagreement within the SAME exact
  // scope is a certification conflict.
  if (consistent) {
    return { state: policy.label, label: policy.label, relation: policy.relation, blocking: false, dimension };
  }
  return { state: policy.conflictLabel, label: policy.conflictLabel, relation: `Disagreement within the same exact scope between certification and product evidence: ${policy.relation}`, blocking: true, dimension };
};

// ---------------------------------------------------------------------------
// Evidence-kind trust (4A-4). classifyEvidenceKind decides the kind of a
// single evidence object; isDerivedEvidenceComplete enforces the DERIVED
// contract; evidenceKindTrust is the ONLY allowed kind ordering, and it never
// promotes INFERRED.
// ---------------------------------------------------------------------------
const DERIVED_REQUIRED_FIELDS = Object.freeze([
  "ruleId",
  "ruleVersion",
  "inputs",
  "inputProvenance",
  "formula",
  "output",
  "executionStatus",
  "sourceFacts",
]);

export const classifyEvidenceKind = ({ hasSource, derivedTrace, declaredKind, provenance } = {}) => {
  // A DERIVED claim with a complete trace is governed evidence; a DERIVED
  // claim whose trace is incomplete is NOT governed evidence -- it is the
  // same as a missing evidence claim, never a model guess (and therefore
  // never MISLABELED as inference, which would let a broken derivation lean
  // on the "suggestion only" bucket instead of failing the evidence gate).
  if (derivedTrace || (provenance && (provenance.ruleId || provenance.calculationType))) {
    return isDerivedEvidenceComplete(derivedTrace || provenance) ? "DERIVED" : "MISSING_EVIDENCE_PLACEHOLDER";
  }
  if (hasSource) return "EXPLICIT";
  if (declaredKind === "INFERRED") return "INFERRED";
  if (declaredKind === "EXPLICIT" && !hasSource) return "MISSING_EVIDENCE_PLACEHOLDER";
  return "UNKNOWN";
};

export const isDerivedEvidenceComplete = (trace) => {
  if (!trace || typeof trace !== "object") return false;
  const outputsValid = trace.output !== undefined && trace.output !== null;
  const inputsValid = Array.isArray(trace.inputs) && trace.inputs.length > 0;
  const provenanceValid = Array.isArray(trace.inputProvenance) ? trace.inputProvenance.length === trace.inputs.length : Boolean(trace.inputProvenance);
  return DERIVED_REQUIRED_FIELDS.reduce((ok, field) => {
    if (field === "output") return ok;
    if (field === "inputs") return ok;
    if (field === "inputProvenance") return ok;
    if (field === "sourceFacts") return ok && (Array.isArray(trace.sourceFacts) || Array.isArray(trace.inputProvenance));
    return ok && trace[field] !== undefined && trace[field] !== null && String(trace[field]).trim().length > 0;
  }, true) && outputsValid && inputsValid && provenanceValid;
};

// The only trust rule: EXPLICIT and DERIVED are both governed; INFERRED is
// never authoritative. Returns the higher of two kinds, or null on a tie.
export const evidenceKindTrust = (left, right) => {
  const order = { EXPLICIT: 2, DERIVED: 2, INFERRED: 1, UNKNOWN: 0, MISSING_EVIDENCE_PLACEHOLDER: 0 };
  const a = order[left] ?? 0;
  const b = order[right] ?? 0;
  return a > b ? left : b > a ? right : null;
};

// INFERRED can never become EXPLICIT because model confidence is high.
// promoteEvidenceKind returns the same kind (or the declared kind), never an
// upgrade. Confidence is deliberately an unused parameter (Rule E analog).
export const promoteEvidenceKind = (kind, _confidence) => {
  if (kind === "INFERRED") return "INFERRED";
  if (kind === "DERIVED") return "DERIVED";
  if (kind === "EXPLICIT") return "EXPLICIT";
  return "MISSING_EVIDENCE_PLACEHOLDER";
};

// ---------------------------------------------------------------------------
// Fail-safe helpers shared by the envelope layer.
// ---------------------------------------------------------------------------
// State for "we know a dimension constrains matching but no authoritative
// evidence backs the claim" -- blocking, engineer exception expected.
export const insufficientAuthority = (dimension) => ({
  state: "INSUFFICIENT_AUTHORITY",
  label: "INSUFFICIENT_AUTHORITY",
  dimension,
  blocking: true,
  relation: "No authoritative evidence governs this dimension; failing closed.",
});

export const missingEvidence = (dimension) => ({
  state: "MISSING_EVIDENCE",
  label: "MISSING_EVIDENCE",
  dimension,
  blocking: true,
  relation: "A mandatory dimension requires evidence the comparison does not provide.",
});