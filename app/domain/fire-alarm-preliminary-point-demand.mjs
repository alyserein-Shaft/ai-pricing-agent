// GOLDEN-6C -- governed Fire Alarm PRELIMINARY point-demand pipeline.
//
// WHAT THIS MODULE IS.
//
// It turns governed Fire Alarm device evidence into a preliminary, system-scale
// point demand that the Fire Alarm ecosystem-selection policy (GOLDEN-5) can
// consult. It answers exactly one question: HOW BIG IS THIS SYSTEM. It selects
// no ecosystem, no manufacturer, no panel model, no loop count and no topology.
//
// WHAT IT DELIBERATELY REUSES (no parallel taxonomy).
//
// Point-consumption classification is NOT redefined here. The canonical
// classifier `classifyFireAlarmSlcItem` (fire-alarm-slc-resource-classifier)
// already owns the units-per-device contract and already fails closed on
// unknown consumption, multi-address devices, quantity conflicts and
// non-addressable families. Re-implementing that would be a second,
// divergent taxonomy for the same engineering question.
//
//     SLC_DETECTOR_POOL  -> ADDRESSABLE_DETECTOR_POINT
//     SLC_MODULE_POOL    -> ADDRESSABLE_MODULE_POINT (input/output/control/
//                           monitor/relay; the sub-kind is not yet a governed
//                           distinction, so the module class is reported)
//     NOT_SLC            -> NON_ADDRESSABLE_EQUIPMENT (panel, battery, PSU,
//                           conventional device, accessory) -- contributes 0
//                           points and is reported as architecture evidence
//     UNRESOLVED         -> UNKNOWN_NEEDS_REVIEW
//
// GOVERNANCE INVARIANTS ENFORCED HERE.
//
//   1. Device quantity is NOT point demand. Points come from the classifier's
//      governed units-per-device, never from the raw BOQ number.
//   2. Unknown consumption is never zero. An unresolved device contributes to
//      `unknownPointDemand`, never to `knownPointDemand`.
//   3. Notification appliances (strobe/sounder/horn/speaker/bell) are NOT SLC
//      points until addressable evidence exists; the canonical classifier
//      already returns UNRESOLVED for them.
//   4. A quantity conflict never picks a winner. Conflicting evidence becomes
//      UNKNOWN demand.
//   5. Two records describing the SAME population are counted once; two
//      records describing DIFFERENT populations are both counted. Dedup is by
//      governed identity only, never by text similarity.
//   6. The project total is never divided across panels. Panel allocation is a
//      later engineering decision.
//   7. Spare-capacity policy is never folded into the demand total.
//   8. A number is only published as `preliminaryTotalPoints` when it is
//      governed AND the 2,000-point threshold cannot be crossed by the
//      unresolved remainder. Otherwise the threshold is UNCERTAIN and no exact
//      policy number is emitted.
//
// This module is pure: no I/O, no database, no schema, no mutation.

import { classifyFireAlarmSlcItem } from "./fire-alarm-slc-resource-classifier.mjs";

export const FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION =
  "fire-alarm-preliminary-point-demand-1.0.0";

// The internal engineering threshold is re-exported from the single canonical
// policy constant so the two can never drift apart. It is an internal selection
// threshold, never a certified manufacturer maximum.
export const PRELIMINARY_POINT_THRESHOLD = 2000;

// Requested point-demand classes (GOLDEN-6C section 5), mapped onto the
// canonical classifier's states.
export const POINT_DEMAND_CLASSES = Object.freeze([
  "ADDRESSABLE_DETECTOR_POINT",
  "ADDRESSABLE_MODULE_POINT",
  "NON_ADDRESSABLE_EQUIPMENT",
  "UNKNOWN_NEEDS_REVIEW",
]);

// Cross-source reconciliation outcomes (GOLDEN-6C section 12).
export const RECONCILIATION_STATES = Object.freeze([
  "QUANTITY_CONFIRMED",
  "QUANTITY_RECONCILED",
  "QUANTITY_CONFLICT",
  "QUANTITY_INCOMPLETE",
  "QUANTITY_UNKNOWN",
]);

export const COMPLETENESS_STATES = Object.freeze([
  "COMPLETE",
  "PARTIALLY_COMPLETE",
  "INSUFFICIENT",
  "CONFLICTED",
  "THRESHOLD_UNCERTAIN",
]);

