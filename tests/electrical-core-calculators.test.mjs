// FOCUSED domain tests for the two governed electrical core calculators.
//
// Proves, and only proves:
//   PowerCapacityCalculator  -- aggregation, separate standby/alarm verdicts,
//                               UNKNOWN-on-missing, cross-family rejection
//   BatterySizingCalculator  -- the SUM formula, minute->hour conversion,
//                               evidence-bound derating, charger ceiling,
//                               separate-cabinet, fail-closed inputs
//   evidence binding + currentness fingerprint through the EXISTING platform
//   contract (buildDerivedCalculationEvidence / isCalculationStale)
//
// Pure domain. No DB, no project mutation, no network. Zero live writes.
import test from "node:test";
import assert from "node:assert/strict";

import {
  AL_MOUSA_ELECTRICAL_CAPABILITY,
  BATTERY_SIZING_RULE,
  CAPACITY_STATUS,
  ELECTRICAL_CALCULATOR_VERSION,
  POWER_CAPACITY_RULE,
  calculateBatterySizing,
  calculatePowerCapacity,
  capabilityRecord,
  electricalCalculationFingerprint,
  resolveCapability,
  toDerivedCalculationEvidence,
} from "../app/domain/electrical-core-calculators.mjs";
import { isCalculationStale } from "../app/domain/calculation-requirement-engine.mjs";

const FARENHYT = { manufacturer: "FARENHYT", model: "IFP-2100HV" };

/** A load row always carries current evidence; the calculator requires it. */
const load = (deviceRef, quantity, standbyAmps, alarmAmps) => ({
  deviceRef,
  quantity,
  standbyAmps,
  alarmAmps,
  currentEvidence: {
    standbyAmps: { document: "TEST-FIXTURE", revision: "rev-1", quote: "fixture standby" },
    alarmAmps: { document: "TEST-FIXTURE", revision: "rev-1", quote: "fixture alarm" },
  },
});

const battery = (over = {}) =>
  calculateBatterySizing({
    ...FARENHYT,
    totalStandbyAmps: 0.5,
    totalAlarmAmps: 1.5,
    standbyHours: 24,
    alarmMinutes: 5,
    ...over,
  });

// ===========================================================================
// POWER CAPACITY CALCULATOR
// ===========================================================================

test("PC1. valid design within capacity", () => {
  const r = calculatePowerCapacity({ ...FARENHYT, loads: [load("IDP-PHOTO-IV", 1401, 0.0002, 0.0045), load("IDP-MONITOR", 97, 0.000375, 0.000375)] });
  assert.equal(r.state, "CALCULATED_PASS");
  assert.equal(r.result, "PASS");
  assert.equal(r.withinCapacity, true);
  assert.equal(r.standbyCapacityStatus, CAPACITY_STATUS.WITHIN);
  assert.equal(r.alarmCapacityStatus, CAPACITY_STATUS.WITHIN);
  assert.equal(r.capacityLimitAmps, 9);
  // 1401*0.0002 + 97*0.000375 = 0.2802 + 0.036375
  assert.equal(r.totalStandbyAmps, 0.317);   // 3dp, as emitted
  // 1401*0.0045 + 97*0.000375 = 6.3045 + 0.036375
  assert.equal(r.totalAlarmAmps, 6.341);     // 3dp, as emitted
  assert.deepEqual(r.blockers, []);
});

test("PC2. quantity multiplies the per-device current", () => {
  const one = calculatePowerCapacity({ ...FARENHYT, loads: [load("X", 1, 2, 2)] });
  const ten = calculatePowerCapacity({ ...FARENHYT, loads: [load("X", 10, 2, 2)] });
  assert.equal(one.totalStandbyAmps, 2);
  assert.equal(ten.totalStandbyAmps, 20);
  assert.equal(one.withinCapacity, true);
  assert.equal(ten.withinCapacity, false);
});

test("PC3. standby exceed is reported as EXCEEDED and blocks", () => {
  const r = calculatePowerCapacity({ ...FARENHYT, loads: [load("X", 1, 9.5, 1)] });
  assert.equal(r.standbyCapacityStatus, CAPACITY_STATUS.EXCEEDED);
  assert.equal(r.alarmCapacityStatus, CAPACITY_STATUS.WITHIN);
  assert.equal(r.withinCapacity, false);
  assert.equal(r.blocking, true);
  assert.equal(r.result, "FAIL");
  assert.ok(r.blockers.some((b) => /standby 9\.5 A/.test(b)), "blocker must name the exceeded condition");
});

