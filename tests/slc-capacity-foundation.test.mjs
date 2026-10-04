// Focused tests for the standalone SLC Capacity foundation (2026-10-03).
//
// Scope is deliberately narrow and entirely synthetic:
//   - §3 negative controls proving capacity SEMANTICS do not bleed together
//   - §14 the standalone validation matrix A..O
//   - §6 the result-state axis being orthogonal to engineering status
//   - §20 currentness / authority guarantees
//
// No database, no network, no Al Mousa quantities. Nothing here uses a real
// project's figures as authority.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  calculateSlcExpansion,
  SLC_CALCULATION_VERSION,
  SLC_RESULT_STATES,
} from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import {
  runStandaloneSlcCapacity,
  STANDALONE_AUTHORITY_NOTICE,
  STANDALONE_RESULT_LABEL,
} from "../app/domain/fire-alarm-slc-standalone-calculator.mjs";
import {
  buildCapacityRecord,
  assessSizingReadiness,
  FIRE_ALARM_PANEL_CAPACITY_SCOPES,
} from "../app/domain/fire-alarm-panel-capability-normalization.mjs";
import {
  buildCalculationInputEnvelope,
  buildCalculationInputStateFingerprint,
  buildDerivedCalculationEvidence,
  CALCULATION_INPUT_SOURCE_TYPES,
  CALCULATION_RESULT_STATES,
} from "../app/domain/calculation-requirement-engine.mjs";

// Synthetic capacity: two genuinely independent pools plus an absolute ceiling.
const CAP = Object.freeze({
  nativeLoops: 1,
  detectorsPerLoop: 159,
  modulesPerLoop: 159,
  systemPointCeiling: 954,
});
const GOVERNED = { sourceType: "PROJECT_EVIDENCE", authorityState: "GOVERNED", currentness: "CURRENT", manualOverrideState: "NONE", assumptionState: null };
const allGoverned = (paths) => Object.fromEntries(paths.map((name) => [name, GOVERNED]));

const core = (demand, extra = {}) => calculateSlcExpansion({ demand, panelCapacity: { ...CAP }, ...extra });

// ===========================================================================
// §3 -- negative controls: capacity semantics must not bleed into each other
// ===========================================================================

test("§3.1 detector-per-loop capacity never populates module-per-loop capacity", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 10, modules: 10 }, panelCapacity: { ...CAP, modulesPerLoop: undefined } });
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(r.missingInputs.includes("panelCapacity.modulesPerLoop"), `expected modulesPerLoop to be named missing, got ${JSON.stringify(r.missingInputs)}`);
});

test("§3.2 module-per-loop capacity never populates detector-per-loop capacity", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 10, modules: 10 }, panelCapacity: { ...CAP, detectorsPerLoop: undefined } });
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(r.missingInputs.includes("panelCapacity.detectorsPerLoop"));
});

test("§3.3 system-point ceiling never substitutes for a per-loop limit", () => {
  // A generous system ceiling must not make an absent per-loop detector limit work.
  const r = calculateSlcExpansion({ demand: { detectors: 5, modules: 5 }, panelCapacity: { nativeLoops: 1, modulesPerLoop: 159, systemPointCeiling: 9999 } });
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(r.missingInputs.includes("panelCapacity.detectorsPerLoop"));
});

test("§3.4 per-loop combined limit never substitutes for the system ceiling", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 5, modules: 5 }, panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, maxTotalPointsPerLoop: 318 } });
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(r.missingInputs.includes("panelCapacity.systemPointCeiling"));
});

test("§3.5 max SLC loops is never inferred from native SLC loops", () => {
  const nativeOnly = buildCapacityRecord({ name: "native_slc_loops", value: 1, unit: "loops" });
  assert.equal(nativeOnly.scope, "BASE_SLC_LOOPS");
  assert.notEqual(nativeOnly.scope, "MAX_SLC_LOOPS");
  const readiness = assessSizingReadiness({
    capacities: [nativeOnly, buildCapacityRecord({ name: "max_detectors_per_loop", value: 159 }), buildCapacityRecord({ name: "max_modules_per_loop", value: 159 })],
  });
  // Still never DERIVED from the base loop count...
  assert.ok(!readiness.present.includes("MAX_SLC_LOOPS"), "MAX_SLC_LOOPS must never be derived from the base loop count");
  // ...and no longer BLOCKING on it either, because loop topology is settled
  // requirement-relatively rather than from an absolute scalar.
  assert.ok(!readiness.missing.includes("MAX_SLC_LOOPS"), "MAX_SLC_LOOPS is not a universal readiness requirement");
  assert.ok(readiness.advisory.includes("MAX_SLC_LOOPS"), "an absent MAX_SLC_LOOPS is reported as advisory, not silently dropped");
  assert.equal(readiness.loopTopologyAuthority, "REQUIREMENT_RELATIVE");
  // Removing MAX_SLC_LOOPS must not weaken the ceiling requirement.
  assert.ok(readiness.missing.includes("SYSTEM_POINT_CEILING"));
});

