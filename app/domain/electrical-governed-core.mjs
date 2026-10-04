// GOVERNED ELECTRICAL CORE -- PURE, DEPENDENCY-FREE ARITHMETIC + CAPABILITY CORE.
//
// WHY THIS FILE EXISTS SEPARATELY
// ---------------------------------------------------------------------------------
// app/domain/electrical-core-calculators.mjs needs the platform evidence contract
// (buildDerivedCalculationEvidence + the shared enums) FROM
// app/domain/calculation-requirement-engine.mjs. The canonical engine must in turn
// DELEGATE to the calculators so there is exactly ONE battery arithmetic authority
// and ONE capability resolver. That is mutual use, so one side has to be free of
// engine imports. This module is that side.
//
// It contains EVERYTHING deterministic: the capability-evidence primitive, the
// current FARENHYT capability registry, both calculators, and the single shared
// battery-demand arithmetic that the canonical rule delegates to.
//
// PURE: no imports from app/domain, no DB, no fetch, no clock, no randomness.
// `node:crypto` is the only dependency and is used solely for the input fingerprint.
import { createHash } from "node:crypto";

import { stableStringify } from "./boq-understanding-engine.mjs";

export const ELECTRICAL_CALCULATOR_VERSION = "electrical-core-calculators-1.0.0";

// ---------------------------------------------------------------------------
// CAPABILITY EVIDENCE -- the anti-leakage primitive.
//
// A bare number is not engineering data (the same invariant
// app/domain/scoped-product-capacity.mjs enforces for loop capacity). Every
// capability number below carries WHO it belongs to, WHICH document states it,
// and WHICH revision, so a consumer can always see where a number came from and
// how old it is -- and so a number for one model can never satisfy a request
// for another.
// ---------------------------------------------------------------------------

/**
 * PROVEN     -- the manufacturer document states this number for this model.
 * BLOCKING   -- the evidence exists but is CONFLICTED or INCOMPLETE, so the
 *               number may not be used. Fail closed.
 * SUPERSEDED -- a newer revision governs; the record is retained, never used.
 * UNKNOWN    -- no evidence was found. Fail closed.
 */
export const CAPABILITY_STATES = Object.freeze(["PROVEN", "BLOCKING", "SUPERSEDED", "UNKNOWN"]);

/** Build one capability evidence record. */
export const capabilityRecord = ({
  manufacturer,
  model,
  family = null,
  field,
  value = null,
  unit = null,
  document,
  revision = null,
  publisher = null,
  url = null,
  quote = null,
  state = "PROVEN",
  blocker = null,
}) => Object.freeze({
  manufacturer,
  model,
  family,
  field,
  value: state === "PROVEN" ? value : null,
  unit,
  document,
  revision,
  publisher,
  url,
  quote,
  state: CAPABILITY_STATES.includes(state) ? state : "UNKNOWN",
  blocker,
});

/**
 * Resolve ONE capability for an EXACT manufacturer + model + field.
 *
 * Fail-closed rules, in order:
 *   1. no record at all              -> UNKNOWN   (never a default, never 0)
 *   2. only SUPERSEDED records exist -> SUPERSEDED
 *   3. any BLOCKING record exists    -> BLOCKING   (a conflict is not a licence
 *                                                to pick the convenient value)
 *   4. two PROVEN records disagree   -> UNKNOWN + CONFLICT, never silently resolved
 *   5. exactly one agreed PROVEN     -> that record
 *
 * Cross-family leakage is structurally impossible: `model` is matched exactly,
 * so a NOTIFIER / Silent Knight record can never satisfy a FARENHYT request.
 */
export const resolveCapability = (records, { manufacturer, model, field } = {}) => {
  const matching = (records || []).filter(
    (entry) => entry?.manufacturer === manufacturer && entry?.model === model && entry?.field === field,
  );
  if (!matching.length) {
    return {
      state: "UNKNOWN",
      manufacturer: manufacturer ?? null,
      model: model ?? null,
      field: field ?? null,
      value: null,
      reason:
        `No capability evidence exists for ${field} on ${manufacturer ?? "unknown"} ${model ?? "unknown"}. ` +
        "Absence of evidence is UNKNOWN, never a passing result and never a default.",
    };
  }
  const superseded = matching.filter((entry) => entry.state === "SUPERSEDED");
  const blocking = matching.filter((entry) => entry.state === "BLOCKING");
  const proven = matching.filter((entry) => entry.state === "PROVEN");

  if (!proven.length && superseded.length) {
    return {
      state: "SUPERSEDED",
      manufacturer,
      model,
      field,
      value: null,
      reason:
        `Every ${field} record for ${manufacturer} ${model} is superseded: ` +
        superseded.map((entry) => `${entry.document}${entry.revision ? ` Rev ${entry.revision}` : ""}`).join("; "),
      supersededBy: superseded[0]?.supersededBy ?? null,
    };
  }
  if (blocking.length) {
    return {
      state: "BLOCKING",
      manufacturer,
      model,
      field,
      value: null,
      reason: blocking[0]?.blocker || `Capability evidence for ${field} on ${manufacturer} ${model} is conflicted or incomplete.`,
      documents: blocking.map((entry) => entry.document),
    };
  }
  const distinct = [...new Set(proven.map((entry) => JSON.stringify(entry.value)))];
  if (distinct.length > 1) {
    return {
      state: "UNKNOWN",
      manufacturer,
      model,
      field,
      value: null,
      conflict: true,
      reason:
        `Conflicting PROVEN capability values for ${field} on ${manufacturer} ${model}: ` +
        proven.map((entry) => `${entry.value} (${entry.document})`).join(" vs ") +
        ". Refusing to select one.",
    };
  }
  return { state: "PROVEN", manufacturer, model, field, value: proven[0].value, unit: proven[0].unit, evidence: proven[0] };
};

/** True when a resolved capability may be used as a number. */
export const capabilityUsable = (resolved) => resolved?.state === "PROVEN" && Number.isFinite(Number(resolved.value));

/**
 * True when a resolved capability carries a usable value of ANY type.
 *
 * capabilityUsable is deliberately numeric-only, because using a non-numeric value
 * where a number belongs is exactly the silent substitution this module exists to
 * prevent. Some capabilities are legitimately structured -- the manufacturer
 * current/impedance envelope is a TABLE -- so those are gated on presence and
 * state here rather than being coerced to NaN and rejected.
 */
export const capabilityResolved = (resolved) =>
  resolved?.state === "PROVEN" && resolved.value !== null && resolved.value !== undefined;