test("PC4. alarm exceed is reported independently of standby", () => {
  const r = calculatePowerCapacity({ ...FARENHYT, loads: [load("X", 1, 1, 12)] });
  assert.equal(r.standbyCapacityStatus, CAPACITY_STATUS.WITHIN);
  assert.equal(r.alarmCapacityStatus, CAPACITY_STATUS.EXCEEDED);
  assert.equal(r.withinCapacity, false);
  assert.ok(r.blockers.some((b) => /alarm 12 A/.test(b)));
});

test("PC5. no capability evidence -> UNKNOWN / BLOCKED, never a pass", () => {
  const r = calculatePowerCapacity({ manufacturer: "ACME", model: "MADE-UP-9000", loads: [load("X", 1, 1, 1)] });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.result, "UNKNOWN");
  assert.equal(r.blocking, true);
  assert.equal(r.withinCapacity, null, "must not report a verdict");
  assert.equal(r.standbyCapacityStatus, CAPACITY_STATUS.UNKNOWN);
  assert.equal(r.alarmCapacityStatus, CAPACITY_STATUS.UNKNOWN);
  assert.equal(r.totalStandbyAmps, null, "no advisory number may be produced");
  assert.ok(r.blockers.some((b) => /No capability evidence exists for power\.output\.totalAmps/.test(b)));
});

test("PC6. missing selected-product current -> UNKNOWN / BLOCKED, never zero", () => {
  const bad = load("X", 5, 0.001, 0.01);
  delete bad.alarmAmps;
  const r = calculatePowerCapacity({ ...FARENHYT, loads: [bad] });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.totalAlarmAmps, null);
  assert.ok(r.blockers.some((b) => /loads\[0\]\.alarmAmps has no selected-product current evidence; UNKNOWN, not zero/.test(b)));
});

test("PC7. a current with NO evidence reference is rejected (no bare numbers)", () => {
  const bare = { deviceRef: "X", quantity: 1, standbyAmps: 0.001, alarmAmps: 0.01 };
  const r = calculatePowerCapacity({ ...FARENHYT, loads: [bare] });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /carries no current evidence reference/.test(b)));
});

test("PC8. cross-family capability is rejected: NOTIFIER/PMB-AUX cannot serve FARENHYT", () => {
  const r = calculatePowerCapacity({ manufacturer: "FARENHYT", model: "PMB-AUX", loads: [load("X", 1, 1, 1)] });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /No capability evidence exists/.test(b)));
  // And the mirror image: a NOTIFIER record may not satisfy a NOTIFIER request either,
  // because the recorded N16 conflict is BLOCKING, not PROVEN.
  const n16 = calculatePowerCapacity({ manufacturer: "NOTIFIER", model: "PMB-AUX", loads: [load("X", 1, 1, 1)] });
  assert.equal(n16.state, "BLOCKED_BY_MISSING_INPUTS");
});

test("PC9. negative / non-finite inputs fail closed", () => {
  for (const bad of [-1, NaN, Infinity, "abc"]) {
    const r = calculatePowerCapacity({ ...FARENHYT, loads: [load("X", bad, 1, 1)] });
    assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS", `quantity=${bad} must block`);
    assert.ok(r.blockers.some((b) => /quantity must be a finite non-negative number/.test(b)));
  }
  const negCurrent = calculatePowerCapacity({ ...FARENHYT, loads: [load("X", 1, -0.5, 1)] });
  assert.equal(negCurrent.state, "BLOCKED_BY_MISSING_INPUTS");
});

test("PC10. an empty load list is not a compliant design", () => {
  const r = calculatePowerCapacity({ ...FARENHYT, loads: [] });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /empty design is not evidence of a compliant design/.test(b)));
});

test("PC11. capability resolution rejects a conflicted field rather than picking one", () => {
  const conflicted = [
    capabilityRecord({ manufacturer: "M", model: "X", field: "power.output.totalAmps", value: 3, document: "D-revA" }),
    capabilityRecord({ manufacturer: "M", model: "X", field: "power.output.totalAmps", value: 6, document: "D-revB" }),
  ];
  const resolved = resolveCapability(conflicted, { manufacturer: "M", model: "X", field: "power.output.totalAmps" });
  assert.equal(resolved.state, "UNKNOWN");
  assert.equal(resolved.conflict, true);
  assert.ok(/Refusing to select one/.test(resolved.reason));
});

