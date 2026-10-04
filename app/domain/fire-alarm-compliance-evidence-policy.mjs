// GOLDEN-6B -- GOVERNED FIRE ALARM STANDARDS & COMPLIANCE EVIDENCE RESOLVER.
//
// Pure domain module that converts GOVERNED project evidence about standards
// and compliance into canonical compliance facts, then derives the ONE
// downstream engineering input GOLDEN-5 (fire-alarm-ecosystem-policy.mjs) is
// allowed to receive from that evidence: `complianceRegime`.
//
// THE TWO LAYERS STAY SEPARATE (mission §1/§3):
//   Layer B -- what the project ESTABLISHES about standards/certifications.
//   Layer C -- what policy branch (if any) derives from those facts.
// This module separates the layers structurally: resolveComplianceEvidence
// returns only facts (Layer B); deriveCompliancePolicyBranch returns only the
// branch + regime string (Layer C). No function in this file ever selects an
// ecosystem, a panel model, or a compatibility target -- that is exclusively
// GOLDEN-5's job, and it consumes only the derived `complianceRegime` string.
//
// INPUT CONTRACT (dialect-free, caller-gated -- THE SAME ROWS THE REQUIREMENT
// ENGINE ALREADY CONSUMES, never a re-typed half):
//   * requirement_standards child rows on a Confirmed-linked CURRENT + ELIGIBLE
//     requirement (review_status='Approved' AND approved_for_downstream=1; the
//     GOV-AUTH-1 contract in worker/technical-requirement-api.mjs:102), or
//   * engineering_facts rows with fact_type='Source Fact' AND status='Active',
//     predicate='applicable_standard' (worker/technical-requirement-api.mjs:244).
// The caller passes those rows as `entries` (shape below). This module does not
// re-derive currency/eligibility from strings; it REFUSES entries that fail the
// gate (defense in depth) and derives semantics from the governed context.
//
// HARD DESIGN INVARIANTS (mission §14-§27):
//   1. No synthetic equivalence. UL != FM, EN54 != LPCB, NFPA != UL/FM. A
//      canonical fact records EXACTLY the designations the evidence establishes.
//   2. Every fact keeps scope + authority + currency + obligation.
//   3. Mention counts, popularity, later created_at, and vendor/hardcoded bias
//      NEVER resolve a conflict. Conflicts FAIL CLOSED.
//   4. Manufacturer / vendor product material can NEVER become a contractual
//      mandate.
//   5. Higher-authority supersession is the only conflict resolution: the
//      winning entry carries the authority, the losing entry stays as history.
//   6. The adapter derives `complianceRegime` only, and ONLY when facts alone
//      justify it: UL/FM route from system-level UL/FM certification evidence;
//      EN54/LPCB route only when BOTH EN54/European AND LPCB are established.
//      EN54-only, LPCB-only, NFPA-only, and any ambiguous/conflicted state
//      yield NO regime -- so GOLDEN-5 fails closed (MISSING_FIRE_ALARM_...).
//
// No database access, no mutation, no review-state changes. Deterministic.

import { COMPLIANCE_REGIMES as GOLDEN5_REGIMES } from "./fire-alarm-ecosystem-policy.mjs";

// ---------------------------------------------------------------------------
// Version & vocabulary
// ---------------------------------------------------------------------------

export const FIRE_ALARM_COMPLIANCE_EVIDENCE_POLICY_VERSION = "fire-alarm-compliance-evidence-policy-1.0.0";

// Mission §3 -- six mention classifications. Never collapsed into one enum
// with the policy branch; `classification` and `policyBranch` are separate axes.
export const MENTION_CLASSIFICATIONS = Object.freeze({
  MANDATORY_PROJECT_REQUIREMENT: "MANDATORY_PROJECT_REQUIREMENT",
  REFERENCE_STANDARD: "REFERENCE_STANDARD",
  PRODUCT_CERTIFICATION: "PRODUCT_CERTIFICATION",
  MANUFACTURER_CAPABILITY: "MANUFACTURER_CAPABILITY",
  INFORMATIVE_CONTEXT: "INFORMATIVE_CONTEXT",
  AMBIGUOUS: "AMBIGUOUS",
});

