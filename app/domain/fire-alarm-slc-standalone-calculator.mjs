// Standalone / manual mode for the SLC Capacity calculator.
//
// A MODE, NOT A NEW ENGINE AND NOT A NEW PLATFORM.
//
// It calls the same `calculateSlcExpansion` used by the governed product flow, so
// the arithmetic is provably identical between modes. The ONLY thing that differs
// is where each input's authority comes from:
//
//   ENGINEERING TOOLS (this file)  -> engineer-entered / declared manual inputs
//   PROJECT ENGINEERING (future)  -> governed project + product authorities
//
// Two invariants this module exists to hold:
//   1. A standalone result is NEVER project authority. It carries no approval, no
//      snapshot, no allocation and no Technical Approval, and it is ephemeral.
//   2. A missing input stays missing. It is never defaulted to 0, back-filled
//      from another product, or inherited from a similar model.
//
// Manufacturer-blind by construction: no manufacturer, brand, family, part number
// or capacity figure appears in this file. Capacity facts arrive as data from the
// caller; per-loop combined limits arrive as data or not at all.

import { calculateSlcExpansion, SLC_CALCULATION_VERSION } from "./fire-alarm-slc-capacity-calculator.mjs";
import {
  buildCalculationInputEnvelope,
  buildCalculationInputStateFingerprint,
  CALCULATION_INPUT_SOURCE_TYPES,
} from "./calculation-requirement-engine.mjs";

export const STANDALONE_MODE = "ENGINEERING_TOOLS";

export const STANDALONE_RESULT_LABEL = "MANUAL / STANDALONE ENGINEERING RESULT";

export const STANDALONE_AUTHORITY_NOTICE =
  "This result was produced from engineer-supplied inputs outside any governed project. " +
  "It is engineering exploration only and carries NO project authority: it does not approve a " +
  "product, does not size a project, and must not be presented as a governed calculation.";

// Canonical capacity scope -> the panelCapacity field the engine consumes.
// Only scopes that MEAN the same thing are mapped. SYSTEM_NAMEDPLATE_POINTS is
// deliberately absent: a nameplate figure is not a stated system ceiling, and
// mapping it here would launder an unexplained number into a governed constraint.
const SCOPE_TO_CAPACITY_FIELD = Object.freeze({
  BASE_SLC_LOOPS: "nativeLoops",
  PER_LOOP_DETECTORS: "detectorsPerLoop",
  PER_LOOP_MODULES: "modulesPerLoop",
  SYSTEM_POINT_CEILING: "systemPointCeiling",
});

const finiteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

const asAuthorityEntry = (sourceType, extra = {}) => ({
  sourceType: CALCULATION_INPUT_SOURCE_TYPES.includes(sourceType) ? sourceType : "MANUAL_ASSUMPTION",
  ...extra,
});

/**
 * Split declared capacity facts from engineer-entered ones.
 *
 * Facts win on overlap: a governed manufacturer fact is never overwritten by a
 * manual entry. A manual entry for a scope that already HAS a fact is reported as
 * ignored rather than silently dropped.
 */
