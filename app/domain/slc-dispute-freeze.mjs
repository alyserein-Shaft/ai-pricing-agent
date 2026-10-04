// SLC DISPUTE FREEZE (read-only isolation, no profile writes).
//
// Two concurrent classifier changes are UNDER_INDEPENDENT_REVIEW (Agent 3):
//   1. generic "Interface Module" now classifies NOT_SLC;
//   2. "Pull Station" moved into MODULE_FAMILIES on evidence citing the
//      unreviewed ingestion.
// Until that review closes, readiness totals must neither consume the new
// semantics as truth nor silently drop the affected populations. This module
// marks them DISPUTED_CONCURRENT_CHANGE at READ time: no profile is rewritten,
// no classifier is reversed, and the populations stay visible in their own
// bucket. Manual Call Point / Manual Station / Break Glass Unit ride along
// because the same unreviewed evidence bundle touches manual-station semantics.
//
// This freeze is TEMPORARY by design: when Agent 3 closes, either the new
// semantics are adopted (delete this module and re-profile) or they are
// reverted (delete this module). There is deliberately no third state.
export const SLC_DISPUTE_FREEZE_VERSION = "slc-dispute-freeze-1.0.0";

export const DISPUTED_SLC_FAMILIES = Object.freeze([
  "Interface Module",
  "Zone Interface Module",
  "Pull Station",
  "Manual Call Point",
  "Manual Station",
  "Pull Station",
  "Break Glass Unit",
]);

export const DISPUTE_STATUS = "DISPUTED_CONCURRENT_CHANGE";

export const isDisputedSlcFamily = (family) => {
  if (family === null || family === undefined) return false;
  return DISPUTED_SLC_FAMILIES.includes(String(family).trim());
};

// Partition a demand census into reportable buckets. `populations` are
// { family, state, demandUnits, quantity } shapes as read from persisted
// profiles. Disputed populations are lifted out of every readiness total but
// counted separately -- never merged into unresolved, never booked as zero.
export const partitionDisputedDemand = (populations) => {
  const buckets = {
    detectorPool: { populations: 0, units: 0 },
    modulePool: { populations: 0, units: 0 },
    notSlc: { populations: 0, units: 0 },
    unresolved: { populations: 0, units: 0 },
    disputed: { populations: 0, units: 0, families: {} },
  };
  for (const pop of populations || []) {
    const units = Number.isFinite(Number(pop?.demandUnits)) ? Number(pop.demandUnits) : 0;
    if (isDisputedSlcFamily(pop?.family)) {
      buckets.disputed.populations += 1;
      buckets.disputed.units += units;
      const key = String(pop.family).trim();
      buckets.disputed.families[key] = (buckets.disputed.families[key] || 0) + 1;
      continue;
    }
    if (pop?.state === "SLC_DETECTOR_POOL") { buckets.detectorPool.populations += 1; buckets.detectorPool.units += units; continue; }
    if (pop?.state === "SLC_MODULE_POOL") { buckets.modulePool.populations += 1; buckets.modulePool.units += units; continue; }
    if (pop?.state === "NOT_SLC") { buckets.notSlc.populations += 1; continue; }
    buckets.unresolved.populations += 1;
    buckets.unresolved.units += units;
  }
  return Object.freeze(buckets);
};
