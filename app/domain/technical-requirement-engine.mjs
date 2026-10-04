import { normalizeMeasurement, resolveScopedFacts } from "./engineering-knowledge.mjs";
import { buildRequirementIntelligence, REQUIREMENT_INTELLIGENCE_VERSION } from "./requirement-intelligence-engine.mjs";
import { requiresDetectorBase, requiresPanelCompatibility } from "./system-knowledge-registry.mjs";
import { normalizeStage4DrawingArchitectureContext } from "./stage4-drawing-architecture-context.mjs";
import { statusAwareSourceAuthority } from "./drawing-authority-policy.mjs";
import { classifyFireAlarmSlcItem, SLC_RESOURCE_CLASSIFIER_VERSION } from "./fire-alarm-slc-resource-classifier.mjs";

// Source Fact Authority Slice 3 -- maps an Active engineering_facts row
// (worker/spec-source-fact-promotion.mjs's fact_type="Source Fact" store)
// into this profile's own technicalFacts shape. Deliberately does NOT
// include a human-readable label (SOURCE_FACT_PREDICATE_LABELS lives in the
// worker/UI layer only -- domain semantics stay label-free) and deliberately
// does NOT become a requirement/applicability entry of any kind.
const toTechnicalFact = (fact) => ({
  factId: fact.factId, predicate: fact.predicate, value: fact.value, unit: fact.unit ?? null,
  confidence: fact.confidence, scopeType: fact.scopeType, scopeId: fact.scopeId,
  factType: fact.factType || "Source Fact", status: fact.status || "Active",
  provenance: Array.isArray(fact.provenance) ? fact.provenance : [],
  modelVersion: fact.modelVersion || null,
});

export const REQUIREMENT_ENGINE_VERSION = "technical-requirement-engine-1.2.0";
// Source Fact Authority Slice 3 -- bumped because buildTechnicalRequirementProfile
// now consumes Active Source Facts (technicalFacts output, plus honest
// standards/compatibility enrichment and conflict surfacing) where it
// previously ignored them entirely. executeRequirementProfile's own
// idempotency check compares only input_fingerprint, which folds in this
// version string precisely so a profile cached before this change is never
// silently trusted as still reflecting current Source Fact evidence.
// Sprint 1.14 -- bumped because detectMissingInformation's compatibilityTarget
// blocking rule changed (per-family now, not blanket for every Fire Alarm
// item). executeRequirementProfile's own idempotency check compares only
// input_fingerprint (boqItem+links+requirements+facts+relationships+this
// ruleset version), which does not otherwise change when the CODE's
// interpretation of unchanged input data changes -- a cached profile from
// before this fix would silently keep reporting the stale readiness
// forever without this bump forcing recomputation.
// Fire Alarm E2E fix (family-aware derived detector-base requirement) --
// bumped because generateDerivedRequirements' detector-base derivation
// changed (family/evidence-aware instead of a bare "detector" text match --
// see fireAlarmRequiresDetectorBase). executeRequirementProfile's own
// idempotency check compares only input_fingerprint (which folds in this
// version string), not the CODE'S interpretation of otherwise-unchanged
// input data -- a cached profile from before this fix would otherwise keep
// reporting the old, over-broad derived requirement forever. Matches the
// same reasoning as the prior Sprint 1.14 bump of this same constant.
// Stage 9 (2026-09-01) -- bumped because worker/technical-requirement-api.mjs
// now folds governed Drawing-sourced requirement entries into the same
// requirements/links arrays that feed this fingerprint (see
// loadDrawingEvidenceGroups + buildDrawingRequirementEntries). A profile
// cached before this change never considered drawing evidence at all; this
// bump forces every existing cached profile to recompute on next generation
// so a real governed drawing link is not silently ignored forever.
// OPERATIONAL POLICY FOUNDATION Stage 1 (2026-09-02) -- bumped because the
// DEFAULT governing-source selection changed from the flat, status-blind
// SOURCE_PRECEDENCE table to statusAwareSourceAuthority (see
// drawing-authority-policy.mjs), which can rank a Drawing source
// differently depending on its drawingStatus. A profile cached before this
// change picked its governingSourceId under the old flat rule; this bump
// forces every existing cached profile to recompute so that change is never
// silently missed.
// R11 safety repair: the panel-compatibility gate now fails CLOSED when the
// product family is present but not a governed taxonomy family, so an
// unreviewed raw BOQ-extractor noun can no longer grant a compatibility
// exemption. This changes readiness semantics for such items, so the ruleset
// version is bumped to force every existing profile to recompute (it is part of
// the profile input fingerprint in worker/technical-requirement-api.mjs).
export const REQUIREMENT_RULESET_VERSION = "requirement-rules-2026-09-27-fail-closed-panel-compat";
export const REQUIREMENT_MODEL_VERSION = "deterministic-applicability-1.1.0";

// ---------------------------------------------------------------------------
// RESOURCE CLASSIFICATION AUTHORITY -- RULE VERSION.
//
// This is the version that owns RESOURCE POLICY, and it is deliberately a
// separate constant from REQUIREMENT_RULESET_VERSION. That ruleset governs
// requirement derivation (applicability, readiness, conflicts); it does not
// describe how a device becomes DETECTOR / MODULE / NOT_SLC, nor how many
// addresses a device consumes.
//
// It is the single owner of the four outputs below, and it is the value that
// MUST appear in the address-demand fingerprint and currentness:
//
//   resourcePool                    <- classifyFireAlarmSlcItem (canonical)
//   addressesPerUnit                <- classifyFireAlarmSlcItem (canonical)
//   directSlcAddressState           <- derived from resourcePool
//   secondaryInterfaceDemandState   <- secondary interface policy
//
// WHY IT IS NOT TAKEN FROM THE DRAWING QUANTITY AUTHORITY: the Drawing
// Quantity Authority owns device COUNTS. It carries no resource-classification
// policy and no resource rule version, so reading a resource rule version from
// it yields a constant that can never invalidate. A resource-rule change must
// invalidate on ITS OWN authority, otherwise a cached address demand silently
// survives the very policy change meant to govern it.
//
// BUMP THIS WHENEVER the family maps, the addresses-per-unit map, or the
// direct/secondary split policy change. It is deliberately NOT folded into
// REQUIREMENT_RULESET_VERSION so a resource-policy change is visible as such.
// WHY IT FOLDS IN THE SHARED CLASSIFIER VERSION. The ONE executable policy is
// `classifyFireAlarmSlcItem` in app/domain/fire-alarm-slc-resource-classifier.mjs,
// and that module carries its own version. A policy change there must invalidate
// here as well, or a cached profile and a cached address demand would both keep
// reporting CURRENT across a change to the rule that produced them.
export const RESOURCE_CLASSIFICATION_RULESET_VERSION = `slc-resource-classification-1.1.0+${SLC_RESOURCE_CLASSIFIER_VERSION}`;
export const APPLICABILITY_STATUSES = ["Confirmed Applicable", "Suggested Applicable", "Conditionally Applicable", "Not Applicable", "Rejected", "Needs Review", "Unknown", "Superseded"];
export const READINESS_STATUSES = ["Ready for Matching", "Ready with Warnings", "Needs Technical Review", "Missing Critical Information", "Conflict Blocking", "Classification Required", "Not Applicable", "Rejected"];
// Legacy flat precedence table -- kept unchanged for any caller that still
// passes an explicit {sourceType: rank} object into consolidateRequirements/
// buildTechnicalRequirementProfile. It cannot express status-aware Drawing
// ranking (an Approved IFC drawing and a Tender/Reference drawing are both
// sourceType "Drawing"), which is exactly why it is no longer the DEFAULT --
// see statusAwareSourceAuthority (drawing-authority-policy.mjs, OPERATIONAL
// POLICY FOUNDATION Stage 1) below.
export const SOURCE_PRECEDENCE = { "Approved Clarification": 100, Addendum: 95, Specification: 90, Drawing: 80, BOQ: 70, "Approved Vendor List": 65, Manufacturer: 55, "Previous Project": 35, "Organization Rule": 30, "AI Inference": 10 };

const text = (value) => String(value ?? "").trim();
const normalized = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))));
const mean = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
const keyOf = (requirement) => `${requirement.requirementCategory || requirement.category || "Other"}|${requirement.attributeName || normalized(requirement.normalizedRequirement || requirement.originalText)}`;

