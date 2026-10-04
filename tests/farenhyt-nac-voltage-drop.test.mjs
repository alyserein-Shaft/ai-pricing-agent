// FARENHYT NAC-CIRCUIT SLICE + VOLTAGE-DROP CORE.
//
// Evidence under test (all MANUFACTURER_EVIDENCE, prod-edam.honeywell.com):
//   IFP-2100 Data Sheet Doc 351602 Rev C ....... 3 A per circuit, 9 A total
//   IFP-2100/ECS Manual LS10143-001SK-E Rev E .. 3 V max drop (Class A and Class B)
//                                               Tables 4.6 / 4.7 max impedance
//                                               Regulated 24 VDC, 4.7k EOL
//
// HV APPLICABILITY IS EXPLICIT: LS10143-001SK-E Rev E carries the scope note
// "All references to the IFP-2100 within this manual are applicable to the IFP-2100,
// IFP-2100B, IFP-2100ECS, IFP-2100ECSB, IFP-2100HV, ... unless otherwise indicated."
//
// Pure domain. No DB, no project mutation, no network.
import test from "node:test";
import assert from "node:assert/strict";

import {
  CALCULATION_RULES,
  CALCULATION_TYPES,
  evaluateCalculationRequirement,
} from "../app/domain/calculation-requirement-engine.mjs";
import {
  AL_MOUSA_ELECTRICAL_CAPABILITY,
  capabilityRecord,
  calculateNacCircuitCapacity,
  calculateVoltageDrop,
  resolveCapability,
} from "../app/domain/electrical-core-calculators.mjs";

const PANEL = { manufacturer: "FARENHYT", model: "IFP-2100HV" };
const EV = { document: "LS10143-001SK-E Rev E", revision: "Table 3.2", quote: "device current" };
const CONDUCTOR = { document: "NFPA 70 Table 8", revision: "conductor properties", quote: "DC resistance at 75C" };

const load = (deviceRef, quantity, standbyAmps, alarmAmps, withEvidence = true) => ({
  deviceRef,
  quantity,
  standbyAmps,
  alarmAmps,
  ...(withEvidence ? { currentEvidence: { standbyAmps: EV, alarmAmps: EV } } : {}),
});

const nac = (loads, over = {}) =>
  calculateNacCircuitCapacity({ ...PANEL, circuitId: "I/01", circuitClass: "B", loads, ...over });

const vd = (over = {}) =>
  calculateVoltageDrop({
    ...PANEL,
    circuitId: "I/01",
    circuitClass: "B",
    circuitAmps: 1,
    oneWayLength: 100,
    lengthUnit: "m",
    conductorResistanceOhmsPerUnit: 0.01,
    conductorType: "#14 AWG",
    conductorEvidence: CONDUCTOR,
    ...over,
  });

// ===========================================================================
// NAC -- capacity boundaries against the governed 3 A per-circuit ceiling
// ===========================================================================

test("N1. under 3 A is within capacity", () => {
  const r = nac([load("SRL", 10, 0.001, 0.154)]);
  assert.equal(r.state, "CALCULATED_PASS");
  assert.equal(r.circuitAlarmAmps, 1.54);
  assert.equal(r.governingCircuitAmps, 1.54);
  assert.equal(r.capacityLimitAmps, 3);
  assert.equal(r.withinCircuitCapacity, true);
  assert.equal(r.capacityDeficitAmps, 0);
});

test("N2. exactly 3 A is within capacity (limit is inclusive)", () => {
  const r = nac([load("SRL", 20, 0.001, 0.15)]);
  assert.equal(r.governingCircuitAmps, 3);
  assert.equal(r.withinCircuitCapacity, true);
  assert.equal(r.state, "CALCULATED_PASS");
});

test("N3. over 3 A fails and returns a governed DEFICIT, never derived hardware", () => {
  const r = nac([load("SRL", 30, 0.001, 0.11)]);
  assert.equal(r.state, "CALCULATED_FAIL");
  assert.equal(r.result, "FAIL");
  assert.equal(r.blocking, true);
  assert.equal(r.withinCircuitCapacity, false);
  assert.equal(r.capacityDeficitAmps, 0.3);
  assert.ok(r.blockers.some((b) => /Deficit 0.3 A/.test(b)));
  // Explicitly: no hardware is selected.
  assert.ok(r.blockers.some((b) => /No auxiliary supply, extender or transformer is selected/.test(b)));
  for (const forbidden of ["auxiliaryPower", "extender", "transformer", "recommendedPartNumber"]) {
    assert.ok(!(forbidden in r), `${forbidden} must not be derived here`);
  }
});

