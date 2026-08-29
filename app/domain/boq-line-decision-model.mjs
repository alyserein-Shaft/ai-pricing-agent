// Phase 5 workflow-continuity fix -- the single, generic place a BOQ line's
// precise unresolved engineering discriminator and composite user-facing
// status are computed. Pure domain logic only: every input here is already
// governed data (approved understanding, persisted requirement profile,
// persisted match candidates and their own recorded product attributes,
// safety decision state) read by the worker aggregator
// (worker/boq-line-decision-api.mjs) from EXISTING authoritative tables --
// nothing here creates or duplicates a review table, and nothing here is
// specific to Fire Alarm, Central Kitchen, or any named row. The same
// functions run identically for any system pack's own equivalent ambiguity.
import { normalizeAttributeName, validateAttributeValue } from "./system-knowledge-registry.mjs";

const rawAttributeName = (attribute) => attribute?.name || attribute?.attributeName || attribute?.canonicalName || attribute?.originalName;
const attributeValue = (attribute) => attribute?.normalizedValue ?? attribute?.parsedValue ?? attribute?.value ?? attribute?.originalValue;
// A genuine controlled-choice value (Single Action, Outdoor, 10) is a short,
// single token or phrase; a descriptive/reference field (a compatible-panel
// list, a wiring/mounting note, a contact-rating table) reads as a long,
// comma- or semicolon-joined string. This is a purely structural check on
// shape, never a named attribute list, so it applies identically to any
// system's catalog.
const isEnumLikeValue = (value) => !/[,;]/.test(String(value)) && String(value).length <= 40;
const label = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase().replace(/^./, (char) => char.toUpperCase());
const missingApprovedValue = (approvedAttributes, canonicalName) => {
  const fact = approvedAttributes?.[canonicalName];
  return !fact || fact.value == null || fact.value === "" || ["MISSING", "NOT_APPLICABLE"].includes(fact.origin);
};

// Finds the one attribute where the item's OWN approved understanding is
// silent (no recorded value) but the candidates still genuinely competing
// for the top rank disagree on it -- exactly the fact an engineer's decision
// would resolve. "Still competing" is deliberately narrow: only candidates
// in the SAME family tier as the best-ranked candidate (familyMatchTier is
// the frozen v1 ranking mechanism -- see product-matching-engine.mjs), since
// a wrong-family fallback's attribute values say nothing about what the
// correct-family item actually needs. Ties are broken by which attribute
// fragments the field into the most distinct values (the most decisive
// question), then alphabetically for determinism.
export function findDiscriminatingAttribute({ system, approvedAttributes = {}, candidates = [] }) {
  if (!candidates.length) return null;
  const bestTier = Math.min(...candidates.map((candidate) => candidate.familyMatchTier ?? 0));
  const viable = candidates.filter((candidate) => (candidate.familyMatchTier ?? 0) === bestTier);
  if (viable.length < 2) return null;
  const valuesByAttribute = new Map();
  for (const candidate of viable) {
    for (const attribute of candidate.attributes || []) {
      const raw = rawAttributeName(attribute);
      const canonicalName = (raw && normalizeAttributeName(system, raw, candidate.family)) || raw;
      if (!canonicalName) continue;
      const value = attributeValue(attribute);
      if (value == null || value === "") continue;
      const set = valuesByAttribute.get(canonicalName) || new Map();
      set.set(String(value), (set.get(String(value)) || 0) + 1);
      valuesByAttribute.set(canonicalName, set);
    }
  }
  // Only a genuinely enum-like attribute (every distinct value short and
  // plain, not a descriptive list) is eligible -- a long, comma-joined
  // reference field (compatible panel lists, contact-rating tables, wiring
  // notes) can differ between two candidates for entirely incidental
  // reasons and is never a real engineering decision an engineer "picks
  // from". If nothing enum-like differs, this honestly reports no
  // candidate-level discriminator rather than asking a misleading question
  // built from a descriptive field. Among genuine candidates, the TIGHTEST
  // split (fewest distinct values, minimum 2) is preferred -- a real
  // controlled choice (Single/Dual Action, Indoor/Outdoor, 1/2/10 channels)
  // is almost always a small, clean enumeration.
  const ranked = [...valuesByAttribute.entries()]
    .filter(([name, values]) => values.size > 1 && missingApprovedValue(approvedAttributes, name) && [...values.keys()].every(isEnumLikeValue))
    .sort((a, b) => a[1].size - b[1].size || a[0].localeCompare(b[0]));
  if (!ranked.length) return null;
  const [attributeName, values] = ranked[0];
  const options = [...values.keys()].sort();
  const controlled = options.length >= 2 && options.length <= 6 && options.every((option) => validateAttributeValue(system, attributeName, option).valid);
  const question = options.length === 2
    ? `Which ${label(attributeName)} is required — ${options[0]} or ${options[1]}?`
    : `Which ${label(attributeName)} is required — ${options.slice(0, -1).join(", ")}, or ${options[options.length - 1]}?`;
  return { source: "Candidate Discriminator", attributeName, options, kind: controlled ? "CONTROLLED_CHOICE" : "OPEN_INPUT", question };
}

