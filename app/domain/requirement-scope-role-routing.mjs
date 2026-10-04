// P1 deterministic requirement scope & downstream-role routing.
//
// Pure derivation over already-persisted requirement evidence:
// requirement_category, original_text patterns, family-phrase evidence,
// parsed child rows (attributes/standards/compatibility), clause context.
// No database access, no mutation, no new persisted fields -- the mission
// found no valid reusable persistence model for scope/role, and inventing
// duplicate semantic fields is explicitly forbidden. This module is
// advisory triage evidence: it never removes a requirement from any
// profile, link set, or matching input. It has NO runtime consumer today
// (tests only): its routing has no runtime effect until it is deliberately wired.
//
// Invariants:
// - NON_PRODUCT_MATCHING roles (installation/testing/documentation/
//   maintenance/commercial/informational) keep the requirement as governed
//   engineering evidence; they only state it must not participate in
//   SKU/Product Matching.
// - ITEM_SPECIFIC scope is never assigned from requirement text alone;
//   item specificity comes only from governed BOQ links.
// - Standards/listings are never compatibility targets here; a listing
//   routes to PRODUCT_MATCHING (family known) or SYSTEM_ARCHITECTURE
//   (system-level obligation), never to a protocol target.
// - Vendor/manufacturer qualifications route COMMERCIAL unless an explicit
//   device family makes them product-selecting.
//
// R6 -- PRECEDENCE (independent closure audit repair). The question routing
// answers is "what kind of downstream engineering obligation is this
// requirement?", NOT "does this sentence mention a product family?". Before R6
// an exact family was checked FIRST, so "As-Built drawings shall locate the
// FACP" or "BGUs shall be installed on the egress side" became PRODUCT_MATCHING.
// The stored requirement_category is a first-match SUBSTRING keyword table
// (specification-extractor.mjs classifyRequirementCategory: "manual" ->
// Documentation, "test switch" -> Testing, "mount"/"cabl"/"ground" ->
// Installation), so a practice category alone is not trustworthy evidence
// against a device requirement ("Manual call points must support fail-safe operation" is
// category Documentation). Precedence is therefore:
//   1. when a family is mentioned, a PRACTICE OBLIGATION stated by the text's own main predicate
//      (install / test / submit / maintain / manufacturer-obligation / network-system) corroborates
//      or overrides the category and always beats family evidence -- for EXACT_ALIAS, PARENT_CHILD and AMBIGUOUS family mentions;
//      the only exception is a weak deliverable/installation-NOUN cue next to a strict product
//      criterion (a P3 product listing, a protocol target, a device attribute row);
//   2. an EXACT_ALIAS family with no practice obligation -> PRODUCT_MATCHING (an uncorroborated
//      practice category is lexical noise, a documented deviation from "category first");
//   3. PARENT_CHILD / RELATED_NOT_EQUIVALENT / AMBIGUOUS never force PRODUCT_MATCHING;
//   4. then the pre-R6 order, unchanged: practice category, system-wide wording,
//      compatibility / standards / attribute rows, UNKNOWN. Requirements that mention no
//      family are NOT re-routed by text cues (R6 is precision-first, not an UNKNOWN reducer).
import { analyzeRequirementFamilyPhrase } from "./fire-alarm-taxonomy.mjs";
import { isSystemWideRequirementText } from "./technical-requirement-engine.mjs";
import { classifyCompatibilityTargets } from "./compatibility-vocabulary.mjs";
import { STANDARD_CITATION, isProductListingBody } from "./standards-citations.mjs";
import { classifyStandardOccurrence, classifyStandardRelationship } from "./standards-semantics.mjs";

export const SCOPE_VALUES = ["PROJECT_WIDE", "SYSTEM_WIDE", "FAMILY_LEVEL", "ITEM_SPECIFIC", "UNKNOWN"];
export const ROLE_VALUES = ["PRODUCT_MATCHING", "SYSTEM_ARCHITECTURE", "INSTALLATION_COMPLIANCE", "TESTING_COMMISSIONING", "DOCUMENTATION_SUBMITTAL", "MAINTENANCE_SERVICE", "COMMERCIAL", "INFORMATIONAL", "UNKNOWN"];

