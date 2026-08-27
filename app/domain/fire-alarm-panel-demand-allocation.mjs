// Sprint 1.2 -- Step 4/5: allocate a BOQ item's evidenced SLC demand across
// physical panels. Pure, deterministic; never invents an allocation. Every
// entry in `allocations` must be an EXPLICIT, evidence-backed assignment of
// some portion of the item's quantity to a specific panel (e.g. from a
// riser diagram, panel schedule, or drawing reference) -- this function
// never splits a quantity evenly across panels on its own.
export const ALLOCATION_STATUSES = Object.freeze([
  "FULLY_ALLOCATED",
  "PARTIALLY_ALLOCATED",
  "AMBIGUOUS",
  "UNALLOCATED",
]);

// allocations: [{ panelId, quantity, evidence }] -- pre-filtered to entries
// for this boqItemId by the caller (kept explicit rather than filtering
// internally, so the caller's own evidence-sourcing stays auditable).
export const allocateBoqDemandToPanels = ({ boqItemId, totalQuantity, allocations = [] }) => {
  if (!Number.isFinite(totalQuantity) || totalQuantity < 0) {
    throw new Error("allocateBoqDemandToPanels requires a non-negative totalQuantity.");
  }
  const entries = Array.isArray(allocations) ? allocations : [];
  const allocatedQuantity = entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  const unallocatedQuantity = Math.max(0, totalQuantity - allocatedQuantity);
  let status;
  if (allocatedQuantity > totalQuantity) status = "AMBIGUOUS"; // conflicting evidence -- allocations overclaim the total
  else if (entries.length === 0) status = "UNALLOCATED";
  else if (allocatedQuantity === totalQuantity) status = "FULLY_ALLOCATED";
  else status = "PARTIALLY_ALLOCATED";
  return { boqItemId, totalQuantity, allocations: entries, allocatedQuantity, unallocatedQuantity, status };
};
