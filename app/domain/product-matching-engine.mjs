import { normalizeMeasurement } from "./engineering-knowledge.mjs";
import { canonicalManufacturerName, sameManufacturerIdentity } from "./manufacturer-identity.mjs";
import { familiesAreSynonyms, hasGovernedTaxonomy, isAccessoryFamily, normalizeAttributeName } from "./system-knowledge-registry.mjs";
import { evaluateRelationshipCondition, resolveRelationshipApplicability } from "./product-relationship-condition-engine.mjs";
import { resolveCapacityDependentAccessory } from "./fire-alarm-slc-expansion-resolver.mjs";

export const MATCH_ENGINE_VERSION = "product-matching-engine-1.0.0";
// Fire Alarm E2E fix (cross-family ranking) -- bumped because runProductMatching's
// final sort changed (familyMatchTier now governs before mandatory-failure-ness
// and evidenceStrength). The matching run's own idempotency check compares
// only input_fingerprint (which folds in this version string), not the
// CODE'S interpretation of otherwise-unchanged input data -- a cached run
// from before this fix would otherwise keep reporting the old, cross-family
// ranking forever. Matches the same reasoning as the requirement engine's
// own prior ruleset-version bumps for an analogous gap.
export const MATCH_RULESET_VERSION = "matching-rules-2026-08-27-family-tier";
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

// Sprint 0.4 -- the catalog's raw attribute names (extracted by
// specification-extractor.mjs, e.g. "IP Rating", "Voltage") and the governed
// requirement-side canonical names (e.g. ip_rating, operating_voltage, from
// BOQ Understanding's approved facts on profile.boqItem.attributes) use
// different vocabularies. This finds a catalog attribute by asking the
// system-knowledge registry whether ITS raw name normalizes to the requested
// canonical name -- the same alias table BOQ Understanding already uses, no
// second mapping. Only ever consulted for a system with a registered governed
// taxonomy; an ungoverned system's raw attribute names are never touched.
const findAttributeByCanonicalName = (system, canonicalName, product) => productAttributes(product).find((entry) => {
  const rawName = entry.name || entry.attributeName || entry.canonicalName || entry.originalName;
  return normalizeAttributeName(system, rawName, product.family) === canonicalName;
});

// profile.boqItem.attributes holds APPROVED-but-unverified-against-a-specification
// AI understanding facts (Sprint 0.25.1/0.26), unlike profile.consolidatedRequirements
// (confirmed from a linked specification document). Absent catalog evidence for
// one of these is therefore reported (Evidence Missing / PRODUCT_ATTRIBUTE_MISSING)
// but never treated as blocking -- it must never turn a Discovery-Only candidate
// into a rejected one just because the catalog hasn't captured this attribute yet.
// A genuine verified mismatch (both sides have real data and disagree) keeps
// compareAttribute's normal blocking behavior.
// Sprint 0.5 -- reusable rule: a requirement for a primary device must not be
// satisfied by a product explicitly evidenced as only an accessory of one
// (e.g. LENS-G, "Wall Strobe Lens Attachment" -- device_role=Accessory --
// wrongly winning Strobe-family requirements). This is symmetric with
// boqAttributeComparisons in every way except it does not require the
// requirement to explicitly state device_role: the expectation that a
// selection-critical device requirement wants a primary device is implicit,
// unless the requirement's OWN family is itself an accessory-type family (a
// base, back box, lens, ...), in which case an accessory candidate is exactly
// what was asked for. No special-casing of any specific product -- this reads
// only the same governed device_role attribute and family taxonomy every
// other comparison uses.
const deviceRoleComparisons = (system, requirementFamily, product) => {
  if (!hasGovernedTaxonomy(system)) return [];
  const offered = findAttributeByCanonicalName(system, "device_role", product);
  const roleValue = offered ? productValue(offered) : null;
  if (!roleValue || norm(roleValue) !== "accessory") return [];
  if (isAccessoryFamily(system, requirementFamily)) return [];
  return [{
    comparisonType: "Attribute",
    requirement: { id: "device-role:primary-device-required", attributeName: "device_role", requirementCategory: "Technical Attribute", normalizedRequirement: "A primary device is required, not an accessory", priority: "Critical Mandatory" },
    required: { name: "device_role", operator: "Not Equal", value: "Accessory" },
    offered,
    result: "Fail",
    pass: false,
    blocking: true,
    difference: null,
    conversion: null,
  }];
};

