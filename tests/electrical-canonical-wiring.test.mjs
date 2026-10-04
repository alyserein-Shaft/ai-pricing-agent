// CANONICAL WIRING of the governed electrical core into the shared engine.
//
// Proves exactly one authority exists for each concept:
//   battery.standby-alarm  -> delegates to computeBatteryDemand (shared core)
//   power.capacity          -> delegates to calculatePowerCapacity  (shared core)
// and that capability resolution, fail-closed behaviour, cross-family rejection
// and currentness all survive the wiring.
//
// Pure domain. No DB, no project mutation, no network.
import test from "node:test";
import assert from "node:assert/strict";

import {
  CALCULATION_LABELS,
  CALCULATION_RULES,
  CALCULATION_TYPES,
  calculationApplicabilityFor,
  evaluateCalculationRequirement,
} from "../app/domain/calculation-requirement-engine.mjs";
import {
  calculateBatterySizing,
  calculatePowerCapacity,
  computeBatteryDemand,
  electricalCalculationFingerprint,
} from "../app/domain/electrical-core-calculators.mjs";

const FARENHYT = { manufacturer: "FARENHYT", model: "IFP-2100HV" };
const EV = { documentId: "Honeywell Doc 351602 Rev C", sourceType: "MANUFACTURER_EVIDENCE" };
const load = (deviceRef, quantity, standbyAmps, alarmAmps) => ({
  deviceRef,
  quantity,
  standbyAmps,
  alarmAmps,
  currentEvidence: { standbyAmps: EV, alarmAmps: EV },
});

// The already-established representative Al Mousa load shape.
const AL_MOUSA_LOADS = [
  load("IFP-2100HV", 1, 0.23, 0.415),
  load("IDP-PHOTO-IV", 1401, 0.0002, 0.0045),
  load("IDP-MONITOR", 97, 0.000375, 0.000375),
];
const AL_MOUSA = { standbyAmps: 0.547, alarmAmps: 6.756, standbyHours: 24, alarmMinutes: 30, deratingFactor: 1.25 };

const canonicalBattery = (over = {}) =>
  evaluateCalculationRequirement({
    calculationType: "battery.standby-alarm",
    system: "Fire Alarm",
    family: "Fire Alarm Power Supply",
    inputs: [
      { name: "standbyCurrent", value: AL_MOUSA.standbyAmps },
      { name: "alarmCurrent", value: AL_MOUSA.alarmAmps },
      { name: "standbyHours", value: AL_MOUSA.standbyHours },
      { name: "alarmMinutes", value: AL_MOUSA.alarmMinutes },
      { name: "deratingFactor", value: AL_MOUSA.deratingFactor },
    ],
    performedAt: "2026-10-04T00:00:00.000Z",
    ...over,
  });

const canonicalPower = (inputs) =>
  evaluateCalculationRequirement({
    calculationType: "power.capacity",
    system: "Fire Alarm",
    family: "Fire Alarm Power Supply",
    inputs,
    performedAt: "2026-10-04T00:00:00.000Z",
  });

const farenhytInputs = (loads = AL_MOUSA_LOADS, over = []) => [
  { name: "capabilityManufacturer", value: "FARENHYT" },
  { name: "capabilityModel", value: "IFP-2100HV" },
  { name: "loads", value: loads },
  ...over,
];

// ===========================================================================
// REGISTRATION
// ===========================================================================

test("W1. power.capacity is a governed, labelled, registered rule", () => {
  assert.ok(CALCULATION_TYPES.includes("power.capacity"), "must be in the governed vocabulary");
  assert.ok(CALCULATION_LABELS["power.capacity"], "every governed type needs a label");
  assert.ok(CALCULATION_RULES["power.capacity"], "must be registered in CALCULATION_RULES");
  assert.equal(CALCULATION_RULES["power.capacity"].dimension, "capacity");
  assert.equal(CALCULATION_RULES["power.capacity"].system, "Fire Alarm");
  assert.ok(CALCULATION_RULES["power.capacity"].ruleVersion);
  assert.notEqual(CALCULATION_RULES["power.capacity"], undefined, "must be resolvable through the canonical registry");
});