test("N4. the GOVERNING term is max(standby, alarm), not alarm alone", () => {
  const standbyGoverns = nac([load("X", 1, 2.9, 1.0)]);
  assert.equal(standbyGoverns.circuitStandbyAmps, 2.9);
  assert.equal(standbyGoverns.circuitAlarmAmps, 1);
  assert.equal(standbyGoverns.governingCircuitAmps, 2.9);
  assert.equal(standbyGoverns.governingCondition, "standby");
  const alarmGoverns = nac([load("X", 1, 0.1, 2.5)]);
  assert.equal(alarmGoverns.governingCircuitAmps, 2.5);
  assert.equal(alarmGoverns.governingCondition, "alarm");
  // A design whose STANDBY load breaches the ceiling must fail even though alarm is low.
  const standbyBreach = nac([load("X", 1, 3.2, 0.5)]);
  assert.equal(standbyBreach.state, "CALCULATED_FAIL");
  assert.equal(standbyBreach.governingCondition, "standby");
});

test("N5. the PANEL TOTAL is never substituted for the per-circuit ceiling", () => {
  // 9 A total would pass a panel-level test; per circuit it must fail at 3 A.
  const r = nac([load("X", 1, 1, 4)]);
  assert.equal(r.capacityLimitAmps, 3, "must be the per-circuit ceiling, not the 9 A panel total");
  assert.equal(r.state, "CALCULATED_FAIL");
  assert.ok(/per-circuit ceiling 3 A/.test(r.blockers[0]));
});

test("N6. missing device current evidence fails closed as UNKNOWN, not zero", () => {
  const r = nac([load("X", 5, 0.001, null)]);
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.result, "UNKNOWN");
  assert.equal(r.governingCircuitAmps, null, "no advisory figure may be produced");
  assert.ok(r.blockers.some((b) => /UNKNOWN, not zero/.test(b)));
  // A bare current with no evidence reference is also refused.
  const bare = nac([{ deviceRef: "X", quantity: 5, standbyAmps: 0.001, alarmAmps: 0.01 }]);
  assert.equal(bare.state, "BLOCKED_BY_MISSING_INPUTS");
});

test("N7. unknown circuit allocation fails closed", () => {
  const r = nac([load("X", 1, 0.001, 0.01)], { circuitId: null });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /Circuit allocation is unknown/.test(b)));
  assert.equal(r.governingCircuitAmps, null);
});

test("N8. cross-family capability is rejected", () => {
  const silentKnight = nac([load("X", 1, 0.001, 0.01)], { model: "SK-2" });
  assert.equal(silentKnight.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(silentKnight.blockers.some((b) => /No capability evidence exists for power\.output\.perCircuitAmps/.test(b)));
  const notifier = nac([load("X", 1, 0.001, 0.01)], { model: "PMB-AUX" });
  assert.equal(notifier.state, "BLOCKED_BY_MISSING_INPUTS");
});

test("N9. conflicting per-circuit capability fails closed rather than picking one", () => {
  const conflicted = [
    capabilityRecord({ manufacturer: "M", model: "X", field: "power.output.perCircuitAmps", value: 3, document: "rev-A" }),
    capabilityRecord({ manufacturer: "M", model: "X", field: "power.output.perCircuitAmps", value: 5, document: "rev-B" }),
  ];
  const r = calculateNacCircuitCapacity({
    manufacturer: "M",
    model: "X",
    circuitId: "I/01",
    loads: [load("X", 1, 0.001, 0.01)],
    capabilityRecords: conflicted,
  });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /Refusing to select one/.test(b)));
});

test("N10. invalid quantity or current fails closed", () => {
  for (const bad of [-1, NaN, Infinity, "abc"]) {
    assert.equal(nac([load("X", bad, 0.001, 0.01)]).state, "BLOCKED_BY_MISSING_INPUTS", `qty=${bad}`);
    assert.equal(nac([load("X", 1, bad, 0.01)]).state, "BLOCKED_BY_MISSING_INPUTS", `standby=${bad}`);
  }
  assert.ok(nac([load("X", -1, 0.001, 0.01)]).blockers.some((b) => /quantity must be a finite non-negative number/.test(b)));
});

test("N11. an empty circuit is not a compliant circuit", () => {
  const r = nac([]);
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /No electrical load records/.test(b)));
});

// ===========================================================================
// VOLTAGE DROP -- 3 V confirmed for IFP-2100HV
// ===========================================================================

test("V1. below the maximum drop is within limit", () => {
  const r = vd();
  assert.equal(r.loopResistanceOhms, 2); // 2 x 100 m x 0.01
  assert.equal(r.voltageDrop, 2); // 1 A x 2 ohm
  assert.equal(r.maxVoltageDropVolts, 3);
  assert.equal(r.withinVoltageDrop, true);
  assert.equal(r.state, "CALCULATED_PASS");
  assert.match(r.thresholdBasis, /LS10143-001SK-E Rev E/);
});