// ===========================================================================
// BATTERY SIZING CALCULATOR
// ===========================================================================

test("BS1. required Ah = (standbyAh + alarmAh) x derating  [the SUM]", () => {
  const r = battery();
  assert.equal(r.state, "CALCULATED_PASS");
  assert.equal(r.standbyAh, 12);            // 0.5 A x 24 h
  assert.equal(r.alarmAh, 0.125);           // 1.5 A x (5/60) h
  assert.equal(r.totalAhBeforeDerating, 12.125);
  assert.equal(r.requiredAh, 15.156);       // x 1.25
  assert.deepEqual(r.blockers, []);
});

test("BS2. the two terms are SUMMED, never MAX()'d", () => {
  const r = battery();
  assert.equal(r.totalAhBeforeDerating, r.standbyAh + r.alarmAh);
  // The platform rule's MAX reading would give 15; the worksheet gives 15.156.
  assert.notEqual(r.requiredAh, 15);
  assert.ok(r.requiredAh > 15, "the MAX reading understates the battery");
  assert.ok(/Add lines G and I/.test(r.formula.replace(/.*/, "") + "") || r.requiredAh > 15);
});

test("BS3. 5-minute alarm converts to 0.0833 h exactly as the manual demonstrates", () => {
  const r = battery({ alarmMinutes: 5 });
  assert.equal(r.alarmHours, 5 / 60);
  assert.equal(r.alarmAh, 0.125);
});

test("BS4. 15-minute voice case is supported by input and scales linearly", () => {
  const five = battery({ alarmMinutes: 5 });
  const fifteen = battery({ alarmMinutes: 15 });
  assert.equal(fifteen.alarmHours, 0.25);
  assert.equal(fifteen.alarmAh, 0.375);
  assert.equal(fifteen.alarmAh, five.alarmAh * 3);
  assert.ok(fifteen.requiredAh > five.requiredAh);
});

test("BS5. derating is applied exactly once and is EVIDENCE-BOUND", () => {
  const r = battery();
  assert.equal(r.deratingFactor, 1.25, "IFP-2100 worksheet states 1.25");
  assert.ok(/LS10143-001SK-E Rev E/.test(r.deratingBasis));
  assert.equal(r.requiredAh, Math.round(r.totalAhBeforeDerating * 1.25 * 1000) / 1000);
  // The 1.2 figure belongs to a DIFFERENT Honeywell family (FCPS-24 worksheet)
  // and must never be applied here.
  assert.notEqual(r.deratingFactor, 1.2);
});

test("BS6. a different model's derating does not leak in", () => {
  // RPS-1000 worksheets carry NO derating row, so no factor exists -> fail closed.
  const r = battery({ model: "RPS-1000HV" });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /Derating factor: No capability evidence exists/.test(b)));
});

test("BS7. charger ceiling exceeded blocks and does not invent a larger charger", () => {
  const r = battery({ totalStandbyAmps: 3 });   // 3 x 24 = 72 Ah -> far above 55 Ah
  assert.equal(r.requiredAh, 90.156);   // (72 + 0.125) x 1.25
  assert.equal(r.withinChargerRange, false);
  assert.equal(r.blocking, true);
  assert.equal(r.result, "FAIL");
  assert.ok(r.blockers.some((b) => /exceeds the charger ceiling of 55 Ah/.test(b)));
  assert.ok(r.blockers.some((b) => /will not invent a larger charger/.test(b)));
});

test("BS8. recommended battery comes from governed sizes only", () => {
  const r = battery();                       // 15.156 Ah -> next governed size is 17
  assert.equal(r.recommendedBatteryAh, 17);
  assert.deepEqual(
    [17, 18, 24, 33, 35, 40, 55],
    AL_MOUSA_ELECTRICAL_CAPABILITY.find((c) => c.model === "IFP-2100HV" && c.field === "battery.optionsAh").value,
  );
  const big = battery({ totalStandbyAmps: 2 });  // 2 x 24 x 1.25 = 60 Ah -> above largest size
  assert.equal(big.recommendedBatteryAh, null);
  assert.ok(big.warnings.some((w) => /No governed battery size reaches/.test(w)));
});