// Mission §9 -- nine authority classes. What governs the mention.
export const AUTHORITY_CLASSES = Object.freeze({
  CONTRACTUAL_PROJECT_REQUIREMENT: "CONTRACTUAL_PROJECT_REQUIREMENT",
  APPROVED_ADDENDUM_OR_CLARIFICATION: "APPROVED_ADDENDUM_OR_CLARIFICATION",
  APPROVED_HUMAN_ENGINEERING_DECISION: "APPROVED_HUMAN_ENGINEERING_DECISION",
  APPROVED_SYSTEM_SPECIFICATION: "APPROVED_SYSTEM_SPECIFICATION",
  BOQ_REQUIREMENT: "BOQ_REQUIREMENT",
  DRAWING_REQUIREMENT: "DRAWING_REQUIREMENT",
  PRODUCT_REFERENCE: "PRODUCT_REFERENCE",
  MANUFACTURER_REFERENCE: "MANUFACTURER_REFERENCE",
  INFORMATIVE_TEXT: "INFORMATIVE_TEXT",
});

// Mission §10 -- fact scopes.
export const COMPLIANCE_SCOPES = Object.freeze({
  PROJECT: "PROJECT",
  FIRE_ALARM_SYSTEM: "FIRE_ALARM_SYSTEM",
  FACP: "FACP",
  DETECTORS: "DETECTORS",
  MODULES: "MODULES",
  NOTIFICATION_APPLIANCES: "NOTIFICATION_APPLIANCES",
  PRODUCT_ONLY: "PRODUCT_ONLY",
  SPECIFIC_BUILDING: "SPECIFIC_BUILDING",
  SPECIFIC_BOQ_ITEM: "SPECIFIC_BOQ_ITEM",
});

// Mission §11 -- obligation vocab.
export const OBLIGATIONS = Object.freeze({
  MANDATORY: "mandatory",
  REFERENCE: "reference",
  PRODUCT_CERTIFICATION: "product_certification",
  MANUFACTURER_CAPABILITY: "manufacturer_capability",
  CONTEXTUAL: "contextual",
  AMBIGUOUS: "ambiguous",
});

// Mission §4 assent states.
export const COMPLIANCE_RESOLUTION_STATES = Object.freeze({
  RESOLVED_COMPLIANCE_FACTS: "RESOLVED_COMPLIANCE_FACTS",
  MISSING_COMPLIANCE_EVIDENCE: "MISSING_COMPLIANCE_EVIDENCE",
  CONFLICTING_COMPLIANCE_EVIDENCE: "CONFLICTING_COMPLIANCE_EVIDENCE",
  REQUIRES_ENGINEERING_REVIEW: "REQUIRES_ENGINEERING_REVIEW",
});

// Policy branches derive from facts (Layer C). They are NOT classifications.
export const POLICY_BRANCHES = Object.freeze({
  UL_FM_POLICY_BRANCH: "UL_FM_POLICY_BRANCH",
  EN54_LPCB_POLICY_BRANCH: "EN54_LPCB_POLICY_BRANCH",
  NO_SUPPORTED_ECOSYSTEM_BRANCH: "NO_SUPPORTED_ECOSYSTEM_BRANCH",
});

export const CONCEPT_TYPES = Object.freeze({
  STANDARD: "STANDARD",
  CERTIFICATION: "CERTIFICATION",
  APPROVAL_BODY: "APPROVAL_BODY",
});

// The scopes that participate in regime/conflict decisions. PROJECT and
// FIRE_ALARM_SYSTEM are system-wide; FACP is the control/compliance anchor of
// the system (mission §25: a FACP mandatory UL requirement establishes the
// system's UL basis, while field-device certifications -- detectors, modules,
// notification appliances -- are product-scoped and never do).
const REGIME_LEVEL_SCOPES = new Set([COMPLIANCE_SCOPES.PROJECT, COMPLIANCE_SCOPES.FIRE_ALARM_SYSTEM, COMPLIANCE_SCOPES.FACP]);