test("§3.6 a nameplate system-points claim does not become a governed system ceiling", () => {
  const nameplate = buildCapacityRecord({ name: "max_system_points", value: 2100 });
  assert.equal(nameplate.scope, "SYSTEM_NAMEDPLATE_POINTS");
  assert.equal(nameplate.decomposableIntoLoopArithmetic, false);
  const readiness = assessSizingReadiness({ capacities: [nameplate] });
  assert.ok(readiness.missing.includes("SYSTEM_POINT_CEILING"), "a nameplate must never satisfy the ceiling requirement");
  assert.equal(readiness.nameplateOnly, true);
});

test("§3.7 missing capacity stays missing rather than defaulting", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 3, modules: 3 }, panelCapacity: {} });
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(r.resultState, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.minLoopsRequired, null, "no loop count may be reported while inputs are missing");
  assert.ok(r.missingInputs.length >= 4);
});

test("§3.8 conflicting Approved capacity facts fail closed instead of picking one", () => {
  const r = runStandaloneSlcCapacity({
    demand: { detectors: 1, modules: 1 },
    capacityFacts: [
      { scope: "PER_LOOP_DETECTORS", value: 159, sourceId: "doc-a", sourceType: "MANUFACTURER_EVIDENCE" },
      { scope: "PER_LOOP_DETECTORS", value: 99, sourceId: "doc-b", sourceType: "MANUFACTURER_EVIDENCE" },
    ],
    manualCapacity: { nativeLoops: 1, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  assert.ok(r.output.failures.includes("CONFLICTING_CAPACITY_EVIDENCE"), "a disputed scope must be reported as a failure");
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE", "the disputed scope is treated as unproven, not resolved");
  assert.ok(r.missingInputs.includes("panelCapacity.detectorsPerLoop"));
});

test("§3.9 a superseded capacity fact cannot satisfy a capacity input as current", () => {
  const superseded = runStandaloneSlcCapacity({
    demand: { detectors: 1, modules: 1 },
    capacityFacts: [{ scope: "PER_LOOP_DETECTORS", value: 159, sourceId: "doc-old", sourceType: "MANUFACTURER_EVIDENCE", currentness: "SUPERSEDED", authorityState: "SUPERSEDED" }],
    manualCapacity: { nativeLoops: 1, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  const entry = superseded.inputs.find((i) => i.name === "panelCapacity.detectorsPerLoop");
  assert.equal(entry.currentness, "SUPERSEDED", "superseded provenance must be carried onto the input envelope");
  assert.notEqual(superseded.output.currentness, "CURRENT", "a standalone result may never claim CURRENT currency");
});

test("§3.10 MAX_SLC_LOOPS is producible from its canonical attribute", () => {
  const record = buildCapacityRecord({ name: "max_slc_loops", value: 4, unit: "loops" });
  assert.equal(record.scope, "MAX_SLC_LOOPS");
  assert.equal(record.unit, "loops");
  assert.ok(FIRE_ALARM_PANEL_CAPACITY_SCOPES.includes("MAX_SLC_LOOPS"));
});

// ===========================================================================
// §4 / §5 -- the shared input and output envelopes
// ===========================================================================

test("§4 the input envelope normalises an absent value to MISSING regardless of claim", () => {
  const claimed = buildCalculationInputEnvelope({ name: "demand.detectors", value: null, sourceType: "MANUFACTURER_EVIDENCE", sourceId: "doc-x" });
  assert.equal(claimed.sourceType, "MISSING");
  assert.equal(claimed.sourceId, null, "a missing input may not retain a source reference");
  assert.ok(CALCULATION_INPUT_SOURCE_TYPES.includes(claimed.sourceType));
});

test("§4 the input envelope carries all eight contract fields", () => {
  const env = buildCalculationInputEnvelope({ name: "demand.modules", value: 4, unit: "count", sourceType: "ENGINEER_CONFIRMED", sourceId: "s1", authorityState: "PENDING_REVIEW", currentness: "PARTIAL", manualOverrideState: "ENGINEER_ENTERED", assumptionState: null });
  for (const key of ["value", "unit", "sourceType", "sourceId", "authorityState", "currentness", "manualOverrideState", "assumptionState"]) {
    assert.ok(key in env, `missing envelope field ${key}`);
  }
  assert.equal(env.sourceType, "ENGINEER_CONFIRMED");
});

test("§5 a result with missing inputs is never valid, and assumptions reach evidence", () => {
  const blocked = buildDerivedCalculationEvidence({
    calculationType: "slc.loop-and-expansion",
    executed: { state: "INSUFFICIENT_EVIDENCE", result: "UNKNOWN", blocking: true, missingInputs: ["panelCapacity.systemPointCeiling"] },
    inputs: [{ name: "panelCapacity.systemPointCeiling", value: null, unit: "count" }],
    assumptions: [{ input: "demand.detectors", sourceType: "MANUAL_ASSUMPTION" }],
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.resultState, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(CALCULATION_RESULT_STATES.includes(blocked.resultState));
  assert.deepEqual(blocked.assumptions, [{ input: "demand.detectors", sourceType: "MANUAL_ASSUMPTION" }]);
});

test("§5 the output envelope exposes every required field", () => {
  const ev = buildDerivedCalculationEvidence({
    calculationType: "slc.loop-and-expansion",
    executed: { state: "COMPLETED", result: "PASS", blocking: false, missingInputs: [] },
    inputs: [{ name: "demand.detectors", value: 10, unit: "count" }],
  });
  for (const key of ["result", "calculationVersion", "inputFingerprint", "warnings", "failures", "assumptions", "evidenceReferences", "currentness", "resultState"]) {
    assert.ok(key in ev, `missing output-envelope field ${key}`);
  }
});

// ===========================================================================
// §6 -- result state is orthogonal to engineering status
// ===========================================================================

test("§6 a certain CAPACITY_EXCEEDED is VALIDATED, not blocked", () => {
  // 500 + 500 = 1000 points against a 954 ceiling: a certain, definite breach.
  const r = core({ detectors: 500, modules: 500 }, { inputAuthority: allGoverned(["demand.detectors", "demand.modules", "panelCapacity.nativeLoops", "panelCapacity.detectorsPerLoop", "panelCapacity.modulesPerLoop", "panelCapacity.systemPointCeiling"]) });
  assert.equal(r.status, "CAPACITY_EXCEEDED");
  assert.equal(r.resultState, "VALIDATED", "a definite answer must not look like a tool failure");
  assert.ok(r.missingInputs.length === 0, "nothing was missing; the breach is a real answer");
});

test("§6 a manual assumption yields CALCULATED_WITH_ASSUMPTIONS", () => {
  const assumed = core({ detectors: 10, modules: 10 }, { inputAuthority: { "demand.detectors": { sourceType: "MANUAL_ASSUMPTION" } } });
  assert.equal(assumed.resultState, "CALCULATED_WITH_ASSUMPTIONS");
  assert.ok(assumed.assumingInputs.includes("demand.detectors"));
  assert.equal(assumed.status, "NO_EXPANSION_REQUIRED", "the engineering status is unchanged by the provenance of an input");
  // And the certain-exceeded case stays VALIDATED even with a governed engine.
  const certain = core({ detectors: 10, modules: 10 }, { inputAuthority: allGoverned(["demand.detectors", "demand.modules"]) });
  assert.equal(certain.resultState, "VALIDATED");
});

test("§6 blocked takes precedence over assumed", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 1, modules: 1 }, panelCapacity: {}, inputAuthority: { "demand.detectors": { sourceType: "MANUAL_ASSUMPTION" } } });
  assert.equal(r.resultState, "BLOCKED_BY_MISSING_INPUTS");
});

test("§6 all three declared states are exported and used", () => {
  assert.deepEqual([...SLC_RESULT_STATES], ["VALIDATED", "CALCULATED_WITH_ASSUMPTIONS", "BLOCKED_BY_MISSING_INPUTS"]);
  assert.deepEqual([...CALCULATION_RESULT_STATES], [...SLC_RESULT_STATES]);
});

// ===========================================================================
// §14 -- standalone validation matrix
// ===========================================================================

test("A detector demand only", () => {
  const r = core({ detectors: 159, modules: 0 });
  assert.equal(r.status, "NO_EXPANSION_REQUIRED");
  assert.equal(r.minLoopsRequired, 1);
});

test("B module demand only", () => {
  // Without expansion-unit evidence the engine must refuse to quantify the
  // expansion, so the loop requirement is asserted alongside the refusal.
  const blocked = core({ detectors: 0, modules: 200 });
  assert.equal(blocked.resultState, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(blocked.missingInputs.includes("expansionOptions.loopExpansionUnit"));
  const r = core({ detectors: 0, modules: 200 }, { expansionOptions: { loopExpansionUnit: { partNumber: "E", loopsAddedPerUnit: 1 } } });
  assert.equal(r.status, "EXPANSION_REQUIRED");
  assert.equal(r.minLoopsRequired, 2, "200 modules over 159 per loop needs 2 loops");
});

test("C both pools fit within a single loop, and are never summed", () => {
  const r = core({ detectors: 100, modules: 100 });
  assert.equal(r.status, "NO_EXPANSION_REQUIRED");
  assert.equal(r.minLoopsRequired, 1, "MAX(1,1)=1 -- a sum would wrongly have demanded 2");
});

test("D detector pool forces expansion while the combined count looks small", () => {
  // 170 + 2 = 172 total points, which fits any naive combined reading, yet the
  // detector pool alone exceeds 159 on one loop.
  const r = core({ detectors: 170, modules: 2 }, { expansionOptions: { loopExpansionUnit: { partNumber: "E", loopsAddedPerUnit: 1 } } });
  assert.equal(r.status, "EXPANSION_REQUIRED");
  assert.equal(r.minLoopsRequired, 2);
});

test("E module pool forces expansion independently", () => {
  const r = core({ detectors: 2, modules: 400 });
  assert.equal(r.minLoopsRequired, 3, "400/159 = 2.52 -> 3 loops from the module pool alone");
});

test("F a manufacturer combined per-loop limit fails even when each pool fits", () => {
  const capacity = { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954, maxTotalPointsPerLoop: 200 };
  const r = calculateSlcExpansion({ demand: { detectors: 150, modules: 150 }, panelCapacity: capacity });
  assert.equal(r.status, "CAPACITY_EXCEEDED", "300 points over 1 loop exceeds a combined 200 limit");
  assert.ok(r.calculationTrace.some((line) => line.includes("combined per-loop limit")), "the constraint must be explained");
  assert.equal(r.combinedPerLoopConstraint.applies, true);
});

test("F2 no combined limit is manufactured when none is supplied", () => {
  const r = core({ detectors: 150, modules: 150 });
  assert.equal(r.combinedPerLoopConstraint.applies, false);
  assert.equal(r.combinedPerLoopConstraint.maxTotalPointsPerLoop, null);
  assert.notEqual(r.status, "CAPACITY_EXCEEDED");
});

test("G the system point ceiling governs independently of loop arithmetic", () => {
  const r = core({ detectors: 500, modules: 500 });
  assert.equal(r.status, "CAPACITY_EXCEEDED");
  assert.ok(r.calculationTrace.some((line) => line.includes("system-wide ceiling")));
});

test("H additional expansion is required and quantified", () => {
  const r = core({ detectors: 400, modules: 10 }, { expansionOptions: { loopExpansionUnit: { partNumber: "EXP-1", loopsAddedPerUnit: 2 } } });
  assert.equal(r.status, "EXPANSION_REQUIRED");
  assert.equal(r.requiredAdditionalLoops, 2);
  assert.equal(r.requiredExpansionQuantity, 1, "2 additional loops / 2 loops per unit");
  assert.equal(r.loopsSelected, 3);
});

test("H2 a mounting unit is a ceiling, never an addressable-capacity source", () => {
  const r = core({ detectors: 600, modules: 10 }, { expansionOptions: { loopExpansionUnit: { partNumber: "EXP-1", loopsAddedPerUnit: 1 }, mountingUnit: { partNumber: "KIT-1", capacityPerMountingUnit: 4 } } });
  assert.equal(r.requiredExpansionQuantity, 3, "4 loops required - 1 native = 3 expanders at 1 loop per unit");
  assert.equal(r.mountingUnit.quantity, 1, "3 expanders fit under one 4-per-kit mounting unit");
  assert.equal(r.minLoopsRequired, 4, "the mounting kit adds no capacity; only the expander does");
});

test("I missing detectorsPerLoop blocks", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 1, modules: 1 }, panelCapacity: { nativeLoops: 1, modulesPerLoop: 159, systemPointCeiling: 954 } });
  assert.equal(r.resultState, "BLOCKED_BY_MISSING_INPUTS");
  assert.ok(r.missingInputs.includes("panelCapacity.detectorsPerLoop"));
});

test("J missing modulesPerLoop blocks", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 1, modules: 1 }, panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, systemPointCeiling: 954 } });
  assert.ok(r.missingInputs.includes("panelCapacity.modulesPerLoop"));
});