// Fire Alarm E2E fix (requirement applicability) -- real Central Kitchen -
// Makkah gap: "the entire fire detection system shall be analogue
// addressable type" is genuinely system-wide (it governs every device in
// the system, not one specific family), but the existing engineer-driven
// propagation path (worker/engineering-knowledge-api.mjs's
// /propagate-system-wide) requires the reviewer to hand-enumerate every
// governed category it applies to -- reasonable for a requirement that
// genuinely only concerns a few named categories, but a real, silent gap
// for wording that already states its own system-wide scope: nobody had
// reason to type out every Fire Alarm category by hand, so the requirement
// never reached Beam Detector, or any other family, at all.
//
// This is a narrow, structural, system-agnostic detector for that one
// wording shape -- "entire ... system" -- never a semantic judgement about
// WHICH categories are affected (that stays a human, governed decision
// downstream). It only ever WIDENS what a reviewer may explicitly opt into
// for an already-Approved requirement -- it never itself creates a link,
// confirms anything, or infers scope for a requirement that does not use
// this wording (a family-specific clause like "heat detector heads shall
// be..." never matches, so it still requires the existing explicit
// per-category selection, unchanged).
const SYSTEM_WIDE_REQUIREMENT_PATTERN = /\bentire\s+(?:\w+\s+){0,4}system\b/i;
export const isSystemWideRequirementText = (value) => SYSTEM_WIDE_REQUIREMENT_PATTERN.test(String(value || ""));

// ALL-COMPONENT SCOPE  ("Every/All/Each component of [SYSTEM] shall ...")
//
// WHY THIS IS A DIFFERENT SCOPE FROM `isSystemWideRequirementText` ABOVE, AND WHY
// IT NEEDS ITS OWN RECOGNISER.
//
// `isSystemWideRequirementText` recognises ONE wording family: a demand asserted
// of the SYSTEM AS A WHOLE ("the entire fire detection system shall be analogue
// addressable"). `SYSTEM_WIDE_REQUIREMENT_PATTERN` requires the literal word
// "entire", so it correctly refuses anything else.
//
// A real Al Mousa clause (28 46 00 / 1 GENERAL / P, sequence 100075) asserts
// something categorically different:
//
//   "Every component of the fire alarm system shall be listed under a single
//    manufacturer, approved by Underwriters Laboratories (UL), and clearly bear
//    the UL certification."
//
// The PREDICATE ("shall be listed ... approved by UL") is asserted of each
// COMPONENT, never of the system as an integrated whole. So this is not a
// system-wide requirement that the existing recogniser was too narrow to see; it
// is a different semantic class. Classifying it as system-wide would overstate
// it -- a genuine system-wide demand can legitimately bear on non-product scope
// (commissioning, installation, training), whereas "every COMPONENT" is by its
// own subject a demand about PRODUCT EQUIPMENT and nothing else. That
// distinction is the whole reason this is a separate recogniser rather than a
// widened one.
//
// THE GAP THIS CLOSES, MEASURED. `buildLinkShortlist` reaches every applicability
// candidate only through `scoreRequirementLink`, which is an EQUIPMENT-TYPE and
// technical-term heuristic. A universal-component compliance clause names no
// equipment type at all, so it scored 8 on the panel BOQ row (system +8,
// "Equipment type unresolved" +0) against a threshold of 15, and could never be
// proposed for applicability. Every distinctive term of the panel's description
// ("alarm", "control", "panel") is in `genericLinkTerms`, so the technical-term
// signal is filtered out too. The clause was real, applicable, and unreachable.
//
// WHAT IS DELIBERATELY NOT DONE HERE. The threshold is untouched.
// `genericLinkTerms` is untouched. "panel"/"alarm"/"control" are NOT made
// distinctive. `scoreRequirementLink` is untouched. There is no per-requirement
// or per-item special case: the recogniser is a property of the CLAUSE'S OWN
// TEXT, so any "Every/All/Each <component-word> of the <named system> shall/must"
// clause is handled identically.
//
// SAFEGUARDS, EACH ONE A SEPARATE REFUSAL SO A REPORT CAN NAME THE FAILURE:
//   * UNIVERSAL QUANTIFIER required -- "every", "all", "each". "Some" is not one.
//   * COMPONENT SUBJECT required -- the demand must be about components/
//     equipment/units/devices/elements/products, not about a person, a service,
//     or the system as a whole.
//   * OBLIGATION MODAL required -- "shall" or "must".
//   * SYSTEM IDENTITY required AND EXACT -- the clause must name a system, and
//     that identity must equal the BOQ row's own governed `system_value` after
//     normalisation. This is what makes cross-system propagation impossible:
//     a Fire Alarm clause can never reach a CCTV or Access Control row, because
//     their system identities differ.
//   * PARTIAL-SCOPE HEDGES VETO -- "where indicated", "as applicable", "some",
//     "if used", "optional" and friends REFUSE the universal reading outright.
//     A clause that limits itself to part of the system is not a universal
//     component demand, and treating it as one would be exactly the over-broad
//     propagation this must not cause.
//   * PER-SENTENCE, NEVER CROSS-SENTENCE -- every condition must hold WITHIN ONE
//     SENTENCE. The real clause P has three sentences (100074 networking, 100075
//     listing, 100076 "All control equipment must be certified accordingly"); a
//     quantifier in one sentence and a system identity in another must never be
//     combined into a scope that the specification never stated.
//   * DISAGREEMENT FAILS CLOSED -- if two sentences assert universal component
//     scope over DIFFERENT systems, the result is ambiguous and yields no scope.
//   * PURE TEXT CLASSIFICATION -- this function decides TEXT SHAPE only. It
//     creates no link, confirms nothing, and grants no authority: the caller
//     still only ever produces a `Suggested` row that a human must confirm.
export const ALL_COMPONENTS_REQUIREMENT_SCOPE = "ALL_COMPONENTS";

const UNIVERSAL_QUANTIFIER = /\b(?:every|all|each)\b/i;
const COMPONENT_SUBJECT = /\b(?:components?|equipment|units?|devices?|elements?|products?|goods)\b/i;
const OBLIGATION_MODAL = /\b(?:shall|must)\b/i;
// A hedge or partial-scope qualifier REFUTES the universal reading. Listed first
// and checked first so a hedged clause can never be rescued by another sentence.
const PARTIAL_SCOPE_HEDGE = /\b(?:where\s+(?:indicated|specified|shown|applicable|required|used|stated)|some\s+(?:components?|equipment|units?|devices?|elements?|products?)|as\s+(?:applicable|required|specified)|if\s+(?:used|applicable|required|specified)|where\s+used|optional|optionally|nominated|selected\s+by|prefer(?:red|ably)?)\b/i;
// The named system identity: a DETERMINER, then the system name, then the literal
// word "system". Captures "fire alarm" from "the fire alarm system".
//
// The determiner is required and is what keeps the system name clean. An earlier
// draft also allowed a quantifier here ("every|all|each"), which in the real
// clause matched the quantifier that governs the COMPONENT subject instead --
// "Every component of the fire alarm system" -- and captured
// "component of the fire alarm". That is not a system identity at all; it is the
// subject noun plus the connector. Anchoring on the article is both simpler and
// the only reading under which the capture is a governed system name.
const NAMED_SYSTEM_PHRASE = /\b(?:the|entire|whole)\s+([a-z][a-z0-9]*(?:[\s-][a-z0-9]+){0,4}?)\s+system\b/i;

/**
 * Canonical comparison key for a governed system identity: lowercase, single
 * spaces, alphanumeric only. "Fire Alarm" and "the fire alarm" therefore agree,
 * while "Fire" and "Fire Alarm" do not -- which is what keeps an exact-identity
 * check exact.
 */
export const systemIdentityKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Classify a requirement's OWN text as an all-component obligation over a named
 * governed system.
 *
 * @returns {{scope: string|null, systemKey: string|null, reason: string}}
 *   `scope` is ALL_COMPONENTS_REQUIREMENT_SCOPE or null. `reason` always names
 *   the refusal so a reviewer can see exactly which safeguard withheld a scope.
 */
export const classifyAllComponentsScope = (value) => {
  const text = String(value || "").trim();
  if (!text) return { scope: null, systemKey: null, reason: "EMPTY_TEXT" };
  if (PARTIAL_SCOPE_HEDGE.test(text)) return { scope: null, systemKey: null, reason: "REFUSED_PARTIAL_OR_HEDGED_SCOPE" };
  const sentences = text.split(/(?<=[.;:])\s+/).map((entry) => entry.trim()).filter(Boolean);
  const matched = [];
  let sawQuantifier = false;
  let sawSubject = false;
  let sawModal = false;
  let sawSystem = false;
  for (const sentence of sentences) {
    const quantifier = UNIVERSAL_QUANTIFIER.test(sentence);
    const subject = COMPONENT_SUBJECT.test(sentence);
    const modal = OBLIGATION_MODAL.test(sentence);
    const systemMatch = sentence.match(NAMED_SYSTEM_PHRASE);
    sawQuantifier ||= quantifier;
    sawSubject ||= subject;
    sawModal ||= modal;
    sawSystem ||= Boolean(systemMatch);
    // Every condition must hold in THIS sentence. Combining a quantifier from one
    // sentence with a system identity from another would invent a scope.
    if (!(quantifier && subject && modal && systemMatch)) continue;
    const systemKey = systemIdentityKey(systemMatch[1]);
    if (systemKey) matched.push(systemKey);
  }
  if (!matched.length) {
    // Report the FIRST missing safeguard, in the order they are defined, so the
    // reason is the most specific available rather than a generic "no".
    if (!sawQuantifier) return { scope: null, systemKey: null, reason: "REFUSED_NO_UNIVERSAL_QUANTIFIER" };
    if (!sawSubject) return { scope: null, systemKey: null, reason: "REFUSED_NO_COMPONENT_SUBJECT" };
    if (!sawModal) return { scope: null, systemKey: null, reason: "REFUSED_NO_OBLIGATION_MODAL" };
    if (!sawSystem) return { scope: null, systemKey: null, reason: "REFUSED_NO_NAMED_SYSTEM_IDENTITY" };
    return { scope: null, systemKey: null, reason: "REFUSED_CONDITIONS_SPLIT_ACROSS_SENTENCES" };
  }
  const distinct = [...new Set(matched)];
  if (distinct.length > 1) return { scope: null, systemKey: null, reason: "REFUSED_CONFLICTING_SYSTEM_IDENTITIES" };
  return { scope: ALL_COMPONENTS_REQUIREMENT_SCOPE, systemKey: distinct[0], reason: "UNIVERSAL_COMPONENT_OBLIGATION_OVER_NAMED_SYSTEM" };
};