// Authority precedence for supersession { higher beats lower }.
// Supersession is ONLY allowed from a strictly higher authority to a lower one,
// mirroring the project's source precedence discipline. Equal authorities
// conflict (fail closed); they never resolve by recency or popularity.
const AUTHORITY_RANK = Object.freeze({
  [AUTHORITY_CLASSES.CONTRACTUAL_PROJECT_REQUIREMENT]: 90,
  [AUTHORITY_CLASSES.APPROVED_ADDENDUM_OR_CLARIFICATION]: 80,
  [AUTHORITY_CLASSES.APPROVED_HUMAN_ENGINEERING_DECISION]: 75,
  [AUTHORITY_CLASSES.APPROVED_SYSTEM_SPECIFICATION]: 70,
  [AUTHORITY_CLASSES.BOQ_REQUIREMENT]: 60,
  [AUTHORITY_CLASSES.DRAWING_REQUIREMENT]: 55,
  [AUTHORITY_CLASSES.PRODUCT_REFERENCE]: 25,
  [AUTHORITY_CLASSES.MANUFACTURER_REFERENCE]: 20,
  [AUTHORITY_CLASSES.INFORMATIVE_TEXT]: 10,
});

// ---------------------------------------------------------------------------
// Concept registry (mission §6 minimum set + operational extras).
// Recognition alone carries NO authority -- it only names the designation.
// ---------------------------------------------------------------------------

