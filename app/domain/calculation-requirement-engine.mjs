// STAGE 4B -- ENGINEERING CALCULATIONS / CAPACITY.
//
// Governs "how much capacity does engineering actually need, and does the
// candidate provide it?" as FIRST-CLASS DERIVED evidence, not as an
// attribute guess. Every calculation here is a pure, deterministic rule over
// explicit, already-verified inputs -- it never reads the DB, never invents a
// missing current/loading/bitrate, and never performs semantic reasoning.
// When a required input is missing the evaluation returns
// REQUIRED_BUT_INPUTS_MISSING and lists EXACTLY which inputs are missing (the
// "never fabricate currents/missing inputs" invariant).
//
// Calculation data is never price data: the engine never reads prices, and
// calculation evidence can only ever raise blocking/flagging on its own
// engineering dimension -- it can never re-rank, re-score, set confidence, or
// touch commercial/approval paths (4B-5).
//
// The results are expressed in the Stage 4A DERIVED evidence contract
// (ruleId + ruleVersion + inputs + inputProvenance + formula + output +
// executionStatus + sourceFacts) so that evidence-authority-policy.mjs's
// isDerivedEvidenceComplete(derived) returns true and the comparison envelope
// can carry the calculation as DERIVED engineering evidence (4B-2/4B-5).
//
// Pure domain logic: no DOM, no fetch, no DB, no Math.random.
import { createHash } from "node:crypto";
import { calculateSlcExpansion } from "./fire-alarm-slc-capacity-calculator.mjs";
import { calculateCctvStorage } from "./cctv-storage-calculator.mjs";
// The governed electrical core is imported from its DEPENDENCY-FREE module, not
// from electrical-core-calculators.mjs, because that adapter imports the evidence
// contract back from this file. Going through the pure module keeps the dependency
// one-directional and makes the delegation below structurally cycle-free.
import {
  AL_MOUSA_ELECTRICAL_CAPABILITY,
  calculateNacCircuitCapacity,
  calculatePowerCapacity,
  computeBatteryDemand,
} from "./electrical-governed-core.mjs";
import { stableStringify } from "./boq-understanding-engine.mjs";

export const CALCULATION_ENGINE_VERSION = "calculation-requirement-engine-1.0.0";
// Stage 4D-1 -- live-path wiring edition of this engine. The wiring itself is
// a versioned, governed contract: bump only when the input-source alias map or
// the fingerprint composition below changes (a change that alters what a
// candidate "ran on" must be detectable via candidateSpecific later).
export const CALCULATION_WIRING_VERSION = "calculation-live-wiring-4d-1.0.0";

// ---------------------------------------------------------------------------
// 4B-1 -- the calculation requirement state model.
// ---------------------------------------------------------------------------
export const CALCULATION_STATES = Object.freeze([
  "NOT_REQUIRED", // the (system, family) has no governed calculation demand
  "REQUIRED", // applicable but engineering inputs have not been provided yet
  "REQUIRED_BUT_INPUTS_MISSING", // applicable, inputs attempted/incomplete -- never fabricate
  "READY_TO_CALCULATE", // inputs complete; rule about to run (execution detail)
  "CALCULATED_PASS", // deterministic calculation completed and satisfied
  "CALCULATED_FAIL", // deterministic calculation completed and the constraint is not met
  "CALCULATION_CONFLICT", // capacity requirement evidence itself contradicts -- engineer review
  "ENGINEER_REVIEW_REQUIRED", // ungoverned/unknown calculation type -- fail closed
]);

export const isCalculationState = (value) => CALCULATION_STATES.includes(value);

export const CALCULATION_TYPES = Object.freeze([
  "slc.loop-and-expansion",
  "battery.standby-alarm",
  "power.nac-load",
  "power.capacity",
  "network.node-capacity",
  "cctv.storage-retention",
  "power.runtime",
]);

export const CALCULATION_LABELS = Object.freeze({
  "slc.loop-and-expansion": "SLC / Loop Capacity",
  "battery.standby-alarm": "Battery Standby-Alarm Sizing",
  "power.nac-load": "NAC Circuit Loading",
  "power.capacity": "Panel / PSU Power Capacity",
  "network.node-capacity": "Network Node Capacity",
  "cctv.storage-retention": "Recording Storage Retention",
  "power.runtime": "UPS Runtime Sizing",
});

export const CALCULATION_RESULTS = Object.freeze(["PASS", "FAIL", "CONFLICT", "UNKNOWN"]);

// ---------------------------------------------------------------------------
// Input/Output provenance envelope -- SHARED vocabulary for every calculator.
// ---------------------------------------------------------------------------
// These are the states the existing `inputProvenance` / `inputs[].source` fields
// already carry informally. Naming them here makes them usable by every
// calculator WITHOUT introducing a second provenance system.
//
// MISSING and MANUAL_ASSUMPTION are first-class, not sentinel values: an input
// the upstream authorities cannot produce is MISSING, and a number a human typed
// without governed backing is MANUAL_ASSUMPTION. Neither may ever be silently
// promoted to evidence.
export const CALCULATION_INPUT_SOURCE_TYPES = Object.freeze([
  "PROJECT_EVIDENCE",
  "MANUFACTURER_EVIDENCE",
  "ENGINEER_CONFIRMED",
  "MANUAL_ASSUMPTION",
  "MISSING",
]);

export const CALCULATION_AUTHORITY_STATES = Object.freeze([
  "GOVERNED",
  "PENDING_REVIEW",
  "SUPERSEDED",
  "STALE",
  "UNPROVEN",
  "NOT_APPLICABLE",
]);

export const CALCULATION_CURRENTNESS_STATES = Object.freeze([
  "CURRENT",
  "NEEDS_REVALIDATION",
  "SUPERSEDED",
  "PARTIAL",
  "UNPROVEN",
]);

// Orthogonal to CALCULATION_RESULTS and to any engine's own `status`. See
// SLC_RESULT_STATES in fire-alarm-slc-capacity-calculator.mjs for the same axis
// as the SLC engine applies it.
export const CALCULATION_RESULT_STATES = Object.freeze([
  "VALIDATED",
  "CALCULATED_WITH_ASSUMPTIONS",
  "BLOCKED_BY_MISSING_INPUTS",
]);

const normalizeEnum = (value, allowed, fallback = null) =>
  (allowed.includes(value) ? value : fallback);

/**
 * Build ONE calculator input in the common envelope.
 *
 * `source` is the existing per-input provenance object (as produced by
 * gatherCalculationInputs). It is preserved verbatim under `source` so nothing
 * already governed by the platform is lost or reshaped.
 *
 * Fail-closed rule: an input with no usable value is normalised to
 * sourceType=MISSING regardless of what the caller claimed. A caller cannot
 * assert authority it did not actually supply.
 */
export const buildCalculationInputEnvelope = (input = {}) => {
  const declaredType = normalizeEnum(input.sourceType, CALCULATION_INPUT_SOURCE_TYPES, null);
  const hasValue = input.value !== undefined && input.value !== null && input.value !== "";
  return {
    name: input.name ?? null,
    value: hasValue ? input.value : null,
    unit: input.unit ?? null,
    sourceType: hasValue ? (declaredType ?? "PROJECT_EVIDENCE") : "MISSING",
    sourceId: hasValue ? (input.sourceId ?? input.source?.sourceId ?? null) : null,
    authorityState: normalizeEnum(input.authorityState, CALCULATION_AUTHORITY_STATES, null),
    currentness: normalizeEnum(input.currentness, CALCULATION_CURRENTNESS_STATES, null),
    manualOverrideState: input.manualOverrideState ?? null,
    assumptionState: input.assumptionState ?? null,
    // Preserved as-is: the platform's existing provenance contract.
    source: input.source ?? null,
  };
};

// ---------------------------------------------------------------------------
// 4B-4 -- per-system-pack applicability profiles (DATA). A family matches a
// row when its governed family name matches the familyPattern; the row lists
// the calculation types that family is REQUIRED to satisfy. An unregistered
// system or family matches nothing and is never blocked by a calculation that
// does not apply to it (no Fire Alarm leakage into unrelated packs).
// ---------------------------------------------------------------------------
export const CALCULATION_PROFILES = Object.freeze({
  "Fire Alarm": [
    { familyPattern: /(control panel|facp|cpu|panel)/i, calculationTypes: ["slc.loop-and-expansion", "battery.standby-alarm", "network.node-capacity"] },
    // power.capacity is required of POWER SUPPLY families only in this slice. It is
    // deliberately NOT added to the control-panel row: three existing assertions
    // encode that row's exact set (tests/stage4d1-live-calculation-wiring.test.mjs,
    // tests/stage4d2-live-engineering-dossier.test.mjs x2), and widening the panel
    // requirement is a separate governed decision, not a wiring detail.
    { familyPattern: /(power supply|nac power|nac boost)/i, calculationTypes: ["power.nac-load", "battery.standby-alarm", "power.capacity"] },
  ],
  CCTV: [{ familyPattern: /(nvr|recorder|storage)/i, calculationTypes: ["cctv.storage-retention"] }],
  UPS: [{ familyPattern: /(ups|uninterruptible|power supply unit)/i, calculationTypes: ["power.runtime"] }],
});