// Fire Alarm E2E fix (candidate discrimination) -- real Central Kitchen -
// Makkah gap: the BOQ's own deterministic fact for indoor_outdoor is a clean
// "Outdoor"/"Indoor" (see boq-understanding-engine.mjs), but this catalog's
// own real attribute values for the same name are richer descriptive text
// (P2RK's own indoor_outdoor value is "Outdoor (weatherproof, NEMA 4X/
// IP56)"), so a strict Equal comparison always failed even for a genuine
// match, treating a correct Outdoor product exactly like a wrong Indoor one
// (both "fail"). ip_rating/detector_technology have the same descriptive-
// text shape. Scoped narrowly to only these three names -- every other
// attribute (including addressing, whose catalog values really are clean
// enums) keeps exact Equal semantics unchanged, so a value like
// "Addressable" can never loosely match "Non-Addressable" through substring
// containment.
const LOOSE_TEXT_MATCH_ATTRIBUTES = new Set(["indoor_outdoor", "ip_rating", "detector_technology"]);
// Fire Alarm E2E fix (candidate discrimination) -- real Central Kitchen -
// Makkah gap: an Annunciator-family BOQ line retrieved a Fire Alarm Control
// Panel product as a weak, cross-family "Category" stage candidate -- a
// legitimate, existing rescue path for a genuinely unclassified product
// (Sprint 8's own comment above), but that panel product IS already
// classified, just into a different real family. Comparing the
// requirement's own attributes (e.g. addressing="Addressable", true of
// nearly every Fire Alarm device) against it gave it non-zero evidenceStrength
// that the correct family's own real candidate (which simply never had
// "addressing" recorded on that particular SKU) did not have -- and
// evidenceStrength is compared before retrieval-stage strength in the final
// ranking, so the wrong-family candidate won. A requirement attribute is
// only really evidence FOR OR AGAINST a candidate already known to be a
// plausible member of the requirement's own family (or a genuine synonym
// family, e.g. Pull Station for a Manual Call Point requirement) -- never for a
// candidate already, correctly classified into an unrelated family. An
// unclassified candidate (product.family falsy) is unaffected, preserving
// the Sprint 8 rescue path exactly.
const boqAttributeComparisons = (system, boqItemAttributes, product, boqItemFamily) => {
  if (!hasGovernedTaxonomy(system) || !boqItemAttributes) return [];
  if (boqItemFamily && product.family && norm(product.family) !== norm(boqItemFamily) && !familiesAreSynonyms(system, product.family, boqItemFamily)) return [];
  return Object.entries(boqItemAttributes).flatMap(([canonicalName, value]) => {
    if (value === null || value === undefined || value === "") return [];
    const required = { name: canonicalName, operator: LOOSE_TEXT_MATCH_ATTRIBUTES.has(canonicalName) ? "Includes" : "Equal", value, unit: null, source: null };
    const offered = findAttributeByCanonicalName(system, canonicalName, product);
    const compared = compareAttribute(required, offered);
    return [{
      comparisonType: "Attribute",
      requirement: { id: `boq-attribute:${canonicalName}`, attributeName: canonicalName, requirementCategory: "Technical Attribute", normalizedRequirement: `${canonicalName} = ${value}`, priority: "Informational" },
      ...compared,
      blocking: offered ? compared.blocking : false,
    }];
  });
};

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

// Sprint 8 -- recall fix. Family/category classification in Product Knowledge
// is sometimes incomplete (a real, catalogued, evidence-backed product can
// have a null family_id) -- previously such a product fell all the way
// through to weak, low-scoring Semantic Discovery token overlap and was
// easily crowded out of the top-10 cap by unrelated products that happen to
// share a couple of description words. This adds one more structured
// retrieval signal, no weaker a source of truth than family/category:
// approved product-level compatibility evidence (engineering_relationships,
// already read into product.compatibility) whose target matches what the
// requirement profile's own confirmed compatibility evidence asks for
// (scope.compatibility, sourced from confirmed requirement links).
//
// Deliberately gated to UNCLASSIFIED products only (product.family AND
// product.category both blank). This is a fallback for a genuine Product
// Knowledge data gap, not a general-purpose retrieval booster: a product
// that already carries a real family/category classification but simply
// belongs to a DIFFERENT family than the item being searched (e.g. a smoke
// detector candidate-generated for a Manual Call Point item, both sharing
// the same "the control unit" compatibility target on the same panel) must
// stay excluded on precision grounds -- that exclusion is correct, not a
// gap, and compatibility evidence must never override it. Restricting the
// fallback to only the unclassified case is what keeps this from flooding.
// Never a manufacturer- or part-number-specific rule, so it generalizes to
// any project/product without hardcoding. It is scored between Structured's
// two tiers (below an exact family match, above a bare category match) so it
// cannot flood out stronger, more specific matches, and it is excluded from
// discoveryOnly (like family/category) because it is evidence-backed, not a
// loose token guess.
const compatibilityMatchTarget = (entry) => entry.targetItem || entry.target || entry.rightEntityId || entry.value;
const isUnclassified = (product) => !norm(product.family) && !norm(product.category);
const productHasMatchingCompatibility = (scope, product) => isUnclassified(product) && Boolean(scope.compatibility?.length) && (product.compatibility || []).some((offered) => scope.compatibility.some((required) => valuesEqual(compatibilityMatchTarget(offered), compatibilityMatchTarget(required))));

// Sprint 1.23 -- real family/matching precision gap: a bare, single-family
// product (e.g. "Strobe") was treated as an equally strong "Product Family"
// match (searchScore 80) as a genuine exact family (e.g. "Speaker/Strobe")
// whenever either family name was a plain substring of the other --
// "strobe".includes("strobe") inside "speaker/strobe", "sounder/strobe", etc.
// This let every bare Strobe-family product in the catalog tie an exact
// Speaker/Strobe or Sounder/Strobe match on retrieval strength alone. Exact
// governed family equality (both sides genuinely the same declared family)
// now scores strictly higher than a partial/substring family relationship,
// which is demoted below even a bare category match -- it is real but weak
// evidence (the two names share a root, nothing more), not a structured
// retrieval signal on the level of an exact family or category match. No
// family or category name is referenced by name here; this is a purely
// structural precision fix that applies identically to every family pair.
const familyExact = (productFamilyNorm, scopeFamilyNorm) => Boolean(scopeFamilyNorm) && Boolean(productFamilyNorm) && productFamilyNorm === scopeFamilyNorm;
const familyPartial = (productFamilyNorm, scopeFamilyNorm) => Boolean(scopeFamilyNorm) && Boolean(productFamilyNorm) && productFamilyNorm !== scopeFamilyNorm && (productFamilyNorm.includes(scopeFamilyNorm) || scopeFamilyNorm.includes(productFamilyNorm));