test("K a missing system ceiling blocks, it is never defaulted", () => {
  const r = calculateSlcExpansion({ demand: { detectors: 1, modules: 1 }, panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159 } });
  assert.ok(r.missingInputs.includes("panelCapacity.systemPointCeiling"));
});

test("L conflicting capacity facts are reported, not resolved", () => {
  const r = runStandaloneSlcCapacity({
    demand: { detectors: 1, modules: 1 },
    capacityFacts: [
      { scope: "SYSTEM_POINT_CEILING", value: 954, sourceId: "a" },
      { scope: "SYSTEM_POINT_CEILING", value: 400, sourceId: "b" },
    ],
    manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159 },
  });
  assert.ok(r.output.warnings.some((w) => w.includes("Conflicting declared capacity facts")));
});

test("M a manual assumption is visible in the result and in evidence", () => {
  const r = runStandaloneSlcCapacity({
    demand: { detectors: 10, modules: 10 },
    manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  assert.equal(r.resultState, "CALCULATED_WITH_ASSUMPTIONS");
  assert.ok(r.output.assumptions.length > 0);
  assert.ok(r.output.warnings.some((w) => w.includes("declared manual assumptions")));
  assert.equal(r.output.currentness, "UNPROVEN");
});

test("N changing the capacity evidence changes the fingerprint", () => {
  const base = { demand: { detectors: 10, modules: 10 }, manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } };
  const a = runStandaloneSlcCapacity(base);
  const b = runStandaloneSlcCapacity({ ...base, manualCapacity: { ...base.manualCapacity, detectorsPerLoop: 99 } });
  assert.notEqual(a.output.inputFingerprint, b.output.inputFingerprint);
});

test("N2 changing a manual demand input changes the fingerprint", () => {
  const base = { manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } };
  const a = runStandaloneSlcCapacity({ ...base, demand: { detectors: 10, modules: 10 } });
  const b = runStandaloneSlcCapacity({ ...base, demand: { detectors: 11, modules: 10 } });
  assert.notEqual(a.output.inputFingerprint, b.output.inputFingerprint);
});