test("V2. exactly at the maximum drop is within limit", () => {
  const r = vd({ circuitAmps: 3, oneWayLength: 50 });
  assert.equal(r.loopResistanceOhms, 1);
  assert.equal(r.voltageDrop, 3);
  assert.equal(r.withinVoltageDrop, true);
});

test("V3. over the maximum drop fails", () => {
  const r = vd({ circuitAmps: 3, oneWayLength: 120 });
  assert.equal(r.voltageDrop, 7.2);
  assert.equal(r.withinVoltageDrop, false);
  assert.equal(r.state, "CALCULATED_FAIL");
  assert.equal(r.blocking, true);
});

test("V4. the published current/impedance envelope is applied and never extrapolated", () => {
  const within = vd({ circuitAmps: 2.5, oneWayLength: 50 }); // R = 1.0 ohm, envelope 1.2
  assert.equal(within.maxImpedanceOhms, 1.2);
  assert.equal(within.withinImpedanceEnvelope, true);
  const over = vd({ circuitAmps: 2.5, oneWayLength: 100 }); // R = 2.0 ohm > 1.2
  assert.equal(over.withinImpedanceEnvelope, false);
  // Above the highest tabulated point there is NO published limit and none is invented.
  const above = vd({ circuitAmps: 3.5, oneWayLength: 50 });
  assert.equal(above.maxImpedanceOhms, null);
  assert.equal(above.withinImpedanceEnvelope, null);
  assert.ok(above.warnings.some((w) => /none is extrapolated/.test(w)));
});

test("V5. missing route length fails closed -- a route is never inferred", () => {
  const r = vd({ oneWayLength: null });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.voltageDrop, null);
  assert.ok(r.blockers.some((b) => /a route is not inferred/.test(b)));
});

test("V6. unknown conductor fails closed, with no table default", () => {
  const unknown = vd({ conductorResistanceOhmsPerUnit: null });
  assert.equal(unknown.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(unknown.blockers.some((b) => /unknown conductor fails closed rather than inheriting a table default/.test(b)));
  const noEvidence = vd({ conductorEvidence: null });
  assert.equal(noEvidence.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(noEvidence.blockers.some((b) => /carries no evidence reference/.test(b)));
});

test("V7. an unresolved manufacturer threshold blocks the VERDICT but keeps the arithmetic", () => {
  // RPS-1000HV has no published NAC voltage-drop threshold.
  const r = vd({ model: "RPS-1000HV" });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.result, "UNKNOWN");
  assert.equal(r.blocking, true);
  assert.equal(r.withinVoltageDrop, null, "no pass may be manufactured from an unresolved threshold");
  assert.equal(r.maxVoltageDropVolts, null);
  // The arithmetic is still reported, because it is a fact, not a verdict.
  assert.equal(r.voltageDrop, 2);
  assert.ok(r.thresholdBlocker);
});

test("V8. Class A and Class B share the 3 V limit; Class A also carries a 50 ohm circuit cap", () => {
  const classB = vd({ circuitClass: "B" });
  const classA = vd({ circuitClass: "A" });
  assert.equal(classB.maxVoltageDropVolts, 3);
  assert.equal(classA.maxVoltageDropVolts, 3, "the manual states 3 V for Class A as well");
  const classAResolved = resolveCapability(AL_MOUSA_ELECTRICAL_CAPABILITY, {
    ...PANEL,
    field: "nac.classA.maxImpedanceOhms",
  });
  assert.equal(classAResolved.value, 50);
});

test("V9. cross-family voltage drop is rejected", () => {
  const r = vd({ model: "PMB-AUX" });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.blockers.some((b) => /A selected panel identity|manufacturer/.test(b)) || r.thresholdBlocker);
});

// ===========================================================================
// CANONICAL REGISTRATION + CURRENTNESS
// ===========================================================================

test("C1. exactly ONE NAC authority exists", () => {
  const nacTypes = CALCULATION_TYPES.filter((t) => t.includes("nac"));
  assert.deepEqual(nacTypes, ["power.nac-load"], "no competing NAC rule may be registered");
  assert.equal(CALCULATION_RULES["power.nac-load"].ruleVersion, "power.nac-load-1.1.0");
  // The standalone rule id is metadata only; it is not a second canonical rule.
  assert.equal(CALCULATION_RULES["nac.circuit-capacity"], undefined);
});