// Fallback engineer questions, in priority order, when no candidate-level
// discriminator applies: a real, already-governed requirement-profile
// clarification (buildTechnicalRequirementProfile's own generic
// missing-information/conflict detection -- never Fire-Alarm-specific), then
// an understanding-review classification/matching blocker. Every one of
// these already exists as governed data; this only picks the single most
// relevant one to surface as THE current question, instead of a caller
// having to scan three separate lists to find it.
export function selectFallbackQuestion({ clarifications = [], classificationBlockers = [], matchingBlockers = [] }) {
  const openClarification = clarifications.find((entry) => entry.status === "Open" && (entry.priority === "High" || entry.priority === "Critical"));
  if (openClarification) return { source: "Requirement Clarification", attributeName: openClarification.relatedField || null, options: [], kind: "OPEN_INPUT", question: openClarification.question };
  const classificationGap = classificationBlockers[0];
  if (classificationGap) return { source: "Classification Gap", attributeName: classificationGap.field, options: [], kind: "OPEN_INPUT", question: `Confirm ${label(classificationGap.field)} for this BOQ item — ${classificationGap.reason}` };
  const matchingGap = matchingBlockers[0];
  if (matchingGap) return { source: "Matching Evidence Gap", attributeName: matchingGap.field, options: [], kind: "OPEN_INPUT", question: `Confirm ${label(matchingGap.field?.replace(/^attributes\./, ""))} for this BOQ item — ${matchingGap.reason}` };
  return null;
}

export const LINE_STATES = Object.freeze([
  "AI_REVIEW_REQUIRED",
  "STALE_RECALCULATING",
  "RECALCULATION_FAILED",
  "TECHNICAL_DECISION_REQUIRED",
  "NO_MATCH",
  "TECHNICALLY_READY",
]);

const LINE_STATE_LABELS = Object.freeze({
  AI_REVIEW_REQUIRED: "AI understanding needs engineer review",
  STALE_RECALCULATING: "Recalculating downstream results",
  RECALCULATION_FAILED: "Automatic recalculation failed — resync required",
  TECHNICAL_DECISION_REQUIRED: "Engineer technical decision required",
  NO_MATCH: "No technically viable candidate",
  TECHNICALLY_READY: "Technically ready",
});

// One user-facing answer to "what does this line still need before
// technical selection is complete", derived from existing authoritative
// state -- never a new stored status, always recomputed from what the
// governed sources say right now. Priority order matters: an approval gap
// always outranks a stale recalculation (nothing downstream can be trusted
// until understanding is approved), and a failed/in-flight recalculation
// always outranks a stale "no match"/"decision required" reading of data
// that is known to be about to change.
export function deriveCompositeLineState({ understandingReviewStatus, recalculationStatus, hasViableCandidate, hasOpenEngineerQuestion, hasOpenSafetyBlock }) {
  const state = understandingReviewStatus !== "APPROVED" ? "AI_REVIEW_REQUIRED"
    : recalculationStatus === "Recalculating" ? "STALE_RECALCULATING"
    : recalculationStatus === "Failed" ? "RECALCULATION_FAILED"
    : !hasViableCandidate ? "NO_MATCH"
    : (hasOpenEngineerQuestion || hasOpenSafetyBlock) ? "TECHNICAL_DECISION_REQUIRED"
    : "TECHNICALLY_READY";
  return { state, label: LINE_STATE_LABELS[state] };
}