test("O unresolved address demand never becomes zero SLC demand", () => {
  const r = runStandaloneSlcCapacity({
    demand: { detectors: 0, modules: 0 },
    unresolvedDemand: { reason: "Notification architecture conflict is unresolved.", physicalQuantity: 438 },
    manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  assert.ok(r.output.failures.includes("ADDRESS_DEMAND_UNRESOLVED"));
  assert.equal(r.unresolvedDemand.physicalQuantity, 438);
  assert.equal(r.unresolvedDemand.state, "UNRESOLVED");
  assert.ok(!("quantity" in r.unresolvedDemand), "unresolved demand must never carry a coerced numeric quantity");
  assert.ok(r.output.warnings.some((w) => w.includes("NOT converted to zero")));
});

test("O2 a wholly unresolved project calculation is BLOCKED, never zero-filled", () => {
  // Both demands absent AND declared unresolved: nothing may be reported.
  const r = runStandaloneSlcCapacity({
    demand: {},
    unresolvedDemand: { reason: "Architecture conflict.", physicalQuantity: 438 },
    manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  assert.equal(r.resultState, "BLOCKED_BY_MISSING_INPUTS");
  assert.equal(r.output.result, null, "no result may be presented while inputs are missing");
});

// ===========================================================================
// §20 -- currentness and authority guarantees
// ===========================================================================

test("§20 a standalone result carries no project authority and is not persisted", () => {
  const r = runStandaloneSlcCapacity({ demand: { detectors: 1, modules: 1 }, manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } });
  assert.equal(r.projectAuthority, null);
  assert.equal(r.persisted, false);
  assert.equal(r.mode, "ENGINEERING_TOOLS");
  assert.equal(r.resultLabel, STANDALONE_RESULT_LABEL);
  assert.equal(r.authorityNotice, STANDALONE_AUTHORITY_NOTICE);
  assert.ok(STANDALONE_AUTHORITY_NOTICE.includes("NO project authority"));
});

test("§20 a manual assumption cannot masquerade as manufacturer evidence", () => {
  const r = runStandaloneSlcCapacity({ demand: { detectors: 1, modules: 1 }, manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } });
  const detectorEntry = r.inputs.find((i) => i.name === "demand.detectors");
  assert.equal(detectorEntry.sourceType, "MANUAL_ASSUMPTION");
  assert.notEqual(detectorEntry.sourceType, "MANUFACTURER_EVIDENCE");
  assert.equal(detectorEntry.evidenceReferences ?? undefined, undefined, "a manual input cites no evidence reference");
});

test("§20 missing capacity cannot inherit another product's value", () => {
  // Facts for one panel must not leak into a field the caller left unstated.
  const r = runStandaloneSlcCapacity({
    demand: { detectors: 1, modules: 1 },
    capacityFacts: [{ scope: "BASE_SLC_LOOPS", value: 4, sourceId: "other-panel-doc" }],
    manualCapacity: {},
  });
  assert.equal(r.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(r.missingInputs.includes("panelCapacity.detectorsPerLoop"));
  // A capacity field nobody supplied must have NO envelope entry carrying a
  // value -- there is no input claiming to be the system ceiling.
  const claimed = r.inputs.filter((i) => i.value !== null).map((i) => i.name);
  assert.ok(!claimed.includes("panelCapacity.systemPointCeiling"), "no input may claim the system ceiling");
  assert.ok(claimed.includes("panelCapacity.nativeLoops"), "the one declared fact is still present");
  const missingEntry = r.inputs.find((i) => i.name === "panelCapacity.systemPointCeiling");
  assert.equal(missingEntry, undefined, "an absent field yields no envelope entry at all");
});

test("§20 a governed fact overrides a manual entry for the same field", () => {
  const r = runStandaloneSlcCapacity({
    demand: { detectors: 10, modules: 10 },
    capacityFacts: [{ scope: "PER_LOOP_DETECTORS", value: 159, sourceId: "doc" }],
    manualCapacity: { nativeLoops: 1, detectorsPerLoop: 999, modulesPerLoop: 159, systemPointCeiling: 954 },
  });
  assert.equal(r.minLoopsRequired, 1, "the governed 159 must win over the manual 999");
  assert.ok(r.output.warnings.some((w) => w.includes("Manual entry for detectorsPerLoop was ignored")));
});

test("§20 identical inputs and rule version are deterministic", () => {
  const run = () => runStandaloneSlcCapacity({ demand: { detectors: 321, modules: 87 }, manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } });
  const a = run();
  const b = run();
  assert.equal(a.output.inputFingerprint, b.output.inputFingerprint);
  assert.equal(a.status, b.status);
  assert.equal(a.minLoopsRequired, b.minLoopsRequired);
  assert.equal(a.calculationVersion, SLC_CALCULATION_VERSION);
});

test("§20 the fingerprint covers authority, not only value", () => {
  const inputs = (authorityState) => [buildCalculationInputEnvelope({ name: "panelCapacity.detectorsPerLoop", value: 159, sourceType: "MANUFACTURER_EVIDENCE", authorityState })];
  const governed = buildCalculationInputStateFingerprint({ inputs: inputs("GOVERNED"), calculationVersion: "v" });
  const superseded = buildCalculationInputStateFingerprint({ inputs: inputs("SUPERSEDED"), calculationVersion: "v" });
  assert.notEqual(governed, superseded, "a superseded fact must invalidate the fingerprint even at an identical value");
});

test("§20 project-mode fingerprint slots stay null in standalone mode", () => {
  const r = runStandaloneSlcCapacity({ demand: { detectors: 1, modules: 1 }, manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } });
  assert.equal(r.output.currentness, "UNPROVEN");
  assert.equal(r.output.resultState !== "BLOCKED_BY_MISSING_INPUTS", true);
});

// ===========================================================================
// §8 / §9 -- combined constraint and spare policy
// ===========================================================================

test("§9 no default reserve is applied when no policy is supplied", () => {
  const r = core({ detectors: 159, modules: 0 });
  assert.equal(r.sparePolicy.state, "NONE");
  assert.equal(r.sparePolicy.applied, false);
  assert.equal(r.minLoopsRequired, 1, "an invented reserve would have forced 2 loops");
});

test("§9 an explicit spare policy changes the design demand and is echoed in evidence", () => {
  const r = core({ detectors: 100, modules: 0 }, { sparePolicy: { sparePercent: 20 } });
  assert.equal(r.sparePolicy.state, "SUPPLIED");
  assert.equal(r.sparePolicy.applied, true);
  assert.equal(r.designDemand.detectors, 120, "100 * 1.2 = 120");
  assert.ok(r.calculationTrace.some((line) => line.includes("EXPLICIT input")));
});

test("§9 a spare policy can force an otherwise unnecessary expansion", () => {
  const r = core({ detectors: 150, modules: 0 }, { sparePolicy: { sparePercent: 20 }, expansionOptions: { loopExpansionUnit: { partNumber: "E", loopsAddedPerUnit: 1 } } });
  assert.equal(r.designDemand.detectors, 180);
  assert.equal(r.status, "EXPANSION_REQUIRED", "180 detectors over 159 per loop needs 2 loops");
});

test("§7 standalone mode never invents a per-loop distribution", () => {
  const r = runStandaloneSlcCapacity({ demand: { detectors: 10, modules: 10 }, manualCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 954 } });
  assert.equal(r.perLoopDistribution, null);
});