test("C2. canonical power.nac-load delegates and preserves its legacy contract", () => {
  const run = (loads, ampacity = 3) =>
    evaluateCalculationRequirement({
      calculationType: "power.nac-load",
      system: "Fire Alarm",
      family: "NAC Power Supply",
      inputs: [
        { name: "nacAmpacity", value: ampacity, unit: "A", source: { documentId: "ds-nac" } },
        { name: "deviceLoads", value: loads, source: { documentId: "ds-horn" } },
      ],
    });
  const pass = run([{ name: "HS", current: 0.25, quantity: 8 }, { name: "HS", current: 0.5, quantity: 2 }]);
  assert.equal(pass.state, "CALCULATED_PASS");
  assert.equal(pass.output.totalAlarmCurrent, 3, "legacy field name retained");
  assert.equal(pass.output.nacAmpacity, 3, "legacy field name retained");
  assert.equal(pass.output.governingCircuitAmps, 3, "governing field added");
  const fail = run([{ name: "HS", current: 0.5, quantity: 10 }]);
  assert.equal(fail.state, "CALCULATED_FAIL");
  assert.equal(fail.blocking, true);
  assert.equal(fail.output.capacityDeficitAmps, 2);
});

test("C3. the governed model-bound shape enforces circuit identity and evidence", () => {
  const strict = evaluateCalculationRequirement({
    calculationType: "power.nac-load",
    system: "Fire Alarm",
    family: "NAC Power Supply",
    performedAt: "2026-10-04T00:00:00.000Z",
    inputs: [
      { name: "capabilityManufacturer", value: "FARENHYT" },
      { name: "capabilityModel", value: "IFP-2100HV" },
      { name: "circuitId", value: "I/01" },
      { name: "loads", value: [load("SRL", 30, 0.001, 0.11)] },
    ],
  });
  assert.equal(strict.state, "CALCULATED_FAIL");
  assert.equal(strict.output.capacityLimitAmps, 3);
  assert.equal(strict.output.capacityDeficitAmps, 0.3);
  assert.ok(strict.evidence, "a completed FAIL still yields DERIVED evidence");
  // Omitting the circuit identity must block under the governed shape.
  const noCircuit = evaluateCalculationRequirement({
    calculationType: "power.nac-load",
    system: "Fire Alarm",
    family: "NAC Power Supply",
    inputs: [
      { name: "capabilityManufacturer", value: "FARENHYT" },
      { name: "capabilityModel", value: "IFP-2100HV" },
      { name: "loads", value: [load("SRL", 1, 0.001, 0.01)] },
    ],
  });
  assert.equal(noCircuit.state, "REQUIRED_BUT_INPUTS_MISSING");
});

test("C4. fingerprint changes when the circuit allocation changes", () => {
  const base = { calculationType: "power.nac-load", system: "Fire Alarm", family: "NAC Power Supply", performedAt: "2026-10-04T00:00:00.000Z" };
  const onCircuit = (circuitId) =>
    evaluateCalculationRequirement({
      ...base,
      inputs: [
        { name: "capabilityManufacturer", value: "FARENHYT" },
        { name: "capabilityModel", value: "IFP-2100HV" },
        { name: "circuitId", value: circuitId },
        { name: "loads", value: [load("SRL", 10, 0.001, 0.154)] },
      ],
    });
  assert.notEqual(
    onCircuit("I/01").evidence.inputFingerprint.candidateSpecific,
    onCircuit("I/02").evidence.inputFingerprint.candidateSpecific,
    "re-assigning a load to another circuit must invalidate the result",
  );
});

test("C5. fingerprint changes when the capability revision changes", () => {
  const run = (revision) =>
    evaluateCalculationRequirement({
      calculationType: "power.nac-load",
      system: "Fire Alarm",
      family: "NAC Power Supply",
      performedAt: "2026-10-04T00:00:00.000Z",
      inputs: [
        {
          name: "nacAmpacity",
          value: 3,
          unit: "A",
          source: { documentId: "LS10143-001SK-E", revision },
        },
        { name: "deviceLoads", value: [{ name: "HS", current: 0.25, quantity: 8 }], source: { documentId: "ds-horn" } },
      ],
    });
  assert.notEqual(
    run("Rev E").evidence.inputFingerprint.productEvidenceVersion,
    run("Rev F").evidence.inputFingerprint.productEvidenceVersion,
    "a new manual revision must invalidate currentness at an unchanged value",
  );
});

test("C6. a superseded per-circuit capability stops being usable", () => {
  const current = AL_MOUSA_ELECTRICAL_CAPABILITY.find(
    (c) => c.model === "IFP-2100HV" && c.field === "power.output.perCircuitAmps",
  );
  assert.ok(current, "the governed per-circuit record must exist");
  const r = calculateNacCircuitCapacity({
    ...PANEL,
    circuitId: "I/01",
    loads: [load("X", 1, 0.001, 0.01)],
    capabilityRecords: [{ ...current, state: "SUPERSEDED" }],
  });
  assert.equal(r.state, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.capacityLimitAmps, null);
});