/**
 * True only when the requirement's own text is an all-component obligation over
 * EXACTLY the system the BOQ row belongs to. Any other system identity, and any
 * hedged or partial-scope clause, is false -- which is what prevents cross-system
 * and over-broad propagation.
 */
export const isAllComponentsScopeForSystem = (requirementText, boqSystemValue) => {
  const itemKey = systemIdentityKey(boqSystemValue);
  if (!itemKey) return false;
  const classified = classifyAllComponentsScope(requirementText);
  return classified.scope === ALL_COMPONENTS_REQUIREMENT_SCOPE && classified.systemKey === itemKey;
};

// Fire Alarm E2E fix (requirement applicability, follow-up) -- real Central
// Kitchen - Makkah gap: propagating "the entire fire detection system shall
// be analogue addressable type" to every governed category (via
// isSystemWideRequirementText above) correctly reached Beam Detector, but
// also reached Notification Devices (Sounder/Strobe/Flasher) -- and every
// single Notification Devices product in the catalog lacks any recorded
// `addressing` value, so the requirement blocked every candidate in that
// category outright. Notification appliances are wired on a conventional
// Notification Appliance Circuit even in a fully addressable/analog Fire
// Alarm system; they are never individually addressed the way an SLC-loop
// initiating/detection device is -- exactly the same real distinction
// system-knowledge-registry.mjs's requiresPanelCompatibility already
// encodes (Detection Devices / Manual Initiation / Modules and Interfaces /
// Control Equipment are addressable-loop, panel-protocol-locked categories;
// Notification Devices, Power and Batteries and Accessories are not). This
// reuses that same existing, already-governed classification -- it adds no
// new taxonomy and names no specific family -- to recognize when a
// system-wide requirement's OWN structured attributes concern addressable-
// loop participation, so allSystemCategories can be narrowed to the
// categories where that concept genuinely applies, the same way an
// explicit, hand-picked categories list already would be.
const LOOP_PARTICIPATION_ATTRIBUTES = new Set(["addressing", "protocol", "compatible_panel_family", "loop_compatibility"]);
export const requirementConstrainsLoopParticipation = (attributeNames) => (Array.isArray(attributeNames) ? attributeNames : []).some((name) => LOOP_PARTICIPATION_ATTRIBUTES.has(String(name || "").trim()));
export const loopParticipationCategories = (system, categories) => (Array.isArray(categories) ? categories : []).filter((category) => requiresPanelCompatibility(system, category, null));

export const requirementPriority = (requirement) => {
  if (requirement.ambiguities?.length) return "Clarification Required";
  if (requirement.requirementType === "Prohibited") return "Prohibited";
  if (requirement.factType === "Derived Fact") return "Derived";
  if (requirement.factType === "Assumption") return "Assumed";
  if (requirement.requirementType === "Conditional") return "Conditional Mandatory";
  if (requirement.requirementType === "Preferred") return "Preferred";
  if (requirement.requirementType === "Optional") return "Optional";
  if (requirement.requirementType === "Mandatory" && (requirement.safetyCritical || ["Voltage", "Compatibility", "Standards", "Capacity"].includes(requirement.requirementCategory))) return "Critical Mandatory";
  return requirement.requirementType === "Mandatory" ? "Mandatory" : "Informational";
};

export const resolveApplicability = ({ boqItem, link, requirement }) => {
  if (link?.status === "Confirmed") return { status: "Confirmed Applicable", method: "Human-confirmed knowledge link", confidence: 100, evidence: link.evidence || [], reviewStatus: "Confirmed" };
  if (["Rejected", "Removed"].includes(link?.status)) return { status: "Rejected", method: "Human review", confidence: 100, evidence: link.evidence || [], reviewStatus: "Reviewed" };
  let confidence = Number(link?.confidence || 0); const evidence = [...(link?.evidence || [])];
  if (boqItem.system && requirement.system && boqItem.system === requirement.system) { confidence += 20; evidence.push("System matches"); }
  if (boqItem.category && requirement.category && boqItem.category === requirement.category) { confidence += 20; evidence.push("Category matches"); }
  if (boqItem.specificationReference && requirement.source?.clausePath?.join(" ").includes(boqItem.specificationReference)) { confidence += 30; evidence.push("Explicit specification reference"); }
  confidence = clamp(confidence);
  const conditional = requirement.requirementType === "Conditional" || Boolean(requirement.condition);
  return { status: conditional ? "Conditionally Applicable" : confidence >= 70 ? "Suggested Applicable" : confidence >= 40 ? "Needs Review" : "Unknown", method: link?.linkMethod || "Deterministic structured signals", confidence, evidence: [...new Set(evidence)], reviewStatus: "Needs Review" };
};

// precedence may be either a flat {sourceType: rank} object (legacy,
// status-blind -- e.g. SOURCE_PRECEDENCE) or a function(entry) => rank
// (the new default, statusAwareSourceAuthority, which can also look at
// entry.source.drawingStatus for a Drawing entry). Accepting both keeps
// every existing explicit-object caller/test working unchanged.
const rankOf = (entry, precedence) => (typeof precedence === "function" ? Number(precedence(entry) || 0) : Number(precedence[entry.sourceType] || 0));
export const consolidateRequirements = (requirements, precedence = statusAwareSourceAuthority) => {
  const groups = new Map();
  for (const requirement of requirements) { const key = keyOf(requirement); const current = groups.get(key) || []; current.push(requirement); groups.set(key, current); }
  return [...groups.entries()].map(([key, sources]) => { const ordered = [...sources].sort((left, right) => rankOf(right, precedence) - rankOf(left, precedence)); const governing = ordered[0]; return { id: `consolidated:${key}`, key, normalizedRequirement: governing.normalizedRequirement || governing.originalText, requirementCategory: governing.requirementCategory || governing.category, requirementType: governing.requirementType, priority: requirementPriority(governing), governingSourceId: governing.id, sources: ordered.map((entry) => ({ requirementId: entry.id, sourceType: entry.sourceType, source: entry.source, confidence: entry.confidence })), attributes: ordered.flatMap((entry) => entry.attributes || []), // Approved, governed canonical capability claims (requirement_intelligence_facts of the form
// "Capability: <key>"), carried alongside attributes so product-matching-engine.mjs can give a
// qualitative capability requirement ONE machine-comparable dimension instead of reporting it
// as unstructured missing evidence. Aggregated from every source in the group exactly like
// attributes/standards, and never derived here.
capabilities: ordered.flatMap((entry) => entry.capabilities || []), // Approved, governed LISTING AUTHORITY claims (requirement_intelligence_facts of fact type
// "Listing Authority", value `{ authority, required }`). A project requirement to be UL LISTED
// names an authority and no number, so it is a structured dimension in its own right: carried
// alongside attributes/capabilities so product-matching-engine.mjs can evaluate it against the
// product's governed certification evidence. Deliberately SEPARATE from `standards`, because a
// numbered standard is satisfied only by that exact number and an unnumbered one is correctly
// refused as unfalsifiable; collapsing the two would either fabricate a number or manufacture a
// false failure. Aggregated from every source in the group, never derived here.
listingRequirements: ordered.flatMap((entry) => entry.listingRequirements || []), standards: ordered.flatMap((entry) => entry.standards || []), manufacturers: ordered.flatMap((entry) => entry.manufacturers || []), compatibility: ordered.flatMap((entry) => entry.compatibility || []), accessories: ordered.flatMap((entry) => entry.accessories || []), confidence: mean(ordered.map((entry) => entry.confidence)) }; });
};