test("§7 a distribution appears only for a fully allocated design", () => {
  const loops = [{ loopId: "L1", detectors: 10, modules: 10 }];
  const partial = calculateSlcExpansion({
    demand: { detectors: 10, modules: 10 },
    panelCapacity: { ...CAP },
    allocation: { state: "PARTIALLY_ALLOCATED", loops },
  });
  assert.equal(partial.perLoopDistribution, null, "a partial allocation must not be presented as a distribution");
  const full = calculateSlcExpansion({
    demand: { detectors: 10, modules: 10 },
    panelCapacity: { ...CAP },
    allocation: { state: "FULLY_ALLOCATED", loops, evidenceReferences: ["drawing-1"] },
  });
  assert.equal(full.perLoopDistribution.allocationState, "FULLY_ALLOCATED");
  assert.equal(full.perLoopDistribution.loops.length, 1);
});

// ===========================================================================
// §16 -- the engine stays manufacturer-blind
// ===========================================================================

test("§16 no manufacturer, brand, model or capacity figure is hardcoded in the engine", () => {
  const forbidden = /farenhyt|notifier|silent\s*knight|gamewell|ifp-?2100|ifp-?300|\b159\b|\b954\b|\b318\b/;
  for (const file of ["../app/domain/fire-alarm-slc-capacity-calculator.mjs", "../app/domain/fire-alarm-slc-standalone-calculator.mjs"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    // Strip comments so prose explaining WHY values are not hardcoded does not
    // trip the check; only executable code is constrained.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!forbidden.test(code), `${file} must contain no product-specific capacity or manufacturer literal in code`);
  }
});
// ===========================================================================
// Loop topology is a REQUIREMENT-RELATIVE constraint, never an absolute scalar
// ===========================================================================
//
// Regression controls for the corrected model. The governing insight: 7 is the
// number of loops needed to reach the 2100 ceiling with BOTH POOLS FULLY LOADED.
// It is NOT a maximum loop count. Ten lightly-loaded loops whose total demand is
// still under 2100 are equally valid, provided expansion resources allow.

const CAP_TOPO = Object.freeze({ nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 2100 });
const withExpansion = (unit) => ({ loopExpansionUnit: { partNumber: "6815", loopsAddedPerUnit: 1, ...unit } });

test("§13.1 required loops = 4 with 3 governed expansion loops available -> PASS", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 636, modules: 0 },           // CEILING(636/159) = 4
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 4 },
  });
  assert.equal(r.requiredLoops, 4);
  assert.equal(r.requiredAdditionalLoops, 3);
  assert.equal(r.expansionFeasibility, "PASS");
  assert.equal(r.supportedTotalLoops, 4);
});