const resolveCapacity = ({ capacityFacts = [], manualCapacity = {} } = {}) => {
  const panelCapacity = {};
  const inputAuthority = {};
  const inputs = [];
  const conflicts = [];
  const ignoredManual = [];

  for (const fact of capacityFacts) {
    const field = SCOPE_TO_CAPACITY_FIELD[fact?.scope];
    if (!field) continue;
    const value = Number(fact?.value);
    if (!finiteNonNegative(value)) continue;
    if (panelCapacity[field] !== undefined && panelCapacity[field] !== value) {
      // Two authorities disagree about the same scope. Recorded, never resolved by
      // picking one -- identical in kind to detectCapacityConflicts upstream.
      conflicts.push({ scope: fact.scope, field, values: [panelCapacity[field], value].sort((a, b) => a - b), sourceIds: [inputAuthority[`panelCapacity.${field}`]?.sourceId ?? null, fact.sourceId ?? null] });
      continue;
    }
    panelCapacity[field] = value;
    const authority = asAuthorityEntry(fact.sourceType ?? "MANUFACTURER_EVIDENCE", {
      sourceId: fact.sourceId ?? null,
      authorityState: fact.authorityState ?? null,
      currentness: fact.currentness ?? null,
      manualOverrideState: "NONE",
      assumptionState: null,
    });
    inputAuthority[`panelCapacity.${field}`] = authority;
    inputs.push(buildCalculationInputEnvelope({ name: `panelCapacity.${field}`, value, unit: "count", ...authority }));
  }

  for (const [field, value] of Object.entries(manualCapacity)) {
    if (!finiteNonNegative(value)) continue;
    if (panelCapacity[field] !== undefined) {
      ignoredManual.push(field);
      continue;
    }
    panelCapacity[field] = Number(value);
    const authority = asAuthorityEntry("MANUAL_ASSUMPTION", {
      sourceId: null,
      authorityState: null,
      currentness: null,
      manualOverrideState: "ENGINEER_ENTERED",
      assumptionState: "DECLARED",
    });
    inputAuthority[`panelCapacity.${field}`] = authority;
    inputs.push(buildCalculationInputEnvelope({ name: `panelCapacity.${field}`, value: Number(value), unit: "count", ...authority }));
  }

  return { panelCapacity, inputAuthority, inputs, conflicts, ignoredManual };
};

/**
 * Run the SLC capacity calculation in standalone mode.
 *
 * `capacityFacts` are capacity records ALREADY read and governed by the caller.
 * This module performs no I/O: passing governed facts in is what keeps it a pure
 * domain function and keeps it impossible for it to promote its own authority.
 */