// Fire Alarm E2E fix (cross-family ranking) -- real Central Kitchen - Makkah
// gap: evidenceStrength/technicalAttributes scoring is a REQUIREMENT-EVIDENCE
// signal, not a family-membership signal -- it was never designed to decide
// "is this candidate even the right kind of device", only "how well does an
// already-plausible candidate satisfy what's confirmed". A generic project
// requirement (e.g. "addressing = Addressable", true of nearly every
// governed Fire Alarm family) can trivially score full marks against a
// completely unrelated but well-attributed candidate (e.g. a Duct Detector
// for a Beam Detector line), while the CORRECT family's real candidate
// simply has fewer attributes recorded on its own SKU -- letting the wrong
// family win on evidenceStrength alone. This introduces one more governed
// ranking dimension, computed BEFORE any evidence/technical scoring is
// allowed to matter: a family tier. It answers only "how plausible is this
// candidate's OWN governed family, given the BOQ item's own governed
// family" -- never which specific candidate within a plausible family is
// technically better (that stays entirely evidenceStrength's job,
// unchanged). Tier 0 (exact family, or a registered synonym family via the
// SAME familiesAreSynonyms every other part of this engine already uses --
// no new equivalence rule, no family named here) is always preferred over
// tier 1 (the candidate carries no family classification at all -- Sprint
// 8's own existing unclassified-product rescue path, preserved exactly as a
// fallback, never deleted) or tier 2 (a real, different, governed family).
// When the BOQ item itself has no confident governed family (ungoverned
// system, or no productFamily resolved at all), tiering is a no-op --
// everyone ties at tier 0 -- so an item with only category-level or
// discovery-only evidence keeps exactly its prior, untiered behavior.
const familyTier = (system, boqItemFamily, product) => {
  if (!hasGovernedTaxonomy(system) || !norm(boqItemFamily)) return 0;
  const productFamilyNorm = norm(product.family);
  if (!productFamilyNorm) return 1;
  if (productFamilyNorm === norm(boqItemFamily) || familiesAreSynonyms(system, product.family, boqItemFamily)) return 0;
  return 2;
};

// Fire Alarm E2E fix (candidate discrimination) -- real Central Kitchen -
// Makkah gap: generateCandidates caps every retrieval stage to its top 10
// products, tie-broken purely by product.id string comparison -- arbitrary
// relative to the actual requirement. Within a same-family catalog larger
// than 10 (e.g. this project's own Sounder/Strobe family), the one real
// discriminating variant (P2RK, the Outdoor SKU an "IP-65" BOQ line
// actually needs) could lose that arbitrary tie-break and never reach
// evaluation at all -- so boqAttributeComparisons' later, correct
// attribute-level discrimination never got a chance to run on it. This
// gives a candidate whose OWN recorded attribute already agrees with a
// structured fact already known from the BOQ (indoor_outdoor, ip_rating,
// detector_technology, ...) a small deterministic nudge before the top-10
// cap, and a matching nudge down for a candidate that already, genuinely
// disagrees -- reusing the exact same canonical-name/value comparison
// boqAttributeComparisons uses later, never a new rule. The adjustment is
// capped well under the smallest real gap between two retrieval stages (5,
// between Structured/80 and Compatibility Evidence/75), so it can only ever
// break a tie WITHIN a stage, never promote a weaker-stage candidate over a
// stronger one.
const STRUCTURED_ALIGNMENT_CAP = 4;
const structuredAttributeAlignment = (system, boqItemAttributes, product, boqItemFamily) => {
  if (!hasGovernedTaxonomy(system) || !boqItemAttributes) return 0;
  if (boqItemFamily && product.family && norm(product.family) !== norm(boqItemFamily) && !familiesAreSynonyms(system, product.family, boqItemFamily)) return 0;
  let score = 0;
  for (const [canonicalName, value] of Object.entries(boqItemAttributes)) {
    if (value === null || value === undefined || value === "" || value === "MISSING") continue;
    const offered = findAttributeByCanonicalName(system, canonicalName, product);
    const offeredValue = offered ? productValue(offered) : null;
    if (offeredValue == null) continue;
    const matches = LOOSE_TEXT_MATCH_ATTRIBUTES.has(canonicalName) ? norm(offeredValue).includes(norm(value)) : valuesEqual(value, offeredValue);
    score += matches ? 1 : -1;
  }
  return Math.max(-STRUCTURED_ALIGNMENT_CAP, Math.min(STRUCTURED_ALIGNMENT_CAP, score));
};