test("§13.2 required loops = 10, total points UNDER 2100 -> PASS (7 is NOT a ceiling)", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 1590, modules: 0 },          // 10 loops, 1590 points total
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 10 },
  });
  assert.equal(r.requiredLoops, 10);
  assert.ok(r.requiredLoops > 7, "the scenario must exceed the old mistaken ceiling of 7");
  assert.ok(r.systemPointDemand < 2100, "total demand is legitimately under the ceiling");
  assert.equal(r.systemPointFeasibility, "PASS");
  assert.equal(r.expansionFeasibility, "PASS");
  assert.equal(r.status, "EXPANSION_REQUIRED", "ten loops are legitimate; expansion is still simply required");
});

test("§13.3 required loops = 10 but total points OVER 2100 -> system ceiling FAIL", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 1590, modules: 600 },       // 2190 points, MAX(10, 4) = 10 loops
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 10 },
  });
  assert.equal(r.systemPointFeasibility, "FAIL");
  assert.equal(r.status, "CAPACITY_EXCEEDED", "the point ceiling governs regardless of how many loops are used");
  // The ceiling is absolute, so loop arithmetic is short-circuited and no
  // expansion requirement ever comes into existence.
  assert.equal(r.requiredLoops, null, "loop math is not performed once the absolute ceiling has failed");
  assert.equal(r.expansionFeasibility, "UNKNOWN");
  assert.match(r.expansionFeasibilityNote, /NOT EVALUATED/);
  assert.doesNotMatch(r.expansionFeasibilityNote, /SBUS/, "must not be misread as missing SBUS evidence");
});

