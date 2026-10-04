// Narrowly-scoped deterministic System Auto-Approval for BOQ Understanding.
//
// This does not approve AI guesses. It approves only when the AI's proposed
// classification is independently REPRODUCIBLE from deterministic evidence
// this codebase already trusts elsewhere: the row's own raw description run
// back through the same governed taxonomy classifier real catalog imports
// use (classifyFireAlarmFamilyFromText), and the BOQ extraction pipeline's
// own deterministic, non-AI section-derived system_value. AI confidence is
// never read by this function -- it is not the approval authority.
//
// Fire Alarm only, for now (see FIRST_SUPPORTED_RULE below) -- this is a
// deliberately narrow first rule, not a generic cross-system policy.
import { classifyFireAlarmFamilyFromText, fireAlarmCategoryForFamily } from "./fire-alarm-taxonomy.mjs";
import { hasGovernedTaxonomy, isCanonicalPair } from "./system-knowledge-registry.mjs";

export const UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION = "understanding-system-auto-approval-1.0.0";

// The only attribute this first rule trusts as deterministically re-derivable
// today: buildFireAlarmTaxonomyContext already sets detector_technology from
// a fixed keyword regex on the row's own text (fire-alarm-taxonomy.mjs), and
// verifiedFact() (boq-understanding-engine.mjs) already refuses to leave it
// EXTRACTED unless its value is a literal substring of the row's own
// evidence text. Any other attribute name reaching this policy with a
// non-null value was asserted beyond what this policy can independently
// verify, and disqualifies auto-approval -- this is intentionally not a
// judgment call, and intentionally not extended to other attributes yet.
const DETERMINISTICALLY_VERIFIABLE_ATTRIBUTES = new Set(["detector_technology"]);

// Governance-safety reviewReasons that mean a real, unresolved question was
// raised during merge (a competing candidate, a source contradiction, a
// multi-function conflict, ...) -- never something raw AI confidence alone
// produces. Any of these present means a human question exists that this
// policy must not paper over.
const POLICY_AMBIGUITY_REASONS = new Set([
  "GOVERNED_CANDIDATE_KEY_INVALID",
  "GOVERNED_CANDIDATE_KEY_MISSING",
  "SOURCE_PROVENANCE_CONTRADICTION",
  "MULTI_FUNCTION_DETECTION_REQUIRES_REVIEW",
  "NULL_LIKE_VALUE_REQUIRES_REVIEW",
]);

const factValue = (fact) => (fact && typeof fact === "object" ? fact.value : fact) ?? null;
const factOrigin = (fact) => (fact && typeof fact === "object" ? fact.origin : null);

/**
 * Pure, read-only. No DB access, no mutation, no side effects.
 *
 * @param {object} input
 * @param {string} input.rawDescription - the BOQ row's own raw description text.
 * @param {string|null} input.boqItemSystemValue - boq_items.system_value, the
 *   deterministic, non-AI system fact the extraction pipeline already derives
 *   from the row's own section heading (never the AI's guess).
 * @param {object} input.interpretation - the validated interpretation object
 *   (validateAndMergeBoqInterpretation's own output shape): system, category,
 *   productFamily each {value, origin, confidence}; attributes: {name: {value,
 *   origin, confidence}}; ambiguities: array; reviewReasons: string[].
 * @param {string} input.proposalState - "AVAILABLE" | anything else (stale/failed/unavailable).
 * @param {Array} input.classificationBlockers - from evaluateUnderstandingAuthority.
 * @param {boolean} input.taxonomyValid - governed-candidate-accepted flag
 *   (e.g. taxonomyValidFor(row) / familyClassification.governedTaxonomyAccepted).
 */