export const generateCandidates = ({ profile, products }) => {
  const scope = buildSearchScope(profile); const descriptionTokens = tokens(profile.boqItem?.normalizedDescription || profile.boqItem?.description); const boqItemAttributes = profile.boqItem?.attributes; const stages = [];
  for (const product of products) {
    const exact = scope.partNumber && [product.partNumber, product.normalizedPartNumber].some((value) => norm(value) === norm(scope.partNumber)); const manufacturerModel = scope.manufacturer && scope.partNumber && sameManufacturerIdentity(product.manufacturer, scope.manufacturer) && norm(`${product.partNumber} ${product.description}`).includes(norm(scope.partNumber)); const manufacturerFamily = scope.manufacturer && scope.productFamily && sameManufacturerIdentity(product.manufacturer, scope.manufacturer) && norm(product.family).includes(norm(scope.productFamily)); const productFamilyNorm = norm(product.family); const scopeFamilyNorm = norm(scope.productFamily); const exactFamilyMatch = familyExact(productFamilyNorm, scopeFamilyNorm); const partialFamilyMatch = familyPartial(productFamilyNorm, scopeFamilyNorm); const category = scope.category && norm(product.category) === norm(scope.category); const compatibilityEvidence = productHasMatchingCompatibility(scope, product); const shared = descriptionTokens.filter((term) => norm(`${product.description} ${product.family}`).includes(term));
    const alignment = structuredAttributeAlignment(scope.system, boqItemAttributes, product, scope.productFamily);
    if (exact) stages.push({ product, stage: "Exact Identity", searchScore: 100, basis: ["Exact Part Number"], alignment });
    else if (manufacturerModel) stages.push({ product, stage: "Manufacturer Model", searchScore: 95, basis: ["Exact Manufacturer + Model"], alignment });
    else if (manufacturerFamily) stages.push({ product, stage: "Manufacturer Family", searchScore: 88, basis: ["Manufacturer + Product Family"], alignment });
    else if (exactFamilyMatch) stages.push({ product, stage: "Structured", searchScore: 80, basis: ["Product Family"], alignment });
    else if (category) stages.push({ product, stage: "Structured", searchScore: 65, basis: ["Category"], alignment });
    else if (compatibilityEvidence) stages.push({ product, stage: "Compatibility Evidence", searchScore: 75, basis: ["Compatibility Evidence"], alignment });
    else if (partialFamilyMatch) stages.push({ product, stage: "Structured", searchScore: 55, basis: ["Partial Product Family"], alignment });
    else if (shared.length >= 2) stages.push({ product, stage: "Semantic Discovery", searchScore: Math.min(55, shared.length * 10), basis: ["Semantic Discovery"], discoveryOnly: true, sharedTerms: shared, alignment });
  }
  // alignment is a secondary sort key only -- it can never move a candidate
  // across a searchScore/stage boundary (searchScore is always compared
  // first, unmodified), so a Structured/family-match candidate can never
  // outrank a Manufacturer Family match, etc. Within a tied stage/score, it
  // takes the top-10 retrieval cap's tie-break away from an arbitrary
  // product.id string comparison and gives it to whichever candidate's own
  // recorded attributes actually agree with a structured fact already known
  // from the BOQ text -- id remains the final, last-resort tie-break.
  return { scope, candidates: [...new Map(stages.sort((a, b) => b.searchScore - a.searchScore || (b.alignment || 0) - (a.alignment || 0) || String(a.product.id).localeCompare(String(b.product.id))).map((entry) => [entry.product.id, entry])).values()].slice(0, 10) };
};