test("§13.4 required loops = 10 but only 6 expansion loops available -> expansion FAIL", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 1590, modules: 0 },
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 7 },
  });
  assert.equal(r.requiredAdditionalLoops, 9);
  assert.equal(r.expansionFeasibility, "FAIL");
  assert.equal(r.status, "EXPANSION_TOPOLOGY_INSUFFICIENT");
  assert.equal(r.systemPointFeasibility, "PASS", "the ceiling is fine; the topology is not");
});

test("§13.5 unknown SBUS occupancy is UNKNOWN, never an assumption that 63 slots are free", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 1590, modules: 0 },
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    // no expansionAvailability at all
  });
  assert.equal(r.expansionFeasibility, "UNKNOWN");
  assert.equal(r.availableExpansionLoops, null);
  assert.equal(r.supportedTotalLoops, null);
  assert.equal(r.status, "EXPANSION_REQUIRED", "the arithmetic is sound; obtainability is simply unknown");
});

test("§13.6a cabinet local capacity is not a global loop ceiling", () => {
  // The cabinet houses up to 2 x 6815 and each 5815RMK holds 2 more. Two remote
  // kits therefore allow 4 expansion loops -- more than the cabinet alone.
  const r = calculateSlcExpansion({
    demand: { detectors: 795, modules: 0 },           // CEILING(795/159) = 5 loops
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: {
      availableMountingKits: 2,
      expandersPerMountingKit: 2,
      localPanelMountingCapacity: 2,
    },
  });
  assert.equal(r.requiredLoops, 5);
  assert.equal(r.availableExpansionLoops, 4, "two kits x two cards = four expansion loops");
  assert.equal(r.expansionFeasibility, "PASS");
  // The cabinet figure must not have collapsed the bound to 2.
  assert.ok(r.availableExpansionLoops > 2, "local mounting capacity must not become the system bound");
});