// detectRequirementConflicts only compares attributes WITHIN one consolidated
// group (one governing requirement text). Approved facts promoted from
// different specification clauses/requirements for the same BOQ item land in
// different groups, so a same-name/different-value collision across sources
// must be caught separately -- never silently resolved by picking one.
export const detectAttributeValueConflicts = (consolidated) => {
  const byName = new Map();
  for (const group of consolidated) for (const attribute of group.attributes) { const list = byName.get(attribute.name) || []; list.push({ attribute, groupId: group.id }); byName.set(attribute.name, list); }
  const conflicts = [];
  for (const [name, entries] of byName) {
    if (new Set(entries.map((entry) => entry.groupId)).size < 2) continue;
    const distinctValues = new Map();
    for (const entry of entries) { const key = JSON.stringify(entry.attribute.normalizedValue); if (!distinctValues.has(key)) distinctValues.set(key, entry.attribute); }
    if (distinctValues.size < 2) continue;
    const values = [...distinctValues.values()];
    conflicts.push({ id: `attribute-conflict:${name}`, type: "Cross-Requirement Attribute Conflict", requirementId: null, attribute: name, values: values.map((attribute) => ({ value: attribute.normalizedValue, unit: attribute.normalizedUnit, source: attribute.source })), severity: "High", technicalImpact: `${name} has conflicting approved values from different specification sources; it cannot be used to discriminate products until the governing source is confirmed.`, commercialImpact: "Product scope or supplier price may change.", blocking: true, recommendedAction: "Review the conflicting sources and record which requirement governs.", resolutionStatus: "Open" });
  }
  return conflicts;
};

export const detectRequirementConflicts = (consolidated) => {
  const conflicts = [];
  for (const group of consolidated) {
    const byName = new Map();
    for (const attribute of group.attributes) { const list = byName.get(attribute.name) || []; list.push(attribute); byName.set(attribute.name, list); }
    for (const [name, attributes] of byName) { const values = [...new Set(attributes.map((attribute) => JSON.stringify(attribute.normalizedValue)))]; if (values.length < 2) continue; const critical = ["Voltage", "Capacity"].includes(name); conflicts.push({ id: `conflict:${group.id}:${name}`, type: "Required Value Conflict", requirementId: group.id, attribute: name, values: attributes.map((attribute) => ({ value: attribute.normalizedValue, unit: attribute.normalizedUnit, source: attribute.source })), severity: critical ? "Critical" : "High", technicalImpact: `${name} cannot be used safely for product matching until the governing source is confirmed.`, commercialImpact: "Product scope or supplier price may change.", blocking: true, recommendedAction: "Review source precedence and obtain an approved clarification.", resolutionStatus: "Open" }); }
  }
  return conflicts;
};

const categoryMinimums = { "Fire Alarm": ["system", "category", "description", "unit", "quantity", "productFamily", "standard", "compatibilityTarget"], CCTV: ["system", "category", "description", "unit", "quantity", "productFamily", "ipRating", "voltage"], UPS: ["system", "category", "description", "unit", "quantity", "productFamily", "power", "runtime"] };
// Sprint 1.14 -- compatibilityTarget was blocking for every Fire Alarm item
// uniformly, regardless of family -- see fire-alarm-taxonomy.mjs's
// fireAlarmRequiresPanelCompatibility for the real manufacturer/system-
// selection reasoning (addressable-loop devices are panel-protocol-locked;
// conventional notification appliances generally are not). Its absence is
// still reported for every Fire Alarm item (it remains useful context), but
// it only BLOCKS readiness for a family where the system pack says panel/
// loop compatibility is a genuine selection constraint. A system with no
// registered pack, or one with no opinion, keeps the prior behavior exactly
// (blocking, via the static list) rather than silently becoming lenient.
const blockingFields = (boqItem, field) => {
  if (field !== "compatibilityTarget") return ["system", "category", "description", "productFamily"].includes(field);
  return requiresPanelCompatibility(boqItem.system, boqItem.category, boqItem.productFamily);
};
export const detectMissingInformation = ({ boqItem, consolidated, standards, compatibility }) => {
  const system = boqItem.system || "Unknown"; const fields = categoryMinimums[system] || ["system", "category", "description", "unit", "quantity", "productFamily"];
  const context = { system: boqItem.system, category: boqItem.category, description: boqItem.description, unit: boqItem.unit, quantity: boqItem.quantity, productFamily: boqItem.productFamily, standard: standards.length ? true : null, compatibilityTarget: compatibility.some((item) => item.targetItem || item.rightEntityId) ? true : null, ipRating: consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "IP Rating")), voltage: consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "Voltage")), power: consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "Power")), runtime: consolidated.some((item) => item.attributes.some((attribute) => /runtime/i.test(attribute.name))) };
  return fields.filter((field) => context[field] === null || context[field] === undefined || context[field] === "" || context[field] === false).map((field) => ({ field, whyNeeded: `${field} is required to define a safe ${system} product search boundary.`, technicalImpact: "Compliance or compatibility cannot be evaluated deterministically.", commercialImpact: "Supplier scope and cost may vary.", blocking: blockingFields(boqItem, field), clarificationQuestion: `Please confirm the ${field.replace(/([A-Z])/g, " $1").toLowerCase()} for BOQ item ${boqItem.itemNumber || boqItem.id}, citing the governing document.`, recommendedOwner: field === "quantity" ? "Estimator" : "Technical Reviewer", status: "Open" }));
};

export const generateDerivedRequirements = ({ boqItem, consolidated }) => {
  const derived = [];
  // Fire Alarm E2E fix (family-aware derived detector-base requirement) --
  // real Central Kitchen - Makkah gap: this used to derive a mandatory
  // "compatible detector base" purely from the word "detector" appearing in
  // the BOQ description text, wrongly penalizing Beam Detector (a
  // bracket-mounted, line-of-sight optical device with no plug-in base --
  // see fire-alarm-taxonomy.mjs's fireAlarmRequiresDetectorBase for the real
  // catalog evidence this is grounded in). The requirement now derives only
  // when EITHER the item's own governed family is proven (by real Product
  // Library accessory evidence) to use base-mount architecture, OR a real,
  // confirmed project requirement for this specific item explicitly states
  // a base is needed regardless of family default -- an opt-in, evidence-led
  // check, never a text-only assumption. A family with no governed opinion
  // (an unregistered system, or a Fire Alarm family not in the proven list)
  // never gets this derived requirement by default.
  const familyRequiresBase = requiresDetectorBase(boqItem.system, boqItem.productFamily);
  const explicitProjectBaseEvidence = consolidated.some((item) => /\bbase\b/i.test(item.normalizedRequirement || ""));
  if ((familyRequiresBase || explicitProjectBaseEvidence) && !consolidated.some((item) => item.accessories.some((accessory) => /base/i.test(accessory.accessory)))) derived.push({ id: `derived:${boqItem.id}:detector-base`, statement: "A compatible detector base is required for each detector unless the approved product includes one.", ruleId: "accessory.detector-base", inputs: [{ boqItemId: boqItem.id, description: boqItem.description }], logic: familyRequiresBase ? "This detector family's governed product architecture uses a separate plug-in mounting base." : "A confirmed project requirement for this item explicitly states a compatible base is needed.", output: { accessory: "Compatible detector base", quantityRule: "One per detector" }, factType: "Derived Fact", confidence: 75, reviewStatus: "Needs Review" });
  if (/outdoor/i.test(boqItem.description || "") && !consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "IP Rating"))) derived.push({ id: `derived:${boqItem.id}:weather`, statement: "Outdoor equipment requires a project-confirmed environmental protection rating.", ruleId: "environment.outdoor-protection", inputs: [{ boqItemId: boqItem.id, environment: "Outdoor" }], logic: "Outdoor location requires measurable weather protection; no rating is invented.", output: { missingAttribute: "IP Rating" }, factType: "Derived Fact", confidence: 85, reviewStatus: "Needs Review" });
  return derived;
};

export const createAssumptions = (missing, boqItem) => missing.filter((item) => !item.blocking).map((item) => ({ id: `assumption:${boqItem.id}:${item.field}`, statement: `Proposed working assumption required for ${item.field}; no value has been selected.`, reason: item.whyNeeded, sourceGap: item.field, technicalRisk: item.technicalImpact, commercialRisk: item.commercialImpact, confidence: 0, approvalRequired: true, reviewCondition: "Expires when source evidence or an approved clarification is recorded.", status: "Proposed" }));

export const calculateReadiness = ({ boqItem, requirements, missing, conflicts, confidence }) => {
  if (!boqItem.system || !boqItem.category) return { status: "Classification Required", blockingReasons: ["System and category must be confirmed."], approved: false };
  if (conflicts.some((item) => item.blocking)) return { status: "Conflict Blocking", blockingReasons: conflicts.filter((item) => item.blocking).map((item) => item.technicalImpact), approved: false };
  if (missing.some((item) => item.blocking)) return { status: "Missing Critical Information", blockingReasons: missing.filter((item) => item.blocking).map((item) => item.whyNeeded), approved: false };
  if (!requirements.some((item) => ["Critical Mandatory", "Mandatory"].includes(item.priority))) return { status: "Needs Technical Review", blockingReasons: ["No confirmed mandatory technical baseline exists."], approved: false };
  if (confidence.overall < 80) return { status: "Ready with Warnings", blockingReasons: ["Requirement profile confidence is below 80%."], approved: false };
  return { status: "Ready for Matching", blockingReasons: [], approved: true, approvalRequired: false };
};