test("W2. NO duplicate battery authority exists", () => {
  const batteryTypes = CALCULATION_TYPES.filter((type) => type.startsWith("battery."));
  assert.deepEqual(batteryTypes, ["battery.standby-alarm"], "exactly one canonical battery rule");
  // The standalone calculator's rule id must NOT have been registered as a rival.
  assert.equal(CALCULATION_RULES["battery.required-ah"], undefined);
  assert.equal(CALCULATION_RULES["battery.standby-alarm"].ruleVersion, "battery.standby-alarm-1.1.0", "version not bumped again");
});

// ===========================================================================
// FARENHYT CAPABILITY RESOLUTION + RUNTIME
// ===========================================================================

test("W3. canonical power.capacity resolves current FARENHYT evidence and passes", () => {
  const r = canonicalPower(farenhytInputs());
  assert.equal(r.state, "CALCULATED_PASS");
  assert.equal(r.result, "PASS");
  assert.equal(r.blocking, false);
  assert.equal(r.output.totalStandbyAmps, 0.547);
  assert.equal(r.output.totalAlarmAmps, 6.756);
  assert.equal(r.output.capacityLimitAmps, 9, "IFP-2100HV published combined ceiling");
  assert.equal(r.output.standbyCapacityStatus, "WITHIN_CAPACITY");
  assert.equal(r.output.alarmCapacityStatus, "WITHIN_CAPACITY");
  assert.equal(r.output.withinCapacity, true);
  assert.ok(r.evidence, "a completed calculation must produce DERIVED evidence");
  assert.equal(r.evidence.ruleId, "power.capacity");
});

test("W4. canonical battery.standby-alarm reproduces the expected Al Mousa arithmetic", () => {
  const r = canonicalBattery();
  assert.equal(r.state, "CALCULATED_PASS");
  // Exact maths: 0.547*24 = 13.128 ; 6.756*(30/60) = 3.378 ; sum 16.506 ; *1.25 = 20.6325
  // The engine publishes at 2dp, so the canonical figures are the 2dp renderings.
  assert.equal(r.output.standbyAh, 13.13);
  assert.equal(r.output.alarmAh, 3.38);
  assert.equal(r.output.totalAhBeforeDerating, 16.51);
  assert.equal(r.output.requiredAh, 20.63);
  const exact = computeBatteryDemand(AL_MOUSA);
  assert.equal(exact.requiredAh, 20.6325, "shared arithmetic is exact");
  assert.equal(r.output.requiredAh, Math.round(exact.requiredAh * 100) / 100);
});

test("W5. canonical battery delegates to the SAME arithmetic the calculator uses (parity exact)", () => {
  const canonical = canonicalBattery().output;
  const standalone = calculateBatterySizing({
    ...FARENHYT,
    totalStandbyAmps: AL_MOUSA.standbyAmps,
    totalAlarmAmps: AL_MOUSA.alarmAmps,
    standbyHours: AL_MOUSA.standbyHours,
    alarmMinutes: AL_MOUSA.alarmMinutes,
  });
  const r2 = (v) => Math.round(Number(v) * 100) / 100;
  assert.equal(r2(canonical.requiredAh), r2(standalone.requiredAh));
  assert.equal(r2(canonical.standbyAh), r2(standalone.standbyAh));
  assert.equal(r2(canonical.alarmAh), r2(standalone.alarmAh));
  assert.equal(r2(canonical.totalAhBeforeDerating), r2(standalone.totalAhBeforeDerating));
});