const standardKey = (value) => norm(`${value.body || value.issuingBody || ""} ${value.number || value.standard || ""} ${value.part || ""}`);
// Sprint 10 -- a "Standard" citation whose number field is literally the
// placeholder word "Standard" (no real, citable identifier -- e.g. body
// "IEEE", number "Standard", vs. a genuine citation like body "UL", number
// "268") is an extraction artifact, not a certifiable manufacturer listing.
// No vendor documentation could ever satisfy an unfalsifiable citation with
// no actual standard number -- treating it as a permanent blocking gate is
// a misclassification, not rigor. This is a purely structural check (a
// missing/placeholder number), so it can never exclude a real standard;
// real ones always carry their own number (UL 268, NFPA 72, ...).
const isUnfalsifiableStandardCitation = (standard) => norm(standard.number) === "standard" && !norm(standard.year);
const evaluateStandards = (required, product) => required.filter((standard) => !isUnfalsifiableStandardCitation(standard)).map((standard) => { const offered = (product.standards || []).find((entry) => standardKey(entry) === standardKey(standard)); const result = offered?.evidence || offered?.source ? "Verified Compliant" : offered ? "Claimed Compliant" : "Evidence Missing"; return { requirement: standard, productStandard: offered || null, result, pass: Boolean(offered), blocking: !offered, evidence: offered?.source || offered?.evidence || null }; });
const evaluateManufacturer = (scope, product) => { const prohibited = scope.prohibitedManufacturers.some((name) => sameManufacturerIdentity(name, product.manufacturer)); const required = scope.approvedManufacturers; const approved = !required.length || required.some((name) => sameManufacturerIdentity(name, product.manufacturer)); return { result: prohibited ? "Prohibited" : approved ? "Approved" : "Not Approved", pass: !prohibited && approved, blocking: prohibited || !approved, required, offered: product.manufacturer }; };
// Sprint 9 -- "provide initiating devices and notification appliances made
// by the same manufacturer" (req_200) is a cross-item project consistency
// rule, not an approved/prohibited-manufacturer-list rule (evaluateManufacturer
// already handles that, via profile.manufacturers with an explicit
// approved/prohibited name). No single-candidate evaluation can verify
// consistency against OTHER items' eventual selections -- that is a
// project-wide check, out of scope here (Planner/State). What honestly IS
// checkable per candidate is whether it has one clear, resolvable
// manufacturer identity via the same canonical manufacturer-identity module
// already used elsewhere in this file -- a product with no manufacturer, or
// an unresolvable one, genuinely cannot participate in an all-one-manufacturer
// selection. This never infers compliance from compatibility evidence, and
// never treats a manufacturer-category requirement that DOES name a specific
// required manufacturer as this kind of self-consistency rule (that case
// keeps going through evaluateManufacturer/profile.manufacturers as before).
const isManufacturerConsistencyRequirement = (requirement) => requirement.requirementCategory === "Manufacturer" && !(requirement.manufacturers || []).length;
const evaluateManufacturerConsistency = (requirements, product) => requirements.filter(isManufacturerConsistencyRequirement).map((requirement) => { const resolved = canonicalManufacturerName(product.manufacturer); return { requirement, offered: resolved.canonical, result: resolved.canonical ? "Resolved" : "Missing Product Data", pass: Boolean(resolved.canonical), blocking: !resolved.canonical }; });
// Sprint 10 -- a compatibility target that is itself a bare standard
// citation (e.g. "IEEE Standard 802", leaked in from the same
// mis-extraction as the malformed Standard entry above) does not describe a
// real external product, system, or role the way "the control unit" does --
// it is the same underlying protocol reference, structurally mis-modeled as
// a Compatibility target instead of a Standard. Excluding it here never
// touches a genuine compatibility target naming a real thing.
const isStandardCitationLeakedAsTarget = (target) => /^ieee standard\b/i.test(txt(target));
const evaluateCompatibility = (required, product) => required.filter((entry) => !isStandardCitationLeakedAsTarget(entry.targetItem || entry.rightEntityId || entry.target || entry.value)).map((entry) => { const target = entry.targetItem || entry.rightEntityId || entry.target || entry.value; const offered = (product.compatibility || []).find((candidate) => valuesEqual(candidate.targetItem || candidate.target || candidate.rightEntityId, target)); const incompatible = offered && /does not|incompatible/i.test(offered.relationshipType || offered.type || ""); return { requirement: entry, offered: offered || null, result: incompatible ? "Incompatible" : offered ? "Verified Compatible" : "Evidence Missing", pass: Boolean(offered) && !incompatible, blocking: !offered || incompatible }; });
const evaluateLifecycle = (product) => { const state = product.lifecycleStatus || "Unknown"; const blocked = /discontinued|end of sale/i.test(state) && !/replacement candidate/i.test(state); const warning = /limited|end of support|replaced|unknown/i.test(state); return { state, result: blocked ? "Blocked" : warning ? "Warning" : "Pass", pass: !blocked, blocking: blocked, warning }; };
// Sprint 10 -- the derived "compatible detector base" requirement
// (technical-requirement-engine.mjs's accessory.detector-base rule) names a
// generic ROLE ("Compatible detector base"), not a specific product's own
// name/family -- so it can never match product.accessories[].name, which is
// always a specific base's own catalog name or family. The already-approved
// Product Relationship itself proves the requirement: product_accessories.
// relationship_type is literally "Compatible Base" for exactly this rule's
// real, seeded detector/base evidence. This only recognizes that EXISTING,
// already-approved relationship type as proof for this one specific derived
// rule; it never invents a new relationship or loosens matching for any
// other accessory requirement (a sounder base, expansion module, etc. still
// only matches on its own name as before). No product or part number is
// named here -- the rule is keyed only by the requirement's own ruleId and
// the already-governed relationship_type value.
const evaluateAccessories = (required, product) => required.map((entry) => { const name = entry.accessory || entry.targetItem || entry.output?.accessory || entry.statement; const available = [...(product.accessories || []), ...(product.includedAccessories || [])]; const offered = available.find((candidate) => norm(candidate.accessory || candidate.name || candidate) === norm(name)) || (entry.ruleId === "accessory.detector-base" ? available.find((candidate) => norm(candidate.relationshipType) === norm("Compatible Base")) : undefined); return { requirement: entry, accessory: name, offered: offered || null, result: offered ? "Pass" : "Missing Accessory", pass: Boolean(offered), blocking: !offered }; });
const commercialState = (prices, productId, projectId) => { const applicable = prices.filter((price) => price.productId === productId && (!price.projectId || price.projectId === projectId)); const current = applicable.filter((price) => price.approvalStatus === "Approved" && price.validUntil && new Date(price.validUntil) >= new Date()); if (current.some((price) => price.projectId === projectId)) return "Project Price Available"; if (current.length) return "Valid Current Price Available"; if (applicable.some((price) => price.validUntil && new Date(price.validUntil) < new Date())) return "Expired Price Only"; if (applicable.length) return "Historical Price Only"; return "Supplier RFQ Required"; };
const explanation = (candidate) => { const passed = candidate.comparisons.filter((entry) => entry.pass).map((entry) => entry.requirement?.normalizedRequirement || entry.required?.name).filter(Boolean); const failed = candidate.comparisons.filter((entry) => !entry.pass).map((entry) => entry.requirement?.normalizedRequirement || entry.required?.name).filter(Boolean); return `${candidate.product.manufacturer || "Unknown manufacturer"} ${candidate.product.partNumber || candidate.product.description} was found through ${candidate.matchingBasis.join(", ")}. ${passed.length ? `${passed.length} evaluated technical criterion${passed.length === 1 ? " passed" : "s passed"}.` : "No technical criterion has verified evidence."} ${failed.length ? `${failed.length} criterion${failed.length === 1 ? " requires" : " require"} review or failed.` : "No evaluated mandatory failure was found."} Commercial state: ${candidate.commercialAvailability}.`; };

// Phase 5 workflow-continuity fix -- familyMatchTier already governed the
// final ranking sort (see runProductMatching's Fire Alarm E2E fix comment
// below) but was never turned into anything an engineer could actually read:
// it lived only in-memory for one matching run and was discarded before
// persistence. This is the one place a plain-language "why this candidate is
// ranked here" is built from the SAME already-computed, already-governed
// fields runProductMatching sorts by (familyMatchTier, mandatoryFailures,
// evidenceStrength, matchingBasis) -- no new judgment, only an explanation of
// judgment the engine already made. A tier-1/tier-2 candidate is always
// worded as a fallback (never as equally valid), and a mandatory failure is
// always worded as rejected-within-tier (never as compliant), matching the
// frozen v1 principles exactly.
const FAMILY_TIER_LABEL = { 0: "Same governed family", 1: "Unclassified fallback", 2: "Different governed family (fallback)" };
const buildRankingReason = (candidate, boqItemFamily) => {
  const tierLabel = FAMILY_TIER_LABEL[candidate.familyMatchTier] ?? "Unranked";
  const familyPart = candidate.familyMatchTier === 0
    ? (boqItemFamily ? `Matches the item's own governed family (${boqItemFamily}), or a registered synonym family.` : "No confident governed family applies to this item, so family tiering is a no-op here.")
    : candidate.familyMatchTier === 1
      ? "This product carries no governed family classification of its own, so it is shown only as a fallback candidate, ranked below every classified same-family candidate."
      : `This product belongs to a different governed family than the item's own (${boqItemFamily || "unclassified"}); it is shown only as a fallback candidate because nothing from the correct family outranks it.`;
  const mandatoryPart = candidate.mandatoryFailures.length
    ? `${candidate.mandatoryFailures.length} mandatory requirement${candidate.mandatoryFailures.length === 1 ? "" : "s"} failed, so it is a rejected alternative within its tier, never marked compliant.`
    : "No mandatory requirement failed.";
  const evidencePart = candidate.evidenceStrength > 0 ? `Its own recorded attributes align with confirmed requirement evidence (evidence strength ${candidate.evidenceStrength}).` : "No confirmed requirement evidence yet distinguishes it from other candidates in the same tier.";
  return `${tierLabel}. ${familyPart} ${mandatoryPart} ${evidencePart} Retrieved via ${candidate.matchingBasis?.join(", ") || "discovery"}.`;
};