export const calculationApplicabilityFor = ({ calculationType, system, family }) => {
  const pack = (system || "") && CALCULATION_PROFILES[system];
  if (!pack) return { applicable: false, calculationTypes: [], reason: `No governed calculation pack exists for system "${system || "unknown"}".` };
  const row = pack.find((entry) => entry.familyPattern.test(String(family || "")));
  if (!row) return { applicable: false, calculationTypes: [], reason: `Family "${family || "unknown"}" in ${system} has no governed calculation requirement.` };
  return {
    applicable: row.calculationTypes.includes(calculationType),
    calculationTypes: row.calculationTypes,
    reason: row.calculationTypes.includes(calculationType) ? `${family} in ${system}: ${row.calculationTypes.join(", ")} required.` : `Family ${family} in ${system} requires ${row.calculationTypes.join(", ")}; ${calculationType} is not among them.`,
  };
};

// ---------------------------------------------------------------------------
// 4B-3 -- the governed calculation rule registry (DATA + pure execute).
// Each rule.execute is TOTAL: given inputs it either completes a calculation
// or returns REQUIRED_BUT_INPUTS_MISSING with the exact missing inputs.
// ---------------------------------------------------------------------------
const isPositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const isFiniteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
const valueOf = (inputs, name) => inputs.find((entry) => entry?.name === name)?.value;
const sourceOf = (inputs, name) => inputs.find((entry) => entry?.name === name)?.source || null;