export const recognizeStandardsConcept = ({ body = null, number = null } = {}) => {
  const b = String(body ?? "").trim();
  const n = String(number ?? "").trim();

  // UL / ULC listings and FM approvals. A numbered UL/ULC/FM designation is
  // still the same certification FAMILY; the precise designation is preserved
  // on the fact. Nothing is ever fabricated into a different family.
  if (/^(UL|U\.L\.)$/i.test(b) || /^UL$/.test(b)) {
    if (n) return { concept: `UL ${n}`, conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "UL" };
    return { concept: "UL", conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "UL" };
  }
  if (/^(ULC|UL-C)$/i.test(b)) {
    if (n) return { concept: `ULC ${n}`, conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "UL" };
    return { concept: "ULC", conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "UL" };
  }
  if (/^(FM|FM Global|FMGlobal)$/i.test(b)) {
    if (n) return { concept: `FM ${n}`, conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "FM" };
    return { concept: "FM", conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "FM" };
  }
  // NFPA codes -- STANDARD/installation codes, NEVER product certifications.
  if (/^(NFPA)$/i.test(b) || /^NFPA/.test(b)) {
    if (/^(70|72|101)$/.test(n)) return { concept: `NFPA ${n}`, conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "NFPA" };
    if (/^7[02]?$/.test(n)) return { concept: `NFPA ${n}`, conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "NFPA" };
    return { concept: "NFPA", conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "NFPA" };
  }
  // EN 54 family -- framework standard, never a certification body.
  if (/^(EN54|EN 54|EN-54)$/i.test(b)) {
    if (n && /^\d+$/.test(n)) return { concept: `EN 54-${n}`, conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "EN54" };
    return { concept: "EN 54", conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "EN54" };
  }
  // LPCB -- approval body.
  if (/^(LPCB|Loss Prevention Certification Board)$/i.test(b)) {
    return { concept: "LPCB", conceptType: CONCEPT_TYPES.APPROVAL_BODY, standardFamily: "LPCB" };
  }
  // BS 5839 / BS-* standards.
  if (/^(BS|BS-)/i.test(b)) {
    const designation = n || b.replace(/^BS[\s-]?/i, "");
    return { concept: designation ? `BS ${designation}` : "BS", conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "BS" };
  }
  if (/^(European Standards|European)$/i.test(b) || /^European Standards$/.test(b)) {
    return { concept: "European", conceptType: CONCEPT_TYPES.STANDARD, standardFamily: "European" };
  }
  // ISO 9001-family quality certs -- manufacturer-capability only, never system
  // compliance (special-cased in the classifier).
  if (/^ISO$/.test(b) && /^9001/.test(n)) {
    return { concept: "ISO 9001", conceptType: CONCEPT_TYPES.CERTIFICATION, standardFamily: "ISO" };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Language cues -- deterministic and word-bounded.
// ---------------------------------------------------------------------------

const MANDATORY_CUE = /(shall|must|required to|to comply|in accordance with|complies? with|to meet|shall adhere|be listed|be certified|shall follow|traced? back to)/i;
const REFERENCE_CUE = /(for reference|as per|per (the )?|reference|such as|including(,| the)?|equivalent to|example)/i;
const CAPABILITY_CUE = /(offers?|provides?|available with|supports?|compatible with|permits?|capable of|certified to (a|the)?|features? include|\blisted\b)/i;
const INFORMATIVE_CUE = /(features? (include|:)|note that|for context|informational|standard configuration|offering)/i;
const NEGATION_CUE = /(shall not|must not|is not (listed|certified)|not permitted to be)/i;

const classFromSource = (sourceType) => {
  const s = String(sourceType ?? "");
  if (/contract|employer|client requirement|tender/i.test(s)) return AUTHORITY_CLASSES.CONTRACTUAL_PROJECT_REQUIREMENT;
  if (/addendum|clarification/i.test(s)) return AUTHORITY_CLASSES.APPROVED_ADDENDUM_OR_CLARIFICATION;
  if (/human decision|engineering decision|review decision|technical manager decision/i.test(s)) return AUTHORITY_CLASSES.APPROVED_HUMAN_ENGINEERING_DECISION;
  if (/specification|technical specification/i.test(s)) return AUTHORITY_CLASSES.APPROVED_SYSTEM_SPECIFICATION;
  if (/bill of quantities|\bboq\b/i.test(s)) return AUTHORITY_CLASSES.BOQ_REQUIREMENT;
  if (/drawing/i.test(s)) return AUTHORITY_CLASSES.DRAWING_REQUIREMENT;
  if (/vendor|product reference|datasheet|approved vendor list|product data/i.test(s)) return AUTHORITY_CLASSES.PRODUCT_REFERENCE;
  if (/manufacturer/i.test(s)) return AUTHORITY_CLASSES.MANUFACTURER_REFERENCE;
  return AUTHORITY_CLASSES.INFORMATIVE_TEXT;
};

const scopeFrom = ({ text = "", level = null } = {}) => {
  const t = text || "";
  if (/detector|smoke|heat\b|photo|ionization|beam detector|call ?point|duct detector/i.test(t)) return COMPLIANCE_SCOPES.DETECTORS;
  if (/sounder|notification appliance|strobe|hooter|speaker/i.test(t)) return COMPLIANCE_SCOPES.NOTIFICATION_APPLIANCES;
  if (/module|counter|isolator|zone card/i.test(t)) return COMPLIANCE_SCOPES.MODULES;
  if (/\b(facp|control ?panel|fire alarm control)\b/i.test(t)) return COMPLIANCE_SCOPES.FACP;
  if (/complete installation|entire (fire alarm )?system|the (fire alarm )?system|whole system|every component of the system/i.test(t)) return COMPLIANCE_SCOPES.FIRE_ALARM_SYSTEM;
  if (/project|this project/i.test(t)) return COMPLIANCE_SCOPES.PROJECT;
  if (level === "product") return COMPLIANCE_SCOPES.PRODUCT_ONLY;
  return COMPLIANCE_SCOPES.FIRE_ALARM_SYSTEM;
};

// ---------------------------------------------------------------------------
// Single-entry classification (Layer B, one governed evidence entry).
// ---------------------------------------------------------------------------

export const classifyEvidenceEntry = (entry = {}) => {
  const current = entry.current !== false;
  const approved = entry.approvedForDownstream === true || Number(entry.approvedForDownstream) === 1;
  const reviewed = String(entry.reviewStatus ?? "").trim() === "Approved";
  const supersededBy = entry.supersededBy ?? null;

  // Defense-in-depth against downstream leakage: refuse ungated entries.
  if (!current || !approved || !reviewed) {
    return {
      id: entry.id ?? null, kind: entry.kind ?? "unknown", concept: null, conceptType: null,
      classification: MENTION_CLASSIFICATIONS.AMBIGUOUS,
      obligation: OBLIGATIONS.AMBIGUOUS,
      authority: AUTHORITY_CLASSES.INFORMATIVE_TEXT,
      scope: COMPLIANCE_SCOPES.PRODUCT_ONLY,
      governing: false, basis: "NOT_ELIGIBLE_FOR_DOWNSTREAM", superseded: false, supersededBy: null,
    };
  }

  const text = String(entry.originalText ?? "").trim();
  const concept = recognizeStandardsConcept({ body: entry.body, number: entry.number });
  const authority = classFromSource(entry.sourceType);
  const scope = entry.scope ?? scopeFrom({ text, level: entry.level });

  const isProductAuthority = authority === AUTHORITY_CLASSES.PRODUCT_REFERENCE
    || authority === AUTHORITY_CLASSES.MANUFACTURER_REFERENCE;

  // Negation is never a positive compliance fact (P3 discipline).
  if (NEGATION_CUE.test(text)) {
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept?.conceptType ?? null,
      classification: MENTION_CLASSIFICATIONS.AMBIGUOUS, obligation: OBLIGATIONS.AMBIGUOUS,
      authority, scope, governing: false, basis: "NEGATED_RELATIONSHIP", superseded: Boolean(supersededBy), supersededBy };
  }

  // Manufacturer / vendor product material can never become a contractual
  // mandate: capability wording -> MANUFACTURER_CAPABILITY; otherwise context.
  if (isProductAuthority) {
    const capability = CAPABILITY_CUE.test(text);
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept?.conceptType ?? null,
      classification: capability ? MENTION_CLASSIFICATIONS.MANUFACTURER_CAPABILITY : MENTION_CLASSIFICATIONS.INFORMATIVE_CONTEXT,
      obligation: capability ? OBLIGATIONS.MANUFACTURER_CAPABILITY : OBLIGATIONS.CONTEXTUAL,
      authority, scope, governing: false, superseded: Boolean(supersededBy), supersededBy };
  }

  if (!concept) {
    const mandating = MANDATORY_CUE.test(text);
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept: null, conceptType: null,
      classification: mandating ? MENTION_CLASSIFICATIONS.AMBIGUOUS : MENTION_CLASSIFICATIONS.INFORMATIVE_CONTEXT,
      obligation: mandating ? OBLIGATIONS.AMBIGUOUS : OBLIGATIONS.CONTEXTUAL,
      authority, scope, governing: false, basis: "UNRECOGNIZED_DESIGNATION", superseded: Boolean(supersededBy), supersededBy };
  }

  // ISO 9001-family quality certification is a manufacturer-capability
  // statement, never a fire-alarm system compliance fact.
  if (concept.standardFamily === "ISO") {
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept.conceptType,
      classification: MENTION_CLASSIFICATIONS.MANUFACTURER_CAPABILITY, obligation: OBLIGATIONS.MANUFACTURER_CAPABILITY,
      authority, scope, governing: false, basis: "QUALITY_CERTIFICATION", superseded: Boolean(supersededBy), supersededBy };
  }

  // Clause-local semantics: informative/feature prose never becomes a mandate.
  if (INFORMATIVE_CUE.test(text)) {
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept.conceptType,
      classification: MENTION_CLASSIFICATIONS.INFORMATIVE_CONTEXT, obligation: OBLIGATIONS.CONTEXTUAL,
      authority, scope, governing: false, basis: "INFORMATIVE_WORDING", superseded: Boolean(supersededBy), supersededBy };
  }

  const mandatory = MANDATORY_CUE.test(text);
  const reference = REFERENCE_CUE.test(text);

  if (!mandatory) {
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept.conceptType,
      classification: reference ? MENTION_CLASSIFICATIONS.REFERENCE_STANDARD : MENTION_CLASSIFICATIONS.INFORMATIVE_CONTEXT,
      obligation: reference ? OBLIGATIONS.REFERENCE : OBLIGATIONS.CONTEXTUAL,
      authority, scope, governing: false, superseded: Boolean(supersededBy), supersededBy };
  }

  if (concept.conceptType === CONCEPT_TYPES.CERTIFICATION) {
    const regimeRelevant = REGIME_LEVEL_SCOPES.has(scope);
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept.conceptType,
      classification: regimeRelevant ? MENTION_CLASSIFICATIONS.MANDATORY_PROJECT_REQUIREMENT : MENTION_CLASSIFICATIONS.PRODUCT_CERTIFICATION,
      obligation: regimeRelevant ? OBLIGATIONS.MANDATORY : OBLIGATIONS.PRODUCT_CERTIFICATION,
      authority, scope, governing: true, superseded: Boolean(supersededBy), supersededBy };
  }

  if (concept.conceptType === CONCEPT_TYPES.STANDARD || concept.conceptType === CONCEPT_TYPES.APPROVAL_BODY) {
    return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept.conceptType,
      classification: MENTION_CLASSIFICATIONS.MANDATORY_PROJECT_REQUIREMENT, obligation: OBLIGATIONS.MANDATORY,
      authority, scope, governing: true, superseded: Boolean(supersededBy), supersededBy };
  }

  return { id: entry.id ?? null, kind: entry.kind ?? "unknown", concept, conceptType: concept.conceptType,
    classification: MENTION_CLASSIFICATIONS.AMBIGUOUS, obligation: OBLIGATIONS.AMBIGUOUS,
    authority, scope, governing: false, superseded: Boolean(supersededBy), supersededBy };
};