export const buildTechnicalRequirementProfile = ({ boqItem, links = [], requirements = [], knowledgeFacts = [], relationships = [], sourceFacts = [], sourceFactConflicts = [], projectPrecedence = statusAwareSourceAuthority, previousVersion = 0, drawingArchitectureContext = null, sourcePageTexts = null }) => {
  const applicable = requirements.map((requirement) => { const link = links.find((entry) => entry.requirementId === requirement.id); const applicability = resolveApplicability({ boqItem, link, requirement }); return { ...requirement, applicability, priority: requirementPriority(requirement) }; }).filter((requirement) => !["Rejected", "Not Applicable", "Unknown"].includes(requirement.applicability.status));
  const confirmed = applicable.filter((requirement) => requirement.applicability.status === "Confirmed Applicable"); const suggested = applicable.filter((requirement) => requirement.applicability.status !== "Confirmed Applicable");
  const intelligence = buildRequirementIntelligence(confirmed, sourcePageTexts);
  const requirementRelationships = relationships.filter((item) => {
    const scopeType = item.scopeType || item.scope_type || null;
    const scopeId = item.scopeId || item.scope_id || null;
    if (scopeType === "Product") return false;
    if (scopeType === "BOQ Item") return scopeId === boqItem.id;
    return scopeType === "Project" || scopeType === "Global" || !scopeType;
  });
  // Source Fact Authority Slice 3 -- reuses resolveScopedFacts (the SAME
  // precedence ladder engineering_facts already uses elsewhere, extended in
  // this slice to recognize "Product Family" scope) rather than a second,
  // independent scope algorithm. A real BOQ-Item-scoped fact (e.g. a future
  // per-row human decision) outranks a Product-Family default without
  // deleting it -- the family fact simply loses the natural-key slot when a
  // more specific one exists, exactly like every other scope type here.
  // A Source Fact currently named in an Open, blocking
  // engineering_knowledge_conflicts row is excluded from authoritative
  // consumption and surfaced as a profile conflict instead -- defense in
  // depth: Slice 2's own confirm gate already refuses to Activate a
  // conflicted fact, so this should normally never fire, but generation
  // must never silently trust a fact that becomes conflicted after the fact.
  const conflictedFactIds = new Set((sourceFactConflicts || []).map((entry) => entry.factId ?? entry.left_entity_id ?? entry.leftEntityId ?? entry.right_entity_id ?? entry.rightEntityId).filter(Boolean));
  const scopedSourceFacts = resolveScopedFacts(
    (sourceFacts || []).filter((fact) => (fact.factType || fact.fact_type) === "Source Fact" && (fact.status || "Active") === "Active"),
    { projectId: boqItem.projectId, boqItemId: boqItem.id, productFamily: boqItem.productFamily },
  );
  // Consumption precedence, not deletion: resolveScopedFacts already sorted
  // scopedSourceFacts most-specific-scope-first (BOQ Item ahead of Product
  // Family ahead of Project/Global), so keeping only the FIRST entry seen
  // per predicate here is exactly "the more specific scope wins" -- the
  // family-level fact is never deleted anywhere (it stays exactly as it
  // was in engineering_facts), it simply is not the one THIS profile
  // treats as authoritative once a more specific one exists.
  const seenPredicates = new Set();
  const authoritativeSourceFacts = scopedSourceFacts.filter((fact) => {
    if (conflictedFactIds.has(fact.factId)) return false;
    if (seenPredicates.has(fact.predicate)) return false;
    seenPredicates.add(fact.predicate);
    return true;
  });
  const conflictedSourceFacts = scopedSourceFacts.filter((fact) => conflictedFactIds.has(fact.factId));
  const technicalFacts = authoritativeSourceFacts.map(toTechnicalFact);
  const sourceFactConflictEntries = conflictedSourceFacts.map((fact) => ({ id: `source-fact-conflict:${fact.factId}`, type: "Source Fact Value Conflict", requirementId: null, attribute: fact.predicate, values: [{ value: fact.value, unit: fact.unit ?? null, source: "Source Fact" }], severity: "High", technicalImpact: `${fact.predicate} has an open, unresolved conflict between current project Specification sources; it cannot be used as authoritative technical evidence until the governing source is confirmed.`, commercialImpact: "Product scope or supplier price may change.", blocking: true, recommendedAction: "Review the conflicting Source Facts and confirm which one governs.", resolutionStatus: "Open" }));
  // Deterministic, semantically-honest cross-population only -- never a
  // fabricated match. applicable_standard genuinely IS a standard (the
  // existing "standard" missing-information gate is exactly
  // `standards.length ? true : null`, so this is a real satisfaction, not
  // an invented one). protocol_compatibility is added to the compatibility
  // EVIDENCE array for visibility, but deliberately carries neither
  // `targetItem` nor `rightEntityId` -- detectMissingInformation's
  // `compatibilityTarget` gate specifically requires one of those fields
  // (a named compatible PRODUCT/PANEL, not merely "supports this
  // protocol"), so a protocol Source Fact is visible evidence without
  // dishonestly claiming to resolve a gap it does not actually answer.
  const sourceFactStandards = authoritativeSourceFacts.filter((fact) => fact.predicate === "applicable_standard").map((fact) => ({ body: fact.value?.body ?? null, number: fact.value?.number ?? null, part: fact.value?.part ?? null, year: fact.value?.year ?? null, confidence: fact.confidence, source: "Source Fact", factId: fact.factId }));
  // severity/blocking/status are set explicitly (not left undefined) purely
  // so persistProfile's existing profile_issues writer (which folds
  // profile.compatibility into "Compatibility Requirement" issue rows)
  // records this evidence cleanly -- never a blocking issue of its own,
  // since it never overwrote or satisfied compatibilityTarget.
  const sourceFactCompatibility = authoritativeSourceFacts.filter((fact) => fact.predicate === "protocol_compatibility").map((fact) => ({ relationshipType: "Protocol Compatibility", value: fact.value, confidence: fact.confidence, source: "Source Fact", factId: fact.factId, severity: "Informational", blocking: false, status: "Evidence" }));
  const consolidated = consolidateRequirements(confirmed, projectPrecedence); const conflicts = [...detectRequirementConflicts(consolidated), ...detectAttributeValueConflicts(consolidated), ...sourceFactConflictEntries]; const standards = [...consolidated.flatMap((item) => item.standards), ...sourceFactStandards]; // Approved, governed listing-authority requirements (project demands an authority by NAME with no standard number). Kept as their own profile dimension, NOT folded into `standards`: they are evaluated against the product's governed certification evidence, and merging them would make a generic "UL Listed" look like a numbered standard citation. Deduplicated by authority so a group of equivalent requirements yields ONE comparison.
const listingRequirements = [...new Map(consolidated.flatMap((item) => (item.listingRequirements || []).map((claim) => [String(claim.authority || "").trim().toLowerCase(), claim])).values())]; const manufacturers = consolidated.flatMap((item) => item.manufacturers); const compatibility = [...consolidated.flatMap((item) => item.compatibility), ...requirementRelationships.filter((item) => /compatible|interface|protocol/i.test(item.relationshipType || "")), ...sourceFactCompatibility]; const accessories = [...consolidated.flatMap((item) => item.accessories), ...requirementRelationships.filter((item) => /requires|includes|mounted|installed/i.test(item.relationshipType || ""))]; const missing = detectMissingInformation({ boqItem, consolidated, standards, compatibility }); const derived = generateDerivedRequirements({ boqItem, consolidated }); const assumptions = createAssumptions(missing, boqItem);
  const confidence = {
    itemClassification: clamp(boqItem.classificationConfidence),
    requirementExtraction: mean(confirmed.map((item) => item.confidence)),
    applicability: mean(confirmed.map((item) => item.applicability.confidence)),
    attributeCompleteness: clamp(100 - missing.length * 12),
    standards: standards.length ? mean(standards.map((item) => item.confidence || 70)) : 0,
    compatibility: compatibility.length ? mean(compatibility.map((item) => item.confidence || 70)) : 0,
    accessories: accessories.length ? mean(accessories.map((item) => item.confidence || 70)) : 0,
  };

  const requiredConfidenceDimensions = [
    "itemClassification",
    "requirementExtraction",
    "applicability",
    "attributeCompleteness",
  ];

  const minimumFields = categoryMinimums[boqItem.system] || [];
  if (minimumFields.includes("standard") || standards.length) requiredConfidenceDimensions.push("standards");

  const compatibilityRequired = requiresPanelCompatibility(
    boqItem.system,
    boqItem.category,
    boqItem.productFamily,
  );
  if (compatibilityRequired || compatibility.length) requiredConfidenceDimensions.push("compatibility");

  const accessoryRequirementPresent =
    accessories.length > 0 ||
    derived.some((entry) => entry.output?.accessory || entry.ruleId?.startsWith("accessory."));
  if (accessoryRequirementPresent) requiredConfidenceDimensions.push("accessories");

  confidence.overall = Math.min(
    ...requiredConfidenceDimensions.map((name) => confidence[name]),
  );
  const readiness = calculateReadiness({ boqItem, requirements: consolidated, missing, conflicts, confidence });
  return { engineVersion: REQUIREMENT_ENGINE_VERSION, rulesetVersion: REQUIREMENT_RULESET_VERSION, modelVersion: REQUIREMENT_MODEL_VERSION, intelligenceVersion: REQUIREMENT_INTELLIGENCE_VERSION, versionNumber: previousVersion + 1, boqItem, applicableRequirements: confirmed, suggestedRequirements: suggested, consolidatedRequirements: consolidated, intelligence, standards, listingRequirements, manufacturers, compatibility, accessories, derivedRequirements: derived, assumptions, missingInformation: missing, conflicts,
    // Source Fact Authority Slice 3 -- what the project Specification
    // establishes as a technical FACT (Active Source Facts), kept
    // structurally separate from applicableRequirements/
    // consolidatedRequirements (what the project REQUIRES). Never a
    // Mandatory obligation, never merged into the normative arrays above.
    technicalFacts,
    // SLC Resource Classification -- intrinsic technical profile authority.
    // Populated from governed BOQ item category and approved intelligence
    // where evidence permits; remains null/UNRESOLVED when insufficient
    // evidence exists (Agent 1 Drawing Quantity Authority not yet current).
    // SLC Resource Classification -- intrinsic technical profile authority (Agent 3).
    //
    // Physical Quantity Authority (Agent 1) provides the count of devices.
    // Resource Classification Authority (Agent 3) determines the resource pool:
    //   DETECTOR_POOL, MODULE_POOL, NOT_SLC, or UNRESOLVED.
    //
    // Physical quantity MUST NOT override or determine resource pools.
    // The dependency is:
    //   PHYSICAL QUANTITY AUTHORITY + RESOURCE CLASSIFICATION AUTHORITY
    //   → ADDRESS DEMAND.
    //
    // Only use category/description substring matching as last resort;
    // fail closed when no governed evidence permits a classification.
    slcResourceClassification: buildGovernedResourceClassification(boqItem),
    clarifications: [...missing.map((item) => ({ question: item.clarificationQuestion, reason: item.whyNeeded, impact: `${item.technicalImpact} ${item.commercialImpact}`, priority: item.blocking ? "High" : "Medium", suggestedRecipient: item.recommendedOwner, status: "Open", relatedField: item.field })), ...conflicts.map((item) => ({ question: `Please confirm the governing ${item.attribute} requirement and applicable source revision.`, reason: item.type, impact: `${item.technicalImpact} ${item.commercialImpact}`, priority: item.severity, suggestedRecipient: "Consultant / Technical Authority", status: "Open", conflictId: item.id }))], knowledgeFacts, confidence, readiness, drawingArchitectureContext: normalizeStage4DrawingArchitectureContext(drawingArchitectureContext), explanation: `This BOQ item is classified as ${boqItem.category || "an unconfirmed category"} under ${boqItem.system || "an unconfirmed system"}. ${confirmed.length} requirement source${confirmed.length === 1 ? " is" : "s are"} confirmed applicable. Matching readiness is ${readiness.status.toLowerCase()}${readiness.blockingReasons.length ? ` because ${readiness.blockingReasons[0]}` : "."}`, generatedAt: new Date().toISOString() };
};

