// Sprint 1.2 -- Step 6/7/8: panel-level SLC sizing orchestration.
//
// The Sprint 1.1 pure calculator (calculateSlcExpansion) is reused UNCHANGED
// -- this file only decides WHICH demand gets fed into it, once per real
// physical panel, and aggregates the results. It never performs the loop
// arithmetic itself.
//
// Panel count is never hardcoded here: it comes entirely from the `panels`
// array the caller supplies, which must itself come from real project
// topology evidence (Sprint 1.2 Steps 1-4). An empty/unknown panel list is
// NOT silently treated as "one project-wide panel" -- see
// INSUFFICIENT_TOPOLOGY_EVIDENCE below.
import { calculateSlcExpansion } from "./fire-alarm-slc-capacity-calculator.mjs";

export const PROJECT_SLC_SIZING_STATUSES = Object.freeze([
  "AUTHORITATIVE_PANEL_SIZING",
  "INSUFFICIENT_TOPOLOGY_EVIDENCE",
]);

// panels: [{ panelId, demand: {detectors, modules}, panelCapacity, expansionOptions }]
// -- `demand` on each panel entry must already be the EVIDENCE-ALLOCATED
// demand for that specific panel (see fire-alarm-panel-demand-allocation.mjs)
// -- this function never derives it by dividing a project total.
export const sizeProjectSlcPanels = ({ panels = [], unallocatedDemand = null } = {}) => {
  if (!Array.isArray(panels) || panels.length === 0) {
    return {
      status: "INSUFFICIENT_TOPOLOGY_EVIDENCE",
      reason: "No physical panel topology evidence is available to allocate project demand against. Panel identity and BOQ-to-panel allocation must come from project evidence (drawings, riser diagrams, panel schedules, or an explicit specification statement) -- never assumed, and never defaulted to a single project-wide panel.",
      panels: [],
      projectTotal: null,
      unallocatedDemand,
    };
  }
  const panelResults = panels.map((panel) => ({
    panelId: panel.panelId,
    ...calculateSlcExpansion({ demand: panel.demand, panelCapacity: panel.panelCapacity, expansionOptions: panel.expansionOptions }),
  }));
  const projectTotal = {
    requiredExpansionQuantity: panelResults.reduce((sum, p) => sum + (p.requiredExpansionQuantity || 0), 0),
    mountingUnitQuantity: panelResults.reduce((sum, p) => sum + (p.mountingUnit?.quantity || 0), 0),
    anyInsufficientEvidence: panelResults.some((p) => p.status === "INSUFFICIENT_EVIDENCE"),
    anyCapacityExceeded: panelResults.some((p) => p.status === "CAPACITY_EXCEEDED"),
    anyConflict: panelResults.some((p) => p.status === "CONFLICT"),
  };
  return { status: "AUTHORITATIVE_PANEL_SIZING", panels: panelResults, projectTotal, unallocatedDemand };
};

// Step 8 -- an explicitly-labeled, non-authoritative reference calculation
// only, treating the ENTIRE project's demand as one hypothetical panel. Must
// never be presented or stored as a final engineering quantity -- callers
// are responsible for keeping the label attached wherever this result flows.
export const nonAuthoritativeAggregateCheck = ({ demand, panelCapacity, expansionOptions }) => ({
  label: "NON_AUTHORITATIVE_AGGREGATE_CHECK",
  warning: "This treats the project's entire demand as a single hypothetical panel for exploratory reference only. It is NOT a verified per-panel engineering quantity and must never be used as a final expansion quantity.",
  result: calculateSlcExpansion({ demand, panelCapacity, expansionOptions }),
});