// ---------------------------------------------------------------------------
// Resolution: aggregate entries -> canonical compliance facts (Layer B).
// ---------------------------------------------------------------------------

const FAMILY_OF = (fact) => fact.concept?.standardFamily ?? null;
const DESIGNATION_OF = (fact) => fact.concept?.concept ?? null;
const isUlFmFamily = (family) => family === "UL" || family === "FM";

export const resolveComplianceEvidence = ({ entries = [] } = {}) => {
  const classified = entries.map((entry) => classifyEvidenceEntry(entry));
  const byId = new Map(classified.map((fact) => [fact.id, fact]));

  // Validate supersession claims: ONLY a strictly-higher authority may override
  // a lower one (§26/§34). Equal-authority claims are invalid and fail closed
  // (the supposedly-superseded fact stays live and conflicts are detected).
  const validWinnerIds = new Set();
  for (const fact of classified) {
    if (!fact.superseded) continue;
    const winner = byId.get(fact.supersededBy);
    if (!winner) continue;
    const winnerRank = winner.authority ? (AUTHORITY_RANK[winner.authority] ?? 0) : 0;
    const loserRank = fact.authority ? (AUTHORITY_RANK[fact.authority] ?? 0) : 0;
    if (winnerRank > loserRank) validWinnerIds.add(fact.supersededBy);
  }

  const facts = [];
  const governing = [];
  const supersededHistory = [];
  const ambiguous = [];
  const refused = [];

  for (const fact of classified) {
    facts.push(fact);
    if (!fact.governing) {
      // Ineligible rows are REFUSED (surfaced in the review payload) but are
      // not "ambiguous evidence": they must not force a RESOLVED state into
      // REQUIRES_ENGINEERING_REVIEW when other governed evidence resolves
      // (the acceptance project's pending Source Fact posture). Only genuinely
      // unclassifiable evidence (negated relationships, unrecognized mandatory
      // designations) is ambiguous.
      if (fact.basis === "NOT_ELIGIBLE_FOR_DOWNSTREAM") refused.push(fact);
      else if (fact.classification === MENTION_CLASSIFICATIONS.AMBIGUOUS) ambiguous.push(fact);
      continue;
    }
    // A governed fact superseded by a validated higher authority is HISTORY:
    // kept in `facts` and `supersededHistory`, never in the governing sets.
    if (fact.superseded && validWinnerIds.has(fact.supersededBy)) {
      supersededHistory.push(fact);
      continue;
    }
    governing.push(fact);
  }

  // Conflict detection -- REGIME-LEVEL certification vs approval claims only
  // (§24/§25: scope participates; field-device facts never conflict). The
  // conflicting pair is UL/ULC/FM certification evidence vs LPCB approval
  // evidence at regime scope. EN54/European families are design/installation
  // codes, NOT certification-regime claimants: a system-level EN54 installation
  // clause coexists with UL listing (the acceptance project's own resolved
  // posture, GOLDEN-6 -> Farenhyt) and never triggers a conflict by itself.
  const ulFmRegime = governing.filter((fact) => fact.conceptType === CONCEPT_TYPES.CERTIFICATION
    && REGIME_LEVEL_SCOPES.has(fact.scope) && isUlFmFamily(FAMILY_OF(fact)));
  const lpcbRegime = governing.filter((fact) => fact.conceptType === CONCEPT_TYPES.APPROVAL_BODY
    && REGIME_LEVEL_SCOPES.has(fact.scope));
  const conflicting = ulFmRegime.length > 0 && lpcbRegime.length > 0
    ? [...ulFmRegime, ...lpcbRegime] : [];

  // Canonical lists -- Layer B output. Family-level aggregation for the
  // regime-relevant lists (requiredCertifications / applicableStandards are
  // families like "UL", "NFPA 72", "EN 54"); the precise designation (e.g.
  // "UL 217") and every fact's scope/authority/obligation ride in the scope
  // detail lists. Aggregation collapses ONLY within a family -- UL 217 and
  // UL 268 both genuinely require UL certification; UL is never merged with
  // FM, EN54, or LPCB.
  const requiredCertifications = [];
  const applicableStandards = [];
  const requiredApprovals = [];
  const standardScopes = [];
  const certificationScopes = [];

  for (const fact of governing) {
    if (fact.conceptType === CONCEPT_TYPES.STANDARD) {
      applicableStandards.push(FAMILY_OF(fact));
      standardScopes.push({ standard: DESIGNATION_OF(fact), family: FAMILY_OF(fact), scope: fact.scope, classification: fact.classification, obligation: fact.obligation, authority: fact.authority, current: true, approvedForDownstream: true });
    } else if (fact.conceptType === CONCEPT_TYPES.CERTIFICATION) {
      requiredCertifications.push(FAMILY_OF(fact));
      certificationScopes.push({ certification: DESIGNATION_OF(fact), family: FAMILY_OF(fact), scope: fact.scope, classification: fact.classification, obligation: fact.obligation, authority: fact.authority, current: true, approvedForDownstream: true });
    } else if (fact.conceptType === CONCEPT_TYPES.APPROVAL_BODY) {
      requiredApprovals.push(FAMILY_OF(fact));
      certificationScopes.push({ certification: DESIGNATION_OF(fact), family: FAMILY_OF(fact), scope: fact.scope, classification: fact.classification, obligation: fact.obligation, authority: fact.authority, current: true, approvedForDownstream: true });
    }
  }

  const referenceStandards = classified
    .filter((fact) => fact.classification === MENTION_CLASSIFICATIONS.REFERENCE_STANDARD)
    .map((fact) => DESIGNATION_OF(fact));

  const unique = (items) => [...new Set(items)];

  let state = COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS;
  if (governing.length === 0) {
    state = refused.length > 0 || ambiguous.length > 0
      ? COMPLIANCE_RESOLUTION_STATES.REQUIRES_ENGINEERING_REVIEW
      : COMPLIANCE_RESOLUTION_STATES.MISSING_COMPLIANCE_EVIDENCE;
  } else if (conflicting.length > 0) {
    state = COMPLIANCE_RESOLUTION_STATES.CONFLICTING_COMPLIANCE_EVIDENCE;
  } else if (ambiguous.length > 0) {
    state = COMPLIANCE_RESOLUTION_STATES.REQUIRES_ENGINEERING_REVIEW;
  }

  const reviewPayload = {
    state,
    reviews: classified
      .filter((fact) => !fact.governing || fact.basis === "NOT_ELIGIBLE_FOR_DOWNSTREAM")
      .map((fact) => ({
        id: fact.id, concept: DESIGNATION_OF(fact), authority: fact.authority, scope: fact.scope,
        obligation: fact.obligation, classification: fact.classification, reason: fact.basis ?? fact.classification,
      })),
    conflictReason: conflicting.length
      ? `Regime-level certification evidence conflicts: ${[...new Set(conflicting.map((f) => DESIGNATION_OF(f)))].join(", ")}. No authority-based winner exists; fails closed.`
      : null,
    whyPolicyCouldNotResolve: conflicting.length
      ? "Conflicting governed facts carry equal or unorderable authority; the resolver never picks sides by recency, mention count, or vendor."
      : null,
  };

  return {
    version: FIRE_ALARM_COMPLIANCE_EVIDENCE_POLICY_VERSION,
    state,
    facts,
    applicableStandards: unique(applicableStandards),
    requiredCertifications: unique(requiredCertifications),
    requiredApprovals: unique(requiredApprovals),
    referenceStandards: unique(referenceStandards),
    standardScopes,
    certificationScopes,
    supersededHistory,
    conflicts: conflicting.map((fact) => ({ id: fact.id, concept: DESIGNATION_OF(fact), scope: fact.scope, authority: fact.authority })),
    reviewPayload,
  };
};

