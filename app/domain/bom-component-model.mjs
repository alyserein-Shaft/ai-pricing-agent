// Phase 5 workflow-continuity fix -- the generic, per-line BOM composite
// model. Every input here is read from EXISTING Product Knowledge
// (library_products / product_accessories, already governed, already
// review-status filtered by the caller) and existing project-scoped
// engineering evidence (approved understanding attributes, an engineer's own
// prior accessory selection) -- nothing here is a new authoritative
// compatibility rule, and nothing here assumes a Fire-Alarm-only 1:1
// detector/base shape. The same classification runs identically for an
// Access Control door kit or a CCTV camera bundle once those packs' own
// product_accessories rows exist.
import { requiresDetectorBase } from "./system-knowledge-registry.mjs";
import { evaluateRelationshipCondition, resolveRelationshipApplicability } from "./product-relationship-condition-engine.mjs";

const CAPACITY_DEPENDENT_PATTERN = /capacity.depend|not calculated by this system/i;
const REQUIRED_LABEL_PATTERN = /^required\b/i;
const BASE_LABEL_PATTERN = /\bbase\b/i;
const label = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase().replace(/^./, (char) => char.toUpperCase());

const isDeterministicRatio = (quantityRule, quantityParameter) =>
  Number.isFinite(Number(quantityParameter)) && Number(quantityParameter) > 0 && !CAPACITY_DEPENDENT_PATTERN.test(String(quantityRule || ""));

// A quantity object that always retains value/unit/source/origin/derivation,
// per the required generic contract -- even when no value can be derived,
// so a future Cost Build-Up stage (and this UI) always gets the same shape.
export function deriveComponentQuantity({ quantityRule, quantityParameter, confidence }, primaryQuantity) {
  if (!isDeterministicRatio(quantityRule, quantityParameter)) {
    return { value: null, unit: null, origin: null, derivationRule: quantityRule || null, source: "Product Knowledge accessory relationship", confidence: confidence ?? null };
  }
  const ratio = Number(quantityParameter);
  const numericPrimary = Number(primaryQuantity);
  const value = Number.isFinite(numericPrimary) ? Number((numericPrimary * ratio).toFixed(4)) : null;
  return { value, unit: "Each", origin: "DERIVED_FROM_PRIMARY_QUANTITY", derivationRule: quantityRule || `${ratio}:1 ratio to the primary product quantity`, source: "Product Knowledge accessory relationship", confidence: confidence ?? null };
}

export function primaryQuantityRecord({ value, unit, origin = "CLIENT_BOQ" }) {
  return { value: value ?? null, unit: unit || null, origin, derivationRule: null, source: "Original BOQ evidence", confidence: null };
}

// Classifies every persisted, approved accessory relationship on the
// PRIMARY selected product into one of the six BOM roles. `selections` is a
// map of relationshipType -> { accessoryProductId } recording a prior
// engineer choice (see worker/boq-line-bom-api.mjs), read from
// engineering_facts -- never invented here.
export function classifyBomComponents({ system, primaryFamily, primaryQuantity, accessories = [], approvedFacts = [], selections = {} }) {
  const evaluated = accessories.map((accessory) => {
    const conditions = Array.isArray(accessory.conditions) ? accessory.conditions : [];
    const conditionResult = evaluateRelationshipCondition(conditions, approvedFacts);
    const applicability = resolveRelationshipApplicability({ reviewStatus: accessory.reviewStatus || "Approved", conditionResult });
    return { ...accessory, conditions, conditionResult, applicability };
  });

  const unconditionalSiblings = new Map();
  for (const entry of evaluated) {
    if (entry.conditions.length) continue;
    const list = unconditionalSiblings.get(entry.relationshipType) || [];
    list.push(entry);
    unconditionalSiblings.set(entry.relationshipType, list);
  }
  // If this SAME relationshipType also has a genuinely conditional entry
  // recorded elsewhere on this product (e.g. "Sounding Base" almost always
  // appears alongside a conditional sounder-base row), that is real catalog
  // evidence the whole concept is feature-gated -- an unconditional sibling
  // under the identical name is never treated as its own separate
  // architecturally-required slot, even though its name also contains
  // "base". This is purely a same-product, same-name data pattern, never a
  // hardcoded relationship name.
  const conditionallyGatedTypes = new Set(evaluated.filter((entry) => entry.conditions.length).map((entry) => entry.relationshipType));

  // A quantity is only ever a real, decided number once the component is
  // actually confirmed as part of the BOM -- an alternative not yet chosen,
  // or a condition not yet resolved, keeps its derivation RULE visible
  // (so the engineer can see what the quantity WOULD be) but never a
  // computed value, so nothing here is ever misread as "230 required" for a
  // component that is still genuinely undecided.
  const quantityIfIncluded = (entry) => deriveComponentQuantity(entry, primaryQuantity);
  const quantityPending = (entry) => ({ ...quantityIfIncluded(entry), value: null, origin: null });

  return evaluated.map((entry) => {
    if (entry.conditions.length) {
      // A conditional relationship: SATISFIED -> genuinely applies now
      // (still labeled CONDITIONAL_COMPONENT, since its inclusion depends
      // on project evidence, not on the device itself); NOT_SATISFIED ->
      // ruled out (NOT_APPLICABLE); anything else (UNKNOWN/CONFLICT/not yet
      // approved) is an open BOM decision, with no quantity fabricated yet.
      const role = entry.applicability.status === "Not Applicable" ? "NOT_APPLICABLE" : "CONDITIONAL_COMPONENT";
      const decisionNeeded = !entry.applicability.applicable && entry.applicability.status !== "Not Applicable";
      const quantity = entry.applicability.applicable ? quantityIfIncluded(entry) : quantityPending(entry);
      return { ...entry, role, quantity, decisionNeeded };
    }
    const siblings = unconditionalSiblings.get(entry.relationshipType) || [entry];
    // Two independent, generic signals that a slot is architecturally
    // required -- never a hardcoded family/PN: the relationship's OWN
    // recorded wording ("Required ..."), or an existing registry signal for
    // a base-type slot (a future system pack registers its own equivalent
    // signal the same way; a slot with neither signal defaults to optional,
    // never fabricated as required).
    const requiredSignal = !conditionallyGatedTypes.has(entry.relationshipType) && (REQUIRED_LABEL_PATTERN.test(entry.relationshipType) || (BASE_LABEL_PATTERN.test(entry.relationshipType) && requiresDetectorBase(system, primaryFamily)));
    const selection = selections[entry.relationshipType];
    if (siblings.length === 1) {
      return { ...entry, role: requiredSignal ? "REQUIRED_COMPONENT" : "OPTIONAL_COMPONENT", quantity: quantityIfIncluded(entry), decisionNeeded: false };
    }
    // Multiple unconditional alternatives for the same slot -- evidence
    // does not by itself decide between them.
    if (selection?.accessoryProductId === entry.accessoryProductId) {
      return { ...entry, role: requiredSignal ? "REQUIRED_COMPONENT" : "OPTIONAL_COMPONENT", quantity: quantityIfIncluded(entry), decisionNeeded: false, engineerSelected: true };
    }
    if (selection) return { ...entry, role: "NOT_APPLICABLE", quantity: quantityPending(entry), decisionNeeded: false, supersededBySelection: true };
    return { ...entry, role: "COMPATIBLE_ALTERNATIVE", quantity: quantityPending(entry), decisionNeeded: requiredSignal, ambiguousSlot: requiredSignal };
  });
}