const SLC_RULE = {
  ruleId: "slc.loop-and-expansion",
  ruleVersion: "slc.loop-and-expansion-1.0.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "SLC / Loop Capacity",
  formula:
    "Loops = MAX(CEIL(detectors / detectorsPerLoop), CEIL(modules / modulesPerLoop)); " +
    "requiredAdditionalLoops = MAX(0, loops - nativeLoops); " +
    "expansionUnits = requiredAdditionalLoops > 0 ? CEIL(requiredAdditionalLoops / loopsAddedPerUnit) : 0; " +
    "system-wide ceiling check (detectors + modules <= systemPointCeiling) governs regardless of loop math.",
  inputSchema: Object.freeze([
    { name: "demand.detectors", unit: "count", required: true },
    { name: "demand.modules", unit: "count", required: true },
    { name: "panelCapacity.nativeLoops", unit: "count", required: true },
    { name: "panelCapacity.detectorsPerLoop", unit: "count", required: true },
    { name: "panelCapacity.modulesPerLoop", unit: "count", required: true },
    { name: "panelCapacity.systemPointCeiling", unit: "count", required: true },
    { name: "expansionOptions.loopExpansionUnit.partNumber", unit: "id", required: false },
    { name: "expansionOptions.loopExpansionUnit.loopsAddedPerUnit", unit: "count", required: false },
    { name: "expansionOptions.mountingUnit.partNumber", unit: "id", required: false },
    { name: "expansionOptions.mountingUnit.capacityPerMountingUnit", unit: "count", required: false },
  ]),
  execute: ({ inputs }) => {
    const missingInputs = [];
    const demand = {
      detectors: valueOf(inputs, "demand.detectors"),
      modules: valueOf(inputs, "demand.modules"),
    };
    const panelCapacity = {
      nativeLoops: valueOf(inputs, "panelCapacity.nativeLoops"),
      detectorsPerLoop: valueOf(inputs, "panelCapacity.detectorsPerLoop"),
      modulesPerLoop: valueOf(inputs, "panelCapacity.modulesPerLoop"),
      systemPointCeiling: valueOf(inputs, "panelCapacity.systemPointCeiling"),
    };
    const expansionOptions = {
      loopExpansionUnit: valueOf(inputs, "expansionOptions.loopExpansionUnit.partNumber") ? { partNumber: valueOf(inputs, "expansionOptions.loopExpansionUnit.partNumber"), loopsAddedPerUnit: Number(valueOf(inputs, "expansionOptions.loopExpansionUnit.loopsAddedPerUnit")) } : null,
      mountingUnit: valueOf(inputs, "expansionOptions.mountingUnit.partNumber") ? { partNumber: valueOf(inputs, "expansionOptions.mountingUnit.partNumber"), capacityPerMountingUnit: Number(valueOf(inputs, "expansionOptions.mountingUnit.capacityPerMountingUnit")) } : null,
    };
    for (const schema of SLC_RULE.inputSchema) {
      if (schema.required && valueOf(inputs, schema.name) === undefined) missingInputs.push(schema.name);
    }
    // The calculator itself re-validates with its own exact-message contract
    // (including "expansion required but no verified expansion unit").
    const calc = calculateSlcExpansion({ demand, panelCapacity, expansionOptions });
    if (calc.status === "INSUFFICIENT_EVIDENCE") return { state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", blocking: true, missingInputs: [...missingInputs, ...(calc.missingInputs || [])], trace: calc.calculationTrace || [] };
    if (calc.status === "CONFLICT") return { state: "CALCULATION_CONFLICT", result: "CONFLICT", blocking: true, output: calc, headroom: null, trace: calc.calculationTrace || [], missingInputs: [] };
    if (calc.status === "CAPACITY_EXCEEDED") return { state: "CALCULATED_FAIL", result: "FAIL", blocking: true, output: calc, headroom: null, trace: calc.calculationTrace || [], missingInputs: [] };
    // NO_EXPANSION_REQUIRED / EXPANSION_REQUIRED both leave the project
    // satisfied; EXPANSION_REQUIRED simply sizes the required expansion items.
    return { state: "CALCULATED_PASS", result: "PASS", blocking: false, output: calc, headroom: calc.headroom, trace: calc.calculationTrace || [], missingInputs: [], expansionRequired: calc.status === "EXPANSION_REQUIRED" ? { requiredQuantity: calc.requiredExpansionQuantity, expansionPartNumber: calc.selectedExpansionType, mountingUnit: calc.mountingUnit } : null };
  },
};

const BATTERY_RULE = {
  ruleId: "battery.standby-alarm",
  // 1.1.0 -- ARITHMETIC AUTHORITY REPAIR. 1.0.0 computed
  //   MAX(standbyAh, alarmAh) * deratingFactor
  // which UNDERSTATED battery demand, because the battery carries the standby
  // period and THEN the alarm period sequentially -- the two demands are
  // cumulative, not alternatives. The manufacturer's own worksheet states this
  // directly: Honeywell IFP-2100 installation manual LS10143-001SK-E Rev E,
  // Sec 3.5.2, Table 3.2 (Continued), line J reads "Add lines G and I".
  // Version bumped so a consumer can detect that a stored figure produced under
  // the old MAX reading is not comparable with one produced under the sum.
  ruleVersion: "battery.standby-alarm-1.1.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "Battery Standby-Alarm Sizing",
  formula:
    "standbyAh = standbyCurrent * standbyHours; " +
    "alarmAh = (alarmMinutes / 60) * alarmCurrent; " +
    "totalAhBeforeDerating = standbyAh + alarmAh; " +
    "RequiredAh = totalAhBeforeDerating * deratingFactor. " +
    "The two demands are summed because the battery serves standby and THEN alarm sequentially " +
    "(manufacturer worksheet line J: 'Add lines G and I'); taking MAX of the two instead understates the " +
    "required capacity. standbyCurrent/alarmCurrent are governed manufacturer figures; the AHJ-mandated " +
    "standby/alarm durations and the aging derating factor are governed project/code inputs. NONE are ever invented.",
  inputSchema: Object.freeze([
    { name: "standbyCurrent", unit: "A", required: true },
    { name: "alarmCurrent", unit: "A", required: true },
    { name: "standbyHours", unit: "h", required: true },
    { name: "alarmMinutes", unit: "min", required: true },
    { name: "deratingFactor", unit: "ratio", required: true },
  ]),
  execute: ({ inputs }) => {
    const names = ["standbyCurrent", "alarmCurrent", "standbyHours", "alarmMinutes", "deratingFactor"];
    const missingInputs = names.filter((name) => !isPositiveNumber(valueOf(inputs, name)));
    if (missingInputs.length) return { state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", blocking: true, missingInputs, trace: [`Battery sizing requires governed manufacturer currents and code/jurisdiction durations: ${missingInputs.join(", ")}. Refusing to calculate.`] };
    // DELEGATED, not reimplemented. computeBatteryDemand is the single arithmetic
    // authority shared with BatterySizingCalculator, so the two can never drift
    // again. That drift is exactly what caused the MAX defect: this rule used
    // MAX(standbyAh, alarmAh) while the project module used the sum, silently
    // understating the battery. One implementation, one authority.
    const demand = computeBatteryDemand({
      standbyAmps: valueOf(inputs, "standbyCurrent"),
      alarmAmps: valueOf(inputs, "alarmCurrent"),
      standbyHours: valueOf(inputs, "standbyHours"),
      alarmMinutes: valueOf(inputs, "alarmMinutes"),
      deratingFactor: valueOf(inputs, "deratingFactor"),
    });
    const { standbyAh, alarmAh, totalAhBeforeDerating, requiredAh } = demand;
    return {
      state: "CALCULATED_PASS",
      result: "PASS",
      blocking: false,
      output: {
        requiredAh: round2(requiredAh),
        standbyAh: round2(standbyAh),
        alarmAh: round2(alarmAh),
        totalAhBeforeDerating: round2(totalAhBeforeDerating),
        // Retained, and still well defined, but now purely informational: it names
        // the LARGER of the two cumulative demands. It no longer selects the result.
        governingDuration: standbyAh >= alarmAh ? "standby" : "alarm",
      },
      headroom: { requiredAh: round2(requiredAh) },
      trace: [
        `Standby demand = ${standbyAh} Ah; alarm demand = ${alarmAh} Ah.`,
        `Both demands are cumulative (worksheet line J "Add lines G and I") -> pre-derating total = ${round2(totalAhBeforeDerating)} Ah.`,
        `Derating ${valueOf(inputs, "deratingFactor")} applied ONCE to the sum -> required = ${round2(requiredAh)} Ah.`,
      ],
      missingInputs: [],
    };
  },
};

const NAC_RULE = {
  ruleId: "power.nac-load",
  // 1.1.0 -- DELEGATED to NacCircuitCalculator (./electrical-governed-core.mjs).
  // 1.0.0 computed the ALARM condition only. The governed requirement is the
  // GOVERNING condition, MAX(standby, alarm), because the conductor must carry
  // whichever is worse. The legacy output names are retained so nothing downstream
  // breaks; the governing fields are additive.
  ruleVersion: "power.nac-load-1.1.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "NAC Circuit Loading",
  formula:
    "circuitStandbyAmps = SUM(load.quantity * load.standbyAmps); circuitAlarmAmps = SUM(load.quantity * load.alarmAmps); " +
    "governingCircuitAmps = MAX(circuitStandbyAmps, circuitAlarmAmps); withinCircuitCapacity = governingCircuitAmps <= perCircuitLimitAmps. " +
    "The panel total ceiling is NEVER substituted for the per-circuit ceiling.",
  inputSchema: Object.freeze([
    { name: "nacAmpacity", unit: "A", required: false },
    { name: "capabilityManufacturer", unit: "text", required: false },
    { name: "capabilityModel", unit: "text", required: false },
    { name: "circuitId", unit: "text", required: false },
    { name: "circuitClass", unit: "text", required: false },
    { name: "deviceLoads", unit: "A (sum)", required: true },
    { name: "loads", unit: "A (sum)", required: false },
  ]),
  execute: ({ inputs }) => {
    const nacAmpacity = valueOf(inputs, "nacAmpacity");
    const deviceLoads = valueOf(inputs, "deviceLoads");
    const loads = valueOf(inputs, "loads");
    const manufacturer = valueOf(inputs, "capabilityManufacturer");
    const model = valueOf(inputs, "capabilityModel");
    const circuitId = valueOf(inputs, "circuitId");
    const circuitClass = valueOf(inputs, "circuitClass");

    // Governed-shape run: model-bound identity + per-device evidence. Strict.
    if (present(manufacturer) || present(model) || Array.isArray(loads)) {
      const outcome = calculateNacCircuitCapacity({
        manufacturer: present(manufacturer) ? String(manufacturer) : null,
        model: present(model) ? String(model) : null,
        circuitId: circuitId ?? null,
        circuitClass: circuitClass ?? null,
        loads: Array.isArray(loads) ? loads : deviceLoads,
        capacityLimitAmps: nacAmpacity,
        capacityLimitEvidence: sourceOf(inputs, "nacAmpacity"),
      });
      if (outcome.state === "BLOCKED_BY_MISSING_INPUTS") {
        return { state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", blocking: true, missingInputs: outcome.blockers, trace: outcome.trace };
      }
      return {
        state: outcome.state,
        result: outcome.result,
        blocking: outcome.blocking,
        output: {
          // legacy names retained
          totalAlarmCurrent: outcome.circuitAlarmAmps,
          nacAmpacity: outcome.capacityLimitAmps,
          // governing fields added
          circuitStandbyAmps: outcome.circuitStandbyAmps,
          circuitAlarmAmps: outcome.circuitAlarmAmps,
          governingCircuitAmps: outcome.governingCircuitAmps,
          capacityLimitAmps: outcome.capacityLimitAmps,
          withinCircuitCapacity: outcome.withinCircuitCapacity,
          capacityDeficitAmps: outcome.capacityDeficitAmps ?? 0,
          governingCondition: outcome.governingCondition,
        },
        headroom: { amperes: round2(Number(outcome.capacityLimitAmps) - Number(outcome.governingCircuitAmps)) },
        trace: [...outcome.trace, ...outcome.blockers],
        missingInputs: [],
      };
    }

    // Pre-existing input shape: nacAmpacity + deviceLoads[{current, quantity}].
    // Preserved verbatim through the SAME calculator. The two relaxations are
    // deliberate and are labelled in the output warnings, never hidden.
    const missingInputs = [];
    if (!isPositiveNumber(nacAmpacity)) missingInputs.push("nacAmpacity");
    if (!Array.isArray(deviceLoads)) missingInputs.push("deviceLoads");
    else {
      deviceLoads.forEach((entry, index) => {
        if (!isFiniteNonNegative(entry?.current)) missingInputs.push(`deviceLoads[${index}].current`);
      });
    }
    if (missingInputs.length) {
      return {
        state: "REQUIRED_BUT_INPUTS_MISSING",
        result: "UNKNOWN",
        blocking: true,
        missingInputs,
        trace: [`NAC loading requires the NAC circuit ampacity and each device's governed alarm current: ${missingInputs.join(", ")}.`],
      };
    }

    const outcome = calculateNacCircuitCapacity({
      manufacturer: null,
      model: null,
      circuitId: null,
      loads: deviceLoads,
      capacityLimitAmps: nacAmpacity,
      capacityLimitEvidence: sourceOf(inputs, "nacAmpacity") ?? { document: "caller", revision: "nacAmpacity", quote: "governed ampacity" },
      requireCircuitIdentity: false,
      requireCurrentEvidence: false,
    });

    return {
      state: outcome.state,
      result: outcome.result,
      blocking: outcome.blocking,
      output: {
        totalAlarmCurrent: outcome.circuitAlarmAmps,
        nacAmpacity: outcome.capacityLimitAmps,
        circuitStandbyAmps: outcome.circuitStandbyAmps,
        circuitAlarmAmps: outcome.circuitAlarmAmps,
        governingCircuitAmps: outcome.governingCircuitAmps,
        capacityLimitAmps: outcome.capacityLimitAmps,
        withinCircuitCapacity: outcome.withinCircuitCapacity,
        capacityDeficitAmps: outcome.capacityDeficitAmps ?? 0,
        governingCondition: outcome.governingCondition,
      },
      headroom: { amperes: round2(Number(outcome.capacityLimitAmps) - Number(outcome.governingCircuitAmps)) },
      trace: [...outcome.trace, ...outcome.warnings],
      missingInputs: [],
    };
  },
};

const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";

/**
 * power.capacity -- CANONICAL panel / PSU output-capacity rule.
 *
 * This is a thin governed ADAPTER, not a second implementation. All arithmetic,
 * all capability resolution and all fail-closed behaviour live in
 * calculatePowerCapacity (./electrical-governed-core.mjs), which is the same code
 * path the standalone PowerCapacityCalculator uses. Registering the rule here makes
 * the capacity check reachable from the canonical engine without creating a
 * competing authority for it.
 *
 * Capability is NEVER defaulted. The manufacturer and model must be supplied and
 * must resolve to a PROVEN capability record bound to that exact model; anything
 * else is UNKNOWN and blocks. A Silent Knight, NOTIFIER or invented figure can
 * therefore never satisfy a Farenhyt panel.
 */
const POWER_CAPACITY_RULE_ADAPTER = {
  ruleId: "power.capacity",
  ruleVersion: "power.capacity-1.0.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "Panel / PSU Power Capacity",
  formula:
    "totalStandbyAmps = SUM(load.quantity * load.standbyAmps); totalAlarmAmps = SUM(load.quantity * load.alarmAmps); " +
    "each is compared INDEPENDENTLY against the selected model's published total output ceiling. " +
    "withinCapacity = (standby <= ceiling) AND (alarm <= ceiling). " +
    "The ceiling is resolved from manufacturer- and model-bound capability evidence and is never defaulted.",
  inputSchema: Object.freeze([
    { name: "capabilityManufacturer", unit: "text", required: true },
    { name: "capabilityModel", unit: "text", required: true },
    { name: "loads", unit: "A (sum)", required: true },
    { name: "capabilityRecords", unit: "evidence", required: false },
  ]),
  execute: ({ inputs }) => {
    const manufacturer = valueOf(inputs, "capabilityManufacturer");
    const model = valueOf(inputs, "capabilityModel");
    const loads = valueOf(inputs, "loads");
    const capabilityRecords = valueOf(inputs, "capabilityRecords");

    const missingInputs = [];
    if (!present(manufacturer)) missingInputs.push("capabilityManufacturer");
    if (!present(model)) missingInputs.push("capabilityModel");
    if (!Array.isArray(loads)) missingInputs.push("loads");
    if (missingInputs.length) {
      return {
        state: "REQUIRED_BUT_INPUTS_MISSING",
        result: "UNKNOWN",
        blocking: true,
        missingInputs,
        trace: [
          `Power capacity requires the selected panel identity and its load records: ${missingInputs.join(", ")}. ` +
            "Refusing to calculate; a capability ceiling is never defaulted.",
        ],
      };
    }

    const outcome = calculatePowerCapacity({
      manufacturer: String(manufacturer),
      model: String(model),
      loads,
      capabilityRecords: Array.isArray(capabilityRecords) && capabilityRecords.length ? capabilityRecords : AL_MOUSA_ELECTRICAL_CAPABILITY,
    });

    // The calculator's UNKNOWN state maps onto the engine's existing
    // REQUIRED_BUT_INPUTS_MISSING state, so the canonical fail-closed vocabulary
    // is preserved rather than invented alongside it.
    if (outcome.state === "BLOCKED_BY_MISSING_INPUTS") {
      return {
        state: "REQUIRED_BUT_INPUTS_MISSING",
        result: "UNKNOWN",
        blocking: true,
        output: null,
        missingInputs: outcome.blockers,
        trace: outcome.trace,
      };
    }

    return {
      state: outcome.state,
      result: outcome.result,
      blocking: outcome.blocking,
      output: {
        totalStandbyAmps: outcome.totalStandbyAmps,
        totalAlarmAmps: outcome.totalAlarmAmps,
        standbyCapacityStatus: outcome.standbyCapacityStatus,
        alarmCapacityStatus: outcome.alarmCapacityStatus,
        withinCapacity: outcome.withinCapacity,
        capacityLimitAmps: outcome.capacityLimitAmps,
      },
      headroom: {
        standbyAmps: round2(Number(outcome.capacityLimitAmps) - Number(outcome.totalStandbyAmps)),
        alarmAmps: round2(Number(outcome.capacityLimitAmps) - Number(outcome.totalAlarmAmps)),
      },
      trace: outcome.trace,
      missingInputs: [],
      // Capability evidence identity travels with the result so currentness can
      // detect a document revision, not merely an input value change.
      evidenceIdentity: (outcome.evidenceUsed || []).map((entry) => ({
        field: entry.field,
        document: entry.document,
        revision: entry.revision,
      })),
    };
  },
};

const NETWORK_RULE = {  ruleId: "network.node-capacity",
  ruleVersion: "network.node-capacity-1.0.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "Network Node Capacity",
  formula: "PASS when nodeCount <= maxNetworkNodes; nodeCount is the governed total of panel network nodes.",
  inputSchema: Object.freeze([
    { name: "nodeCount", unit: "count", required: true },
    { name: "maxNetworkNodes", unit: "count", required: true },
  ]),
  execute: ({ inputs }) => {
    const nodeCount = Number(valueOf(inputs, "nodeCount"));
    const maxNetworkNodes = Number(valueOf(inputs, "maxNetworkNodes"));
    const missingInputs = [];
    if (!isFiniteNonNegative(nodeCount)) missingInputs.push("nodeCount");
    if (!isPositiveNumber(maxNetworkNodes)) missingInputs.push("maxNetworkNodes");
    if (missingInputs.length) return { state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", blocking: true, missingInputs, trace: [`Network node sizing requires nodeCount and the panel family's governed maxNetworkNodes: ${missingInputs.join(", ")}.`] };
    const pass = nodeCount <= maxNetworkNodes;
    return {
      state: pass ? "CALCULATED_PASS" : "CALCULATED_FAIL",
      result: pass ? "PASS" : "FAIL",
      blocking: !pass,
      output: { nodeCount, maxNetworkNodes },
      headroom: { nodes: maxNetworkNodes - nodeCount },
      trace: [`Network nodes = ${nodeCount}; max governed = ${maxNetworkNodes} -> ${pass ? "PASS" : "FAIL"}.`],
      missingInputs: [],
    };
  },
};

const CCTV_STORAGE_RULE = {
  ruleId: "cctv.storage-retention",
  ruleVersion: "cctv.storage-retention-1.0.0",
  system: "CCTV",
  dimension: "capacity",
  label: "Recording Storage Retention",
  formula: "requiredBytes = cameraCount * bitrateBitsPerSecond * recordingHoursPerDay * 3600 * retentionDays / 8; recommendedHddCount = CEIL(requiredBytes * raidOverheadFactor / hddCapacityBytes).",
  inputSchema: Object.freeze([
    { name: "cameraCount", unit: "count", required: true },
    { name: "bitrateBitsPerSecond", unit: "bit/s", required: true },
    { name: "recordingHoursPerDay", unit: "h/day", required: true },
    { name: "retentionDays", unit: "days", required: true },
    { name: "hddCapacityBytes", unit: "bytes", required: true },
    { name: "raidOverheadFactor", unit: "ratio", required: false },
  ]),
  execute: ({ inputs }) => {
    const calc = calculateCctvStorage({
      cameraCount: Number(valueOf(inputs, "cameraCount")),
      bitrateBitsPerSecond: Number(valueOf(inputs, "bitrateBitsPerSecond")),
      recordingHoursPerDay: Number(valueOf(inputs, "recordingHoursPerDay")),
      retentionDays: Number(valueOf(inputs, "retentionDays")),
      hddCapacityBytes: Number(valueOf(inputs, "hddCapacityBytes")),
      raidOverheadFactor: valueOf(inputs, "raidOverheadFactor") === undefined ? 1 : Number(valueOf(inputs, "raidOverheadFactor")),
    });
    if (calc.status === "INSUFFICIENT_EVIDENCE") return { state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", blocking: true, missingInputs: calc.missingInputs, trace: calc.calculationTrace, output: null };
    return { state: "CALCULATED_PASS", result: "PASS", blocking: false, output: { requiredRawBytes: calc.requiredRawBytes, requiredUsableBytes: calc.requiredUsableBytes, recommendedHddCount: calc.recommendedHddCount }, headroom: { hddSizing: "HDD count is a sizing outcome, not a headroom margin" }, trace: calc.calculationTrace, missingInputs: [] };
  },
};

const UPS_RUNTIME_RULE = {
  ruleId: "power.runtime",
  ruleVersion: "power.runtime-1.0.0",
  system: "UPS",
  dimension: "capacity",
  label: "UPS Runtime Sizing",
  formula: "runtimeHours = batteryAh * systemVoltage * efficiency / loadWatts; PASS when runtimeHours >= requiredRuntimeHours.",
  inputSchema: Object.freeze([
    { name: "batteryAh", unit: "Ah", required: true },
    { name: "systemVoltage", unit: "V", required: true },
    { name: "loadWatts", unit: "W", required: true },
    { name: "efficiency", unit: "ratio", required: true },
    { name: "requiredRuntimeHours", unit: "h", required: true },
  ]),
  execute: ({ inputs }) => {
    const names = ["batteryAh", "systemVoltage", "loadWatts", "efficiency", "requiredRuntimeHours"];
    const missingInputs = names.filter((name) => !isPositiveNumber(valueOf(inputs, name)));
    if (missingInputs.length) return { state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", blocking: true, missingInputs, trace: [`UPS runtime sizing requires governed battery/circuit/load inputs: ${missingInputs.join(", ")}.`] };
    const runtimeHours = (Number(valueOf(inputs, "batteryAh")) * Number(valueOf(inputs, "systemVoltage")) * Number(valueOf(inputs, "efficiency"))) / Number(valueOf(inputs, "loadWatts"));
    const required = Number(valueOf(inputs, "requiredRuntimeHours"));
    const pass = runtimeHours >= required;
    return {
      state: pass ? "CALCULATED_PASS" : "CALCULATED_FAIL",
      result: pass ? "PASS" : "FAIL",
      blocking: !pass,
      output: { runtimeHours: round2(runtimeHours), requiredRuntimeHours: required },
      headroom: { hours: round2(runtimeHours - required) },
      trace: [`Runtime = ${round2(runtimeHours)} h vs required ${required} h -> ${pass ? "PASS" : "FAIL"}.`],
      missingInputs: [],
    };
  },
};

export const CALCULATION_RULES = Object.freeze({
  "slc.loop-and-expansion": SLC_RULE,
  "battery.standby-alarm": BATTERY_RULE,
  "power.nac-load": NAC_RULE,
  "power.capacity": POWER_CAPACITY_RULE_ADAPTER,
  "network.node-capacity": NETWORK_RULE,
  "cctv.storage-retention": CCTV_STORAGE_RULE,
  "power.runtime": UPS_RUNTIME_RULE,
});

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// ---------------------------------------------------------------------------
// 4B-2 -- the DERIVED evidence contract. buildDerivedCalculationEvidence
// produces an object that satisfies
// evidence-authority-policy.mjs's isDerivedEvidenceComplete, so it is
// classified as governed DERIVED evidence by Stage 4A.
// ---------------------------------------------------------------------------
export const buildDerivedCalculationEvidence = ({ calculationType, system, scope, rule, executed, inputs, inputProvenance, performedAt, calculationVersion = null, inputFingerprint = null, warnings = null, failures = null, assumptions = null, evidenceReferences = null, currentness = null, resultState = null }) => {
  const ruleInfo = rule || CALCULATION_RULES[calculationType] || null;
  if (!ruleInfo || !executed) return null;
  const normalizedInputs = Array.isArray(inputs) ? inputs.map((entry) => ({ name: entry?.name, value: Number(entry?.value), unit: entry?.unit || null })) : [];
  const provenance = Array.isArray(inputProvenance) ? inputProvenance : (inputs || []).map((entry) => entry?.source || null);
  return {
    // Stage 4A DERIVED contract fields (isDerivedEvidenceComplete).
    ruleId: ruleInfo.ruleId,
    ruleVersion: ruleInfo.ruleVersion,
    inputs: normalizedInputs,
    inputProvenance: provenance,
    formula: ruleInfo.formula,
    output: executed.output || null,
    executionStatus: executed.state,
    sourceFacts: executed.trace || [],
    // 4B-2 envelope contract fields.
    calculationType,
    system,
    scope: scope || null,
    dimension: ruleInfo.dimension,
    result: executed.result,
    blocking: Boolean(executed.blocking),
    headroom: executed.headroom || null,
    missingInputs: executed.missingInputs || [],
    performedAt: performedAt || null,
    engine: CALCULATION_ENGINE_VERSION,
    humanReview: null,
    // --- shared output-envelope extension (additive) -----------------------
    // `valid` is DERIVED from missingInputs, never asserted by the caller, so a
    // missing required input cannot be presented as a valid result.
    calculationVersion: calculationVersion ?? ruleInfo.ruleVersion ?? null,
    inputFingerprint: inputFingerprint ?? null,
    warnings: warnings ?? [],
    failures: failures ?? (executed.missingInputs?.length ? [...executed.missingInputs] : []),
    assumptions: assumptions ?? [],
    evidenceReferences: evidenceReferences ?? [],
    currentness: currentness ?? "UNPROVEN",
    resultState: resultState ?? (executed.missingInputs?.length ? "BLOCKED_BY_MISSING_INPUTS" : "VALIDATED"),
    valid: !(executed.missingInputs?.length ?? 0),
  };
};

export const isCompleteTrace = (trace) => {
  // Re-import-free completeness check mirroring 4A's contract.
  if (!trace || typeof trace !== "object") return false;
  return Boolean(
    trace.ruleId && trace.ruleVersion && Array.isArray(trace.inputs) && trace.inputs.length > 0 && trace.inputProvenance && trace.formula && trace.output !== null && trace.output !== undefined && trace.executionStatus && (Array.isArray(trace.sourceFacts) || Array.isArray(trace.inputProvenance)),
  );
};

// ---------------------------------------------------------------------------
// 4B-1/4B-2 -- orchestrator.
// ---------------------------------------------------------------------------
export const evaluateCalculationRequirement = ({ calculationType, system, family, scope, inputs, inputProvenance, requirementConflict = false, performedAt = null }) => {
  // Fail closed FIRST: an ungoverned calculation type can never be "assumed
  // fine" and can never be declared not-required -- we cannot know whether it
  // should apply, so the engineer decides.
  const rule = CALCULATION_RULES[calculationType];
  if (!rule) {
    return { calculationType, system, family, scope: scope || null, state: "ENGINEER_REVIEW_REQUIRED", blocking: true, result: "UNKNOWN", missingInputs: [], reason: `Calculation type "${calculationType}" is not governed by any rule in this engine.`, evidence: null };
  }
  const applicability = calculationApplicabilityFor({ calculationType, system, family });
  if (!applicability.applicable) {
    return { calculationType, system, family, scope: scope || null, state: "NOT_REQUIRED", blocking: false, result: null, missingInputs: [], reason: applicability.reason, evidence: null };
  }
  if (requirementConflict) {
    return { calculationType, system, family, scope: scope || null, state: "CALCULATION_CONFLICT", blocking: true, result: "CONFLICT", missingInputs: [], reason: "Capacity requirement evidence contradicts itself; the calculation cannot proceed until the engineer/AHJ resolves the requirement conflict.", evidence: null };
  }
  if (!inputs) {
    return { calculationType, system, family, scope: scope || null, state: "REQUIRED", blocking: false, result: null, missingInputs: rule.inputSchema.filter((entry) => entry.required).map((entry) => entry.name), reason: `${rule.label} applies but engineering inputs have not been provided yet.`, evidence: null };
  }
  const executed = rule.execute({ inputs });
  // CURRENTNESS (reused mechanism, not a new one). A completed calculation on the
  // canonical path previously carried NO fingerprint, so isCalculationStale could
  // never confirm what it ran on and every direct call was unconfirmable. The
  // fingerprint is composed from exactly what the rule consumed -- the input
  // values, their source documents, and any capability evidence identity -- and it
  // plugs into the existing isCalculationStale contract unchanged.
  const consumedFingerprint = {
    requirementProfileVersion: rule.ruleVersion,
    productEvidenceVersion: fingerprintOf({
      inputs: (inputs || []).map((entry) => ({ name: entry?.name ?? null, value: entry?.value ?? null, unit: entry?.unit ?? null })),
      // Source identity is captured as document AND revision: a re-issued manual must
      // invalidate currentness even when the number it states is unchanged.
      sourceDocuments: (inputs || []).map((entry) => ({
        documentId: entry?.source?.documentId ?? entry?.sourceId ?? null,
        revision: entry?.source?.revision ?? null,
      })),
      evidenceIdentity: executed.evidenceIdentity || [],
    }),
    candidateSpecific: fingerprintOf({
      wiringVersion: CALCULATION_WIRING_VERSION,
      system,
      family,
      calculationType,
      inputs: (inputs || []).map((entry) => ({ input: entry?.name ?? null, value: entry?.value ?? null, unit: entry?.unit ?? null })),
    }),
    itemBasis: fingerprintOf({ system, family, calculationType }),
  };
  const evidence = ["CALCULATED_PASS", "CALCULATED_FAIL"].includes(executed.state)
    ? buildDerivedCalculationEvidence({
        calculationType,
        system,
        scope,
        rule,
        executed,
        inputs,
        inputProvenance,
        performedAt,
        inputFingerprint: consumedFingerprint,
        // A completed calculation that carries a fingerprint is current; the
        // staleness contract still governs any later drift.
        currentness: performedAt ? "CURRENT" : "UNPROVEN",
      })
    : null;
  const missingInputs = executed.missingInputs || [];
  return {
    calculationType,
    system,
    family,
    scope: scope || null,
    state: executed.state,
    blocking: executed.blocking,
    result: executed.result,
    output: executed.output || null,
    headroom: executed.headroom || null,
    expansionRequired: executed.expansionRequired || null,
    missingInputs,
    trace: executed.trace || [],
    reason: null,
    evidence,
  };
};

// Determinism is structurally guaranteed by the pure-function rules above.

// ---------------------------------------------------------------------------
// 4B -- staleness. A calculation is stale when its governed inputs changed
// after it was performed (requirement profile version or product evidence
// version drift), or when it carries no performedAt timestamp at all.
// ---------------------------------------------------------------------------
export const isCalculationStale = ({ calculation, requirementProfileVersion, productEvidenceVersion } = {}) => {
  if (!calculation?.performedAt) return { stale: true, reason: "No performedAt timestamp; currency cannot be confirmed." };
  const inputFingerprint = calculation.inputFingerprint;
  if (!inputFingerprint) return { stale: true, reason: "No input fingerprint; the governed inputs the calculation ran on cannot be confirmed against the current versions." };
  const calcProfileVersion = inputFingerprint.requirementProfileVersion ?? calculation.requirementProfileVersion;
  const calcEvidenceVersion = inputFingerprint.productEvidenceVersion ?? calculation.productEvidenceVersion;
  if (requirementProfileVersion && calcProfileVersion && calcProfileVersion !== requirementProfileVersion) {
    return { stale: true, reason: `Requirement profile advanced (${calcProfileVersion} -> ${requirementProfileVersion}) after the calculation was performed.` };
  }
  if (productEvidenceVersion && calcEvidenceVersion && calcEvidenceVersion !== productEvidenceVersion) {
    return { stale: true, reason: `Product evidence version advanced (${calcEvidenceVersion} -> ${productEvidenceVersion}) after the calculation was performed.` };
  }
  return { stale: false, reason: null };
};

// ---------------------------------------------------------------------------
// 4B-6 -- engineer-facing language. Explicit lines, no fabricated numbers.
// ---------------------------------------------------------------------------
export const describeCalculation = (calculation) => {
  if (!calculation) return ["No calculation evaluation available."];
  const label = CALCULATION_LABELS[calculation.calculationType] || calculation.calculationType;
  if (calculation.state === "NOT_REQUIRED") return [`${label}: no governed calculation requirement applies here.`];
  if (calculation.state === "REQUIRED") return [`${label}: required calculation is awaiting engineering inputs.`];
  if (calculation.state === "ENGINEER_REVIEW_REQUIRED") return [`${label}: ungoverned calculation type; engineer review required.`];
  if (calculation.state === "CALCULATION_CONFLICT") return [`${label}: capacity requirement evidence conflicts; resolve with the engineer/AHJ before proceeding.`];
  if (calculation.state === "REQUIRED_BUT_INPUTS_MISSING") return describeMissingInputs(calculation, label);
  const output = calculation.output || {};
  const headroom = calculation.headroom || {};
  if (calculation.calculationType === "slc.loop-and-expansion") {
    if (calculation.state === "CALCULATED_PASS") {
      const lines = [`${label}: ${calculation.expansionRequired ? "Expansion required and sized" : "Fits within native capacity"}.`];
      if (calculation.expansionRequired) lines.push(`  Required: ${calculation.expansionRequired.requiredQuantity} x ${calculation.expansionRequired.expansionPartNumber}${calculation.expansionRequired.mountingUnit ? `, mounted via ${calculation.expansionRequired.mountingUnit.quantity} x ${calculation.expansionRequired.mountingUnit.partNumber}` : ""}.`);
      lines.push(`  Headroom: ${headroom.detectors ?? "n/a"} detectors / ${headroom.modules ?? "n/a"} modules.`);
      return lines;
    }
    return [`${label}: calculated demand exceeds verified capacity. ${headroom ? `Headroom: ${headroom.detectors ?? "-"} detectors / ${headroom.modules ?? "-"} modules.` : ""}`];
  }
  if (calculation.calculationType === "battery.standby-alarm") {
    // Both demands are cumulative, so the sentence names BOTH terms rather than
    // claiming one "governs" the result.
    return calculation.state === "CALCULATED_PASS"
      ? [`${label}: required ${output.requiredAh} Ah = (standby ${output.standbyAh} Ah + alarm ${output.alarmAh} Ah = ${output.totalAhBeforeDerating ?? "-"} Ah) x derating.`]
      : [`${label}: battery demand could not be sized.`];
  }
  if (calculation.calculationType === "power.capacity") {
    return calculation.state === "CALCULATED_PASS" || calculation.state === "CALCULATED_FAIL"
      ? [`${label}: standby ${output.totalStandbyAmps ?? "?"} A / alarm ${output.totalAlarmAmps ?? "?"} A vs published ceiling ${output.capacityLimitAmps ?? "?"} A -> ${calculation.result}.`]
      : [`${label}: output capacity could not be evaluated against governed evidence.`];
  }
  if (calculation.calculationType === "power.nac-load") {
    return [`${label}: total ${output.totalAlarmCurrent ?? "?"} A vs circuit ${output.nacAmpacity ?? "?"} A -> ${calculation.result}.`];
  }
  if (calculation.calculationType === "network.node-capacity") {
    return [`${label}: ${output.nodeCount ?? "?"} nodes vs max ${output.maxNetworkNodes ?? "?"} -> ${calculation.result}.`];
  }
  if (calculation.calculationType === "cctv.storage-retention") {
    return calculation.state === "CALCULATED_PASS" ? [`${label}: ${output.recommendedHddCount} HDD(s) recommended (${output.requiredUsableBytes ?? "?"} bytes usable).`] : [`${label}: storage cannot be sized without inputs.`];
  }
  if (calculation.calculationType === "power.runtime") {
    return [`${label}: ${output.runtimeHours ?? "?"} h vs required ${output.requiredRuntimeHours ?? "?"} h -> ${calculation.result}.`];
  }
  return [`${label}: ${calculation.state}.`];
};

export const describeMissingInputs = (calculation, label = null) => {
  const name = label || CALCULATION_LABELS[calculation.calculationType] || calculation.calculationType;
  const missing = calculation.missingInputs || [];
  if (!missing.length) return [`${name}: required engineering inputs are missing, but no specific gap was recorded.`];
  return [`${name}: missing governed engineering inputs: ${missing.join(", ")}. Supply verified values (never assume/fabricate them) to calculate.`];
};

// ---------------------------------------------------------------------------
// 4B-5 -- matching integration, authority-inert.
//
// feedCalculationsIntoEnvelope attaches DERIVED calculation evidence to the
// matching comparison envelope's own dimension. Purely explanatory: it never
// re-ranks, never re-scores, never sets confidence, never reads prices, and
// can only set an engineeringReviewRecommended advisory flag. For blocking
// calculation outcomes the (dimension) cross-domain state produced here is
// the Stage 4A ENGINEERING_DESIGN vs PRODUCT_TECHNICAL pairing
// (CALCULATION_DEFINES_PRODUCT_VERIFIES -> TECHNICAL_CONFLICT).
// ---------------------------------------------------------------------------
export const feedCalculationsIntoEnvelope = ({ envelope, calculationEvidence }) => {
  if (!envelope || !Array.isArray(calculationEvidence) || !calculationEvidence.length) return envelope || null;
  const derived = calculationEvidence.filter((entry) => entry?.dimension === envelope.dimension);
  if (!derived.length) return envelope;
  const copy = { ...envelope };
  copy.derivedEvidence = derived.map((entry) => ({
    ruleId: entry.ruleId,
    ruleVersion: entry.ruleVersion,
    calculationType: entry.calculationType,
    result: entry.result,
    blocking: entry.blocking,
    output: entry.output,
    headroom: entry.headroom,
    performedAt: entry.performedAt,
  }));
  const blockingDerived = derived.find((entry) => entry.blocking);
  if (blockingDerived) {
    // Advisory-only: the envelope is explanatory; the flag tells the engineer
    // this dimension carries a blocking engineering calculation. Score/rank
    // are untouched (see the envelope module header).
    copy.engineeringReviewRecommended = true;
    copy.conflicts = { state: blockingDerived.state === "CALCULATION_CONFLICT" ? "TECHNICAL_CONFLICT" : "CALCULATION_DEFINES_PRODUCT_VERIFIES", label: blockingDerived.state === "CALCULATION_CONFLICT" ? "TECHNICAL_CONFLICT" : "CALCULATION_DEFINES_PRODUCT_VERIFIES", relation: "The governed calculation defines required capacity; the product evidence cannot satisfy it without engineer review.", blocking: true, dimension: envelope.dimension };
  }
  return copy;
};

// ---------------------------------------------------------------------------
// STAGE 4D-1 -- LIVE-PATH CALCULATION WIRING (additive engineering evidence).
//
// Stage 4B proved the calculation rules produce first-class DERIVED evidence
// when fed explicit inputs. Stage 4D-1 wires those same rules into the live
// technical matching pipeline: it gathers candidate-side capacity facts from
// product.attributes and requirement-side demand/code facts from the approved
// requirement profile, evaluates EVERY governed calculation type, and attaches
// the full Stage 4B contract per result as `engineeringCalculations` on the
// candidate -- engineering evidence ONLY, with zero approval/ranking/pricing
// behavior change.
//
// Governing invariants (identical to the engine's own "never fabricate"):
//   - Admission gate is DATA-driven: a raw attribute name must appear in
//     CALCULATION_INPUT_SOURCES below for its side, and its value must be a
//     finite number. Non-parseable values (e.g. "150 IDP/SK points; 75 SD
//     points", "2 x 7") are MISSING inputs, never a guess.
//   - Nothing is inferred from model descriptions or free text.
//   - Price/commercial data is never read: the alias map contains no price
//     field, and the gather below only touches attribute records.
//   - Product attributes with review_status 'Rejected' are excluded, mirroring
//     loadProducts()'s `review_status<>'Rejected'` boundary exactly.
//   - Contradictory values gathered for the SAME governed input name are
//     surfaced as CALCULATION_CONFLICT through evaluateCalculationRequirement's
//     requirementConflict gate -- never silently resolved in favour of one.
//   - The wiring only reads already-verified facts and produces evidence; it
//     never changes score, rank, evidenceStrength, familyMatchTier,
//     confidence, approvalReady, or reviewStatus.
// ---------------------------------------------------------------------------
export const CALCULATION_INPUT_SOURCES = Object.freeze({
  "slc.loop-and-expansion": Object.freeze({
    product: Object.freeze({
      slc_loop_count: { input: "panelCapacity.nativeLoops", unit: "count" },
      slc_loops: { input: "panelCapacity.nativeLoops", unit: "count" },
      native_loops: { input: "panelCapacity.nativeLoops", unit: "count" },
      detector_capacity: { input: "panelCapacity.detectorsPerLoop", unit: "count" },
      detectors_per_loop: { input: "panelCapacity.detectorsPerLoop", unit: "count" },
      module_capacity: { input: "panelCapacity.modulesPerLoop", unit: "count" },
      modules_per_loop: { input: "panelCapacity.modulesPerLoop", unit: "count" },
      panel_capacity: { input: "panelCapacity.systemPointCeiling", unit: "count" },
      system_point_capacity: { input: "panelCapacity.systemPointCeiling", unit: "count" },
      loop_expansion_unit_loops_added: { input: "expansionOptions.loopExpansionUnit.loopsAddedPerUnit", unit: "count" },
      mounting_unit_capacity: { input: "expansionOptions.mountingUnit.capacityPerMountingUnit", unit: "count" },
    }),
    requirement: Object.freeze({
      detector_count: { input: "demand.detectors", unit: "count" },
      device_count: { input: "demand.detectors", unit: "count" },
      slc_point_count: { input: "demand.detectors", unit: "count" },
      addressable_device_count: { input: "demand.detectors", unit: "count" },
      module_count: { input: "demand.modules", unit: "count" },
      monitor_module_count: { input: "demand.modules", unit: "count" },
    }),
  }),
  "battery.standby-alarm": Object.freeze({
    product: Object.freeze({
      standby_current: { input: "standbyCurrent", unit: "A" },
      alarm_current: { input: "alarmCurrent", unit: "A" },
      battery_standby_current: { input: "standbyCurrent", unit: "A" },
      battery_alarm_current: { input: "alarmCurrent", unit: "A" },
    }),
    requirement: Object.freeze({
      standby_hours: { input: "standbyHours", unit: "h" },
      required_standby_hours: { input: "standbyHours", unit: "h" },
      alarm_minutes: { input: "alarmMinutes", unit: "min" },
      required_alarm_minutes: { input: "alarmMinutes", unit: "min" },
      derating_factor: { input: "deratingFactor", unit: "ratio", ratio: true },
      battery_derating_factor: { input: "deratingFactor", unit: "ratio", ratio: true },
    }),
  }),
  "power.nac-load": Object.freeze({
    product: Object.freeze({
      nac_ampacity: { input: "nacAmpacity", unit: "A" },
      nac_circuit_ampacity: { input: "nacAmpacity", unit: "A" },
    }),
    requirement: Object.freeze({
      device_loads: { input: "deviceLoads", unit: "A (sum)", list: true },
      nac_device_loads: { input: "deviceLoads", unit: "A (sum)", list: true },
    }),
  }),
  // power.capacity resolves the panel identity from PRODUCT evidence and the load
  // records from REQUIREMENT evidence. Alias names are chosen to match attribute
  // keys the project ALREADY governs; no new product attribute is invented here.
  "power.capacity": Object.freeze({
    product: Object.freeze({
      manufacturer: { input: "capabilityManufacturer", unit: "text" },
      manufacturer_name: { input: "capabilityManufacturer", unit: "text" },
      model: { input: "capabilityModel", unit: "text" },
      model_name: { input: "capabilityModel", unit: "text" },
      part_number: { input: "capabilityModel", unit: "text" },
    }),
    requirement: Object.freeze({
      device_loads: { input: "loads", unit: "A (sum)", list: true },
      electrical_loads: { input: "loads", unit: "A (sum)", list: true },
      power_loads: { input: "loads", unit: "A (sum)", list: true },
      capability_records: { input: "capabilityRecords", unit: "evidence", list: true },
    }),
  }),
  "network.node-capacity": Object.freeze({
    product: Object.freeze({
      network_capacity: { input: "maxNetworkNodes", unit: "count" },
      max_network_nodes: { input: "maxNetworkNodes", unit: "count" },
      node_capacity: { input: "maxNetworkNodes", unit: "count" },
    }),
    requirement: Object.freeze({
      node_count: { input: "nodeCount", unit: "count" },
      network_node_count: { input: "nodeCount", unit: "count" },
    }),
  }),
  "cctv.storage-retention": Object.freeze({
    product: Object.freeze({
      hdd_capacity_bytes: { input: "hddCapacityBytes", unit: "bytes" },
      storage_capacity_bytes: { input: "hddCapacityBytes", unit: "bytes" },
    }),
    requirement: Object.freeze({
      camera_count: { input: "cameraCount", unit: "count" },
      bitrate_bits_per_second: { input: "bitrateBitsPerSecond", unit: "bit/s" },
      bitrate_mbps: { input: "bitrateBitsPerSecond", unit: "bit/s", scale: 1_000_000, rawUnitPattern: /(mbps|mbit|megabit)/i },
      recording_hours_per_day: { input: "recordingHoursPerDay", unit: "h/day" },
      retention_days: { input: "retentionDays", unit: "days" },
    }),
  }),
  "power.runtime": Object.freeze({
    product: Object.freeze({
      battery_amp_hours: { input: "batteryAh", unit: "Ah" },
      battery_capacity_ah: { input: "batteryAh", unit: "Ah" },
      system_voltage: { input: "systemVoltage", unit: "V" },
      battery_voltage: { input: "systemVoltage", unit: "V" },
      efficiency: { input: "efficiency", unit: "ratio", ratio: true },
      inverter_efficiency: { input: "efficiency", unit: "ratio", ratio: true },
    }),
    requirement: Object.freeze({
      load_watts: { input: "loadWatts", unit: "W" },
      critical_load_watts: { input: "loadWatts", unit: "W" },
      required_runtime_hours: { input: "requiredRuntimeHours", unit: "h" },
    }),
  }),
});

const wiringName = (raw) => String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const wiringValue = (entry) => entry?.normalizedValue ?? entry?.normalized_value ?? entry?.parsedValue ?? entry?.value ?? entry?.original_value ?? entry?.originalValue ?? null;
const wiringUnit = (entry) => String(entry?.normalizedUnit ?? entry?.normalized_unit ?? entry?.unit ?? entry?.originalUnit ?? entry?.original_unit ?? "");
const unwrapFactValue = (value) => (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "value") ? value.value : value);

// Unit-driven coercion only. `ratio` converts a recorded "%"/"percent" unit to
// a 0..1 ratio; `scale` multiplies when the recorded unit confirms the alias's
// expected raw unit (e.g. Mbps -> bit/s). Nothing is ever guessed from a
// missing or mismatched unit -- the value is simply not admitted.
const coerceWiringValue = ({ value, unit, ratioInput = false, scale = null, rawUnitPattern = null }) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  if (rawUnitPattern && (!unit || !rawUnitPattern.test(unit))) return null;
  let converted = raw;
  if (scale !== null) converted = converted * scale;
  if (ratioInput && unit && /(percent|%)/i.test(unit)) converted = converted / 100;
  return converted;
};

const wiringProvenance = (entry, side) => ({
  side,
  sourceId: entry?.sourceId ?? entry?.source_id ?? null,
  documentId: entry?.documentId ?? entry?.document_id ?? null,
  reviewStatus: entry?.reviewStatus ?? entry?.review_status ?? null,
  origin: entry?.origin ?? null,
  confidence: entry?.confidence ?? null,
  evidence: entry?.evidence ?? entry?.evidence_json ?? null,
});

const readRequirementFacts = (profile) => {
  const facts = [];
  const push = (rawName, value, unit, sources) => {
    const unwrapped = unwrapFactValue(value);
    if (unwrapped === null || unwrapped === undefined || typeof unwrapped === "boolean") return;
    facts.push({ name: wiringName(rawName), value: unwrapped, unit, sources });
  };
  const boqAttributes = profile?.boqItem?.attributes ?? null;
  if (boqAttributes && typeof boqAttributes === "object" && !Array.isArray(boqAttributes)) {
    for (const [name, value] of Object.entries(boqAttributes)) push(name, value, null, null);
  }
  const classification = profile?.boqItem?.slcResourceClassification ?? null;
  if (classification && ["SLC_DETECTOR_POOL", "SLC_MODULE_POOL"].includes(classification.state) && Number.isFinite(Number(classification.demandUnits)) && Number(classification.demandUnits) >= 0) {
    const quantity = classification.quantity ?? {};
    const evidence = classification.provenance ?? null;
    const source = {
      side: "slc-resource-classification",
      sourceId: quantity.source ?? null,
      documentId: quantity.decisionId ?? null,
      reviewStatus: "Approved",
      origin: classification.state,
      confidence: null,
      evidence,
    };
    push("detector_count", classification.state === "SLC_DETECTOR_POOL" ? classification.demandUnits : 0, "count", source);
    push("module_count", classification.state === "SLC_MODULE_POOL" ? classification.demandUnits : 0, "count", source);
  }
  for (const requirement of profile?.consolidatedRequirements ?? []) {
    for (const entry of requirement?.attributes ?? []) {
      push(entry?.name ?? entry?.attributeName ?? entry?.canonicalName ?? entry?.canonical_name ?? "", entry?.normalizedValue ?? entry?.requiredValue ?? entry?.parsedValue ?? entry?.value ?? null, entry?.normalizedUnit ?? entry?.requiredUnit ?? entry?.unit ?? null, entry?.sources ?? requirement?.sources ?? null);
    }
  }
  return facts;
};

// Gathers the governed inputs for ONE calculation type from the candidate
// product + the approved requirement profile. Returns aligned inputs (rule
// schema names), the product-side attribute subset actually used (for the
// productEvidenceVersion fingerprint), and any conflicting input names.
export const gatherCalculationInputs = ({ calculationType, product, profile }) => {
  const aliases = CALCULATION_INPUT_SOURCES[calculationType];
  if (!aliases) return { inputs: [], conflictInputs: [], usedProductAttributes: [] };
  const gathered = [];
  const usedProductAttributes = [];
  for (const entry of Array.isArray(product?.attributes) ? product.attributes : []) {
    if ((entry?.reviewStatus ?? entry?.review_status) !== "Approved") continue;
    const alias = aliases.product?.[wiringName(entry?.name ?? entry?.attribute_name ?? entry?.attributeName ?? entry?.canonicalName ?? entry?.canonical_name ?? "")];
    if (!alias) continue;
    const value = coerceWiringValue({ value: wiringValue(entry), unit: wiringUnit(entry), ratioInput: alias.ratio === true, scale: alias.scale ?? null, rawUnitPattern: alias.rawUnitPattern ?? null });
    if (value === null) continue;
    const record = { alias, value, provenance: wiringProvenance(entry, "product") };
    gathered.push(record);
    usedProductAttributes.push(record);
  }
  for (const fact of readRequirementFacts(profile)) {
    const alias = aliases.requirement?.[fact.name];
    if (!alias) continue;
    const value = coerceWiringValue({ value: Number(fact.value), unit: fact.unit, ratioInput: alias.ratio === true, scale: alias.scale ?? null, rawUnitPattern: alias.rawUnitPattern ?? null });
    if (value === null) continue;
    gathered.push({ alias, value, provenance: fact.sources?.side ? fact.sources : { side: "requirement", sourceId: null, documentId: null, reviewStatus: null, origin: null, confidence: null, evidence: fact.sources ?? null } });
  }
  // Merge per governed schema input. Conflicting values on the SAME input are
  // NOT resolved here -- they surface as CALCULATION_CONFLICT so the engineer
  // decides (never silently prefer one verified fact over another).
  const byInput = new Map();
  for (const record of gathered) {
    const entry = byInput.get(record.alias.input) || { input: record.alias.input, records: [] };
    entry.records.push(record);
    byInput.set(record.alias.input, entry);
  }
  const inputs = [];
  const conflictInputs = [];
  for (const entry of byInput.values()) {
    const distinct = [...new Set(entry.records.map((record) => Number(record.value)))];
    if (distinct.length > 1) conflictInputs.push(entry.input);
    const chosen = entry.records[0];
    inputs.push({ name: entry.input, value: chosen.value, unit: chosen.alias.unit, source: chosen.provenance });
  }
  return { inputs, conflictInputs, usedProductAttributes };
};

const fingerprintOf = (value) => createHash("sha256").update(stableStringify(value)).digest("hex");

// Attach the staleness fingerprint per result NOW (Stage 4D-3+ will evaluate it
// against current inputs/rule versions). `stale` itself is deliberately null in
// this stage: currency evaluation is a later stage's job, not this wiring's.
export const buildCalculationInputFingerprint = ({ calculationType, ruleVersion, system, family, applicableCalculationTypes, requirementProfileVersion, inputs, usedProductAttributes }) => ({
  requirementProfileVersion: requirementProfileVersion ?? null,
  productEvidenceVersion: fingerprintOf(usedProductAttributes.map((entry) => ({ name: entry.alias.input, value: entry.value, unit: entry.alias.unit }))),
  ruleVersions: { [calculationType]: ruleVersion },
  candidateSpecific: fingerprintOf({ wiringVersion: CALCULATION_WIRING_VERSION, system, family, calculationType, inputs: inputs.map((entry) => ({ input: entry.name, value: entry.value, unit: entry.unit, side: entry.source?.side ?? null })) }),
  itemBasis: fingerprintOf({ system, family, applicableCalculationTypes }),
});

/**
 * Fingerprint of the inputs a calculation ACTUALLY CONSUMED, covering value AND
 * authority.
 *
 * Deliberately includes sourceType / sourceId / authorityState / currentness, not
 * just the number: a capacity fact that has been superseded by a newer document
 * must invalidate a prior result even when the digit is unchanged. Callers that
 * only pass {name,value,unit} keep working -- the extra fields simply hash null.
 *
 * Timestamps are never used as authority anywhere in this fingerprint.
 *
 * The first four slots are reserved for future Project Mode so the SAME function
 * can later absorb selected-panel identity/version, capacity-fact versions, an
 * address-demand fingerprint and a panel-allocation version without a second
 * hashing mechanism. They are null here because those authorities do not exist
 * yet, and a null slot must never be filled with a substitute.
 */
export const buildCalculationInputStateFingerprint = ({
  inputs = [],
  calculationVersion = null,
  selectedPanel = null,
  capacityFactVersions = null,
  addressDemandFingerprint = null,
  panelAllocationVersion = null,
  sparePolicyVersion = null,
} = {}) => fingerprintOf({
  consumedInputs: (Array.isArray(inputs) ? inputs : []).map((entry) => ({
    name: entry?.name ?? null,
    value: entry?.value ?? null,
    unit: entry?.unit ?? null,
    sourceType: entry?.sourceType ?? null,
    sourceId: entry?.sourceId ?? null,
    authorityState: entry?.authorityState ?? null,
    currentness: entry?.currentness ?? null,
    manualOverrideState: entry?.manualOverrideState ?? null,
    assumptionState: entry?.assumptionState ?? null,
  })),
  calculationVersion,
  selectedPanel,
  capacityFactVersions,
  addressDemandFingerprint,
  panelAllocationVersion,
  sparePolicyVersion,
});

// Stage 4D-1 orchestrator: evaluates ALL six governed calculation types for a
// candidate product against the approved requirement profile and returns the
// additive `engineeringCalculations` envelope. Purely evidence-producing:
// feedCalculationsIntoEnvelope-consuming consumers may attach the DERIVED
// evidence to their own explanatory envelope; nobody re-scores or re-ranks.
export const evaluateCandidateEngineeringCalculations = ({ profile, product, performedAt = null }) => {
  const system = profile?.boqItem?.system ?? null;
  const family = product?.family ?? null;
  const scope = system ? { system, family } : null;
  const requirementProfileVersion = profile?.versionNumber ?? null;
  const applicableCalculationTypes = CALCULATION_TYPES.filter((calculationType) => calculationApplicabilityFor({ calculationType, system, family }).applicable);
  const results = [];
  let passed = 0, failed = 0, notRequired = 0, missingInputs = 0, conflict = 0, required = 0, calculated = 0;
  for (const calculationType of CALCULATION_TYPES) {
    const gathered = gatherCalculationInputs({ calculationType, product, profile });
    const evaluation = evaluateCalculationRequirement({ calculationType, system, family, scope, inputs: gathered.inputs, inputProvenance: gathered.inputs.map((entry) => entry.source), requirementConflict: gathered.conflictInputs.length > 0, performedAt });
    const rule = CALCULATION_RULES[calculationType];
    const result = {
      calculationType,
      state: evaluation.state,
      blocking: evaluation.blocking,
      result: evaluation.result,
      ruleId: rule?.ruleId ?? null,
      ruleVersion: rule?.ruleVersion ?? null,
      dimension: rule?.dimension ?? null,
      label: rule?.label ?? CALCULATION_LABELS[calculationType] ?? null,
      formula: rule?.formula ?? null,
      inputs: gathered.inputs,
      normalizedInputs: gathered.inputs.map((entry) => ({ name: entry.name, value: Number(entry.value), unit: entry.unit ?? null })),
      inputProvenance: gathered.inputs.map((entry) => entry.source),
      conflictInputs: gathered.conflictInputs,
      output: evaluation.output ?? null,
      headroom: evaluation.headroom ?? null,
      expansionRequired: evaluation.expansionRequired ?? null,
      evidenceKind: evaluation.evidence ? "DERIVED" : null,
      evidence: evaluation.evidence,
      missingInputs: evaluation.missingInputs ?? [],
      reason: evaluation.reason ?? null,
      trace: evaluation.trace ?? [],
      performedAt: performedAt ?? null,
      stale: null,
      inputFingerprint: buildCalculationInputFingerprint({ calculationType, ruleVersion: rule?.ruleVersion ?? null, system, family, applicableCalculationTypes, requirementProfileVersion, inputs: gathered.inputs, usedProductAttributes: gathered.usedProductAttributes }),
    };
    if (result.state === "CALCULATED_PASS") passed += 1;
    else if (result.state === "CALCULATED_FAIL") failed += 1;
    if (result.state === "NOT_REQUIRED") notRequired += 1;
    if (result.state === "REQUIRED_BUT_INPUTS_MISSING") missingInputs += 1;
    if (result.state === "CALCULATION_CONFLICT") conflict += 1;
    if (result.state === "REQUIRED") required += 1;
    if (["CALCULATED_PASS", "CALCULATED_FAIL"].includes(result.state)) calculated += 1;
    results.push(result);
  }
  return {
    engineVersion: CALCULATION_ENGINE_VERSION,
    wiringVersion: CALCULATION_WIRING_VERSION,
    evaluatedAt: performedAt ?? null,
    system,
    family,
    applicableCalculationTypes,
    applicabilityReason: applicableCalculationTypes.length ? `${family ?? "unknown"} in ${system ?? "unknown"}: ${applicableCalculationTypes.join(", ")} required.` : `Family "${family ?? "unknown"}" in ${system ?? "unknown"} has no governed calculation requirement.`,
    results,
    inputFingerprint: {
      requirementProfileVersion,
      productEvidenceVersion: fingerprintOf(results.flatMap((result) => result.normalizedInputs)),
      ruleVersions: Object.fromEntries(results.map((result) => [result.calculationType, result.ruleVersion])),
      itemBasis: fingerprintOf({ system, family, applicableCalculationTypes }),
    },
    summary: { total: results.length, required, calculated, passed, failed, notRequired, missingInputs, conflict },
  };
};