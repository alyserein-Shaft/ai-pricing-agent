// Sprint 1.1 -- Step 9: integrate calculateSlcExpansion with the existing
// Sprint 1.0 conditional relationship runtime, WITHOUT turning capacity
// sizing into general semantic condition evaluation. These stay two
// genuinely separate engines answering two separate questions:
//   - product-relationship-condition-engine.mjs: "is this relationship
//     applicable at all" (SATISFIED / NOT_SATISFIED / UNKNOWN / CONFLICT),
//     driven by evaluateRelationshipCondition against approved requirement
//     facts.
//   - this file: "how many are needed", driven ONLY by real project SLC
//     demand + verified product capacity evidence, never by a semantic
//     keyword match against accessory text/notes.
import { calculateSlcExpansion } from "./fire-alarm-slc-capacity-calculator.mjs";

const CAPACITY_DEPENDENT_MARKER = "CAPACITY_DEPENDENT";

// accessory: one entry of product.accessories[] (already relationship-approved
// upstream -- see product-matching-engine.mjs's resolveAccessoryCandidates).
// capacityEvidence: { demand, panelCapacity, expansionOptions } -- see
// calculateSlcExpansion's contract. Must be supplied by the caller from
// verified, evidence-backed project + product facts; this function never
// invents or defaults any of it.
export const resolveCapacityDependentAccessory = (accessory, capacityEvidence) => {
  const quantityRule = String(accessory?.quantityRule || "");
  if (!quantityRule.includes(CAPACITY_DEPENDENT_MARKER)) return null; // not a capacity-dependent relationship at all -- out of scope for this resolver.

  if (!capacityEvidence) {
    return {
      accessoryPartNumber: accessory.accessoryPartNumber,
      accessoryProductId: accessory.accessoryProductId,
      status: "INSUFFICIENT_EVIDENCE",
      requiredExpansionQuantity: null,
      calculationTrace: ["Relationship is CAPACITY_DEPENDENT but no project SLC demand / verified product capacity evidence was supplied to this resolution. A capacity-dependent quantity is never inferred from the relationship's existence alone."],
      missingInputs: ["capacityEvidence"],
    };
  }

  const result = calculateSlcExpansion(capacityEvidence);
  return { accessoryPartNumber: accessory.accessoryPartNumber, accessoryProductId: accessory.accessoryProductId, ...result };
};