// ONE EXECUTABLE RESOURCE POLICY. Both of the maps this block used to hold
// are gone, deliberately:
//
//   * `resourcePoolMap` was DEAD -- never referenced by any executor -- while
//     three finished reports cited it as canonical. Dead code described as
//     canonical is a trap for the next lane, so it is removed rather than
//     left to be re-read as authority.
//   * `familyMap` / `familyUnitMap` were LIVE, but they were a SECOND, parallel
//     taxonomy: nine lowercase keys (`detector`, `smoke`, `heat`, `module`,
//     `manual call`, `pull station`, `fireman`, `door`, `telephone`) that matched
//     no governed family name, and four state names of their own.
//
// `classifyFireAlarmSlcItem` is the policy that already existed, is keyed on the
// governed family taxonomy, carries the manufacturer citations, is already the
// input to `fire-alarm-preliminary-point-demand.mjs`, and is the vocabulary the
// demand consumers (`project-point-demand-bridge.mjs`,
// `calculation-requirement-engine.mjs`) already expect. The resource
// classification on a profile is now produced by THAT policy and by nothing
// else, so there is exactly one place a family can be mapped to a resource.
//
// NO RAW FALLBACK. `category`, `subcategory` and `description` are diagnostics
// only. They are not passed as authority, and the classifier receives no field
// it could derive a pool from except the governed product family and the
// governed technical attributes. A governed category is still passed, because
// the classifier has one documented, pre-existing material-scope rule keyed on
// it (wiring/cable/conduit consumes no SLC address by physical necessity) and
// that rule is an established encoded governed engineering rule, not a new one.
const buildGovernedResourceClassification = (boqItem) => {
  const classification = classifyFireAlarmSlcItem({
    system: boqItem.governedSystem ?? boqItem.system,
    family: boqItem.governedProductFamily ?? boqItem.productFamily ?? null,
    category: boqItem.governedCategory ?? boqItem.category ?? null,
    attributes: boqItem.governedTechnicalAttributes || {},
    // Quantity is NOT this layer's concern. Physical quantity is the Drawing
    // Quantity Authority's, so no quantity is supplied here and the classifier
    // books demand as UNKNOWN rather than inventing one.
    selectedQuantity: null,
  });
  return {
    state: classification.state,
    unitsPerDevice: classification.unitsPerDevice,
    family: classification.family,
    addressability: classification.addressability,
    // The two axes are read from the classification itself, so they cannot
    // drift apart from the state they were derived from.
    directSlcAddressState: classification.directSlcPerDevice,
    secondaryInterfaceDemandState: classification.secondaryInterface?.state ?? "UNRESOLVED",
    secondaryInterface: classification.secondaryInterface,
    slcRole: classification.slcRole,
    classifierVersion: classification.classifierVersion,
    reason: classification.reason,
    provenance: { ...classification.provenance, governedProductFamily: boqItem.governedProductFamily ?? null, governedProductFamilyAuthority: boqItem.governedProductFamilyAuthority ?? null },
  };
};