// The single current BOM decision, reusing the exact question-and-answer
// pattern proven in the Unified Engineer Decision Center (Vertical Slice
// 1): a governed reason, a structured kind, and (for a controlled choice) a
// closed option set -- never free-form chain-of-thought.
export function selectBomDecisionQuestion(components) {
  const ambiguous = components.find((entry) => entry.role === "COMPATIBLE_ALTERNATIVE" && entry.ambiguousSlot);
  const conditionalDecision = components.find((entry) => entry.role === "CONDITIONAL_COMPONENT" && entry.decisionNeeded);
  const attributeQuestion = (entry) => {
    const condition = entry.conditions[0];
    return {
      kind: "ATTRIBUTE_ANSWER",
      attributeName: condition?.attribute || null,
      relationshipType: entry.relationshipType,
      options: [],
      question: `Is a ${label(entry.relationshipType)} required for this item? (Confirms ${label(condition?.attribute)} = "${condition?.value}")`,
    };
  };
  const selectionQuestion = (entry) => {
    const siblings = components.filter((component) => component.relationshipType === entry.relationshipType && component.role === "COMPATIBLE_ALTERNATIVE");
    return {
      kind: "ACCESSORY_SELECTION",
      relationshipType: entry.relationshipType,
      options: siblings.map((component) => ({ accessoryProductId: component.accessoryProductId, accessoryPartNumber: component.accessoryPartNumber })),
      question: `Which ${label(entry.relationshipType)} is required — ${siblings.map((component) => component.accessoryPartNumber).join(", ")}?`,
    };
  };
  // A gate question ("is a sounder needed at all?") must be answered before
  // a variant question for the SAME named slot ("which sounder base
  // variant?") -- picking a specific accessory before confirming the slot
  // even applies would be premature. Only takes priority when the two
  // genuinely share a relationshipType; an unrelated ambiguous slot (e.g.
  // Compatible Base) is unaffected and keeps its own priority.
  if (conditionalDecision && (!ambiguous || ambiguous.relationshipType === conditionalDecision.relationshipType)) return attributeQuestion(conditionalDecision);
  if (ambiguous) return selectionQuestion(ambiguous);
  if (conditionalDecision) return attributeQuestion(conditionalDecision);
  return null;
}

export const BOM_STATES = Object.freeze(["BOM_READY", "BOM_DECISION_REQUIRED", "BOM_EVIDENCE_INCOMPLETE", "BOM_NOT_APPLICABLE"]);
const BOM_STATE_LABELS = Object.freeze({
  BOM_READY: "BOM ready for costing",
  BOM_DECISION_REQUIRED: "Engineer BOM decision required",
  BOM_EVIDENCE_INCOMPLETE: "A required component's quantity is not yet determined",
  BOM_NOT_APPLICABLE: "No approved technical decision yet",
});

// One user-facing BOM readiness answer, always recomputed from the current
// classified components -- never a stored workflow state.
export function deriveBomReadiness({ hasPrimaryProduct, components = [], hasOpenQuestion }) {
  const state = !hasPrimaryProduct ? "BOM_NOT_APPLICABLE"
    : hasOpenQuestion ? "BOM_DECISION_REQUIRED"
    : components.some((entry) => (entry.role === "REQUIRED_COMPONENT" || (entry.role === "CONDITIONAL_COMPONENT" && entry.applicability?.applicable)) && entry.quantity?.value == null) ? "BOM_EVIDENCE_INCOMPLETE"
    : "BOM_READY";
  return { state, label: BOM_STATE_LABELS[state] };
}