// Sprint 1.0 -- approved requirement evidence available to condition
// evaluation: the BOQ item's own approved understanding attributes (governed,
// per-item; e.g. notification_feature from a deterministic BOQ description
// fact) plus each confirmed requirement's own governed attributes (spec-clause
// evidence, with provenance). Never reads raw BOQ/spec text -- only already-
// normalized canonical facts that passed through the existing governed-review
// gates (Sprint 0.7/0.8), so nothing unapproved, rejected, or stale can reach
// the evaluator.
const approvedConditionFacts = (profile) => [
  ...Object.entries(profile.boqItem?.attributes || {}).map(([attribute, value]) => ({ attribute, value, source: "Approved BOQ Understanding" })),
  ...(profile.consolidatedRequirements || []).flatMap((requirement) => (requirement.attributes || []).map((attribute) => ({ attribute: attribute.name, value: attribute.normalizedValue, source: attribute.source?.clause ? `Specification page ${attribute.source.page || attribute.source.pageFrom || "?"}, clause ${attribute.source.clause}` : "Approved Specification Requirement" }))),
];

// Purely additive: never affects score, technicalStatus, mandatoryFailures, or
// the pre-existing `accessories` comparison field above. Every entry in
// product.accessories already passed the review_status filter in
// worker/product-matching-api.mjs's loadProducts (Rejected/Needs Review
// excluded before this code ever runs) -- the relationship-approval question
// (Step 6) is answered upstream; this only answers the project-condition
// question, keeping the two questions genuinely separate as required.
const resolveAccessoryCandidates = (product, profile) => {
  const facts = approvedConditionFacts(profile);
  return (product.accessories || []).map((accessory) => {
    const conditions = Array.isArray(accessory.conditions) ? accessory.conditions : [];
    const conditionResult = evaluateRelationshipCondition(conditions, facts);
    const applicability = resolveRelationshipApplicability({ reviewStatus: "Approved", conditionResult });
    // Sprint 1.1 Step 9 -- a second, separate question ("how many"), answered
    // only when the caller supplies real project SLC demand + verified
    // product capacity evidence via profile.capacityEvidence. Purely
    // additive: profile.capacityEvidence is undefined for every non-SLC
    // accessory and every non-Fire-Alarm system, so this never affects any
    // existing candidate. resolveCapacityDependentAccessory itself returns
    // null for any accessory whose quantityRule isn't CAPACITY_DEPENDENT.
    const capacityResolution = resolveCapacityDependentAccessory(accessory, profile.capacityEvidence);
    return { accessoryPartNumber: accessory.accessoryPartNumber, accessoryProductId: accessory.accessoryProductId, relationshipType: accessory.relationshipType, quantityRule: accessory.quantityRule, quantityParameter: accessory.quantityParameter, confidence: accessory.confidence, evidence: accessory.evidence, conditionResult, ...applicability, ...(capacityResolution ? { capacityResolution } : {}) };
  });
};