export const runStandaloneSlcCapacity = ({
  demand = {},
  unresolvedDemand = null,
  capacityFacts = [],
  manualCapacity = {},
  expansionOptions = null,
  sparePolicy = null,
  allocation = null,
  productLabel = null,
} = {}) => {
  const warnings = [];
  const failures = [];
  const { panelCapacity, inputAuthority, inputs, conflicts, ignoredManual } = resolveCapacity({ capacityFacts, manualCapacity });

  // --- detector / module demand -------------------------------------------
  const detectorDemand = finiteNonNegative(demand.detectors) ? Number(demand.detectors) : null;
  const moduleDemand = finiteNonNegative(demand.modules) ? Number(demand.modules) : null;

  // Unresolved demand is recorded FIRST. It is never silently coerced to a zero,
  // because "this project needs no SLC capacity" is the most dangerous misreport
  // this calculator could make.
  if (unresolvedDemand) {
    const declared = {
      reason: unresolvedDemand.reason ?? "Address demand is unresolved.",
      physicalQuantity: finiteNonNegative(unresolvedDemand.physicalQuantity) ? Number(unresolvedDemand.physicalQuantity) : null,
      items: Array.isArray(unresolvedDemand.items) ? unresolvedDemand.items : null,
    };
    inputAuthority["demand.unresolved"] = {
      ...asAuthorityEntry("PROJECT_EVIDENCE", {
        sourceId: unresolvedDemand.sourceId ?? null,
        authorityState: "PENDING_REVIEW",
        currentness: "CURRENT",
        manualOverrideState: "NONE",
        assumptionState: null,
      }),
      // The DECLARED detail must travel with the authority entry, otherwise the
      // engine receives an unresolved marker with no reason and no quantity and
      // has to substitute a generic one -- which would silently discard the
      // engineer's actual finding.
      reason: declared.reason,
      physicalQuantity: declared.physicalQuantity,
      items: declared.items,
    };
    failures.push("ADDRESS_DEMAND_UNRESOLVED");
    warnings.push(`Unresolved address demand reported and NOT converted to zero${declared.physicalQuantity !== null ? ` (physical quantity ${declared.physicalQuantity})` : ""}: ${declared.reason}`);
    inputs.push(buildCalculationInputEnvelope({ name: "demand.unresolved", value: declared.reason, unit: "text", ...inputAuthority["demand.unresolved"] }));
  }

  for (const [name, value] of [["demand.detectors", detectorDemand], ["demand.modules", moduleDemand]]) {
    if (value === null) {
      inputAuthority[name] = asAuthorityEntry("MISSING", { manualOverrideState: "NONE", assumptionState: null });
      inputs.push(buildCalculationInputEnvelope({ name, value: null, unit: "count", sourceType: "MISSING" }));
      continue;
    }
    const authority = asAuthorityEntry("MANUAL_ASSUMPTION", {
      sourceId: null,
      authorityState: null,
      currentness: null,
      manualOverrideState: "ENGINEER_ENTERED",
      assumptionState: "DECLARED",
    });
    inputAuthority[name] = authority;
    inputs.push(buildCalculationInputEnvelope({ name, value, unit: "count", ...authority }));
  }

  if (conflicts.length) {
    failures.push("CONFLICTING_CAPACITY_EVIDENCE");
    for (const conflict of conflicts) {
      warnings.push(`Conflicting declared capacity facts for ${conflict.field}: ${conflict.values.join(" vs ")}. No value was chosen; the scope is treated as unproven.`);
    }
    // A disputed scope is unproven, so it is removed rather than resolved.
    for (const conflict of conflicts) {
      delete panelCapacity[conflict.field];
      delete inputAuthority[`panelCapacity.${conflict.field}`];
    }
  }
  for (const field of ignoredManual) {
    warnings.push(`Manual entry for ${field} was ignored because a declared capacity fact already governs that field.`);
  }

  if (sparePolicy) {
    const authority = asAuthorityEntry("ENGINEER_CONFIRMED", { manualOverrideState: "ENGINEER_ENTERED", assumptionState: null });
    inputAuthority["sparePolicy"] = authority;
    inputs.push(buildCalculationInputEnvelope({ name: "sparePolicy.sparePercent", value: sparePolicy.sparePercent ?? null, unit: "percent", ...authority }));
  }

  const engineResult = calculateSlcExpansion({
    // A null demand is passed through untouched; the engine's own validation
    // names it in missingInputs rather than receiving a substituted zero.
    demand: { detectors: detectorDemand, modules: moduleDemand },
    panelCapacity,
    expansionOptions,
    sparePolicy,
    inputAuthority,
    allocation,
  });

  const inputFingerprint = buildCalculationInputStateFingerprint({
    inputs,
    calculationVersion: SLC_CALCULATION_VERSION,
    // Project Mode slots stay null: those authorities do not exist yet, and a null
    // slot must never be filled with a standalone or historical substitute.
    selectedPanel: productLabel ? { label: productLabel, productId: null, version: null } : null,
    capacityFactVersions: null,
    addressDemandFingerprint: null,
    panelAllocationVersion: null,
    sparePolicyVersion: null,
  });

  if (engineResult.resultState === "CALCULATED_WITH_ASSUMPTIONS") {
    warnings.push(`Result rests on declared manual assumptions for: ${engineResult.assumingInputs.join(", ")}. It is not manufacturer- or project-governed evidence.`);
  }
  if (engineResult.resultState === "BLOCKED_BY_MISSING_INPUTS") {
    failures.push("MISSING_REQUIRED_INPUT");
  }

  return {
    mode: STANDALONE_MODE,
    resultLabel: STANDALONE_RESULT_LABEL,
    authorityNotice: STANDALONE_AUTHORITY_NOTICE,
    // Explicitly null. A standalone run creates nothing.
    projectAuthority: null,
    persisted: false,
    productLabel,
    ...engineResult,
    inputs,
    output: {
      result: engineResult.resultState === "BLOCKED_BY_MISSING_INPUTS" ? null : engineResult.status,
      unit: "count",
      calculationVersion: engineResult.calculationVersion,
      resultState: engineResult.resultState,
      status: engineResult.status,
      inputFingerprint,
      warnings,
      failures,
      // Every manual entry is carried as an explicit assumption in evidence.
      assumptions: engineResult.assumingInputs.map((path) => ({ input: path, sourceType: "MANUAL_ASSUMPTION" })),
      evidenceReferences: capacityFacts.map((fact) => ({ scope: fact?.scope ?? null, sourceId: fact?.sourceId ?? null, sourceType: fact?.sourceType ?? "MANUFACTURER_EVIDENCE" })),
      // A standalone result has no governed currency to inherit.
      currentness: "UNPROVEN",
    },
  };
};