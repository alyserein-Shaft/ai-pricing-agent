// OPERATIONAL POLICY FOUNDATION -- STAGE 1 (2026-09-02).
//
// This file remains pure domain logic -- no DB, no fetch, no env. It answers
// four governed questions, and only these four:
//   1. What type of project is this? (PROJECT_TYPES)
//   2. What maturity/status is this drawing? (normalizeDrawingStatus)
//   3. How much authority/trust does that status carry? (evaluateDrawingAuthority)
//   4. Where does a technical-requirement source rank against Specification/BOQ? (resolveSourceAuthorityRank)
//
// It deliberately does NOT decide quantity policy (Tender->BOQ, On-hand->
// Drawing/RFI enforcement is Stage 2, not built here), does NOT implement
// RFI/clarification workflow, and does NOT touch calculations, the AI Agent,
// product matching or pricing. Everything here is conservative-by-default:
// an unrecognized or ambiguous input normalizes to UNKNOWN, never guessed
// upward into a higher-trust status.

// Section 1: governed project type. Free text is never accepted -- callers
// must pass one of these two values, or leave the project UNSET (null).
export const PROJECT_TYPES = Object.freeze(["TENDER", "ON_HAND"]);
export const isGovernedProjectType = (value) => PROJECT_TYPES.includes(String(value || ""));

// Section 2: controlled drawing-status model. UNKNOWN is a first-class,
// safe member of this set -- not an absence of a value.
export const DRAWING_STATUSES = Object.freeze([
  "APPROVED_IFC_AFC",
  "UNAPPROVED_IFC",
  "TENDER_REFERENCE",
  "DESIGN_DEVELOPMENT",
  "CONCEPT",
  "UNKNOWN",
]);

// Section 3: deterministic normalization of common title-block / intake
// "purpose of issue" text into the controlled status set above. This is a
// closed, literal-match ruleset -- it is intentionally not a fuzzy/NLP
// classifier, because Section 3 requires that any value it cannot safely
// distinguish stays UNKNOWN rather than being guessed upward (e.g. "Rev A"
// alone must never be inferred to mean Approved). The raw source text
// itself is never discarded -- normalizeDrawingStatus only classifies it;
// callers remain responsible for keeping the original issue_purpose text
// as a separate field for provenance (Section 2).
const NORMALIZATION_RULES = [
  { status: "APPROVED_IFC_AFC", patterns: [/\bafc\b/, /\bapproved\s+for\s+construction\b/, /\bissued\s+for\s+construction\b/, /\bifc\b/, /\bapproved\s+ifc\b/] },
  { status: "TENDER_REFERENCE", patterns: [/\bfor\s+tender\b/, /\btender\b/, /\breference\b/, /\bfor\s+information\b/, /\bfor\s+reference\b/] },
  { status: "DESIGN_DEVELOPMENT", patterns: [/\bdesign\s+development\b/, /\bdd\b/] },
  { status: "CONCEPT", patterns: [/\bconcept\b/, /\bconcept\s+design\b/, /\bschematic\b/] },
  // "Unapproved IFC" only matches when the text explicitly says IFC/
  // construction issue but ALSO explicitly says it is not yet approved --
  // this rule must be checked before the general APPROVED_IFC_AFC rule
  // above, and only fires on that explicit combination so it can never
  // silently upgrade an ordinary "IFC" label to Approved by omission.
];

export const normalizeDrawingStatus = (rawIssuePurpose) => {
  const text = String(rawIssuePurpose ?? "").trim().toLowerCase();
  if (!text) return "UNKNOWN";
  const explicitlyUnapproved = /\b(unapproved|not\s+approved|pending\s+approval|draft\s+ifc)\b/.test(text);
  const referencesConstructionIssue = /\bifc\b/.test(text) || /\bissued\s+for\s+construction\b/.test(text);
  if (explicitlyUnapproved && referencesConstructionIssue) return "UNAPPROVED_IFC";
  for (const rule of NORMALIZATION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.status;
  }
  return "UNKNOWN";
};