export const evaluateCandidate = ({ profile, generated, prices = [], projectId = null, weights = {} }) => {
  const product = generated.product, scope = buildSearchScope(profile); const requirements = profile.consolidatedRequirements || []; const attributeComparisons = [...requirements.flatMap((requirement) => (requirement.attributes || []).map((entry) => ({ comparisonType: "Attribute", requirement, ...compareAttribute(requirementAttribute(entry), findAttribute(product, requirementAttribute(entry))) }))), ...boqAttributeComparisons(profile.boqItem?.system, profile.boqItem?.attributes, product, profile.boqItem?.productFamily), ...deviceRoleComparisons(profile.boqItem?.system, profile.boqItem?.productFamily, product)]; const manufacturerConsistency = evaluateManufacturerConsistency(requirements, product); const structuredRequirementIds = new Set([...attributeComparisons.map((entry) => entry.requirement?.id), ...(profile.standards || []).map((entry) => entry.requirementId), ...(profile.compatibility || []).map((entry) => entry.requirementId), ...(profile.accessories || []).map((entry) => entry.requirementId), ...manufacturerConsistency.map((entry) => entry.requirement?.id)].filter(Boolean)); const unstructuredComparisons = requirements.filter((requirement) => ["Critical Mandatory", "Mandatory", "Conditional Mandatory"].includes(requirement.priority) && !(requirement.attributes || []).length && !structuredRequirementIds.has(requirement.id)).map((requirement) => ({ requirement, result: "Missing Product Data", pass: false, blocking: true, offered: null, evidence: null })); const standards = evaluateStandards(profile.standards || [], product); const manufacturer = evaluateManufacturer(scope, product); const compatibility = evaluateCompatibility(profile.compatibility || [], product); const accessories = evaluateAccessories([...(profile.accessories || []), ...(profile.derivedRequirements || []).filter((entry) => entry.output?.accessory)], product); const lifecycle = evaluateLifecycle(product); const comparisons = [
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
    ...manufacturerConsistency.map((entry) => ({
      comparisonType: "Manufacturer Consistency",
      requirement: entry.requirement,
      ...entry,
    })),
  ]; const mandatoryFailures = comparisons.filter((entry) => entry.blocking); if (manufacturer.blocking) mandatoryFailures.push({ type: "Manufacturer", ...manufacturer }); if (lifecycle.blocking) mandatoryFailures.push({ type: "Lifecycle", ...lifecycle });
  // Sprint 1.17 -- real ranking gap: when a BOQ item has no confirmed
  // specification requirements yet (attributeComparisons/standards/
  // compatibility/accessories all empty), every candidate's ratio()-based
  // components tie at exactly the same value regardless of how the
  // candidate was actually retrieved -- an exact governed product-family
  // match (generateCandidates' "Structured"/family stage, searchScore 80)
  // scored no higher than a bare category-only match (searchScore 65) or
  // even compatibility-evidence/semantic-discovery fallbacks, because
  // generated.searchScore was never itself part of `score`, only of the
  // separate confidenceScore calculation below. This adds it as one more
  // weighted component so the retrieval stage's own already-computed
  // strength (Exact Identity > Manufacturer Model/Family > exact Product
  // Family > Compatibility Evidence > bare Category > Semantic Discovery)
  // always contributes to ranking, not just to the confidence label -- the
  // smallest generic fix, reusable for every family/category, never keyed
  // to a manufacturer, part number, or specific product.
  const defaultWeights = { mandatory: 40, attributes: 20, standards: 10, compatibility: 10, manufacturer: 5, accessories: 5, lifecycle: 5, source: 3, commercial: 2, searchRelevance: 15 }; const w = { ...defaultWeights, ...weights }; const ratio = (rows) => rows.length ? rows.filter((entry) => entry.pass).length / rows.length : 0; const components = { mandatoryCompliance: mandatoryFailures.length ? 0 : w.mandatory, technicalAttributes: ratio(attributeComparisons) * w.attributes, standards: ratio(standards) * w.standards, compatibility: ratio(compatibility) * w.compatibility, manufacturer: manufacturer.pass ? w.manufacturer : 0, accessories: ratio(accessories) * w.accessories, lifecycle: lifecycle.pass ? w.lifecycle : 0, sourceReliability: /verified|reviewed/i.test(product.reviewStatus || product.sourceReliability || "") ? w.source : 0, commercialAvailability: commercialState(prices, product.id, projectId) === "Valid Current Price Available" ? w.commercial : 0, searchRelevance: (Number(generated.searchScore || 0) / 100) * w.searchRelevance }; const score = clamp(Object.values(components).reduce((sum, value) => sum + value, 0)); const profileBlocked = !["Ready for Matching", "Ready with Warnings"].includes(profile.readiness?.status); const discovery = generated.discoveryOnly || profileBlocked; const technicalStatus = mandatoryFailures.length ? "Non-Compliant" : discovery ? "Discovery Only" : comparisons.some((entry) => !entry.pass) || lifecycle.warning ? "Compliant with Warnings" : "Technically Compliant"; const confidenceCeiling = discovery ? 49 : mandatoryFailures.some((entry) => entry.result === "Evidence Missing" || entry.result === "Missing Product Data") ? 59 : generated.stage === "Exact Identity" ? 95 : generated.stage === "Manufacturer Model" ? 92 : generated.stage === "Manufacturer Family" ? 88 : generated.stage === "Structured" ? 85 : 49; const completeness = comparisons.length ? ratio(comparisons) * 100 : 0; const confidenceScore = clamp(Math.min(confidenceCeiling, generated.searchScore * 0.4 + completeness * 0.4 + Number(product.reviewStatus === "Reviewed") * 20)); const confidence = discovery ? "Discovery Only" : confidenceScore >= 90 ? "Verified" : confidenceScore >= 75 ? "High Confidence" : confidenceScore >= 55 ? "Medium Confidence" : "Low Confidence"; const tier = mandatoryFailures.length ? "Rejected Candidate" : discovery ? "Discovery Candidate" : technicalStatus === "Technically Compliant" ? "Recommended Candidate" : "Conditional Alternative";
  // Sprint 1.17 -- the requirement-evidence-backed components only (never
  // mandatory compliance itself, manufacturer, lifecycle, source reliability,
  // or commercial availability -- none of those are "requirement evidence"),
  // used by runProductMatching's final sort to decide whether a candidate
  // genuinely has "stronger evidence" before search-relevance is allowed to
  // matter, and before either can be overridden by peripheral score noise.
  const evidenceStrength = components.technicalAttributes + components.standards + components.compatibility + components.accessories;
  const familyMatchTier = familyTier(profile.boqItem?.system, profile.boqItem?.productFamily, product);
  const candidate = { product, searchStage: generated.stage, searchScore: Number(generated.searchScore || 0), evidenceStrength, familyMatchTier, isFallbackCandidate: familyMatchTier > 0, matchingBasis: generated.basis, components, score, technicalStatus, recommendationTier: tier, confidence, confidenceScore, comparisons, standards, manufacturer, manufacturerConsistency, compatibility, accessories, accessoryCandidates: resolveAccessoryCandidates(product, profile), lifecycle, commercialAvailability: commercialState(prices, product.id, projectId), mandatoryFailures, approvalReady: false, reviewStatus: "Needs Review", provenance: { productSource: product.source || null, requirementProfileVersion: profile.versionNumber, engineVersion: MATCH_ENGINE_VERSION, rulesetVersion: MATCH_RULESET_VERSION, searchVersion: MATCH_SEARCH_VERSION, modelVersion: MATCH_MODEL_VERSION } }; candidate.explanation = explanation(candidate); candidate.rankingReason = buildRankingReason(candidate, profile.boqItem?.productFamily); return candidate;
};