// ---------------------------------------------------------------------------
// CURRENT AL MOUSA FIRE ALARM CAPABILITY EVIDENCE.
//
// LIVE AUTHORITY, re-read before this file was written:
//   engineering_knowledge_decisions
//     ecosystemDecision_1e636450-711b-4bcf-8008-f5aebe2dcd75
//     action = supersede-fire-alarm-ecosystem
//     decided_at = 2026-10-01T20:57:43.805Z
//     decided_by = authoritative-engineer-decision
//     decided_role = Project Engineer (authoritative human decision)
//     ecosystem = FARENHYT
//     preliminaryPanelFamily = FARENHYT_IFP_2100 / "Honeywell Farenhyt IFP-2100 Series"
//     notDirectMatchEcosystems = ["NOTIFIER","GAMEWELL_FCI","GENT","SIMPLEX"]
//
// The earlier NOTIFIER / INSPIRE N16 ecosystem decision
// (ecosystemDecision_acfdc49f, 2026-09-30T09:38:06Z) was explicitly SUPERSEDED.
// NOTIFIER is therefore a technically valid ALTERNATIVE, not this project's
// design basis, and no N16 number may satisfy a FARENHYT calculation.
//
// MANUFACTURER EVIDENCE (Honeywell, cited to prod-edam.honeywell.com)
// ---------------------------------------------------------------------------

/** IFP-2100HV / RPS-1000HV output + battery capability, and the NOTIFIER gap. */
export const AL_MOUSA_ELECTRICAL_CAPABILITY = Object.freeze([
  // --- IFP-2100HV NAC / auxiliary output ceiling ---------------------------
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    family: "IFP-2100 / IFP-2100HV / RFP-2100 / RFP-2100HV",
    field: "power.output.perCircuitAmps",
    value: 3,
    unit: "A",
    document: "Honeywell Farenhyt IFP-2100 Data Sheet",
    revision: "Doc 351602 Rev C (04-2022)",
    publisher: "Honeywell Fire Solutions",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf",
    quote: "Maximum current per circuit: 3 A. Cannot exceed 9A total for all circuits.",
  }),
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    family: "IFP-2100 / IFP-2100HV / RFP-2100 / RFP-2100HV",
    field: "power.output.totalAmps",
    value: 9,
    unit: "A",
    document: "Honeywell Farenhyt IFP-2100 Data Sheet",
    revision: "Doc 351602 Rev C (04-2022)",
    publisher: "Honeywell Fire Solutions",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf",
    quote:
      "Flexput Circuits: Terminal block provides connections for (eight Class B or four Class A) NACs or auxiliary power. " +
      "Power-limited, supervised circuitry. Maximum current per circuit: 3 A. Cannot exceed 9A total for all circuits.",
  }),
  // --- IFP-2100 battery charger ceiling -----------------------------------
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "battery.charger.minAh",
    value: 17,
    unit: "Ah",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual",
    revision: "LS10143-001SK-E Rev E",
    publisher: "Honeywell Fire Solutions",
    quote: "The control panel battery charge capacity is 17 to 55 AH.",
  }),
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "battery.charger.maxAh",
    value: 55,
    unit: "Ah",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual",
    revision: "LS10143-001SK-E Rev E",
    publisher: "Honeywell Fire Solutions",
    quote: "The control panel battery charge capacity is 17 to 55 AH.",
  }),
  // --- IFP-2100 in-cabinet battery limit (separate cabinet above this) -----
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "battery.enclosure.mainCabinetMaxAh",
    value: 18,
    unit: "Ah",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual",
    revision: "LS10143-001SK-E Rev E",
    publisher: "Honeywell Fire Solutions",
    quote:
      "The main cabinet physically accepts two 18 Ah batteries, but the CHARGER accepts 17-55 Ah. A selected size above " +
      "18 Ah is legitimate and requires an RBB or AB-55 accessory enclosure; conversely a battery that fits the " +
      "cabinet is not thereby proven adequate.",
  }),
  // --- IFP-2100 battery derating factor ------------------------------------
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "battery.deratingFactor",
    value: 1.25,
    unit: "ratio",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual, Sec 3.5.2, Table 3.2 (Continued)",
    revision: "LS10143-001SK-E Rev E",
    publisher: "Honeywell Fire Solutions",
    quote: "Multiply by the Derating Factor   1.25",
  }),
  // --- IFP-2100 supported battery sizes ------------------------------------
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "battery.optionsAh",
    value: [17, 18, 24, 33, 35, 40, 55],
    unit: "Ah",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual, Tables 3.5 / 3.6 and battery accessory section",
    revision: "LS10143-001SK-E Rev E",
    publisher: "Honeywell Fire Solutions",
    quote:
      "FARENHYT DOES NOT SUPPORT THE USE OF BATTERIES SMALLER THAN THOSE LISTED IN TABLES 3.5 AND 3.6. " +
      "Use next size battery with capacity greater than required (worksheet footnote 7).",
  }),

  // --- IFP-2100HV NAC voltage-drop authority --------------------------------
  // APPLICABILITY IS EXPLICIT, NOT INFERRED. LS10143-001SK-E Rev E carries a scope
  // note in its own Introduction: "All references to the IFP-2100 within this manual
  // are applicable to the IFP-2100, IFP-2100B, IFP-2100ECS, IFP-2100ECSB, IFP-2100HV,
  // IFP-2100HVB, IFP-2100ECSHV, IFP-2100ECSHVB, RFP-2100, and RFP-2100B unless
  // otherwise indicated." IFP-2100HV is named, so every figure below is EXACT-MODEL
  // CURRENT for the Al Mousa panel rather than a family inference.
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "nac.voltageRegulated",
    value: "REGULATED_24VDC",
    unit: "text",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual, Flexput I/O Circuits, Figure 4.44 / 4.45",
    revision: "LS10143-001SK-E Rev E (8/29/2022)",
    publisher: "Honeywell Fire Solutions",
    quote: "All Circuits are Regulated. Rated at 24VDC @ 3A max per circuit, 9A max total.",
  }),
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "nac.maxVoltageDropVolts",
    value: 3,
    unit: "V",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual, Sec 4.18.1 Class A / Class B Notification Wiring",
    revision: "LS10143-001SK-E Rev E (8/29/2022)",
    publisher: "Honeywell Fire Solutions",
    quote:
      "Class B: \"Maximum voltage drop is 3V per Class B notification. See Table 4.6.\" " +
      "Class A: \"Maximum voltage drop is 3V per Class A circuit. See Table 4.7.\"",
  }),
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "nac.maxImpedanceOhmsByAmps",
    value: Object.freeze([
      Object.freeze({ amps: 1.0, maxImpedanceOhms: 3 }),
      Object.freeze({ amps: 1.5, maxImpedanceOhms: 2 }),
      Object.freeze({ amps: 2.0, maxImpedanceOhms: 1.5 }),
      Object.freeze({ amps: 2.5, maxImpedanceOhms: 1.2 }),
      Object.freeze({ amps: 3.0, maxImpedanceOhms: 1.0 }),
    ]),
    unit: "ohm",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual, Table 4.6 Maximum Impedance Class B / Table 4.7 Class A",
    revision: "LS10143-001SK-E Rev E (8/29/2022)",
    publisher: "Honeywell Fire Solutions",
    quote: "Current Maximum Impedance  1.0A 3 ohm  1.5A 2 ohm  2.0A 1.5 ohm  2.5A 1.2 ohm  3.0A 1.0 ohm",
  }),
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    field: "nac.classA.maxImpedanceOhms",
    value: 50,
    unit: "ohm",
    document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual, Table 4.7 Maximum Impedance Class A",
    revision: "LS10143-001SK-E Rev E (8/29/2022)",
    publisher: "Honeywell Fire Solutions",
    quote: "Maximum Impedance per circuit is 50 ohm.",
  }),

  // --- RPS-1000HV auxiliary power module ----------------------------------
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "RPS-1000HV",
    field: "power.output.totalAmps",
    value: 6,
    unit: "A",
    document: "Honeywell Farenhyt RPS-1000/RPS-1000HV Data Sheet",
    revision: "Doc 350070 Rev M (04-2022)",
    publisher: "Honeywell Fire Solutions",
    quote: "Provides 6.0 amps output power. ... Total Accessory Load: 6A @ 24VDC",
  }),
  capabilityRecord({
    manufacturer: "FARENHYT",
    model: "RPS-1000HV",
    field: "power.output.perCircuitAmps",
    value: 3,
    unit: "A",
    document: "Honeywell Farenhyt RPS-1000/RPS-1000HV Data Sheet",
    revision: "Doc 350070 Rev M (04-2022)",
    publisher: "Honeywell Fire Solutions",
    quote: "Uses Flexput I/O circuits, 3A each",
  }),

  // --- NOTIFIER INSPIRE N16 / PMB-AUX: EVIDENCE GAP, NOT A NUMBER ---------
  // Recorded BLOCKING so the calculator fails closed on N16 rather than
  // silently adopting a superseded limit.
  capabilityRecord({
    manufacturer: "NOTIFIER",
    model: "PMB-AUX",
    family: "INSPIRE N16",
    field: "battery.charger.maxAh",
    state: "BLOCKING",
    document: "NOTIFIER-C7 (app/domain/notifier-product-corpus.mjs)",
    revision: "DN-62112 Rev M vs DN-62116 Rev B",
    publisher: "Honeywell NOTIFIER",
    blocker:
      "SOURCE_SEMANTIC_CONFLICT, recorded severity BLOCKING_FOR_BATTERY_SIZING: DN-62112 Rev M states 7-210 AH and " +
      "2.0 A aux while DN-62116 Rev B still states 7-100 AH and 1.5 A aux. The project's own corpus records the " +
      "resolution as UNRESOLVED, so no charger ceiling may be used for N16 until Honeywell confirms the governing revision.",
  }),
  capabilityRecord({
    manufacturer: "NOTIFIER",
    model: "PMB-AUX",
    family: "INSPIRE N16",
    field: "battery.requiredAh",
    state: "BLOCKING",
    document: "GAP-05 (app/domain/notifier-product-corpus.mjs)",
    revision: "recorded severity BLOCKING_FOR_BATTERY_SIZING",
    publisher: "Honeywell NOTIFIER",
    blocker:
      "No model-level battery amp-hour evidence exists for N16. DN-6933 (BAT series) was not reviewed and the N16 " +
      "manual Appendix K battery-sizing section was not obtained.",
  }),
]);