const PRACTICE_ROLE = {
  Documentation: "DOCUMENTATION_SUBMITTAL",
  Testing: "TESTING_COMMISSIONING",
  Commissioning: "TESTING_COMMISSIONING",
  Maintenance: "MAINTENANCE_SERVICE",
  Warranty: "COMMERCIAL",
  Manufacturer: "COMMERCIAL",
  Installation: "INSTALLATION_COMPLIANCE",
  Network: "SYSTEM_ARCHITECTURE",
};

const hasRows = (list) => Array.isArray(list) && list.length > 0;

// ---- practice obligations stated by the text's main predicate -----------------------------------
// Each cue is a MAIN-PREDICATE form: an imperative ("Install ...", "Submit ..."), a modal + be +
// participle ("shall be installed"), or a governed deliverable/party noun ("as-built drawings",
// "manufacturer shall"). A participle used as a modifier ("detectors installed in guest rooms must
// be programmed"), a product feature ("test switch", "remotely testable", "mounting: surface")
// and a bare keyword never count. The earliest cue in the text wins; ties break on the fixed
// role order below, so the result does not depend on the order of this table.
const MODAL = "(?:shall|must|should|will|to)";
const ENUMERATOR = /^\s*(?:[a-z0-9]{1,3}[.)]\s*)?/i;
const MEASURE = "(?:\\d+(?:\\.\\d+)?\\s*(?:mm|cm|m|ft|feet|foot|inch|inches|in|\")|above (?:the )?(?:floor|ceiling)|plain view)";
const CUE_ORDER = ["INSTALLATION_COMPLIANCE", "TESTING_COMMISSIONING", "DOCUMENTATION_SUBMITTAL", "MAINTENANCE_SERVICE", "COMMERCIAL", "SYSTEM_ARCHITECTURE"];
export const OBLIGATION_CUES = Object.freeze([
  { id: "INSTALL_IMPERATIVE", role: "INSTALLATION_COMPLIANCE", pattern: /^\s*(?:(?:provide|furnish|supply)\s+and\s+)?(?:install|mount|attach|terminate|anchor)\b/i, sentenceStart: true },
  { id: "INSTALL_MODAL_BE", role: "INSTALLATION_COMPLIANCE", pattern: new RegExp(`\\b${MODAL}\\s+(?:also\\s+|then\\s+)?be\\s+(?:installed|terminated|labell?ed|anchored|fastened)\\b`, "i") },
  { id: "INSTALL_MODAL_PLACE", role: "INSTALLATION_COMPLIANCE", pattern: new RegExp(`\\b${MODAL}\\s+(?:also\\s+|then\\s+)?be\\s+(?:attached|fixed|located)\\b`, "i") },
  { id: "INSTALL_MODAL_INSTALL", role: "INSTALLATION_COMPLIANCE", pattern: /\b(?:shall|must|should|will)\s+install\b/i },
  { id: "INSTALL_MOUNTED_AT", role: "INSTALLATION_COMPLIANCE", pattern: new RegExp(`\\b${MODAL}\\s+(?:also\\s+)?be\\s+(?:[a-z-]+\\s+){0,2}mounted\\s+(?:at|on|in|within|above|below|from|per|using|by|adjacent|near)\\b`, "i") },
  { id: "INSTALL_MOUNTED_MEASURED", role: "INSTALLATION_COMPLIANCE", pattern: new RegExp(`\\bmounted\\s+(?:in|at|on|within|above|below)\\b[^.;]{0,50}?\\b${MEASURE}`, "i") },
  { id: "INSTALL_NOUN", role: "INSTALLATION_COMPLIANCE", pattern: /\binstallation\s+(?:of|shall|must|should|requirements?|methods?|instructions?)\b/i },
  { id: "TEST_IMPERATIVE", role: "TESTING_COMMISSIONING", pattern: /^\s*(?:test|verify|inspect|commission|calibrate|witness)\b(?!\s+(?:certificates?|reports?|data|results?|equipment|instruments?|points?|switch(?:es)?|records?|procedures?)\b)/i, sentenceStart: true },
  { id: "TEST_MODAL_BE", role: "TESTING_COMMISSIONING", pattern: new RegExp(`\\b${MODAL}\\s+(?:also\\s+)?be\\s+(?:tested|inspected|commissioned|calibrated|witnessed)\\b(?!\\s*,?\\s*(?:and\\s+)?(?:listed|labell?ed|certified|approved|rated|marked))`, "i") },
  { id: "TEST_MODAL_TEST", role: "TESTING_COMMISSIONING", pattern: /\b(?:contractor|installer|manufacturer|supplier|vendor|engineer|consultant|technician)s?\s+(?:shall|must|will|should)\s+(?:also\s+)?(?:test|commission|inspect|verify)\b/i },
  { id: "TEST_PROCEDURE", role: "TESTING_COMMISSIONING", pattern: /\b(?:acceptance|commissioning|performance|functional|final|site|factory|pre-?commissioning|periodic)\s+(?:acceptance\s+)?(?:tests?|testing|inspections?)\b(?!\s+(?:switch|feature|point|button|station|lamp|led|port|mode|magnet|key|function|capability))/i },
  { id: "TEST_NOUN", role: "TESTING_COMMISSIONING", pattern: /(?<![,&]\s*|\b(?:and|or)\s+)\btesting\s+(?:shall|must|of|and\s+commissioning|procedures?|requirements?|per|in\s+accordance)\b/i },
  { id: "DOC_IMPERATIVE", role: "DOCUMENTATION_SUBMITTAL", pattern: /^\s*(?:(?:submit|prepare)\s+(?:[\w&/,-]+\s+){0,4}?(?=(?:shop\s+drawings?|as-?built|record\s+drawings?|data\s?sheets?|technical\s+data|product\s+data|submittals?|calculations?|certificates?|reports?|record\s+of\s+completion|documentation)\b)|(?:provide|furnish|supply|include)\s+)(?:(?:all|the|complete|detailed|full|updated|approved)\s+)*(?:shop\s+drawings?|as-?built(?:\s+drawings?)?|record\s+drawings?|data\s?sheets?|technical\s+data|product\s+data|submittals?|documentation|(?:operation\s+and\s+maintenance|o&m|operating|user|instruction|installation|service)\s+manuals?|calculations?|certificates?|test\s+reports?|reports?|drawings?|record\s+of\s+completion)\b/i, sentenceStart: true },
  { id: "DOC_MODAL_SUBMIT", role: "DOCUMENTATION_SUBMITTAL", pattern: /\b(?:shall|must|should|will|to)\s+(?:also\s+)?(?:be\s+)?submitt?ed?\b|\b(?:shall|must|should|will)\s+submit\b/i },
  { id: "DOC_MODAL_DELIVER", role: "DOCUMENTATION_SUBMITTAL", pattern: /\b(?:shall|must|will)\s+deliver\s+(?:an?|the)\s+(?:[a-z-]+\s+){0,2}(?:reports?|certificates?|records?|manuals?|drawings)\b/i },
  { id: "DOC_DELIVERABLE", role: "DOCUMENTATION_SUBMITTAL", pattern: /(?<!(?:manufacturer['’]?s?|per|with|to|following|by|of|in)\s+)\b(?:shop\s+drawings?|as-?built\s+drawings?|as-?builts?|record\s+drawings?|o&m\s+manuals?|operation\s+and\s+maintenance\s+manuals?|(?:user|operating|instruction|installation)\s+manuals?|submittals?)\b/i },
  { id: "MAINT_SERVICE", role: "MAINTENANCE_SERVICE", pattern: /\b(?:preventive\s+)?maintenance\s+(?:contracts?|visits?|periods?|agreements?|schedules?|programs?|services?|obligations?)\b|\bspare\s+parts?\b|\bservice\s+visits?\b/i },
  { id: "COMMERCIAL_PARTY", role: "COMMERCIAL", pattern: /\b(?:manufacturer|supplier|vendor)s?(?:['’]s)?\s+(?:shall|must|should|will|is|are|has|have|to)\b|\b(?:manufacturer|supplier|vendor)s?\s+(?:qualifications?|experience|certificates?|agents?|agency)\b|\bapproved\s+(?:manufacturers?|vendors?|suppliers?|makes?)\b/i },
  { id: "COMMERCIAL_TERMS", role: "COMMERCIAL", pattern: /\bwarrant(?:y|ies)\b|\byears?['’]?\s+(?:of\s+)?experience\b|\bagency\s+agreement\b|\bpriced\s+(?:maintenance\s+)?proposal\b/i },
  { id: "SYSTEM_NETWORK", role: "SYSTEM_ARCHITECTURE", pattern: /\bnetwork(?:ed|ing|s)?\b(?!\s+(?:interface|card|module|node|switch|adapter|port|cable|cabling|equipment|transport|electronics)s?\b)|\btopology\b/i },
]);

const SUBORDINATE_PLACEMENT = new Set(["INSTALL_MOUNTED_AT", "INSTALL_MOUNTED_MEASURED", "INSTALL_MODAL_PLACE"]);
const FEATURE_PREDICATE = /\b(?:include|includes|provide|have|has|incorporate|incorporates|feature|features)\b/i;

export const detectPracticeObligation = (value) => {
  const text = String(value ?? "").replace(ENUMERATOR, "");
  let best = null;
  for (const cue of OBLIGATION_CUES) {
    const match = cue.pattern.exec(text);
    if (!match) continue;
    // A placement/mounting phrase that follows a product-feature predicate ("shall include remote
    // indicators ... mounted at 48 inches") describes a feature of the product, not the main obligation.
    if (SUBORDINATE_PLACEMENT.has(cue.id) && FEATURE_PREDICATE.test(text.slice(0, match.index))) continue;
    // "shall be located" is the weakest installation verb: far from the sentence start it is a trailing clause.
    if (cue.id === "INSTALL_MODAL_PLACE" && match.index > 80) continue;
    const candidate = { id: cue.id, role: cue.role, index: match.index, matched: match[0].trim() };
    if (!best || candidate.index < best.index || (candidate.index === best.index && CUE_ORDER.indexOf(candidate.role) < CUE_ORDER.indexOf(best.role))) best = candidate;
  }
  return best;
};

// ---- product-technical criterion (protects a genuinely product-specific claim from a weak cue) -----
// Only strict, structured evidence counts: a P3 PRODUCT_STANDARD listing claim, a protocol target
// stated with a support/compatibility verb, or a governed device-attribute row. A bare technical
// predicate ("shall have") is NOT enough, because installation/test/submittal clauses use it too.
const DEVICE_ATTRIBUTE_NAMES = new Set(["fixed_temperature_setpoint", "rate_of_rise_sensitivity", "addressing", "sound_output", "candela_rating", "humidity_range", "temperature_range", "battery_capacity", "battery_autonomy", "IP Rating", "IK Rating", "detection_principle", "protocol"]);
const PROTOCOL_VERB = /\b(?:support|supports|supporting|compatible|compatibility|compliant|communicat\w+\s+(?:using|via|with)|use|uses|using)\b/i;
const LISTING_RELATIONSHIPS = new Set(["LISTED_TO", "CERTIFIED_TO", "APPROVED", "TESTED_TO", "COMPLIES_WITH"]);

const listingClaim = (text, family) => {
  for (const match of text.matchAll(STANDARD_CITATION)) {
    const body = (/^[A-Za-z]+/.exec(match[0]) || [""])[0];
    if (!isProductListingBody(body)) continue;
    const relationship = classifyStandardRelationship(text, match[0]);
    if (!LISTING_RELATIONSHIPS.has(relationship)) continue;
    const number = match[0].slice(body.length).replace(/^[\s\-:/]+/, "") || null;
    if (classifyStandardOccurrence({ body, number, relationship, category: "Other", family, text, citation: match[0] }).semantic === "PRODUCT_STANDARD") return match[0];
  }
  return null;
};

export const detectProductTechnicalCriterion = ({ text = "", family = null, attributes = [] } = {}) => {
  const value = String(text);
  const citation = listingClaim(value, family);
  if (citation) return { kind: "PRODUCT_LISTING", citation };
  if (classifyCompatibilityTargets(value).some((hit) => hit.type === "PROTOCOL") && PROTOCOL_VERB.test(value)) return { kind: "PROTOCOL_TARGET" };
  const attribute = (attributes || []).find((row) => DEVICE_ATTRIBUTE_NAMES.has(row?.name));
  if (attribute) return { kind: "DEVICE_ATTRIBUTE", name: attribute.name };
  return null;
};

// With NO family mentioned, only these main-predicate cues may promote a requirement whose own
// category is not already a practice category (installation/testing/submittal predicates are precise;
// party, service and network wording is not enough evidence without a device family).
const STANDALONE_CUES = new Set(["INSTALL_IMPERATIVE", "INSTALL_MODAL_BE", "INSTALL_MODAL_INSTALL", "INSTALL_MOUNTED_AT", "INSTALL_MOUNTED_MEASURED", "TEST_IMPERATIVE", "TEST_MODAL_BE", "TEST_MODAL_TEST", "TEST_PROCEDURE", "DOC_IMPERATIVE", "DOC_MODAL_SUBMIT", "DOC_MODAL_DELIVER"]);

// Cues that merely MENTION a deliverable/installation noun; they yield to a product-technical criterion.
const WEAK_CUES = new Set(["INSTALL_NOUN", "DOC_DELIVERABLE"]);

// RELATED_NOT_EQUIVALENT (a device-ish noun, no specified device identity) and NONE are not competing family evidence.
const FAMILY_COMPETES = new Set(["EXACT_ALIAS", "PARENT_CHILD", "AMBIGUOUS"]);

export function resolveRequirementRoute(requirement = {}, { analyzeFamily = analyzeRequirementFamilyPhrase } = {}) {
  const text = String(requirement.originalText || requirement.original_text || "");
  const category = String(requirement.requirementCategory || requirement.requirement_category || "Other");
  const analysis = analyzeFamily(text);
  const exactFamily = analysis.matchClass === "EXACT_ALIAS" ? analysis.family : null;
  const systemWide = isSystemWideRequirementText(text);
  const evidence = { familyMatchClass: analysis.matchClass, familyGroup: analysis.parentGroup || null, mentionedFamily: exactFamily };

  // Family evidence only COMPETES with a practice obligation when a family is mentioned at all.
  // Requirements that mention no family keep the pre-R6 order below (their UNKNOWN rows are not
  // promoted here: R6 is precision-first, not an UNKNOWN reducer).
  if (FAMILY_COMPETES.has(analysis.matchClass)) {
    // 1. A practice obligation stated by the text's own main predicate outranks any family mention
    //    (EXACT_ALIAS, PARENT_CHILD and AMBIGUOUS alike).
    // "network" is the weakest cue: inside a different practice category ("cabinet for mounting ...
    // network electronics", Installation) it does not count, so the family/category logic decides.
    const rawObligation = detectPracticeObligation(text);
    const obligation = rawObligation?.id === "SYSTEM_NETWORK" && !exactFamily && PRACTICE_ROLE[category] && PRACTICE_ROLE[category] !== "SYSTEM_ARCHITECTURE" ? null : rawObligation;
    const protectedByCriterion = obligation && WEAK_CUES.has(obligation.id) && exactFamily && detectProductTechnicalCriterion({ text, family: exactFamily, attributes: requirement.attributes });
    if (obligation && !protectedByCriterion) {
      return { scope: obligation.role === "SYSTEM_ARCHITECTURE" && category !== "Network" ? "SYSTEM_WIDE" : "PROJECT_WIDE", role: obligation.role, family: null, ...evidence, basis: [`OBLIGATION_${obligation.id}`, ...(PRACTICE_ROLE[category] === obligation.role ? [`CATEGORY_${category}_CORROBORATED`] : [])], unknown: false };
    }
    // 2. Only an EXACT_ALIAS family, with no practice obligation, makes it product matching.
    //    PARENT_CHILD / RELATED_NOT_EQUIVALENT / AMBIGUOUS never do (they fall through).
    if (exactFamily) {
      return { scope: "FAMILY_LEVEL", role: "PRODUCT_MATCHING", family: exactFamily, ...evidence, basis: ["EXPLICIT_FAMILY_PHRASE", ...(protectedByCriterion ? [`PRODUCT_CRITERION_${protectedByCriterion.kind}`] : [])], unknown: false };
    }
    // 3. PARENT_CHILD / AMBIGUOUS alone are insufficient. The product-specific exception: a strict
    //    product-technical criterion (P3 product listing, protocol target, device attribute row)
    //    on a group mention ("smoke detector") is genuine product matching; family stays null
    //    (a group is not a resolved family).
    if (analysis.matchClass === "PARENT_CHILD") {
      const criterion = detectProductTechnicalCriterion({ text, family: analysis.parentGroup, attributes: requirement.attributes });
      if (criterion) return { scope: "FAMILY_LEVEL", role: "PRODUCT_MATCHING", family: null, ...evidence, basis: ["PARENT_GROUP_WITH_PRODUCT_CRITERION", criterion.kind], unknown: false };
    }
  } else if (!PRACTICE_ROLE[category]) {
    // No family mentioned and no practice category: a precise main-predicate cue ("All devices shall be
    // installed per NFPA 72") routes the obligation; everything else keeps the pre-R6 order below.
    const obligation = detectPracticeObligation(text);
    if (obligation && STANDALONE_CUES.has(obligation.id)) {
      return { scope: "PROJECT_WIDE", role: obligation.role, family: null, ...evidence, basis: [`OBLIGATION_${obligation.id}`], unknown: false };
    }
  }
  // 5a. Practice categories (no exact family and no text obligation competing) route by their governed meaning, project-wide.
  if (PRACTICE_ROLE[category]) {
    return { scope: "PROJECT_WIDE", role: PRACTICE_ROLE[category], family: null, ...evidence, basis: [`CATEGORY_${category}`], unknown: false };
  }
  // 5b. Explicit system-wide wording.
  if (systemWide) {
    return { scope: "SYSTEM_WIDE", role: "SYSTEM_ARCHITECTURE", family: null, ...evidence, basis: ["SYSTEM_WIDE_PATTERN"], unknown: false };
  }
  // 5c. Parsed compatibility targets without a device family: system architecture, never a match gate.
  if (hasRows(requirement.compatibility)) {
    return { scope: "SYSTEM_WIDE", role: "SYSTEM_ARCHITECTURE", family: null, ...evidence, basis: ["COMPATIBILITY_NO_FAMILY"], unknown: false };
  }
  // 5d. Parsed standards/listings without a device family: system-level listing obligation.
  if (hasRows(requirement.standards)) {
    return { scope: "SYSTEM_WIDE", role: "SYSTEM_ARCHITECTURE", family: null, ...evidence, basis: ["STANDARDS_NO_FAMILY"], unknown: false };
  }
  // 5e. Parsed attributes without a device family: measurable system property.
  if (hasRows(requirement.attributes)) {
    return { scope: "SYSTEM_WIDE", role: "SYSTEM_ARCHITECTURE", family: null, ...evidence, basis: ["ATTRIBUTES_NO_FAMILY"], unknown: false };
  }
  return { scope: "UNKNOWN", role: "UNKNOWN", family: null, ...evidence, basis: ["INSUFFICIENT_ROUTING_EVIDENCE"], unknown: true };
}