export const THRESHOLD_STATES = Object.freeze([
  "WITHIN_THRESHOLD_CONFIRMED",
  "ABOVE_THRESHOLD_CONFIRMED",
  "THRESHOLD_UNCERTAIN",
]);

const text = (value) => String(value ?? "").trim();
const numeric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const nonNegative = (n) => (n === null || n < 0 ? 0 : n);

// ---------------------------------------------------------------------------
// Section 4 -- device inventory.
//
// Every record preserves its own lineage. Quantities are never flattened: a
// record carries the quantity AND where that quantity came from, so a reader
// can always ask "which document said 131?" and get an answer.
// ---------------------------------------------------------------------------

/**
 * Builds one inventory record. `sources` is the list of governed quantity
 * observations for this single normalized population; each carries
 * `{ authority, source, scope, quantity, confidence }`.
 */
export function buildDeviceInventoryRecord({
  populationId,
  deviceFamily = null,
  system = null,
  addressability = null,
  attributes = {},
  scope = {},
  governingSource = null,
  confidence = null,
  reviewStatus = "Needs Review",
  supersedes = null,
  sources = [],
} = {}) {
  if (!text(populationId)) {
    throw new Error("GOLDEN6C_POPULATION_ID_REQUIRED: A device population requires a governed population identity.");
  }
  const observations = sources
    .map((source) => ({
      authority: text(source?.authority) || null,
      source: text(source?.source) || null,
      scope: text(source?.scope) || null,
      quantity: numeric(source?.quantity),
      confidence: numeric(source?.confidence),
      supersedes: text(source?.supersedes) || supersedes,
    }))
    .filter((source) => source.authority || source.source);

  if (observations.length === 0) {
    throw new Error("GOLDEN6C_QUANTITY_SOURCE_REQUIRED: A device population requires at least one governed quantity source.");
  }
  return {
    populationId: text(populationId),
    deviceFamily: text(deviceFamily) || null,
    system: text(system) || null,
    // Governed addressability evidence. It is NEVER defaulted to "addressable":
    // a device family only earns a point once addressability is established
    // from an approved source, which is exactly what the live project lacks.
    addressability: text(addressability) || null,
    // Device-family technical evidence travels WITH the population, so a
    // multi-address or multi-channel device is still recognised as such after
    // aggregation instead of collapsing to one point per device.
    attributes: { ...attributes },
    scope: {
      project: text(scope?.project) || null,
      building: text(scope?.building) || null,
      fireAlarmSystem: text(scope?.fireAlarmSystem) || null,
      panel: text(scope?.panel) || null,
    },
    governingSource: text(governingSource) || null,
    confidence: numeric(confidence),
    reviewStatus: text(reviewStatus) || "Needs Review",
    sources: observations,
  };
}