// ---------------------------------------------------------------------------
// Policy adapter (Layer C): canonical facts -> GOLDEN-5 `complianceRegime`.
//
// DOCUMENTED APPROVED ADAPTER RULES:
//   Rule "compliance-regime.ul-fm": a system-level (PROJECT or FIRE_ALARM_SYSTEM)
//     UL/ULC/FM certification fact establishes the UL/FM certification route.
//     UL-only or FM-only evidence establishes it; the sibling certification is
//     NEVER fabricated into canonical facts. regime: "UL/FM".
//   Rule "compliance-regime.en54-lpcb": BOTH system-level EN54/European evidence
//     AND LPCB approval evidence are required. Neither alone suffices.
//     regime: "LPCB/EN54/European".
//   Rule "compliance-regime.unsupported": anything else (EN54-only, LPCB-only,
//     NFPA-only code references, no governing facts, conflicts, ambiguity)
//     yields NO regime. GOLDEN-5 then fails closed.
// ---------------------------------------------------------------------------

export const deriveCompliancePolicyBranch = (resolution) => {
  if (resolution.state !== COMPLIANCE_RESOLUTION_STATES.RESOLVED_COMPLIANCE_FACTS) {
    return { policyBranch: null, regime: null, ruleId: null, reason: resolution.state };
  }
  // Regime derivation is REGIME-SCOPED ONLY: a detector-only UL listing
  // (PRODUCT_CERTIFICATION, scope DETECTORS) never triggers the UL/FM route
  // (mission §25 scope participation). requiredCertifications is inventory;
  // the regime question consults only the scope detail lists.
  const systemCertificationFacts = (resolution.certificationScopes || []).filter(
    (entry) => REGIME_LEVEL_SCOPES.has(entry.scope),
  );
  const hasUlFm = systemCertificationFacts.some((entry) => isUlFmFamily(entry.family));
  const hasEn54 = (resolution.standardScopes || []).some((entry) => REGIME_LEVEL_SCOPES.has(entry.scope)
    && (entry.family === "EN54" || entry.family === "European"));
  // LPCB is regime-scoped only: a building- or product-scoped LPCB approval
  // does not establish the project-wide EN54/LPCB route by itself.
  const hasLpcb = (resolution.certificationScopes || []).some(
    (entry) => entry.family === "LPCB" && REGIME_LEVEL_SCOPES.has(entry.scope),
  );

  if (hasUlFm) {
    const families = [...new Set((resolution.requiredCertifications || []).filter((f) => isUlFmFamily(f)))];
    return {
      policyBranch: POLICY_BRANCHES.UL_FM_POLICY_BRANCH,
      regime: GOLDEN5_REGIMES.ULFM,
      ruleId: "compliance-regime.ul-fm",
      reason: `System-level ${families.join("+")} certification evidence establishes the UL/FM certification route (approved policy); the sibling certification is not fabricated.`,
    };
  }
  if (hasEn54 && hasLpcb) {
    return {
      policyBranch: POLICY_BRANCHES.EN54_LPCB_POLICY_BRANCH,
      regime: GOLDEN5_REGIMES.LPCB_EN54_EUROPEAN,
      ruleId: "compliance-regime.en54-lpcb",
      reason: "System-level EN54/European AND LPCB evidence are both established.",
    };
  }
  const reason = hasLpcb
    ? "LPCB approval established without EN54/European evidence; LPCB-only never establishes the compliance regime."
    : hasEn54
      ? "EN54/European evidence established without LPCB approval; EN54-only never selects the EN54/LPCB regime."
      : (resolution.applicableStandards || []).length
        ? "Standards/codes only (NFPA/BS references) do not establish a certification regime."
        : "No governing system-level certification or approval evidence.";
  return { policyBranch: POLICY_BRANCHES.NO_SUPPORTED_ECOSYSTEM_BRANCH, regime: null, ruleId: "compliance-regime.unsupported", reason };
};

export const buildFireAlarmComplianceAdapterResult = ({ entries = [] } = {}) => {
  const resolution = resolveComplianceEvidence({ entries });
  const branch = deriveCompliancePolicyBranch(resolution);
  return { ...resolution, ...branch };
};