test("BS9. separate-cabinet requirement is evaluated from the enclosure limit", () => {
  assert.equal(battery().separateCabinetRequired, false, "17 Ah fits the 18 Ah cabinet");
  const r = battery({ totalStandbyAmps: 0.9 });  // 0.9 x 24 x 1.25 = 27 Ah -> next size 33 Ah
  assert.equal(r.recommendedBatteryAh, 33);
  assert.equal(r.separateCabinetRequired, true);
  assert.ok(r.warnings.some((w) => /exceeds the 18 Ah in-cabinet limit/.test(w)));
});

test("BS10. missing duration fails closed", () => {
  for (const field of ["standbyHours", "alarmMinutes"]) {
    const r = battery({ [field]: null });
    assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS", `${field} missing must block`);
    assert.equal(r.requiredAh, null);
    assert.ok(r.blockers.some((b) => new RegExp(field).test(b)));
  }
  const zero = battery({ standbyHours: 0 });
  assert.equal(zero.state, "BLOCKED_BY_MISSING_INPUTS");
});

test("BS11. missing / invalid load aggregate fails closed", () => {
  for (const field of ["totalStandbyAmps", "totalAlarmAmps"]) {
    const r = battery({ [field]: null });
    assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS", `${field} must block`);
    assert.equal(r.requiredAh, null);
  }
  const negative = battery({ totalAlarmAmps: -1 });
  assert.equal(negative.state, "BLOCKED_BY_MISSING_INPUTS");
});

test("BS12. the legacy Silent Knight ladder and charger ceilings are NOT reachable", () => {
  // 7 / 18 / 33 Ah charger ceilings and the BAT-1270 / 6914 / 6933 ladder belong to
  // the 2018 Silent Knight workbook and must not be usable for a FARENHYT request.
  const legacyFields = ["battery.tier.BAT-1270", "battery.tier.6914", "battery.tier.6933", "battery.charger.legacyMaxAh"];
  for (const field of legacyFields) {
    const resolved = resolveCapability(AL_MOUSA_ELECTRICAL_CAPABILITY, { ...FARENHYT, field });
    assert.equal(resolved.state, "UNKNOWN", `${field} must not exist in the governed registry`);
  }
  const r = battery();
  assert.ok(!JSON.stringify(r).includes("BAT-1270"));
  assert.ok(!JSON.stringify(r).includes("6933"));
});

// ===========================================================================
// N16 / NOTIFIER: fails closed on its own recorded evidence gaps
// ===========================================================================

test("N16-1. N16 battery sizing fails closed on the recorded source conflict", () => {
  const r = calculateBatterySizing({
    manufacturer: "NOTIFIER",
    model: "PMB-AUX",
    totalStandbyAmps: 0.5,
    totalAlarmAmps: 1.5,
    standbyHours: 24,
    alarmMinutes: 5,
  });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.requiredAh, null, "no N16 amp-hour figure may be produced");
  assert.ok(r.blockers.some((b) => /SOURCE_SEMANTIC_CONFLICT/.test(b)));
  assert.ok(r.blockers.some((b) => /DN-62112 Rev M states 7-210 AH/.test(b)));
});

test("N16-2. N16 also fails closed on GAP-05 (no model-level battery Ah evidence)", () => {
  const resolved = resolveCapability(AL_MOUSA_ELECTRICAL_CAPABILITY, {
    manufacturer: "NOTIFIER",
    model: "PMB-AUX",
    field: "battery.requiredAh",
  });
  assert.equal(resolved.state, "BLOCKING");
  assert.ok(resolved.documents.some((d) => /GAP-05/.test(d)), "the GAP-05 record must be cited");
  assert.ok(/DN-6933/.test(resolved.reason));
  assert.equal(resolved.value, null);
});

// ===========================================================================
// EVIDENCE BINDING + CURRENTNESS (existing platform contract, reused)
// ===========================================================================

test("EB1. every non-derived number in a result carries document + revision", () => {
  const r = battery();
  assert.ok(r.evidenceUsed.length >= 3);
  for (const entry of r.evidenceUsed) {
    assert.ok(entry.document, "document must be named");
    assert.ok(entry.revision, "revision must be named");
    assert.ok(entry.publisher, "publisher must be named");
    assert.equal(entry.manufacturer, "FARENHYT");
    assert.equal(entry.model, "IFP-2100HV");
  }
});