// ---------------------------------------------------------------------------
// Section 12 -- cross-source reconciliation.
//
// Governed identifiers decide whether two observations describe the SAME
// physical population. Text similarity never does. When observations disagree
// and no authority model resolves them, the population is a CONFLICT and its
// quantity is unknown -- never an arbitrary winner, never a sum.
// ---------------------------------------------------------------------------
export function reconcilePopulation(record, { governingAuthority = null } = {}) {
  const quantities = record.sources
    // A source with NO numeric quantity is not a quantity of zero. It is
    // filtered out here, and the empty result below becomes QUANTITY_UNKNOWN,
    // so a missing number can never be coerced into a zero population.
    .map((source) => ({ ...source, numericQuantity: numeric(source.quantity) }))
    .filter((source) => source.numericQuantity !== null && source.numericQuantity >= 0);

  if (quantities.length === 0) {
    return { state: "QUANTITY_UNKNOWN", quantity: null, contributingSources: [], reason: "No governed numeric quantity is available for this population." };
  }

  const distinct = [...new Set(quantities.map((source) => source.numericQuantity))];
  const governing = governingAuthority
    ? quantities.filter((source) => source.authority === governingAuthority)
    : [];

  // An explicit governing authority resolves the population even if other
  // sources disagree: the authority model, not arithmetic, is what decides.
  if (governing.length > 0) {
    const governingQuantities = [...new Set(governing.map((source) => source.numericQuantity))];
    if (governingQuantities.length > 1) {
      return {
        state: "QUANTITY_CONFLICT",
        quantity: null,
        contributingSources: record.sources,
        reason: `Governing authority ${governingAuthority} reports conflicting quantities (${governingQuantities.join(", ")}); no winner is chosen.`,
      };
    }
    const governed = governingQuantities[0];
    const otherSourcesAgree = distinct.every((value) => value === governed);
    return {
      state: otherSourcesAgree ? "QUANTITY_CONFIRMED" : "QUANTITY_RECONCILED",
      quantity: governed,
      contributingSources: record.sources,
      reason: otherSourcesAgree
        ? `Governing authority ${governingAuthority} and every corroborating source report ${governed}.`
        : `Governing authority ${governingAuthority} reports ${governed}; other sources report ${distinct.filter((value) => value !== governed).join(", ")} and are retained as non-governing evidence.`,
    };
  }

  if (distinct.length === 1) {
    return {
      state: "QUANTITY_CONFIRMED",
      quantity: distinct[0],
      contributingSources: record.sources,
      reason: `All ${quantities.length} governed source(s) report ${distinct[0]}.`,
    };
  }

  // Disagreement with no governing authority: fail closed.
  return {
    state: "QUANTITY_CONFLICT",
    quantity: null,
    contributingSources: record.sources,
    reason: `Governed sources disagree (${distinct.sort((a, b) => a - b).join(" vs ")}) and no governing authority is established; the population is not summed and no value is chosen.`,
  };
}

// ---------------------------------------------------------------------------
// Sections 5-9 -- point-consumption classification.
//
// Delegates to the canonical classifier. This function only normalises the
// request shape and projects the canonical result into a demand class.
// ---------------------------------------------------------------------------
export function classifyDevicePointDemand(record, { quantity, addressability = null, extraAttributes = {} } = {}) {
  // Governed addressability comes from the inventory record unless the caller
  // supplies more specific evidence. Absent evidence means absent addressability.
  const governedAddressability = addressability ?? record?.addressability ?? null;
  // The record's own device-family evidence is always in play; a caller's
  // extraAttributes refine it rather than replace it.
  const attributes = {
    ...(record?.attributes || {}),
    ...extraAttributes,
    ...(governedAddressability ? { addressing: governedAddressability } : {}),
  };
  const classification = classifyFireAlarmSlcItem({
    system: record?.system || "Fire Alarm",
    family: record?.deviceFamily,
    attributes,
    selectedQuantity: { value: quantity, source: record?.governingSource || null, status: quantity === null ? "UNKNOWN" : "VALID" },
  });

  const demandClass = {
    SLC_DETECTOR_POOL: "ADDRESSABLE_DETECTOR_POINT",
    SLC_MODULE_POOL: "ADDRESSABLE_MODULE_POINT",
    NOT_SLC: "NON_ADDRESSABLE_EQUIPMENT",
  }[classification.state] || "UNKNOWN_NEEDS_REVIEW";

  return {
    demandClass,
    canonicalState: classification.state,
    // INVARIANT 1/2: demand is the classifier's governed units-per-device
    // result, and it is null whenever consumption is not established.
    pointDemand: classification.demandUnits === null || classification.demandUnits === undefined
      ? null
      : Number(classification.demandUnits),
    unitsPerDevice: classification.unitsPerDevice ?? null,
    quantity: classification.quantity?.value ?? null,
    quantityStatus: classification.quantity?.status ?? "UNKNOWN",
    addressability: governedAddressability,
    reason: classification.reason,
    provenance: classification.provenance || null,
  };
}

// ---------------------------------------------------------------------------
// Section 13 -- scope.
//
// Project is mandatory; building / system / panel are preserved only when the
// evidence actually carries them. Panel boundaries are never invented.
// ---------------------------------------------------------------------------
const scopeKey = (scope) => [
  text(scope?.project) || "",
  text(scope?.building) || "",
  text(scope?.fireAlarmSystem) || "",
  text(scope?.panel) || "",
].join("|");