// Pure deterministic address-demand derivation engine.
// Inputs are explicit authority objects; no DB reads, no lore, no agent reports.
export const deriveAddressDemand = ({
  boqItem,
  physicalQuantityAuthority,
  resourceClassificationAuthority,
  productAuthority,
  architectureDecision,
  enabledChannelDecision,
  interfaceDecision
}) => {
  // THE ONE POLICY, used identically whether or not a stored authority was
  // handed in. The stored authority wins when present; otherwise the same
  // canonical classifier runs from the same governed inputs. It is never a
  // weaker second guess, and it never sees raw category/description as
  // authority. State names are the canonical classifier's, not a local set:
  // SLC_DETECTOR_POOL / SLC_MODULE_POOL / SLC_ROLE_ESTABLISHED / NOT_SLC /
  // UNRESOLVED. The old DETECTOR / MODULE / RELAYMON names belonged to the
  // deleted parallel map and are gone with it.
  const derived = resourceClassificationAuthority
    ? {
        state: resourceClassificationAuthority.state ?? "UNRESOLVED",
        unitsPerDevice: resourceClassificationAuthority.unitsPerDevice ?? null,
        secondaryInterface: resourceClassificationAuthority.secondaryInterface ?? null,
      }
    : buildGovernedResourceClassification(boqItem);

  const resourcePool = derived.state;
  const addressesPerUnit = derived.unitsPerDevice ?? null;

  // Direct SLC address demand: TOTAL, not per-device. A pool state multiplies
  // the governed physical quantity by the governed addresses-per-unit. Unknown
  // stays unknown -- `||` is never used on a governed count, because it would
  // silently turn a proven zero into "absent".
  const governedQuantity = physicalQuantityAuthority?.value
    ?? (boqItem.numeric_quantity != null ? Number(boqItem.numeric_quantity) : null);
  const poolDemand = (resourcePool === 'SLC_DETECTOR_POOL' || resourcePool === 'SLC_MODULE_POOL')
    && addressesPerUnit !== null && addressesPerUnit > 0
    && governedQuantity !== null && Number.isFinite(Number(governedQuantity))
    ? Number(governedQuantity) * Number(addressesPerUnit)
    : null;

  const directSlcAddressDemand = resourcePool === 'NOT_SLC' ? 0 : poolDemand;

  // SECONDARY INTERFACE DEMAND IS A SEPARATE AXIS. A proven direct SLC of zero
  // is never a proven total of zero: the classification carries its own
  // secondary-interface state, and the cases where that state is a separate
  // required device are named rather than silently zeroed.
  const secondaryInterfaceDemandState = derived.secondaryInterface?.state ?? "UNRESOLVED";

  // Actual required address demand. Identical to the direct figure when a pool
  // is proven; unresolved otherwise. It is NOT the sum of direct and secondary:
  // a secondary device is a separately-quantified BOQ line, so adding it here
  // would double count it once that line is itself classified.
  const actualRequiredAddressDemand = poolDemand;

  // Demand state
  let demandState
  if (actualRequiredAddressDemand !== null && actualRequiredAddressDemand > 0) {
    demandState = 'PROVEN'
  } else if (resourcePool === 'NOT_SLC') {
    demandState = 'NOT_APPLICABLE'
  } else if (actualRequiredAddressDemand === null) {
    demandState = 'UNRESOLVED'
  } else {
    demandState = 'CONFLICT'
  }

  // Unresolved reason
  let unresolvedReason
  if (resourcePool === 'NOT_SLC' && directSlcAddressDemand === 0) {
    unresolvedReason = 'NOT_SLC: direct SLC address = 0; secondary interface demand unresolved unless separately proven'
  } else if (actualRequiredAddressDemand === null) {
    unresolvedReason = 'Insufficient governed evidence to determine address demand'
  } else if (demandState === 'CONFLICT') {
    unresolvedReason = 'Notification architecture conflict or unresolved channel decision'
  } else {
    unresolvedReason = null
  }

  // Input fingerprint (for staleness detection — only upstream inputs)
  const inputFingerprint = {
    boqItemId: boqItem.id,
    productFamily: boqItem.productFamily,
    resourcePool,
    addressesPerUnit,
    physicalQuantity: physicalQuantityAuthority?.value,
    architectureDecision,
    enabledChannelDecision,
    interfaceDecision
  }

  // Evidence references
  const evidenceReferences = {
    resourceClassification: 'requirement_profile_versions.profile.slcResourceClassification',
    physicalQuantity: 'BOQ numeric_quantity or physicalQuantityAuthority',
    product: productAuthority ? 'governed product evidence' : null
  }

  // Currentness — minimal: only upstream inputs that affect derivation.
    // Includes resourceDemandRuleVersion so that a change in classification rules
    // while all project inputs remain identical invalidates the fingerprint.
    const currentness = {
        resourcePool,
        addressesPerUnit,
        physicalQuantity: physicalQuantityAuthority?.value ? 'governed' : 'un governed',
        productAuthority: productAuthority ? 'governed' : 'un governed',
        architectureDecision,
        enabledChannelDecision,
        interfaceDecision,
        resourceDemandRuleVersion: physicalQuantityAuthority?.ruleVersion ?? 'derived-from-engine'
    }

  return {
    boqItemId: boqItem.id,
    physicalQuantity: physicalQuantityAuthority?.value
      || (boqItem.numeric_quantity != null ? Number(boqItem.numeric_quantity) : null),
    physicalQuantityAuthorityId: 'derived-from-profile',
    resourcePool,
    addressesPerUnit,
    directSlcAddressDemand,
    secondaryInterfaceDemandState,
    actualRequiredAddressDemand,
    maxCapabilityAddressDemand,
    demandState,
    unresolvedReason,
    inputFingerprint,
    evidenceReferences,
    currentness
  }
}

// Do not remove — this is the export line

// Canonical read for Agent 1: assembles current authorities + derives address demand.
//
// This function is the SOLE owner of address-demand semantics. It is pure: no
// store access, no clock, no description matching. Callers resolve current
// authorities and hand them in.
//
// ---------------------------------------------------------------------------
// AUTHORITY OBJECT SHAPE (what callers pass)
// ---------------------------------------------------------------------------
//   resourceClassificationAuthority = {
//     profileId?, id?,          persistent profile identity (null if none)
//     version?,                 governed profile version
//     state,                    DETECTOR | MODULE | NOT_SLC | UNRESOLVED
//     unitsPerDevice,           governed addresses-per-device (null = unknown)
//     inputFingerprint?,        the profile's own input fingerprint
//     currentness?              'CURRENT' | 'STALE'  (absent = CURRENT)
//   }
//   physicalQuantityAuthority = {
//     id?, claimId?,            persistent claim identity (null if none)
//     version?,                 governed claim version
//     value,                    the governed count. 0 IS A REAL VALUE.
//     ruleVersion?,             QUANTITY rule version (NOT a resource version)
//     maxAddresses?,            advisory capability only
//     evidenceFingerprint?,     the claim's own fingerprint
//     currentness?              'CURRENT' | 'STALE'  (absent = CURRENT)
//   }
//
// CURRENCY IS EVALUATED BY THE CALLER, which owns the store and the fingerprint
// rules. This function reports what it is told; it never re-derives currency.
// `currentness` is therefore read from the authority, never invented here.
//
// IDENTITY IS NEVER FABRICATED. A caller that has no persistent id passes
// nothing, and the corresponding field is null with an explicit authority state
// beside it. No placeholder string is ever returned in an id field.