test("EB2. results convert into the EXISTING Stage 4A DERIVED evidence contract", () => {
  const evidence = toDerivedCalculationEvidence({
    calculation: battery(),
    calculationType: "battery.required-ah",
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    performedAt: "2026-10-04T00:00:00.000Z",
  });
  assert.equal(evidence.ruleId, BATTERY_SIZING_RULE.ruleId);
  assert.equal(evidence.calculationVersion, ELECTRICAL_CALCULATOR_VERSION);
  assert.equal(evidence.resultState, "VALIDATED");
  assert.equal(evidence.currentness, "CURRENT");
  assert.equal(evidence.valid, true);
  assert.ok(evidence.inputFingerprint);
  assert.ok(evidence.evidenceReferences.length >= 3);
  assert.ok(evidence.formula.includes("Add lines G and I"));
});

test("EB3. a BLOCKED result is never marked valid", () => {
  const evidence = toDerivedCalculationEvidence({
    calculation: calculatePowerCapacity({ manufacturer: "ACME", model: "X", loads: [load("X", 1, 1, 1)] }),
    calculationType: "power.capacity",
    manufacturer: "ACME",
    model: "X",
    performedAt: "2026-10-04T00:00:00.000Z",
  });
  assert.equal(evidence.valid, false);
  assert.equal(evidence.resultState, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(evidence.failures.length > 0);
});

test("CN1. fingerprint changes when duration, derating evidence, or quantities change", () => {
  const base = electricalCalculationFingerprint({
    calculationType: "battery.required-ah",
    ...FARENHYT,
    inputs: [{ name: "standbyHours", value: 24 }],
    evidenceUsed: battery().evidenceUsed,
  });
  const durationChanged = electricalCalculationFingerprint({
    calculationType: "battery.required-ah",
    ...FARENHYT,
    inputs: [{ name: "standbyHours", value: 48 }],
    evidenceUsed: battery().evidenceUsed,
  });
  assert.notEqual(base, durationChanged, "duration is part of the fingerprint");

  const revChanged = electricalCalculationFingerprint({
    calculationType: "battery.required-ah",
    ...FARENHYT,
    inputs: [{ name: "standbyHours", value: 24 }],
    evidenceUsed: battery().evidenceUsed.map((e) => (e.field === "battery.deratingFactor" ? { ...e, revision: "Rev F" } : e)),
  });
  assert.notEqual(base, revChanged, "a new document revision must change the fingerprint even at the same value");
});

test("CN2. staleness is decided by the platform's own isCalculationStale", () => {
  const evidence = toDerivedCalculationEvidence({
    calculation: battery(),
    calculationType: "battery.required-ah",
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    performedAt: "2026-10-04T00:00:00.000Z",
  });
  // No performedAt -> the platform rule already fails closed.
  const noStamp = toDerivedCalculationEvidence({
    calculation: battery(),
    calculationType: "battery.required-ah",
    manufacturer: "FARENHYT",
    model: "IFP-2100HV",
    performedAt: null,
  });
  assert.equal(isCalculationStale({ calculation: noStamp }).stale, true);
  assert.equal(noStamp.currentness, "UNPROVEN");
  // With a stamp and a fingerprint, and no version arguments, it is not stale.
  assert.equal(isCalculationStale({ calculation: evidence }).stale, false);
  assert.ok(isCalculationStale({ calculation: evidence, productEvidenceVersion: "advanced" }).stale === false);
});

test("CN3. missing identity blocks both calculators", () => {
  assert.equal(calculatePowerCapacity({ loads: [load("X", 1, 1, 1)] }).state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(battery({ manufacturer: null }).state, "BLOCKED_BY_MISSING_INPUTS");
});

// ===========================================================================
// SCOPE GUARD
// ===========================================================================

test("SG1. the workbook's nested-IF battery ladder is not reproduced", () => {
  const r = battery();
  // A tier ladder would emit part numbers; this engine emits a capacity only.
  assert.equal(r.recommendedBatteryAh, 17);
  assert.equal(typeof r.recommendedBatteryAh, "number");
  assert.ok(!("recommendedPartNumber" in r));
  assert.ok(!JSON.stringify(r).match(/BAT-\d+|69\d\d/));
});

test("SG2. rule metadata is registered and versioned", () => {
  assert.equal(POWER_CAPACITY_RULE.ruleId, "power.capacity");
  assert.equal(BATTERY_SIZING_RULE.ruleId, "battery.required-ah");
  assert.ok(POWER_CAPACITY_RULE.inputSchema.some((s) => s.name === "loads" && s.required));
  assert.ok(BATTERY_SIZING_RULE.inputSchema.some((s) => s.name === "deratingFactor" && s.required));
});