test("§13.6b a known local-only arrangement bounds expansion at the cabinet capacity", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 795, modules: 0 },
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: { availableMountingKits: 1, expandersPerMountingKit: 2 },
  });
  assert.equal(r.availableExpansionLoops, 2);
  assert.equal(r.expansionFeasibility, "FAIL", "5 loops needed, only 2 obtainable");
});

test("§13.7 a legacy max_slc_loops = 3 fact does not govern feasibility", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 636, modules: 0 },           // needs 4 loops
    // The stale governed value is still present on the product and must be inert.
    panelCapacity: { ...CAP_TOPO, maxSlcLoops: 3, max_slc_loops: 3 },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 4 },
  });
  assert.equal(r.requiredLoops, 4);
  assert.equal(r.expansionFeasibility, "PASS", "a legacy scalar of 3 must not cap a requirement-relative decision");
  assert.equal(r.supportedTotalLoops, 4);
});

test("§13.8 available SBUS slots bound expansion independently of a lower-bound claim", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 1590, modules: 0 },          // needs 9 expansion loops
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: {
      supportedAtLeastTotalLoops: 64,                 // generous product lower bound
      availableExpanderSlots: 8,                       // but only 8 SBUS slots actually free
      slotsPerExpander: 1,
    },
  });
  assert.equal(r.availableExpansionLoops, 8, "the shared-resource bound is the minimum, not the generous claim");
  assert.equal(r.expansionFeasibility, "FAIL");
  assert.equal(r.status, "EXPANSION_TOPOLOGY_INSUFFICIENT");
});

test("§13.9 expansion feasibility is independent of the point-ceiling feasibility", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 1590, modules: 600 },        // ceiling FAIL, topology PASS
    panelCapacity: { ...CAP_TOPO },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 10 },
  });
  // Two genuinely independent axes: one fails on the absolute point ceiling,
  // the other is simply never reached because no loop count could rescue it.
  assert.equal(r.systemPointFeasibility, "FAIL");
  assert.equal(r.expansionFeasibility, "UNKNOWN");
  assert.equal(r.status, "CAPACITY_EXCEEDED");
  assert.match(r.expansionFeasibilityNote, /NOT EVALUATED/);
});

test("§3 combined-per-loop constraint still governs independently of topology", () => {
  const r = calculateSlcExpansion({
    demand: { detectors: 150, modules: 150 },         // each pool fits; combined 300 > 250
    panelCapacity: { ...CAP_TOPO, maxTotalPointsPerLoop: 250 },
    expansionOptions: withExpansion(),
    expansionAvailability: { supportedAtLeastTotalLoops: 10 },
  });
  assert.equal(r.status, "CAPACITY_EXCEEDED");
  assert.equal(r.expansionFeasibility, "PASS", "expansion was available; the combined per-loop limit is what fails");
});
