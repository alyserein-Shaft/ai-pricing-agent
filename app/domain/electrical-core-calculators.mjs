// GOVERNED ELECTRICAL CORE CALCULATORS -- PUBLIC API ADAPTER.
//
// The deterministic core lives in ./electrical-governed-core.mjs, which imports
// NOTHING from this repository's domain layer. That separation exists so the
// canonical engine (app/domain/calculation-requirement-engine.mjs) can delegate
// to the same arithmetic and the same capability resolver without a circular
// import. Delegation is what guarantees there is exactly ONE battery-demand
// authority and ONE capability-evidence authority in the system.
//
// Re-exported here so every existing consumer keeps one import path:
//
//   PowerCapacityCalculator / BatterySizingCalculator / resolveCapability /
//   capabilityRecord / computeBatteryDemand / electricalCalculationFingerprint
//
// `toDerivedCalculationEvidence` stays in this adapter because it is the only
// piece that needs the platform's Stage 4A evidence contract.
//
// PURE DOMAIN LOGIC throughout: no DB, no fetch, no clock, no randomness.
import {
  CALCULATION_AUTHORITY_STATES,
  CALCULATION_CURRENTNESS_STATES,
  CALCULATION_INPUT_SOURCE_TYPES,
  CALCULATION_RESULTS,
  CALCULATION_RESULT_STATES,
  buildCalculationInputEnvelope,
  buildDerivedCalculationEvidence,
} from "./calculation-requirement-engine.mjs";

import {
  BATTERY_SIZING_RULE,
  ELECTRICAL_CALCULATOR_VERSION,
  POWER_CAPACITY_RULE,
  electricalCalculationFingerprint,
} from "./electrical-governed-core.mjs";

export * from "./electrical-governed-core.mjs";

// Re-exported so a consumer can build inputs in the shared envelope without
// importing the platform engine separately.
export {
  buildCalculationInputEnvelope,
  CALCULATION_INPUT_SOURCE_TYPES,
  CALCULATION_AUTHORITY_STATES,
  CALCULATION_CURRENTNESS_STATES,
  CALCULATION_RESULT_STATES,
  CALCULATION_RESULTS,
};

/**
 * Wrap a calculator result in the platform DERIVED evidence contract.
 * `performedAt` is supplied by the caller; this module never reads a clock.
 *
 * The fingerprint is delegated to the shared core, so the canonical rule and the
 * standalone calculator produce byte-identical fingerprints for identical inputs
 * and evidence.
 */
export const toDerivedCalculationEvidence = ({ calculation, calculationType, manufacturer, model, inputs = [], performedAt = null }) => {
  const rule = calculationType === "power.capacity" ? POWER_CAPACITY_RULE : BATTERY_SIZING_RULE;
  return buildDerivedCalculationEvidence({
    calculationType,
    system: "Fire Alarm",
    scope: model ?? null,
    rule,
    executed: {
      state: calculation.state,
      result: calculation.result,
      blocking: calculation.blocking,
      output: calculation,
      headroom:
        calculation.capacityLimitAmps != null
          ? { standbyAmps: Math.round((Number(calculation.capacityLimitAmps) - Number(calculation.totalStandbyAmps)) * 1000) / 1000 }
          : calculation.chargerRangeAh
            ? { requiredHeadroomAh: Math.round((Number(calculation.chargerRangeAh.max) - Number(calculation.requiredAh)) * 1000) / 1000 }
            : null,
      trace: calculation.trace,
      missingInputs: calculation.blockers ?? [],
    },
    inputs,
    inputProvenance: inputs.map((entry) => entry?.source ?? null),
    performedAt,
    calculationVersion: ELECTRICAL_CALCULATOR_VERSION,
    inputFingerprint: electricalCalculationFingerprint({
      calculationType,
      manufacturer,
      model,
      inputs,
      evidenceUsed: calculation.evidenceUsed ?? [],
    }),
    warnings: calculation.warnings ?? [],
    failures: calculation.blockers ?? [],
    currentness: performedAt ? "CURRENT" : "UNPROVEN",
    resultState: calculation.blocking ? "BLOCKED_BY_MISSING_INPUTS" : "VALIDATED",
    evidenceReferences: (calculation.evidenceUsed ?? []).map((entry) => ({
      document: entry.document,
      revision: entry.revision,
      publisher: entry.publisher,
      url: entry.url,
      quote: entry.quote,
    })),
  });
};