// Section 4: the drawing authority profile. This is the engineer's exact
// 5-tier mapping (Rule 2) -- it governs TRUST/COMMERCIAL/QUANTITY use, and
// is kept strictly separate from coverageState (drawing-quantity-evidence-
// engine.mjs's own, independent concept of whether a drawing SET has been
// reviewed completely enough to compare against a BOQ quantity). Merging
// the two would let a single well-reviewed Concept drawing look as
// authoritative as an Approved IFC set, which Section 4 explicitly forbids.
const AUTHORITY_PROFILES = {
  APPROVED_IFC_AFC: { authorityTier: "High", trustLevel: "High", commercialUse: "Approved quantity evidence", quantityUse: "May be relied upon for quantity take-off", requiresEngineerReview: false },
  UNAPPROVED_IFC: { authorityTier: "Medium-High", trustLevel: "Medium-High", commercialUse: "Usable pricing evidence with engineer review", quantityUse: "Usable with review; not yet approved for unreviewed reliance", requiresEngineerReview: true },
  TENDER_REFERENCE: { authorityTier: "Medium", trustLevel: "Medium", commercialUse: "Preliminary pricing only", quantityUse: "Preliminary only; not a substitute for BOQ or approved drawings", requiresEngineerReview: true },
  DESIGN_DEVELOPMENT: { authorityTier: "Low-Medium", trustLevel: "Low-Medium", commercialUse: "Budgetary use only", quantityUse: "Budgetary only; scope and quantity remain subject to change", requiresEngineerReview: true },
  CONCEPT: { authorityTier: "Low", trustLevel: "Low", commercialUse: "Estimate only", quantityUse: "Estimate only; must not be treated as authoritative", requiresEngineerReview: true },
  UNKNOWN: { authorityTier: "Unknown", trustLevel: "Unknown", commercialUse: "Needs Review before commercial use", quantityUse: "Needs Review -- status could not be safely determined", requiresEngineerReview: true },
};

export const evaluateDrawingAuthority = ({ drawingStatus = "UNKNOWN", projectType = null } = {}) => {
  const status = DRAWING_STATUSES.includes(drawingStatus) ? drawingStatus : "UNKNOWN";
  const profile = AUTHORITY_PROFILES[status];
  // projectType is accepted (per Section 4's signature) and returned for
  // traceability, but Stage 1 explicitly does not yet let it change
  // quantityUse/commercialUse -- that governed behavior (Tender->BOQ,
  // On-hand->Drawing/RFI enforcement) is Stage 2, not built here.
  return { drawingStatus: status, projectType: isGovernedProjectType(projectType) ? projectType : null, ...profile };
};

// Section 5/6: status-aware technical-requirement source authority.
//
// The prior flat SOURCE_PRECEDENCE table (technical-requirement-engine.mjs)
// cannot express "Approved IFC Drawing outranks Specification, but Tender/
// Reference Drawing ranks below BOQ" -- both are sourceType "Drawing". This
// resolver replaces a single numeric lookup with a named, ordered tier list
// plus a per-entry rule for Drawing sources that inspects the embedded
// drawingStatus (Section 5's own text: "a governed authority resolver, not
// another brittle numeric constant").
//
// Tier ordering, highest authority first. The engineer's source document
// lists these six named concepts as a numbered enumeration ("1. Approved/
// IFC Drawings ... 6. Tender/Reference Drawings"), but this Stage 1 brief's
// own required test matrix (Section 10) is unambiguous that a Formal Client
// Clarification must outrank an Approved IFC Drawing -- which the numbered
// list's literal ordinal position does not, on its own, make clear. This
// tier order is the one interpretation that satisfies every explicit test
// in Section 10 simultaneously (see the Stage 1 report's "remaining
// ambiguity" section): a client's own explicit written word (Clarification,
// then Approved RFI Response/Technical Bulletin) sits above even an Approved
// drawing, which in turn sits above Specification, BOQ, and finally any
// not-yet-approved drawing. This should be confirmed with the engineer
// rather than assumed correct.
export const AUTHORITY_TIERS = Object.freeze([
  "FORMAL_CLIENT_CLARIFICATION",
  "APPROVED_RFI_OR_TECHNICAL_BULLETIN",
  "APPROVED_DRAWING",
  "SPECIFICATION",
  "BOQ",
  "UNAPPROVED_OR_REFERENCE_DRAWING",
  "APPROVED_VENDOR_LIST",
  "MANUFACTURER",
  "PREVIOUS_PROJECT",
  "ORGANIZATION_RULE",
  "AI_INFERENCE",
]);

const TIER_WEIGHT = { FORMAL_CLIENT_CLARIFICATION: 1000, APPROVED_RFI_OR_TECHNICAL_BULLETIN: 900, APPROVED_DRAWING: 800, SPECIFICATION: 700, BOQ: 600, UNAPPROVED_OR_REFERENCE_DRAWING: 500, APPROVED_VENDOR_LIST: 350, MANUFACTURER: 300, PREVIOUS_PROJECT: 200, ORGANIZATION_RULE: 150, AI_INFERENCE: 50 };