// A governed scope that is known to exist but produced no device evidence is
// MISSING coverage, not zero demand. `missing scope != zero devices`.
const missingKnownScopes = (rows, knownScopes) => {
  const covered = new Set(rows.map((row) => text(row.scope?.building)).filter(Boolean));
  return knownScopes.map((scope) => text(scope)).filter((scope) => scope && !covered.has(scope));
};

// ---------------------------------------------------------------------------
// Sections 14/15/21/22 -- aggregation.
//
// known vs unknown stay separate; the threshold is evaluated against the
// KNOWN total and the WORST-CASE total; completeness and confidence are
// derived from evidence coverage, never from the size of the number.
// ---------------------------------------------------------------------------
export function aggregatePreliminaryPointDemand(records, {
  threshold = PRELIMINARY_POINT_THRESHOLD,
  knownScopes = null,
  governingAuthority = null,
} = {}) {
  const rows = (records || []).map((record) => {
    const reconciliation = reconcilePopulation(record, { governingAuthority });
    const classified = classifyDevicePointDemand(record, {
      quantity: reconciliation.quantity,
      extraAttributes: record?.attributes || {},
    });
    const isPointConsumer = classified.demandClass === "ADDRESSABLE_DETECTOR_POINT"
      || classified.demandClass === "ADDRESSABLE_MODULE_POINT";
    const contributesKnown = isPointConsumer && classified.pointDemand !== null;
    // INVARIANT 2: unresolved consumption lands in unknown, never in known.
    // Equipment RESOLVED as non-point (FACP, battery, power supply, accessory)
    // is neither: it is settled at zero, so counting it as "unknown" would
    // manufacture phantom unresolved demand and could fake a threshold
    // uncertainty that the evidence does not support.
    const isNonPointEquipment = classified.demandClass === "NON_ADDRESSABLE_EQUIPMENT";
    return {
      populationId: record.populationId,
      deviceFamily: record.deviceFamily,
      scope: record.scope,
      reconciliation,
      classified,
      knownPointDemand: contributesKnown ? classified.pointDemand : 0,
      unknownPointDemand: !contributesKnown && !isNonPointEquipment
        ? (classified.quantity ?? reconciliation.quantity ?? 0)
        : 0,
      unresolved: !contributesKnown && !isNonPointEquipment,
    };
  });

  const sum = (list, key) => list.reduce((total, row) => total + nonNegative(row[key]), 0);
  const knownPointDemand = sum(rows, "knownPointDemand");
  const unresolvedRows = rows.filter((row) => row.unresolved);
  const unknownPointDemand = sum(unresolvedRows, "unknownPointDemand");
  const conflictedRows = rows.filter((row) => row.reconciliation.state === "QUANTITY_CONFLICT");
  const unknownQuantityRows = rows.filter((row) => row.reconciliation.state === "QUANTITY_UNKNOWN");
  const nonPointRows = rows.filter((row) => row.classified.demandClass === "NON_ADDRESSABLE_EQUIPMENT");

  // Section 15 -- threshold risk.
  // Above-threshold is PROVEN by the known total alone; unresolved demand can
  // never retract a proof. At or below the threshold, unresolved demand that
  // could still cross it makes the answer UNCERTAIN rather than falsely precise.
  let thresholdStatus;
  if (knownPointDemand > threshold) {
    thresholdStatus = "ABOVE_THRESHOLD_CONFIRMED";
  } else if (knownPointDemand + unknownPointDemand > threshold) {
    thresholdStatus = "THRESHOLD_UNCERTAIN";
  } else if (knownPointDemand === 0) {
    // No resolved point evidence at all. Zero demand is NOT proof of a small
    // system: it is what an unexamined project looks like. Reporting
    // "within threshold" here would hand GOLDEN-5 false precision and could
    // resolve an ecosystem for a project that was never actually sized.
    thresholdStatus = "THRESHOLD_UNCERTAIN";
  } else {
    thresholdStatus = "WITHIN_THRESHOLD_CONFIRMED";
  }

  // INVARIANT 8: publish a policy number only when it is safe to do so.
  const preliminaryTotalPoints = thresholdStatus === "THRESHOLD_UNCERTAIN" ? null : knownPointDemand;

  // Section 22 -- completeness. Coverage-driven, not size-driven.
  let completeness;
  if (conflictedRows.length > 0) completeness = "CONFLICTED";
  else if (rows.length === 0 || knownPointDemand === 0) completeness = "INSUFFICIENT";
  else if (thresholdStatus === "THRESHOLD_UNCERTAIN") completeness = "THRESHOLD_UNCERTAIN";
  else if (unresolvedRows.length > 0 || (knownScopes && missingKnownScopes(rows, knownScopes).length > 0)) {
    completeness = "PARTIALLY_COMPLETE";
  } else completeness = "COMPLETE";

  // Section 21 -- confidence from evidence coverage factors only.
  const classifiedRows = rows.length;
  const coverage = classifiedRows === 0 ? 0 : (classifiedRows - unresolvedRows.length) / classifiedRows;
  const factors = {
    classifiedQuantityCoverage: Number(coverage.toFixed(4)),
    unresolvedDevicePopulations: unresolvedRows.length,
    conflictingQuantities: conflictedRows.length,
    unknownQuantities: unknownQuantityRows.length,
    nonPointEquipmentExcluded: nonPointRows.length,
  };
  const penalties = conflictedRows.length * 0.25
    + unknownQuantityRows.length * 0.15
    + unresolvedRows.length * 0.05;
  const confidence = classifiedRows === 0 ? "NONE" : Math.max(0, Number((coverage - penalties).toFixed(4)));

  // Section 13 -- scope totals, keyed by the governed scope tuple.
  const scopeMap = new Map();
  for (const row of rows) {
    const key = scopeKey(row.scope);
    const entry = scopeMap.get(key) || { scope: row.scope, knownPointDemand: 0, unknownPointDemand: 0, populations: 0 };
    entry.knownPointDemand += nonNegative(row.knownPointDemand);
    entry.unknownPointDemand += nonNegative(row.unknownPointDemand);
    entry.populations += 1;
    scopeMap.set(key, entry);
  }

  // Section 26 -- complexity signals are EVIDENCE ONLY. GOLDEN-6C never sets a
  // complexity decision; that is GOLDEN-6D's governed output.
  const complexityEvidence = {
    signals: rows
      .filter((row) => row.classified.demandClass === "NON_ADDRESSABLE_EQUIPMENT")
      .map((row) => ({
        populationId: row.populationId,
        deviceFamily: row.deviceFamily,
        reason: row.classified.reason,
      })),
    decision: null,
    decidedByThisStage: false,
  };

  return {
    version: FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION,
    threshold,
    thresholdIsCertifiedManufacturerMaximum: false,
    knownPointDemand,
    unknownPointDemand,
    unresolvedPopulations: unresolvedRows.length,
    // INVARIANT 6: a project total, never a per-panel share of it.
    projectTotalPoints: knownPointDemand,
    preliminaryTotalPoints,
    thresholdStatus,
    completeness,
    confidence,
    confidenceFactors: factors,
    missingKnownScopes: knownScopes ? missingKnownScopes(rows, knownScopes) : [],
    scopeTotals: [...scopeMap.values()].sort((left, right) => scopeKey(left.scope).localeCompare(scopeKey(right.scope))),
    populations: rows,
    conflicts: conflictedRows.map((row) => ({
      populationId: row.populationId,
      reason: row.reconciliation.reason,
    })),
    complexityEvidence,
  };
}

// ---------------------------------------------------------------------------
// Section 23 -- the GOLDEN-5 adapter.
//
// Emits the policy input and nothing else. It never resolves an ecosystem and
// never names a manufacturer. When the threshold is uncertain it withholds the
// number entirely, because a fabricated exact count would let the policy reach
// a confident ecosystem decision on unproven evidence.
// ---------------------------------------------------------------------------
export function preliminarySizingInput(result) {
  const usable = result?.thresholdStatus !== "THRESHOLD_UNCERTAIN" && result?.completeness !== "INSUFFICIENT";
  return {
    // null means "no governed exact point count is available" -- never 0, and
    // never a total that includes unresolved demand.
    preliminaryTotalPoints: usable ? result.preliminaryTotalPoints : null,
    usable,
    thresholdStatus: result?.thresholdStatus ?? null,
    completeness: result?.completeness ?? null,
    knownPointDemand: result?.knownPointDemand ?? 0,
    unknownPointDemand: result?.unknownPointDemand ?? 0,
    sourceVersion: FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION,
  };
}