test("W6. power.capacity maps onto the EXISTING fail-closed state vocabulary", () => {
  const noIdentity = canonicalPower([{ name: "loads", value: AL_MOUSA_LOADS }]);
  assert.equal(noIdentity.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.equal(noIdentity.result, "UNKNOWN");
  assert.equal(noIdentity.blocking, true);
  assert.equal(noIdentity.evidence, null, "no evidence may be produced from a refused calculation");
  assert.ok(noIdentity.missingInputs.includes("capabilityManufacturer"));
  assert.ok(noIdentity.missingInputs.includes("capabilityModel"));
});

// ===========================================================================
// FAIL CLOSED
// ===========================================================================

test("W7. missing capability evidence fails closed through the canonical rule", () => {
  const r = canonicalPower(farenhytInputs(AL_MOUSA_LOADS, []).map((entry) => (entry.name === "capabilityModel" ? { ...entry, value: "MADE-UP-9000" } : entry)));
  assert.equal(r.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.equal(r.result, "UNKNOWN");
  assert.ok(r.missingInputs.some((m) => /No capability evidence exists/.test(m)));
  assert.ok(r.missingInputs.some((m) => /never a passing result/.test(m)), "absence is UNKNOWN, not compliant");
});

test("W8. cross-family evidence is rejected through the canonical rule", () => {
  // A NOTIFIER / PMB-AUX request under the FARENHYT registry.
  const r = canonicalPower([
    { name: "capabilityManufacturer", value: "FARENHYT" },
    { name: "capabilityModel", value: "PMB-AUX" },
    { name: "loads", value: AL_MOUSA_LOADS },
  ]);
  assert.equal(r.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.ok(r.missingInputs.some((m) => /No capability evidence exists for power\.output\.totalAmps/.test(m)));
  // And the mirror case: NOTIFIER's own record is BLOCKING, so it cannot self-serve either.
  const n16 = canonicalPower([
    { name: "capabilityManufacturer", value: "NOTIFIER" },
    { name: "capabilityModel", value: "PMB-AUX" },
    { name: "loads", value: AL_MOUSA_LOADS },
  ]);
  assert.equal(n16.state, "REQUIRED_BUT_INPUTS_MISSING");
});

test("W9. a missing device current still fails closed via the canonical rule", () => {
  const broken = [{ ...AL_MOUSA_LOADS[0] }, { deviceRef: "X", quantity: 2, alarmAmps: 0.01, currentEvidence: { alarmAmps: EV } }];
  const r = canonicalPower(farenhytInputs(broken));
  assert.equal(r.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.ok(r.missingInputs.some((m) => /UNKNOWN, not zero/.test(m)));
});

test("W10. an exceeded ceiling is CALCULATED_FAIL and blocks, naming the condition", () => {
  const heavy = [load("NAC-BANK", 1, 1, 12)];
  const r = canonicalPower(farenhytInputs(heavy));
  assert.equal(r.state, "CALCULATED_FAIL");
  assert.equal(r.result, "FAIL");
  assert.equal(r.blocking, true);
  assert.equal(r.output.alarmCapacityStatus, "EXCEEDED");
  assert.equal(r.output.standbyCapacityStatus, "WITHIN_CAPACITY");
  assert.ok(r.evidence, "a FAIL is a completed calculation and still yields DERIVED evidence");
  assert.equal(r.headroom.alarmAmps, -3);
});

// ===========================================================================
// CURRENTNESS
// ===========================================================================

test("W11. the canonical result is stale when the governed inputs move", () => {
  const r = canonicalPower(farenhytInputs());
  const first = r.evidence.inputFingerprint;
  // Quantity change must move the fingerprint.
  const doubled = canonicalPower(farenhytInputs([load("IFP-2100HV", 2, 0.23, 0.415), ...AL_MOUSA_LOADS.slice(1)])).evidence.inputFingerprint;
  assert.notEqual(first, doubled, "quantity participates in currentness");
  // Duration change must move the battery fingerprint.
  const b1 = canonicalBattery().evidence.inputFingerprint;
  const b2 = canonicalBattery({
    inputs: [
      { name: "standbyCurrent", value: AL_MOUSA.standbyAmps },
      { name: "alarmCurrent", value: AL_MOUSA.alarmAmps },
      { name: "standbyHours", value: 48 },
      { name: "alarmMinutes", value: AL_MOUSA.alarmMinutes },
      { name: "deratingFactor", value: AL_MOUSA.deratingFactor },
    ],
  }).evidence.inputFingerprint;
  assert.notEqual(b1, b2, "standby duration participates in currentness");
});

test("W12. the canonical result is stale when the PANEL CAPABILITY EVIDENCE REVISION changes", () => {
  const revA = calculatePowerCapacity({ ...FARENHYT, loads: AL_MOUSA_LOADS });
  // A capability whose ONLY record is superseded must stop being usable: the panel's
  // published ceiling is no longer current, so capacity cannot be asserted.
  const superseded = calculatePowerCapacity({
    ...FARENHYT,
    loads: AL_MOUSA_LOADS,
    capabilityRecords: [{ ...revA.capabilityResolution.evidence, state: "SUPERSEDED" }],
  });
  assert.equal(superseded.state, "BLOCKED_BY_MISSING_INPUTS", "a fully superseded capability must stop being usable");
  assert.equal(superseded.capacityLimitAmps, null);
  assert.ok(/superseded/i.test(superseded.blockers[0]));

  // And the shared fingerprint reacts to revision identity even at an unchanged value.
  const base = electricalCalculationFingerprint({
    calculationType: "power.capacity",
    ...FARENHYT,
    inputs: [{ name: "totalAlarmAmps", value: 6.756 }],
    evidenceUsed: revA.evidenceUsed,
  });
  const revised = electricalCalculationFingerprint({
    calculationType: "power.capacity",
    ...FARENHYT,
    inputs: [{ name: "totalAlarmAmps", value: 6.756 }],
    evidenceUsed: revA.evidenceUsed.map((e) => ({ ...e, revision: "Doc 351602 Rev D (2026)" })),
  });
  assert.notEqual(base, revised, "a new document revision must invalidate currentness at an unchanged value");
});

test("W13. the canonical rules share the platform staleness mechanism, not a new one", async () => {
  const { isCalculationStale } = await import("../app/domain/calculation-requirement-engine.mjs");
  const r = canonicalPower(farenhytInputs());
  assert.equal(isCalculationStale({ calculation: r.evidence }).stale, false, "stamped + fingerprinted is current");
  assert.equal(r.evidence.currentness, "CURRENT");
  assert.ok(r.evidence.inputFingerprint, "fingerprint must be attached");
});

// ===========================================================================
// NO DUPLICATE AUTHORITY
// ===========================================================================

test("W14. canonical power.capacity and the standalone calculator are the same code path", () => {
  const viaEngine = canonicalPower(farenhytInputs());
  const standalone = calculatePowerCapacity({ ...FARENHYT, loads: AL_MOUSA_LOADS });
  assert.equal(viaEngine.output.totalStandbyAmps, standalone.totalStandbyAmps);
  assert.equal(viaEngine.output.totalAlarmAmps, standalone.totalAlarmAmps);
  assert.equal(viaEngine.output.capacityLimitAmps, standalone.capacityLimitAmps);
  assert.equal(viaEngine.result, standalone.result);
  // Identical capability resolution, so the ceiling cannot differ between paths.
});

test("W15. power.capacity is required of power-supply families and does not leak into other packs", () => {
  const applicable = (system, family) => calculationApplicabilityFor({ calculationType: "power.capacity", system, family }).applicable;
  assert.equal(applicable("Fire Alarm", "Fire Alarm Power Supply"), true);
  assert.equal(applicable("Fire Alarm", "NAC Power Supply"), true);
  assert.equal(applicable("Fire Alarm", "Fire Alarm Control Panel"), false, "widening the panel requirement is a separate governed decision");
  assert.equal(applicable("CCTV", "NVR"), false, "no Fire Alarm leakage into CCTV");
  assert.equal(applicable("UPS", "Uninterruptible Power Supply Unit"), false, "the UPS pack keeps only power.runtime");
});