export function evaluateUnderstandingSystemAutoApproval({
  rawDescription,
  boqItemSystemValue = null,
  interpretation,
  proposalState,
  classificationBlockers = [],
  taxonomyValid = false,
} = {}) {
  const reasons = [];
  const evidence = { policyVersion: UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION, rawDescription: rawDescription ?? null, boqItemSystemValue };

  // Gate 1 (also subsumes gate 9: staleness/input-fingerprint mismatch --
  // the caller computes proposalState from exactly that check).
  if (proposalState !== "AVAILABLE") {
    reasons.push("STALE_OR_UNAVAILABLE_PROPOSAL");
    return { eligible: false, reasons, evidence, policyVersion: UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION };
  }
  if (!interpretation) {
    reasons.push("NO_INTERPRETATION");
    return { eligible: false, reasons, evidence, policyVersion: UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION };
  }

  const system = factValue(interpretation.system);
  const category = factValue(interpretation.category);
  const productFamily = factValue(interpretation.productFamily);
  evidence.proposed = { system, category, productFamily };

  // Gate 2.
  if (classificationBlockers.length > 0) reasons.push("CLASSIFICATION_BLOCKERS_PRESENT");

  // Gate 3.
  if (!hasGovernedTaxonomy(system)) reasons.push("SYSTEM_NOT_GOVERNED");
  else if (!taxonomyValid) reasons.push("TAXONOMY_CANDIDATE_NOT_ACCEPTED");
  else if (!isCanonicalPair(system, category, productFamily)) reasons.push("TAXONOMY_PAIR_NOT_CANONICAL");

  // Gate 4 + Gate 5 (parent chain) + Gate 8 (no unresolved competing
  // candidate of equivalent validity): classifyFireAlarmFamilyFromText is
  // the SAME deterministic classifier real catalog imports are governed by
  // (fire-alarm-taxonomy.mjs). It fails closed to null on ambiguity or no
  // match -- so requiring an EXACT match against the proposal is what rules
  // out "raw text supports multiple families", "family conflicts with raw
  // text", and "a competing candidate of equivalent validity" all at once,
  // with no separate ambiguity re-implementation needed.
  const deterministic = classifyFireAlarmFamilyFromText(rawDescription);
  evidence.deterministicClassification = deterministic;
  if (!deterministic) {
    reasons.push("FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE");
  } else {
    if (deterministic.family !== productFamily) reasons.push("FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE");
    if (deterministic.category !== category) reasons.push("PARENT_CATEGORY_MISMATCH");
    if (fireAlarmCategoryForFamily(productFamily) !== category) reasons.push("PARENT_CATEGORY_MISMATCH");
  }

  // Gate 5 (system leg): the AI's proposed system must be independently
  // confirmed by the BOQ extraction pipeline's OWN deterministic,
  // section-derived system_value -- never trusted from the AI proposal
  // alone, and never re-derived from AI-fed evidence.
  if (!boqItemSystemValue || boqItemSystemValue !== system) reasons.push("SYSTEM_NOT_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT");

  // Gate 6 + 7: no technical attribute may assert more than the evidence
  // supports. Any non-null attribute value is disqualifying unless its name
  // is on the short, explicit deterministically-verifiable allow-list AND
  // its own origin is EXTRACTED (verifiedFact() already refused to leave it
  // EXTRACTED unless it is a literal substring of the row's own evidence
  // text -- this policy trusts that upstream guarantee, it does not
  // re-scan text itself).
  const attributes = interpretation.attributes || {};
  const matchedAttributes = [];
  for (const [name, fact] of Object.entries(attributes)) {
    const value = factValue(fact);
    if (value === null || value === undefined) continue;
    if (DETERMINISTICALLY_VERIFIABLE_ATTRIBUTES.has(name) && factOrigin(fact) === "EXTRACTED") {
      matchedAttributes.push(name);
      continue;
    }
    reasons.push(`ATTRIBUTE_EXCEEDS_EVIDENCE:${name}`);
  }
  evidence.matchedAttributes = matchedAttributes;

  // Same principle for manufacturer, standards, compatibility and required
  // accessories: this first rule verifies none of these independently, so
  // any non-empty list -- manufacturer inferred, a compatibility target
  // asserted, a standard cited, an accessory required -- disqualifies
  // auto-approval outright, regardless of origin. Row 15 (and every
  // equivalent bare "Heat detector" row) carries none of these, so this
  // never fires for the case this rule targets; it exists specifically to
  // keep manufacturer/protocol/panel-compatibility inference out of scope.
  for (const listName of ["manufacturerPreferences", "compatibilityRequirements", "requiredAccessories", "standards"]) {
    if ((interpretation[listName] || []).length > 0) reasons.push(`UNVERIFIED_CLAIM_PRESENT:${listName}`);
  }

  // Gate 10: no policy-defined ambiguity requiring engineer judgment.
  const ambiguities = interpretation.ambiguities || [];
  if (ambiguities.length > 0) reasons.push("POLICY_AMBIGUITY_PRESENT");
  const blockingReviewReasons = (interpretation.reviewReasons || []).filter((entry) => POLICY_AMBIGUITY_REASONS.has(entry));
  if (blockingReviewReasons.length > 0) reasons.push(`POLICY_AMBIGUITY_PRESENT:${blockingReviewReasons.join(",")}`);

  const eligible = reasons.length === 0;
  if (eligible) {
    reasons.push(
      "PRODUCT_FAMILY_DETERMINISTICALLY_REPRODUCED_FROM_RAW_TEXT",
      "PARENT_TAXONOMY_CHAIN_CONFIRMED",
      "SYSTEM_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT",
      "NO_TECHNICAL_ATTRIBUTE_EXCEEDS_EVIDENCE",
      "NO_POLICY_AMBIGUITY",
    );
  }
  return { eligible, reasons, evidence, policyVersion: UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION };
}