export const getAgent1AddressDemandRead = ({
  boqItemId,
  // Current resource classification authority — from profile or governed source
  resourceClassificationAuthority,
  // Current physical quantity authority
  physicalQuantityAuthority,
  // Current architecture/channel/interface decisions
  architectureDecision,
  enabledChannelDecision,
  interfaceDecision
}) => {
  const resource = resourceClassificationAuthority ?? null;
  const quantity = physicalQuantityAuthority ?? null;

  // ---- Authority presence and currency, resolved independently -------------
  const quantityAbsent = quantity === null;
  const quantityStale = !quantityAbsent && quantity.currentness === 'STALE';
  const resourceAbsent = resource === null;
  const resourceStale = !resourceAbsent && resource.currentness === 'STALE';

  // ---- Governed values, read with NULLISH semantics ------------------------
  // 0 is a real governed count. `null` means unavailable/unknown. Using `||`
  // here would silently convert a governed zero into "unavailable", which is
  // how a proven zero becomes an absence and then an unresolved demand.
  const governedQuantity = quantity?.value ?? null;
  // With no stored classification authority there is no governed family, so
  // there is nothing to classify from. The previous code still CALLED the
  // deleted classifier with three empty strings; that could only ever return
  // UNRESOLVED / null, so stating that directly is behaviour-identical and
  // removes a call that looked like a fallback but was not one.
  const resourcePool = resource?.state ?? "UNRESOLVED";
  const addressesPerUnit = resource?.unitsPerDevice ?? null;

  // ---- Direct SLC address state ------------------------------------------
  // A proven zero is only asserted for NOT_SLC. Every other pool is unknown
  // until governed evidence proves otherwise.
  const directSlcAddressState = resourcePool === 'NOT_SLC' ? 0 : null;

  // ---- Secondary interface demand -----------------------------------------
  // Read from the classification's own secondary-interface axis when a stored
  // authority carries one. With no stored authority there is no governed
  // family, so this is UNRESOLVED -- because the AUTHORITY IS MISSING, never
  // because the demand is zero. A proven direct SLC of 0 does NOT imply a
  // total downstream demand of 0.
  const secondaryInterfaceDemandState = resource?.secondaryInterface?.state ?? "UNRESOLVED";

  // ---- Actual required address demand -------------------------------------
  // NULLISH, and only for a pool that actually consumes an SLC address. A
  // governed 0 stays 0; an unavailable quantity stays null.
  let actualRequiredAddressDemand = null;
  if ((resourcePool === 'SLC_DETECTOR_POOL' || resourcePool === 'SLC_MODULE_POOL')
      && addressesPerUnit !== null && addressesPerUnit > 0) {
    actualRequiredAddressDemand = governedQuantity === null ? null : governedQuantity * addressesPerUnit;
  }

  // ---- Max capability address demand (advisory only) ----------------------
  // The `RELAYMON ? 16` term belonged to the deleted parallel map. `RELAYMON`
  // was never a canonical classification state, so the branch was unreachable;
  // it is removed rather than translated, because inventing a per-family
  // address capacity here is exactly the PRODUCT CAPABILITY FACT that must not
  // be copied into a resource profile. Product capacity is carried by governed
  // product authority or not at all.
  const maxCapabilityAddressDemand = quantity?.maxAddresses ?? null;

  // ---- Architecture conflict ----------------------------------------------
  // Data-driven and deliberately narrow: a conflict is reported only when a
  // decision actually DECLARES one. Nothing infers a conflict from a missing
  // decision. No governed decision currently carries this signal, so
  // ARCHITECTURE_CONFLICT is representable but unpopulated today -- which is
  // itself the honest finding (the channel/interface authority layer is
  // missing), not a value to be guessed at.
  const declaresConflict = (decision) => Boolean(
    decision && (decision.conflict === true || decision.state === 'CONFLICT'
      || decision.conflictState === 'CONFLICT')
  );
  const architectureConflict = declaresConflict(architectureDecision)
    || declaresConflict(enabledChannelDecision)
    || declaresConflict(interfaceDecision);

  // ---- Demand state --------------------------------------------------------
  let demandState;
  if (architectureConflict) {
    demandState = 'CONFLICT';
  } else if (resourcePool === 'NOT_SLC') {
    // Proven direct zero. NOT a completed downstream outcome: what the device
    // needs INSTEAD is unresolved.
    demandState = 'NOT_APPLICABLE';
  } else if (actualRequiredAddressDemand !== null) {
    // Includes a governed zero. "Proven zero devices" is a proven demand of 0
    // and must not be demoted to unresolved or conflict.
    demandState = 'PROVEN';
  } else {
    demandState = 'UNRESOLVED';
  }

  // ---- WHY it cannot be calculated ----------------------------------------
  // Every applicable reason is reported, in a fixed precedence order, so one
  // cause is never masked by another and a consumer can always tell which
  // authority layer is missing. The list is EMPTY exactly when the read is a
  // complete, proven answer.
  const unresolvedReasons = [];
  if (quantityStale) unresolvedReasons.push('STALE_PHYSICAL_QUANTITY_AUTHORITY');
  if (quantityAbsent) unresolvedReasons.push('MISSING_PHYSICAL_QUANTITY_AUTHORITY');
  if (resourceStale) unresolvedReasons.push('STALE_RESOURCE_CLASSIFICATION_AUTHORITY');
  if (resourceAbsent) unresolvedReasons.push('MISSING_RESOURCE_CLASSIFICATION_AUTHORITY');
  if (architectureConflict) unresolvedReasons.push('ARCHITECTURE_CONFLICT');
  // A proven direct SLC of zero ALWAYS leaves the secondary axis open. That is
  // the whole point of keeping the two axes apart: NOT_SLC on this loop does
  // not mean the project consumes nothing downstream (a passive telephone jack
  // is fed by a separate Firephone Control Module line; a non-relay duct
  // housing is fed by a separate detector head line).
  if (resourcePool === 'NOT_SLC' && secondaryInterfaceDemandState === 'UNRESOLVED') {
    unresolvedReasons.push('UNRESOLVED_SECONDARY_INTERFACE');
  }
  if (unresolvedReasons.length === 0
      && (resourcePool === 'SLC_DETECTOR_POOL' || resourcePool === 'SLC_MODULE_POOL')
      && addressesPerUnit === null) {
    unresolvedReasons.push('UNRESOLVED_ADDRESSES_PER_UNIT');
  }
  if (unresolvedReasons.length === 0 && actualRequiredAddressDemand === null
      && resourcePool !== 'NOT_SLC') {
    unresolvedReasons.push('UNRESOLVED_RESOURCE_CLASSIFICATION');
  }

  // ---- Read outcome --------------------------------------------------------
  // `boqItemCurrentness` names the single most fundamental reason the read
  // cannot produce a demand, so a consumer can branch on one value. It is
  // 'CURRENT' only when no authority-level cause exists (missing or stale).
  const authorityBlocked = quantityStale || quantityAbsent || resourceStale || resourceAbsent;
  const boqItemCurrentness = quantityStale ? 'STALE_PHYSICAL_QUANTITY_AUTHORITY'
    : quantityAbsent ? 'MISSING_PHYSICAL_QUANTITY_AUTHORITY'
    : resourceStale ? 'STALE_RESOURCE_CLASSIFICATION_AUTHORITY'
    : resourceAbsent ? 'MISSING_RESOURCE_CLASSIFICATION_AUTHORITY'
    : 'CURRENT';

  // ---- Unresolved reason (human-readable primary) -------------------------
  const REASON_TEXT = {
    MISSING_PHYSICAL_QUANTITY_AUTHORITY:
      'Physical quantity authority absent; cannot derive address demand. Agent 1 Drawing Quantity Authority not yet current/persisted.',
    MISSING_RESOURCE_CLASSIFICATION_AUTHORITY:
      'Resource classification authority absent; the resource pool cannot be governed, so no address demand can be derived.',
    STALE_PHYSICAL_QUANTITY_AUTHORITY:
      'Physical quantity authority is present but no longer current; it was not consumed.',
    STALE_RESOURCE_CLASSIFICATION_AUTHORITY:
      'Resource classification authority is present but no longer current; it was not consumed.',
    ARCHITECTURE_CONFLICT:
      'A governed architecture/channel/interface decision declares a conflict; address demand cannot be resolved while it stands.',
    UNRESOLVED_SECONDARY_INTERFACE:
      'NOT_SLC: direct SLC address = 0; secondary interface demand unresolved unless separately proven',
    UNRESOLVED_ADDRESSES_PER_UNIT:
      'Resource pool is governed but addresses-per-unit is unresolved; address demand cannot be derived.',
    UNRESOLVED_RESOURCE_CLASSIFICATION:
      'Insufficient governed evidence to determine address demand'
  };
  const unresolvedReason = unresolvedReasons.length ? REASON_TEXT[unresolvedReasons[0]] : null;

  // ---- Input fingerprint ---------------------------------------------------
  // Contains ONLY upstream inputs that affect derivation, plus the resource rule
  // version that governs resourcePool / addressesPerUnit / the direct-secondary
  // split. `resourceDemandRuleVersion` is the RESOURCE CLASSIFICATION ruleset
  // version -- never a quantity-authority field -- so a resource-policy change
  // invalidates this fingerprint on its own authority.
  const addressDemandInputFingerprint = {
    boqItemId,
    resourcePool,
    addressesPerUnit,
    physicalQuantity: governedQuantity,
    resourceClassificationAuthorityVersion: resource?.version ?? null,
    physicalQuantityAuthorityVersion: quantity?.version ?? null,
    resourceDemandRuleVersion: RESOURCE_CLASSIFICATION_RULESET_VERSION,
    architectureDecision: architectureDecision?.decisionId ?? architectureDecision ?? null,
    enabledChannelDecision,
    interfaceDecision
  };

  // ---- Evidence references -------------------------------------------------
  const evidenceReferences = {
    resourceClassification: resource
      ? `requirement_profile_versions#${resource.profileId ?? resource.id ?? 'unversioned-row'}@v${resource.version ?? 'unknown'}`
      : 'unavailable',
    physicalQuantity: quantity
      ? `drawing_quantity_claims#${quantity.id ?? quantity.claimId ?? 'unversioned-row'}@v${quantity.version ?? 'unknown'}`
      : 'unavailable',
    product: quantity ? 'governed' : 'un governed'
  };

  // ---- Currentness ---------------------------------------------------------
  const currentness = {
    resourcePool,
    addressesPerUnit,
    physicalQuantity: quantityStale ? 'not-current'
      : governedQuantity !== null ? 'governed'
      : quantity ? 'governed-authority-value-unavailable'
      : 'un governed',
    productAuthority: quantity ? 'governed' : 'un governed',
    resourceClassificationAuthority: resourceAbsent ? 'ABSENT' : (resourceStale ? 'STALE' : 'CURRENT'),
    physicalQuantityAuthority: quantityAbsent ? 'ABSENT' : (quantityStale ? 'STALE' : 'CURRENT'),
    architectureDecision,
    enabledChannelDecision,
    interfaceDecision,
    // OWNERSHIP FIX: this is the resource-classification ruleset version, which
    // is the authority that actually governs resourcePool, addressesPerUnit,
    // directSlcAddressState and secondaryInterfaceDemandState.
    resourceDemandRuleVersion: RESOURCE_CLASSIFICATION_RULESET_VERSION,
    // The quantity rule version is reported separately, under its own name, so
    // the two policies are never conflated.
    physicalQuantityRuleVersion: quantity?.ruleVersion ?? null
  };

  return {
    boqItemId,
    boqItemCurrentness,
    // REAL identities. null when the upstream authority has no persistent id.
    physicalQuantity: governedQuantity,
    physicalQuantityAuthorityId: quantity?.id ?? quantity?.claimId ?? null,
    physicalQuantityAuthorityVersion: quantity?.version ?? null,
    physicalQuantityAuthorityFingerprint: quantity?.evidenceFingerprint ?? null,
    physicalQuantityCurrentness: quantityAbsent ? 'ABSENT' : (quantityStale ? 'STALE' : 'CURRENT'),
    resourceProfileId: resource?.profileId ?? resource?.id ?? null,
    resourceProfileVersion: resource?.version ?? null,
    resourceProfileFingerprint: resource?.inputFingerprint ?? null,
    resourcePool,
    addressesPerUnit,
    directSlcAddressState,
    secondaryInterfaceDemandState,
    resourceAuthorityCurrentness: resourceAbsent ? 'ABSENT' : (resourceStale ? 'STALE' : 'CURRENT'),
    actualRequiredAddressDemand,
    maxCapabilityAddressDemand,
    demandState,
    unresolvedReason,
    unresolvedReasons,
    authorityBlocked,
    addressDemandInputFingerprint,
    architectureDecisionReferences: architectureDecision
      ? [{
          decisionId: architectureDecision?.decisionId ?? null,
          decision: architectureDecision,
          source: 'governed'
        }]
      : [],
    evidenceReferences,
    currentness
  }
};
export const normalizeProfileAttribute = (attribute) => attribute.originalUnit ? { ...attribute, normalization: normalizeMeasurement({ value: attribute.parsedValue, unit: attribute.originalUnit, targetUnit: attribute.normalizedUnit || undefined }) } : attribute;