// ---------------------------------------------------------------------------
// Shared fail-closed numeric helpers.
// ---------------------------------------------------------------------------

const isFiniteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
const isPositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

const round3 = (value) => Math.round(Number(value) * 1000) / 1000;

/** Capacity verdict vocabulary, deliberately separate from CALCULATION_RESULTS. */
export const CAPACITY_STATUS = Object.freeze({
  WITHIN: "WITHIN_CAPACITY",
  EXCEEDED: "EXCEEDED",
  UNKNOWN: "UNKNOWN",
});

/**
 * Validate one load row. Returns null when acceptable, otherwise the reason.
 *
 * A load with no governed current evidence is UNKNOWN, never zero. Treating a
 * missing current as 0 A is the exact fail-open this project has been bitten by
 * before (a blank circuit reported "within limitations").
 */
const loadDefect = (load, index) => {
  const at = `loads[${index}]`;
  if (load == null || typeof load !== "object") return `${at} is not a load record.`;
  const quantity = load.quantity ?? 1;
  if (!isFiniteNonNegative(quantity)) return `${at}.quantity must be a finite non-negative number (got ${load.quantity}).`;
  for (const field of ["standbyAmps", "alarmAmps"]) {
    const value = load[field];
    if (value === undefined || value === null || value === "") {
      return `${at}.${field} has no selected-product current evidence; UNKNOWN, not zero.`;
    }
    if (!isFiniteNonNegative(value)) return `${at}.${field} must be a finite non-negative number (got ${value}).`;
    if (!load.currentEvidence?.[field]) {
      return `${at}.${field} carries no current evidence reference; a bare number may not be used.`;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// 1. POWER CAPACITY CALCULATOR
// ---------------------------------------------------------------------------

export const POWER_CAPACITY_RULE = Object.freeze({
  ruleId: "power.capacity",
  ruleVersion: "power.capacity-1.0.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "Panel / PSU Power Capacity",
  formula:
    "totalStandbyAmps = SUM(load.quantity * load.standbyAmps); totalAlarmAmps = SUM(load.quantity * load.alarmAmps); " +
    "each is compared INDEPENDENTLY against the selected model's published total output ceiling. " +
    "withinCapacity = (standby <= ceiling) AND (alarm <= ceiling).",
  inputSchema: Object.freeze([
    { name: "capabilityManufacturer", unit: "text", required: true },
    { name: "capabilityModel", unit: "text", required: true },
    { name: "loads", unit: "A (sum)", required: true },
  ]),
});

/**
 * Evaluate a panel / PSU against its own published output ceiling.
 *
 * `capabilityRecords` defaults to the Al Mousa governed registry. Supplying a
 * different registry is supported so the calculator stays reusable, but the
 * manufacturer/model match stays EXACT in every case.
 */
export const calculatePowerCapacity = ({
  manufacturer,
  model,
  loads = [],
  capabilityRecords = AL_MOUSA_ELECTRICAL_CAPABILITY,
} = {}) => {
  const blockers = [];
  const warnings = [];

  if (!manufacturer || !model) {
    blockers.push("A selected panel / PSU identity (manufacturer + model) is required; capacity cannot be evaluated for an unidentified device.");
  }

  const total = resolveCapability(capabilityRecords, { manufacturer, model, field: "power.output.totalAmps" });
  if (!capabilityUsable(total)) blockers.push(total.reason);

  const defects = loads.map(loadDefect).filter(Boolean);
  blockers.push(...defects);

  if (loads.length === 0) blockers.push("No electrical load records were supplied; an empty design is not evidence of a compliant design.");

  const evidenceUsed = capabilityUsable(total) ? [total.evidence] : [];

  if (blockers.length) {
    return {
      calculator: "PowerCapacityCalculator",
      version: ELECTRICAL_CALCULATOR_VERSION,
      manufacturer: manufacturer ?? null,
      model: model ?? null,
      state: "BLOCKED_BY_MISSING_INPUTS",
      result: "UNKNOWN",
      blocking: true,
      totalStandbyAmps: null,
      totalAlarmAmps: null,
      standbyCapacityStatus: CAPACITY_STATUS.UNKNOWN,
      alarmCapacityStatus: CAPACITY_STATUS.UNKNOWN,
      withinCapacity: null,
      capacityLimitAmps: null,
      blockers,
      warnings,
      evidenceUsed,
      capabilityResolution: total,
      trace: [`Power capacity NOT evaluated: ${blockers.join(" | ")}`],
    };
  }

  const ceiling = Number(total.value);
  const totalStandbyAmps = loads.reduce((sum, load) => sum + Number(load.quantity ?? 1) * Number(load.standbyAmps), 0);
  const totalAlarmAmps = loads.reduce((sum, load) => sum + Number(load.quantity ?? 1) * Number(load.alarmAmps), 0);

  const standbyCapacityStatus = totalStandbyAmps <= ceiling ? CAPACITY_STATUS.WITHIN : CAPACITY_STATUS.EXCEEDED;
  const alarmCapacityStatus = totalAlarmAmps <= ceiling ? CAPACITY_STATUS.WITHIN : CAPACITY_STATUS.EXCEEDED;
  const withinCapacity = standbyCapacityStatus === CAPACITY_STATUS.WITHIN && alarmCapacityStatus === CAPACITY_STATUS.WITHIN;

  if (!withinCapacity) {
    blockers.push(
      `Output capacity exceeded: standby ${round3(totalStandbyAmps)} A / alarm ${round3(totalAlarmAmps)} A against a ` +
        `${ceiling} A ceiling (${total.evidence.document} ${total.evidence.revision}). Auxiliary power is required; ` +
        "this calculator does not select it.",
    );
  }

  return {
    calculator: "PowerCapacityCalculator",
    version: ELECTRICAL_CALCULATOR_VERSION,
    manufacturer,
    model,
    state: withinCapacity ? "CALCULATED_PASS" : "CALCULATED_FAIL",
    result: withinCapacity ? "PASS" : "FAIL",
    blocking: !withinCapacity,
    totalStandbyAmps: round3(totalStandbyAmps),
    totalAlarmAmps: round3(totalAlarmAmps),
    standbyCapacityStatus,
    alarmCapacityStatus,
    withinCapacity,
    capacityLimitAmps: ceiling,
    capacityLimitBasis:
      "The datasheet states a COMBINED ceiling across all outputs, not a separate standby and alarm figure, so BOTH " +
      "conditions are compared against the same published total. No standby/alarm split is invented.",
    blockers,
    warnings,
    evidenceUsed,
    capabilityResolution: total,
    trace: [
      `Standby = SUM(quantity x standbyAmps) = ${round3(totalStandbyAmps)} A.`,
      `Alarm   = SUM(quantity x alarmAmps)   = ${round3(totalAlarmAmps)} A.`,
      `Ceiling for ${manufacturer} ${model} = ${ceiling} A (${total.evidence.document} ${total.evidence.revision}).`,
      `Standby ${standbyCapacityStatus}; alarm ${alarmCapacityStatus} -> ${withinCapacity ? "PASS" : "FAIL"}.`,
    ],
  };
};

// ---------------------------------------------------------------------------
// 2. BATTERY SIZING CALCULATOR
// ---------------------------------------------------------------------------

export const BATTERY_SIZING_RULE = Object.freeze({
  ruleId: "battery.required-ah",
  ruleVersion: "battery.required-ah-1.0.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "Battery Required Ampere-Hours",
  formula:
    "standbyAh = totalStandbyAmps * standbyHours; alarmAh = totalAlarmAmps * (alarmMinutes / 60); " +
    "totalAhBeforeDerating = standbyAh + alarmAh; requiredAh = totalAhBeforeDerating * deratingFactor. " +
    "The two terms are summed because the battery carries standby THEN alarm sequentially " +
    "(manufacturer worksheet line J: 'Add lines G and I').",
  inputSchema: Object.freeze([
    { name: "totalStandbyAmps", unit: "A", required: true },
    { name: "totalAlarmAmps", unit: "A", required: true },
    { name: "standbyHours", unit: "h", required: true },
    { name: "alarmMinutes", unit: "min", required: true },
    { name: "deratingFactor", unit: "ratio", required: true },
    { name: "capabilityManufacturer", unit: "text", required: true },
    { name: "capabilityModel", unit: "text", required: true },
  ]),
});

/**
 * Size one independently powered enclosure's battery.
 *
 * The derating factor is NEVER accepted as a bare number. It must come from
 * `resolveCapability(... "battery.deratingFactor")`, which is what stops a 1.2
 * factor belonging to a different Honeywell family from being applied here.
 */
export const calculateBatterySizing = ({
  manufacturer,
  model,
  totalStandbyAmps,
  totalAlarmAmps,
  standbyHours,
  alarmMinutes,
  capabilityRecords = AL_MOUSA_ELECTRICAL_CAPABILITY,
} = {}) => {
  const blockers = [];
  const warnings = [];
  const evidenceUsed = [];

  if (!manufacturer || !model) blockers.push("A selected panel / PSU identity (manufacturer + model) is required.");
  if (!isFiniteNonNegative(totalStandbyAmps) || totalStandbyAmps === null || totalStandbyAmps === undefined) {
    blockers.push("totalStandbyAmps must be a finite non-negative number produced by an evidenced load aggregate.");
  }
  if (!isFiniteNonNegative(totalAlarmAmps) || totalAlarmAmps === null || totalAlarmAmps === undefined) {
    blockers.push("totalAlarmAmps must be a finite non-negative number produced by an evidenced load aggregate.");
  }
  if (!isPositive(standbyHours)) blockers.push("standbyHours is required and must be a positive governed duration.");
  if (!isPositive(alarmMinutes)) blockers.push("alarmMinutes is required and must be a positive governed duration.");

  const derating = resolveCapability(capabilityRecords, { manufacturer, model, field: "battery.deratingFactor" });
  if (!capabilityUsable(derating)) blockers.push(`Derating factor: ${derating.reason}`);

  const chargerMin = resolveCapability(capabilityRecords, { manufacturer, model, field: "battery.charger.minAh" });
  const chargerMax = resolveCapability(capabilityRecords, { manufacturer, model, field: "battery.charger.maxAh" });
  if (!capabilityUsable(chargerMax)) blockers.push(`Charger ceiling: ${chargerMax.reason}`);

  const options = resolveCapability(capabilityRecords, { manufacturer, model, field: "battery.optionsAh" });
  const enclosure = resolveCapability(capabilityRecords, { manufacturer, model, field: "battery.enclosure.mainCabinetMaxAh" });

  if (blockers.length) {
    return {
      calculator: "BatterySizingCalculator",
      version: ELECTRICAL_CALCULATOR_VERSION,
      manufacturer: manufacturer ?? null,
      model: model ?? null,
      state: "BLOCKED_BY_MISSING_INPUTS",
      result: "UNKNOWN",
      blocking: true,
      standbyAh: null,
      alarmAh: null,
      totalAhBeforeDerating: null,
      requiredAh: null,
      recommendedBatteryAh: null,
      withinChargerRange: null,
      separateCabinetRequired: null,
      blockers,
      warnings,
      evidenceUsed,
      trace: [`Battery sizing NOT performed: ${blockers.join(" | ")}`],
    };
  }

  [derating, chargerMin, chargerMax, options, enclosure].forEach((resolved) => {
    if (capabilityUsable(resolved)) evidenceUsed.push(resolved.evidence);
  });

  const factor = Number(derating.value);
  const alarmHours = Number(alarmMinutes) / 60;
  const standbyAh = Number(totalStandbyAmps) * Number(standbyHours);
  const alarmAh = Number(totalAlarmAmps) * alarmHours;
  const totalAhBeforeDerating = standbyAh + alarmAh;
  const requiredAh = totalAhBeforeDerating * factor;

  // Recommended size = next governed size at or above the requirement.
  const governedSizes = (Array.isArray(options.value) ? options.value : []).map(Number).filter(isPositive).sort((a, b) => a - b);
  const recommended = governedSizes.find((size) => size >= requiredAh) ?? null;

  const ceiling = Number(chargerMax.value);
  const floor = capabilityUsable(chargerMin) ? Number(chargerMin.value) : null;

  // The charger range bounds the BATTERY that may be fitted, NOT the calculated
  // requirement. A design needing 15.156 Ah is perfectly serviceable: the 17 Ah
  // battery it selects is inside a 17-55 Ah charger. Comparing the requirement
  // against the charger MINIMUM would wrongly block every small design, so the
  // floor is checked against the SELECTED size and the ceiling against both.
  const exceedsCeiling = requiredAh > ceiling;
  const selectedOutOfRange = recommended !== null && floor !== null && recommended < floor;
  const withinChargerRange = !exceedsCeiling && !selectedOutOfRange;

  if (exceedsCeiling) {
    blockers.push(
      `Required ${round3(requiredAh)} Ah exceeds the charger ceiling of ${ceiling} Ah ` +
        `(${chargerMax.evidence.document} ${chargerMax.evidence.revision}). ` +
        "The design needs additional independently powered enclosures; this calculator will not invent a larger charger.",
    );
  }
  if (selectedOutOfRange) {
    blockers.push(
      `The smallest governed battery reaching the requirement (${recommended} Ah) is below the charger minimum of ` +
        `${floor} Ah, so no fitted battery is valid.`,
    );
  }
  if (recommended === null && governedSizes.length) {
    warnings.push(
      `No governed battery size reaches ${round3(requiredAh)} Ah; the largest documented size is ${governedSizes.at(-1)} Ah.`,
    );
  }
  if (recommended !== null && recommended < requiredAh) warnings.push("Recommended size is below the requirement and must not be used.");

  const separateCabinetRequired =
    capabilityUsable(enclosure) && recommended !== null ? recommended > Number(enclosure.value) : null;
  if (separateCabinetRequired === true) {
    warnings.push(
      `A ${recommended} Ah bank exceeds the ${enclosure.value} Ah in-cabinet limit (${enclosure.evidence.document} ` +
        `${enclosure.evidence.revision}); a remote/accessory battery enclosure is required.`,
    );
  }

  const blocking = !withinChargerRange;
  return {
    calculator: "BatterySizingCalculator",
    version: ELECTRICAL_CALCULATOR_VERSION,
    manufacturer,
    model,
    state: blocking ? "CALCULATED_FAIL" : "CALCULATED_PASS",
    result: blocking ? "FAIL" : "PASS",
    blocking,
    standbyAh: round3(standbyAh),
    alarmAh: round3(alarmAh),
    totalAhBeforeDerating: round3(totalAhBeforeDerating),
    requiredAh: round3(requiredAh),
    recommendedBatteryAh: recommended,
    withinChargerRange,
    separateCabinetRequired,
    chargerRangeAh: { min: floor, max: ceiling },
    mainCabinetMaxAh: capabilityUsable(enclosure) ? Number(enclosure.value) : null,
    deratingFactor: factor,
    deratingBasis: `${derating.evidence.document} ${derating.evidence.revision}`,
    alarmHours,
    formula:
      `standbyAh = ${round3(totalStandbyAmps)} A x ${standbyHours} h = ${round3(standbyAh)} Ah; ` +
      `alarmAh = ${round3(totalAlarmAmps)} A x (${alarmMinutes}/60) h = ${round3(alarmAh)} Ah; ` +
      `sum = ${round3(totalAhBeforeDerating)} Ah; requiredAh = ${round3(totalAhBeforeDerating)} x ${factor} = ${round3(requiredAh)} Ah`,
    blockers,
    warnings,
    evidenceUsed,
    trace: [
      `Standby term = ${round3(standbyAh)} Ah; alarm term = ${round3(alarmAh)} Ah.`,
      `SUM (worksheet line J "Add lines G and I") = ${round3(totalAhBeforeDerating)} Ah.`,
      `Derating ${factor} applied ONCE -> requiredAh = ${round3(requiredAh)} Ah.`,
      `Charger range ${floor === null ? "?" : floor}-${ceiling} Ah -> ${withinChargerRange ? "within" : "EXCEEDED"}.`,
      `Recommended governed size = ${recommended === null ? "NONE" : `${recommended} Ah`}.`,
      `Separate battery enclosure required = ${separateCabinetRequired === null ? "UNKNOWN" : separateCabinetRequired}.`,
    ],
  };
};

// ---------------------------------------------------------------------------
// SINGLE SHARED BATTERY-DEMAND ARITHMETIC.
//
// THIS IS THE ONLY PLACE requiredAh IS COMPUTED IN THIS REPOSITORY.
//
// The canonical governed rule `battery.standby-alarm`
// (app/domain/calculation-requirement-engine.mjs) delegates here, and
// `calculateBatterySizing` delegates here, so the two can never drift again.
// The old defect was exactly that drift: the engine used
// MAX(standbyAh, alarmAh) while the project module used the sum, and the engine
// silently understated the battery by 0.156 Ah on a governed example.
//
// Authority for the SUM: Honeywell IFP-2100 installation manual
// LS10143-001SK-E Rev E, Sec 3.5.2, Table 3.2 (Continued), line J --
// "Add lines G and I". The battery serves standby and THEN alarm sequentially,
// so the demands are cumulative. Derating is applied EXACTLY ONCE, to the sum.
// ---------------------------------------------------------------------------
export const computeBatteryDemand = ({ standbyAmps, alarmAmps, standbyHours, alarmMinutes, deratingFactor }) => {
  const alarmHours = Number(alarmMinutes) / 60;
  const standbyAh = Number(standbyAmps) * Number(standbyHours);
  const alarmAh = Number(alarmAmps) * alarmHours;
  const totalAhBeforeDerating = standbyAh + alarmAh;
  return {
    standbyAmps: Number(standbyAmps),
    alarmAmps: Number(alarmAmps),
    standbyHours: Number(standbyHours),
    alarmMinutes: Number(alarmMinutes),
    alarmHours,
    standbyAh,
    alarmAh,
    totalAhBeforeDerating,
    deratingFactor: Number(deratingFactor),
    requiredAh: totalAhBeforeDerating * Number(deratingFactor),
  };
};

/**
 * Fingerprint of the governed inputs + evidence identity a calculation ran on.
 * Evidence IDENTITY (document + revision + field) is hashed, not the prose, so a
 * new document revision invalidates the fingerprint even at an unchanged value.
 */
export const electricalCalculationFingerprint = ({ calculationType, manufacturer, model, inputs = [], evidenceUsed = [] }) =>
  createHash("sha256")
    .update(
      stableStringify({
        engine: ELECTRICAL_CALCULATOR_VERSION,
        calculationType,
        manufacturer,
        model,
        inputs: inputs.map((entry) => ({ name: entry.name, value: entry.value, unit: entry.unit ?? null })),
        evidence: evidenceUsed.map((entry) => ({ document: entry.document, revision: entry.revision, field: entry.field })),
      }),
    )
    .digest("hex");

// ---------------------------------------------------------------------------
// 3. NAC CIRCUIT CALCULATOR
//
// Circuit COUNT is not circuit CAPACITY, and neither is PANEL capacity. On this
// panel the datasheet states "Maximum current per circuit: 3 A. Cannot exceed 9A
// total for all circuits" -- two independent ceilings. This calculator answers
// ONLY the per-circuit question. Panel total capacity is NEVER substituted for it.
// ---------------------------------------------------------------------------

export const NAC_CIRCUIT_RULE = Object.freeze({
  ruleId: "power.nac-load",
  ruleVersion: "power.nac-load-1.1.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "NAC Circuit Loading",
  formula:
    "circuitStandbyAmps = SUM(load.quantity * load.standbyAmps); " +
    "circuitAlarmAmps = SUM(load.quantity * load.alarmAmps); " +
    "governingCircuitAmps = MAX(circuitStandbyAmps, circuitAlarmAmps); " +
    "withinCircuitCapacity = governingCircuitAmps <= perCircuitLimitAmps. " +
    "The governing term is the larger of the two cumulative conditions because the " +
    "conductor must carry whichever condition is worse, not only the alarm condition. " +
    "The per-circuit limit is resolved from model-bound capability evidence and is " +
    "never substituted by the panel total ceiling.",
});

/** A NAC load row may state both conditions, or a single `current` (alarm, legacy shape). */
const nacLoadDefect = (load, index, requireCurrentEvidence = true) => {
  const at = `loads[${index}]`;
  if (load == null || typeof load !== "object") return `${at} is not a load record.`;
  const quantity = load.quantity ?? 1;
  if (!isFiniteNonNegative(quantity)) return `${at}.quantity must be a finite non-negative number (got ${load.quantity}).`;
  const hasSplit = load.standbyAmps !== undefined || load.alarmAmps !== undefined;
  if (!hasSplit) {
    if (load.current === undefined || load.current === null || load.current === "") {
      return `${at} carries no current evidence (neither standbyAmps/alarmAmps nor current); UNKNOWN, not zero.`;
    }
    if (!isFiniteNonNegative(load.current)) return `${at}.current must be a finite non-negative number (got ${load.current}).`;
    return null;
  }
  if (!requireCurrentEvidence) return null;
  for (const field of ["standbyAmps", "alarmAmps"]) {
    const value = load[field];
    if (value === undefined || value === null || value === "") {
      return `${at}.${field} has no selected-product current evidence; UNKNOWN, not zero.`;
    }
    if (!isFiniteNonNegative(value)) return `${at}.${field} must be a finite non-negative number (got ${value}).`;
    // A number with no document behind it is not engineering data. This mirrors the
    // power.capacity rule exactly, so the two calculators cannot drift apart here.
    if (!load.currentEvidence?.[field]) {
      return `${at}.${field} carries no current evidence reference; a bare number may not be used.`;
    }
  }
  return null;
};

const perCircuitOverridePrecheck = (amps, evidence) => isFiniteNonNegative(amps) && Boolean(evidence);

export const calculateNacCircuitCapacity = ({
  manufacturer,
  model,
  circuitId,
  circuitClass = null,
  loads = [],
  capabilityRecords = AL_MOUSA_ELECTRICAL_CAPABILITY,
  // Evidence-bound override of the per-circuit ceiling. When the caller already
  // holds a governed ampacity FACT (the canonical engine resolves nacAmpacity from a
  // product attribute with its own provenance), that fact is the authority and the
  // registry lookup is skipped. It is still never a bare number: without evidence
  // the override is refused and the registry is consulted.
  capacityLimitAmps = null,
  capacityLimitEvidence = null,
  // The canonical engine's pre-existing input shape carries no circuit identity and
  // no per-device evidence reference. Those two strictnesses are relaxed ONLY for
  // that shape, and every relaxation is emitted as a labelled warning.
  requireCircuitIdentity = true,
  requireCurrentEvidence = true,
} = {}) => {
  const blockers = [];
  const warnings = [];

  // Panel identity is required whenever the ceiling must be resolved from the
  // model-bound registry. When the caller already holds an evidence-bound ampacity
  // FACT, that fact is the authority and the identity is not needed to use it.
  if ((!manufacturer || !model) && !perCircuitOverridePrecheck(capacityLimitAmps, capacityLimitEvidence)) {
    blockers.push("A selected panel identity (manufacturer + model) is required.");
  }
  if (requireCircuitIdentity && (circuitId === undefined || circuitId === null || String(circuitId).trim() === "")) {
    blockers.push("Circuit allocation is unknown: no circuitId, so no load can be attributed to a governed circuit.");
  } else if (circuitId === undefined || circuitId === null || String(circuitId).trim() === "") {
    warnings.push(
      "No circuitId was supplied. Circuit identity is implicit in this invocation, so the result is not " +
        "attributable to a specific governed circuit.",
    );
  }
  // The per-circuit ceiling is its OWN capability field. power.output.totalAmps is
  // deliberately NOT consulted here: a panel total is not a per-circuit allowance.
  const perCircuitOverride = isFiniteNonNegative(capacityLimitAmps) && capacityLimitEvidence
    ? { state: "PROVEN", manufacturer, model, field: "power.output.perCircuitAmps", value: Number(capacityLimitAmps), unit: "A", evidence: capacityLimitEvidence }
    : null;
  const perCircuit = perCircuitOverride ?? resolveCapability(capabilityRecords, { manufacturer, model, field: "power.output.perCircuitAmps" });
  if (!capabilityUsable(perCircuit)) blockers.push(`Per-circuit capability: ${perCircuit.reason}`);
  if (!loads.length) blockers.push("No electrical load records were supplied for this circuit.");
  if (!requireCurrentEvidence) {
    warnings.push("Per-device current evidence references were not required for this input shape; device currents are treated as governed attribute values.");
  }
  blockers.push(...loads.map((load, index) => nacLoadDefect(load, index, requireCurrentEvidence)).filter(Boolean));

  const evidenceUsed = capabilityUsable(perCircuit) ? [perCircuit.evidence] : [];
  const shape = (state, extra = {}) => ({
    calculator: "NacCircuitCalculator",
    version: ELECTRICAL_CALCULATOR_VERSION,
    manufacturer: manufacturer ?? null,
    model: model ?? null,
    circuitId: circuitId ?? null,
    circuitClass: circuitClass ?? null,
    state,
    result: state === "CALCULATED_PASS" ? "PASS" : state === "CALCULATED_FAIL" ? "FAIL" : "UNKNOWN",
    blocking: state !== "CALCULATED_PASS",
    circuitStandbyAmps: null,
    circuitAlarmAmps: null,
    governingCircuitAmps: null,
    capacityLimitAmps: null,
    withinCircuitCapacity: null,
    blockers,
    warnings,
    evidenceUsed,
    trace: [`NAC circuit capacity NOT evaluated: ${blockers.join(" | ")}`],
    ...extra,
  });

  if (blockers.length) return shape("BLOCKED_BY_MISSING_INPUTS");

  const limit = Number(perCircuit.value);
  // A legacy-shaped load states one current; it is the ALARM condition and the
  // standby condition is then unknown-but-bounded by it. Labelled, never invented.
  let legacyShape = false;
  const standby = loads.reduce((sum, l) => sum + (l.standbyAmps === undefined ? ((legacyShape = true), 0) : Number(l.quantity ?? 1) * Number(l.standbyAmps)), 0);
  const alarm = loads.reduce(
    (sum, l) => sum + Number(l.quantity ?? 1) * Number(l.alarmAmps === undefined ? l.current : l.alarmAmps),
    0,
  );
  if (legacyShape) {
    warnings.push(
      "Some loads state a single `current` only. That is treated as the ALARM condition; the standby " +
        "contribution is therefore omitted from the governing term and the figure is a lower bound.",
    );
  }

  const governing = Math.max(standby, alarm);
  const within = governing <= limit;
  if (!within) {
    // A governed DEFICIT is returned. Derived hardware is NEVER added here.
    blockers.push(
      `Circuit ${circuitId} governing load ${round3(governing)} A exceeds the per-circuit ceiling ${limit} A ` +
        `(${perCircuit.evidence.document} ${perCircuit.evidence.revision}). Deficit ${round3(governing - limit)} A. ` +
        "No auxiliary supply, extender or transformer is selected by this calculator.",
    );
  }

  return shape(within ? "CALCULATED_PASS" : "CALCULATED_FAIL", {
    circuitStandbyAmps: round3(standby),
    circuitAlarmAmps: round3(alarm),
    governingCircuitAmps: round3(governing),
    capacityLimitAmps: limit,
    withinCircuitCapacity: within,
    capacityDeficitAmps: within ? 0 : round3(governing - limit),
    governingCondition: standby >= alarm ? "standby" : "alarm",
    capacityBasis: "Per-circuit ceiling only. The panel total ceiling is a separate constraint enforced by power.capacity.",
    trace: [
      `Circuit ${circuitId}${circuitClass ? ` (Class ${circuitClass})` : ""} on ${manufacturer} ${model}.`,
      `Standby = SUM(quantity x standbyAmps) = ${round3(standby)} A.`,
      `Alarm   = SUM(quantity x alarmAmps)   = ${round3(alarm)} A.`,
      `Governing = MAX(standby, alarm) = ${round3(governing)} A (${standby >= alarm ? "standby" : "alarm"}).`,
      `Per-circuit ceiling = ${limit} A (${perCircuit.evidence.document} ${perCircuit.evidence.revision}).`,
      `-> ${within ? "within" : "EXCEEDED"} per-circuit capacity.`,
    ],
  });
};

// ---------------------------------------------------------------------------
// 4. VOLTAGE DROP CORE
//
// R_loop = 2 x oneWayLength x conductorResistance   (the 2 is the out-and-back path)
// Vdrop  = circuitCurrent x R_loop
//
// The ARITHMETIC is always computed when its inputs are present. The VERDICT
// requires a manufacturer-authorised maximum drop for the EXACT model, resolved
// from capability evidence. If that threshold is unresolved the verdict is
// UNKNOWN and the result blocks -- the arithmetic is never turned into a pass.
//
// The 2018 Silent Knight BatteryCalc figures (20.4 V start, 16 V EOL floor, 10 %
// warning) are DELIBERATELY NOT USED. No current FARENHYT evidence states them, and
// this panel's NACs are documented as REGULATED 24 VDC, so a nominal-start-voltage
// model would not describe them.
//
// Conductor resistance is supplied BY THE CALLER with its own evidence reference.
// It is never defaulted from a built-in table, so an unknown conductor fails closed
// instead of silently inheriting a value from another source.
// ---------------------------------------------------------------------------

export const VOLTAGE_DROP_RULE = Object.freeze({
  ruleId: "power.voltage-drop",
  ruleVersion: "power.voltage-drop-1.0.0",
  system: "Fire Alarm",
  dimension: "capacity",
  label: "NAC Circuit Voltage Drop",
  formula:
    "R_loop = 2 * oneWayLength * conductorResistance; Vdrop = circuitCurrent * R_loop; " +
    "withinVoltageDrop = Vdrop <= manufacturerMaxVoltageDrop. " +
    "Both the threshold and the conductor resistance are evidence-bound; neither is defaulted.",
});

export const calculateVoltageDrop = ({
  manufacturer,
  model,
  circuitId,
  circuitClass = null,
  circuitAmps,
  oneWayLength,
  lengthUnit = "m",
  conductorResistanceOhmsPerUnit = null,
  conductorType = null,
  conductorEvidence = null,
  capabilityRecords = AL_MOUSA_ELECTRICAL_CAPABILITY,
} = {}) => {
  const blockers = [];
  const warnings = [];
  const evidenceUsed = [];

  if (!manufacturer || !model) blockers.push("A selected panel identity (manufacturer + model) is required.");
  if (circuitId === undefined || circuitId === null || String(circuitId).trim() === "") blockers.push("Circuit allocation is unknown: no circuitId.");
  if (!isFiniteNonNegative(circuitAmps) || circuitAmps === null || circuitAmps === undefined) {
    blockers.push("circuitAmps must be a finite non-negative governed current.");
  }
  if (!isFiniteNonNegative(oneWayLength) || oneWayLength === null || oneWayLength === undefined) {
    blockers.push("oneWayLength is required and must be a finite non-negative length; a route is not inferred.");
  }
  if (!isPositive(conductorResistanceOhmsPerUnit)) {
    blockers.push("conductorResistanceOhmsPerUnit is unknown; an unknown conductor fails closed rather than inheriting a table default.");
  } else if (!conductorEvidence) {
    blockers.push("conductorResistanceOhmsPerUnit carries no evidence reference; a bare conductor figure may not be used.");
  }

  const maxDrop = resolveCapability(capabilityRecords, { manufacturer, model, field: "nac.maxVoltageDropVolts" });
  const impedanceTable = resolveCapability(capabilityRecords, { manufacturer, model, field: "nac.maxImpedanceOhmsByAmps" });

  const base = {
    calculator: "VoltageDropCalculator",
    version: ELECTRICAL_CALCULATOR_VERSION,
    manufacturer: manufacturer ?? null,
    model: model ?? null,
    circuitId: circuitId ?? null,
    circuitClass: circuitClass ?? null,
    conductorType,
    lengthUnit,
    circuitAmps: isFiniteNonNegative(circuitAmps) ? Number(circuitAmps) : null,
    loopResistanceOhms: null,
    voltageDrop: null,
    maxVoltageDropVolts: null,
    withinVoltageDrop: null,
    maxImpedanceOhms: null,
    withinImpedanceEnvelope: null,
    blockers,
    warnings,
    evidenceUsed,
  };

  // Without the arithmetic inputs there is nothing to report at all.
  if (blockers.length) {
    return { ...base, state: "BLOCKED_BY_MISSING_INPUTS", result: "UNKNOWN", blocking: true, trace: [`Voltage drop NOT evaluated: ${blockers.join(" | ")}`] };
  }

  const loopResistance = 2 * Number(oneWayLength) * Number(conductorResistanceOhmsPerUnit);
  const voltageDrop = Number(circuitAmps) * loopResistance;
  if (conductorEvidence) evidenceUsed.push(conductorEvidence);
  if (capabilityUsable(maxDrop)) evidenceUsed.push(maxDrop.evidence);

  const computed = {
    ...base,
    loopResistanceOhms: round3(loopResistance),
    voltageDrop: round3(voltageDrop),
    formula: `R_loop = 2 x ${oneWayLength} ${lengthUnit} x ${conductorResistanceOhmsPerUnit} ohm/${lengthUnit} = ${round3(loopResistance)} ohm; Vdrop = ${circuitAmps} A x ${round3(loopResistance)} ohm = ${round3(voltageDrop)} V`,
    trace: [
      `Circuit ${circuitId}${circuitClass ? ` (Class ${circuitClass})` : ""}: ${circuitAmps} A over ${oneWayLength} ${lengthUnit} one way.`,
      `R_loop = 2 x ${oneWayLength} x ${conductorResistanceOhmsPerUnit} = ${round3(loopResistance)} ohm.`,
      `Vdrop = ${circuitAmps} A x ${round3(loopResistance)} ohm = ${round3(voltageDrop)} V.`,
    ],
  };

  // The manufacturer impedance envelope, when the table is applicable.
  let envelope = null;
  if (capabilityResolved(impedanceTable) && Array.isArray(impedanceTable.value)) {
    evidenceUsed.push(impedanceTable.evidence);
    const rows = [...impedanceTable.value].sort((a, b) => a.amps - b.amps);
    // The table is a per-current envelope; a circuit above the highest tabulated
    // current has NO published limit and must not be extrapolated.
    envelope = rows.find((row) => Number(circuitAmps) <= row.amps) ?? null;
    if (!envelope) {
      warnings.push(
        `Circuit current ${circuitAmps} A is above the highest tabulated impedance point (${rows.at(-1).amps} A); ` +
          "no published impedance limit exists and none is extrapolated.",
      );
    }
  }

  // The VERDICT needs a proven threshold. Without one the arithmetic stands but the
  // result blocks -- exactly the "fail closed, never infer" rule.
  if (!capabilityUsable(maxDrop)) {
    return {
      ...computed,
      state: "BLOCKED_BY_MISSING_INPUTS",
      result: "UNKNOWN",
      blocking: true,
      maxVoltageDropVolts: null,
      withinVoltageDrop: null,
      thresholdBlocker: maxDrop.reason,
      maxImpedanceOhms: envelope?.maxImpedanceOhms ?? null,
      withinImpedanceEnvelope: envelope ? loopResistance <= envelope.maxImpedanceOhms : null,
      trace: [...computed.trace, `No manufacturer maximum voltage drop is resolved for ${manufacturer} ${model}: ${maxDrop.reason}`],
    };
  }

  const threshold = Number(maxDrop.value);
  const within = voltageDrop <= threshold;
  return {
    ...computed,
    state: within ? "CALCULATED_PASS" : "CALCULATED_FAIL",
    result: within ? "PASS" : "FAIL",
    blocking: !within,
    maxVoltageDropVolts: threshold,
    withinVoltageDrop: within,
    maxImpedanceOhms: envelope?.maxImpedanceOhms ?? null,
    withinImpedanceEnvelope: envelope ? loopResistance <= envelope.maxImpedanceOhms : null,
    thresholdBasis: `${maxDrop.evidence.document} ${maxDrop.evidence.revision}`,
    trace: [
      ...computed.trace,
      `Manufacturer maximum voltage drop = ${threshold} V (${maxDrop.evidence.document} ${maxDrop.evidence.revision}).`,
      envelope ? `Impedance envelope at ${circuitAmps} A: max ${envelope.maxImpedanceOhms} ohm; actual ${round3(loopResistance)} ohm -> ${loopResistance <= envelope.maxImpedanceOhms ? "within" : "EXCEEDED"}.` : null,
      `-> voltage drop ${within ? "within" : "EXCEEDS"} the manufacturer limit.`,
    ].filter(Boolean),
  };
};