// Sub-ordering WITHIN the "not an Approved drawing" bucket, per Rule 2's own
// trust ordering (Medium-High > Medium > Low-Medium > Low), with UNKNOWN
// lowest of all so an unrecognized status never outranks a genuinely
// classified low-trust drawing.
const REFERENCE_DRAWING_SUB_WEIGHT = { UNAPPROVED_IFC: 20, TENDER_REFERENCE: 15, DESIGN_DEVELOPMENT: 10, CONCEPT: 5, UNKNOWN: 0 };

// Section 6: sourceType names this policy recognizes but that have no real
// producer in this codebase today. Recognizing the name lets the resolver
// rank them correctly IF they are ever produced; it creates no fake data
// path -- nothing in this codebase sets these sourceType values today.
export const SOURCE_TYPE_PRODUCTION_STATUS = {
  "Formal Client Clarification": "NOT_YET_PRODUCED",
  "Approved Clarification": "NOT_YET_PRODUCED", // legacy/original name for the same concept
  "Approved RFI Response": "NOT_YET_PRODUCED",
  "Technical Bulletin": "NOT_YET_PRODUCED",
  Addendum: "NOT_YET_PRODUCED", // legacy name, previously aliased to this tier
  Specification: "SUPPORTED_BY_POLICY",
  Drawing: "SUPPORTED_BY_POLICY",
  BOQ: "SUPPORTED_BY_POLICY",
  "Approved Vendor List": "SUPPORTED_BY_POLICY",
  Manufacturer: "SUPPORTED_BY_POLICY",
  "Previous Project": "SUPPORTED_BY_POLICY",
  "Organization Rule": "SUPPORTED_BY_POLICY",
  "AI Inference": "SUPPORTED_BY_POLICY",
};

const NON_DRAWING_SOURCE_TIER = {
  "Formal Client Clarification": "FORMAL_CLIENT_CLARIFICATION",
  "Approved Clarification": "FORMAL_CLIENT_CLARIFICATION",
  "Approved RFI Response": "APPROVED_RFI_OR_TECHNICAL_BULLETIN",
  "Technical Bulletin": "APPROVED_RFI_OR_TECHNICAL_BULLETIN",
  Addendum: "APPROVED_RFI_OR_TECHNICAL_BULLETIN",
  Specification: "SPECIFICATION",
  BOQ: "BOQ",
  "Approved Vendor List": "APPROVED_VENDOR_LIST",
  Manufacturer: "MANUFACTURER",
  "Previous Project": "PREVIOUS_PROJECT",
  "Organization Rule": "ORGANIZATION_RULE",
  "AI Inference": "AI_INFERENCE",
};

// Given one technical-requirement source entry (the same shape
// consolidateRequirements already groups -- {sourceType, source, ...}),
// return its named authority tier, numeric sort weight (higher = governs),
// and whether this source type is actually produced by real code today.
// A Drawing entry's rank depends on entry.source.drawingStatus, which the
// caller (worker/technical-requirement-api.mjs, via
// drawing-requirement-evidence-engine.mjs) is responsible for populating
// from the real document_versions.drawing_status column -- this stays a
// pure function and never queries that column itself.
export const resolveSourceAuthorityRank = (entry) => {
  const sourceType = entry?.sourceType || "";
  if (sourceType === "Drawing") {
    const rawStatus = entry?.source?.drawingStatus;
    const status = DRAWING_STATUSES.includes(rawStatus) ? rawStatus : "UNKNOWN";
    if (status === "APPROVED_IFC_AFC") return { tier: "APPROVED_DRAWING", weight: TIER_WEIGHT.APPROVED_DRAWING, producedStatus: "SUPPORTED_BY_POLICY", drawingStatus: status };
    return { tier: "UNAPPROVED_OR_REFERENCE_DRAWING", weight: TIER_WEIGHT.UNAPPROVED_OR_REFERENCE_DRAWING + (REFERENCE_DRAWING_SUB_WEIGHT[status] ?? 0), producedStatus: "SUPPORTED_BY_POLICY", drawingStatus: status };
  }
  const tier = NON_DRAWING_SOURCE_TIER[sourceType] || null;
  if (!tier) return { tier: null, weight: 0, producedStatus: "UNKNOWN_SOURCE_TYPE", drawingStatus: null };
  return { tier, weight: TIER_WEIGHT[tier], producedStatus: SOURCE_TYPE_PRODUCTION_STATUS[sourceType] || "UNKNOWN_SOURCE_TYPE", drawingStatus: null };
};

// The function form consolidateRequirements/buildTechnicalRequirementProfile
// accept as their precedence argument -- see technical-requirement-engine.mjs.
export const statusAwareSourceAuthority = (entry) => resolveSourceAuthorityRank(entry).weight;