export const runProductMatching = ({ profile, products, prices = [], projectId = null, previousVersion = 0, weights }) => {
  const technicallyReady = ["Ready for Matching", "Ready with Warnings", "Needs Technical Review"].includes(profile.readiness?.status);
  const discoveryReady = Boolean(profile.boqItem?.description && profile.boqItem?.system && (profile.boqItem?.category || profile.boqItem?.productFamily));
  if (!technicallyReady && !discoveryReady) return { versionNumber: previousVersion + 1, status: "Not Ready", candidates: [], noMatch: { reason: "The BOQ item is not classified for product discovery.", blockers: profile.readiness?.blockingReasons || [], suggestedAction: "Confirm the item discipline and equipment category." } };
  // Sprint 1.17 -- real ranking gap: when no confirmed requirement evidence
  // exists yet for a BOQ item, every candidate's evidenceStrength ties at 0,
  // and `score` alone was too easily decided by peripheral, non-evidence
  // components (sourceReliability, commercialAvailability, lifecycle,
  // manufacturer) rather than by how well-retrieved the candidate actually
  // was.
  //
  // Fire Alarm E2E fix (cross-family ranking) -- real Central Kitchen -
  // Makkah gap: that ordering alone let a generic, easily-satisfied
  // requirement (e.g. "addressing = Addressable") give an unrelated but
  // well-attributed candidate (a Duct/Smoke/Heat Detector) a HIGHER
  // evidenceStrength than the correct family's own real candidate (Beam
  // Detector, whose specific SKU simply has fewer attributes recorded) --
  // letting a wrong governed family win purely on requirement-evidence
  // richness having nothing to do with whether it is even the right kind of
  // device. familyMatchTier (computed once per candidate in
  // evaluateCandidate, from the SAME familiesAreSynonyms every other part of
  // this engine already uses -- no new equivalence rule) now governs FIRST,
  // ahead of both mandatory-failure-ness and evidence: the BOQ item's exact
  // governed family, or a registered synonym family, always outranks a real,
  // different governed family, and an unclassified candidate (Sprint 8's own
  // rescue path) sits between the two -- never deleted, always visible as a
  // fallback. Only WITHIN a tier does fewer-mandatory-failures-first still
  // apply (so a same-family candidate that fails a mandatory requirement,
  // e.g. a conventional Beam Detector failing "must be addressable", still
  // ranks below the compliant same-family candidate, and still above every
  // wrong-family candidate -- visible as a technically rejected alternative,
  // never as compliant), THEN stronger real requirement evidence (an
  // explicit "stronger evidence" escape hatch for candidates within the SAME
  // tier), THEN retrieval-stage strength, THEN the remaining blended `score`
  // as the final tie-break. When the BOQ item has no confident governed
  // family, familyMatchTier ties at 0 for every candidate -- a complete
  // no-op, preserving prior behavior exactly. No product ID, manufacturer,
  // or family name is referenced here -- purely structural precedence over
  // already-computed, reusable fields.
  const generated = generateCandidates({ profile, products }); const evaluated = generated.candidates.map((candidate) => evaluateCandidate({ profile, generated: candidate, prices, projectId, weights })).sort((left, right) => left.familyMatchTier - right.familyMatchTier || Number(left.mandatoryFailures.length > 0) - Number(right.mandatoryFailures.length > 0) || right.evidenceStrength - left.evidenceStrength || right.searchScore - left.searchScore || right.score - left.score).map((candidate, index) => ({ ...candidate, rank: index + 1 })); const valid = evaluated.filter((candidate) => !candidate.mandatoryFailures.length && candidate.recommendationTier !== "Discovery Candidate"); const status = valid.length ? "Needs Review" : evaluated.length ? "Discovery Only" : "No Match"; return { engineVersion: MATCH_ENGINE_VERSION, rulesetVersion: MATCH_RULESET_VERSION, searchVersion: MATCH_SEARCH_VERSION, modelVersion: MATCH_MODEL_VERSION, versionNumber: previousVersion + 1, status, searchScope: generated.scope, candidateCountEvaluated: evaluated.length, candidates: evaluated, noMatch: valid.length ? null : { reason: evaluated.length ? "No technically recommendable candidate passed every mandatory gate." : "No product was found within the controlled search scope.", exclusionReasons: evaluated.flatMap((candidate) => candidate.mandatoryFailures.map((failure) => ({ productId: candidate.product.id, reason: failure.result || failure.type }))), missingLibraryCoverage: evaluated.length === 0, suggestedClarification: profile.clarifications || [], suggestedAction: evaluated.length ? "Review failed evidence or import an approved alternative." : "Import relevant product data or issue a supplier RFQ." }, generatedAt: new Date().toISOString() };
};

export const compareCandidates = (candidates) => candidates.map((candidate) => ({ productId: candidate.product.id, manufacturer: candidate.product.manufacturer, partNumber: candidate.product.partNumber, technicalStatus: candidate.technicalStatus, mandatoryFailures: candidate.mandatoryFailures.length, standards: candidate.standards.map((entry) => entry.result), compatibility: candidate.compatibility.map((entry) => entry.result), accessories: candidate.accessories.map((entry) => entry.result), lifecycle: candidate.lifecycle.state, commercialAvailability: candidate.commercialAvailability, confidence: candidate.confidence, score: candidate.score }));
