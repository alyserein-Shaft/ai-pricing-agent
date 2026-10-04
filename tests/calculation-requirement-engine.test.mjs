import test from "node:test";
import assert from "node:assert/strict";
import { isDerivedEvidenceComplete, resolveCrossDomainConflict } from "../app/domain/evidence-authority-policy.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import {
  CALCULATION_STATES,
  CALCULATION_TYPES,
  CALCULATION_LABELS,
  CALCULATION_RESULTS,
  isCalculationState,
  calculationApplicabilityFor,
  evaluateCalculationRequirement,
  buildDerivedCalculationEvidence,
  isCompleteTrace,
  isCalculationStale,
  describeCalculation,
  describeMissingInputs,
  feedCalculationsIntoEnvelope,
  CALCULATION_ENGINE_VERSION,
} from "../app/domain/calculation-requirement-engine.mjs";

const input = (name, value, unit = null, source = null) => ({ name, value, unit, source });

// ---------------------------------------------------------------------------
// State model + applicability (4B-1/4B-4).
// ---------------------------------------------------------------------------
test("the eight calculation states are canonical and validated", () => {
  assert.deepEqual(CALCULATION_STATES, ["NOT_REQUIRED", "REQUIRED", "REQUIRED_BUT_INPUTS_MISSING", "READY_TO_CALCULATE", "CALCULATED_PASS", "CALCULATED_FAIL", "CALCULATION_CONFLICT", "ENGINEER_REVIEW_REQUIRED"]);
  for (const state of CALCULATION_STATES) assert.equal(isCalculationState(state), true);
  assert.equal(isCalculationState("GUESSED"), false);
  assert.equal(CALCULATION_ENGINE_VERSION, "calculation-requirement-engine-1.0.0");
});

test("calculation types and labels are governed and enumerated", () => {
  assert.ok(CALCULATION_TYPES.includes("slc.loop-and-expansion"));
  assert.ok(CALCULATION_TYPES.includes("cctv.storage-retention"));
  assert.ok(CALCULATION_TYPES.includes("power.runtime"));
  for (const type of CALCULATION_TYPES) assert.ok(CALCULATION_LABELS[type], `missing label for ${type}`);
  assert.deepEqual(CALCULATION_RESULTS, ["PASS", "FAIL", "CONFLICT", "UNKNOWN"]);
});

test("applicability is domain-specific: FACP families require capacity calculations, unrelated packs do not", () => {
  const facp = calculationApplicabilityFor({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel" });
  assert.equal(facp.applicable, true);
  assert.deepEqual(facp.calculationTypes, ["slc.loop-and-expansion", "battery.standby-alarm", "network.node-capacity"]);
  // An addressable smoke detector is demand-side -- it must NOT independently
  // trigger a panel capacity calculation (the panel owns the calculation).
  const detector = calculationApplicabilityFor({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Addressable Smoke Detector" });
  assert.equal(detector.applicable, false);
  // No Fire Alarm calculation leaks into CCTV / UPS / unknown systems.
  assert.equal(calculationApplicabilityFor({ calculationType: "slc.loop-and-expansion", system: "CCTV", family: "Recorder" }).applicable, false);
  assert.equal(calculationApplicabilityFor({ calculationType: "slc.loop-and-expansion", system: "UPS", family: "Uninterruptible Power Supply Unit" }).applicable, false);
  assert.equal(calculationApplicabilityFor({ calculationType: "slc.loop-and-expansion", system: "Plumbing", family: "Boiler" }).applicable, false);
  const storage = calculationApplicabilityFor({ calculationType: "cctv.storage-retention", system: "CCTV", family: "NVR / Storage" });
  assert.equal(storage.applicable, true);
  const ups = calculationApplicabilityFor({ calculationType: "power.runtime", system: "UPS", family: "UPS Unit" });
  assert.equal(ups.applicable, true);
});

// ---------------------------------------------------------------------------
// Orchestrator transitions.
// ---------------------------------------------------------------------------
test("applicable with no inputs -> REQUIRED, listing the required schema inputs", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel" });
  assert.equal(result.state, "REQUIRED");
  assert.equal(result.blocking, false);
  assert.ok(result.missingInputs.includes("demand.detectors"));
  assert.ok(result.missingInputs.includes("panelCapacity.systemPointCeiling"));
});

test("unknown calculation type fails closed to ENGINEER_REVIEW_REQUIRED", () => {
  const result = evaluateCalculationRequirement({ calculationType: "antimatter.sizing", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: [] });
  assert.equal(result.state, "ENGINEER_REVIEW_REQUIRED");
  assert.equal(result.blocking, true);
});

test("contradictory capacity requirement evidence -> CALCULATION_CONFLICT before any math runs", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: [], requirementConflict: true });
  assert.equal(result.state, "CALCULATION_CONFLICT");
  assert.equal(result.blocking, true);
  assert.equal(result.result, "CONFLICT");
});

// ---------------------------------------------------------------------------
// SLC loop / expansion rule (wraps the verified calculator).
// ---------------------------------------------------------------------------
const slcInputs = (overrides = {}) => [
  input("demand.detectors", overrides.detectors ?? 185, "count", { factId: "fact-ck-bom" }),
  input("demand.modules", overrides.modules ?? 82, "count", { factId: "fact-ck-bom" }),
  input("panelCapacity.nativeLoops", overrides.nativeLoops ?? 1, "count", { documentId: "ds-panel" }),
  input("panelCapacity.detectorsPerLoop", overrides.detectorsPerLoop ?? 189, "count", { documentId: "ds-panel" }),
  input("panelCapacity.modulesPerLoop", overrides.modulesPerLoop ?? 189, "count", { documentId: "ds-panel" }),
  input("panelCapacity.systemPointCeiling", overrides.ceiling ?? 378, "count", { documentId: "ds-panel" }),
  input("expansionOptions.loopExpansionUnit.partNumber", overrides.expansionPart ?? null, "id"),
  input("expansionOptions.loopExpansionUnit.loopsAddedPerUnit", overrides.loopsAdded ?? null, "count"),
  input("expansionOptions.mountingUnit.partNumber", overrides.mountPart ?? null, "id"),
  input("expansionOptions.mountingUnit.capacityPerMountingUnit", overrides.mountCapacity ?? null, "count"),
];

test("SLC: demand fits native capacity -> CALCULATED_PASS with correct headroom", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs(), performedAt: "2026-09-19T00:00:00.000Z" });
  assert.equal(result.state, "CALCULATED_PASS");
  assert.equal(result.blocking, false);
  assert.equal(result.result, "PASS");
  assert.equal(result.output.status, "NO_EXPANSION_REQUIRED");
  assert.equal(result.headroom.detectors, 189 - 185);
  assert.equal(result.headroom.modules, 189 - 82);
  assert.equal(result.expansionRequired, null);
  assert.ok(result.evidence, "a completed calculation must produce DERIVED evidence");
  assert.equal(isCompleteTrace(result.evidence), true);
});

test("SLC: demand beyond native loops -> sized expansion, still structurally PASS", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs({ detectors: 400, modules: 100, ceiling: 500, expansionPart: "6815", loopsAdded: 2 }), performedAt: "2026-09-19T00:00:00.000Z" });
  assert.equal(result.state, "CALCULATED_PASS");
  assert.equal(result.output.status, "EXPANSION_REQUIRED");
  assert.equal(result.output.requiredAdditionalLoops, 2);
  assert.equal(result.expansionRequired.requiredQuantity, 1);
  assert.equal(result.expansionRequired.expansionPartNumber, "6815");
});

test("SLC: demand exceeding the verified system-wide ceiling -> CALCULATED_FAIL (blocking)", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs({ detectors: 600, ceiling: 500 }) });
  assert.equal(result.state, "CALCULATED_FAIL");
  assert.equal(result.blocking, true);
  assert.equal(result.result, "FAIL");
  assert.equal(result.output.status, "CAPACITY_EXCEEDED");
});

test("SLC: contradictory evidence (demand + zero pool capacity) -> CALCULATION_CONFLICT", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs({ detectorsPerLoop: 0 }) });
  assert.equal(result.state, "CALCULATION_CONFLICT");
  assert.equal(result.blocking, true);
});

test("never fabricate missing capacity evidence: missing panel capacity -> REQUIRED_BUT_INPUTS_MISSING", () => {
  const incomplete = [input("demand.detectors", 185, "count"), input("demand.modules", 82, "count")];
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: incomplete });
  assert.equal(result.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.equal(result.blocking, true);
  assert.ok(result.missingInputs.includes("panelCapacity.nativeLoops"));
  assert.ok(result.missingInputs.includes("panelCapacity.systemPointCeiling"));
  assert.equal(result.evidence, null, "no evidence may be produced from a refused calculation");
});

// ---------------------------------------------------------------------------
// Battery: governed currents only, never fabricated.
// ---------------------------------------------------------------------------
test("battery standby-alarm sizing: complete governed inputs produce the Ah calculation", () => {
  const result = evaluateCalculationRequirement({
    calculationType: "battery.standby-alarm",
    system: "Fire Alarm",
    family: "Fire Alarm Control Panel",
    inputs: [input("standbyCurrent", 0.5, "A", { documentId: "ds-panel" }), input("alarmCurrent", 1.5, "A", { documentId: "ds-panel" }), input("standbyHours", 24, "h", { sourceType: "Code" }), input("alarmMinutes", 5, "min", { sourceType: "Code" }), input("deratingFactor", 1.25, "ratio", { sourceType: "Code" })],
  });
  assert.equal(result.state, "CALCULATED_PASS");
  // standby = 0.5 * 24 = 12 Ah; alarm = 1.5 * 5/60 = 0.125 Ah.
  // The two demands are CUMULATIVE -- the battery serves standby and THEN alarm
  // (manufacturer worksheet line J: "Add lines G and I") -- so the pre-derating
  // total is 12.125 Ah and 12.125 * 1.25 = 15.15625 Ah -> 15.16 Ah at the
  // engine's 2dp contract. The superseded MAX reading returned 15 Ah.
  assert.equal(result.output.standbyAh, 12);
  assert.equal(result.output.alarmAh, 0.13);
  assert.equal(result.output.totalAhBeforeDerating, 12.13);
  assert.equal(result.output.requiredAh, 15.16);
  assert.notEqual(result.output.requiredAh, 15, "the superseded MAX reading must not come back");
  assert.equal(result.output.governingDuration, "standby", "retained as the larger of two cumulative demands");
});

// REGRESSION for the P0 arithmetic-authority defect: the MAX reading understated
// battery demand. This pins the exact figures named in the repair brief.
test("battery standby-alarm sizing: demands are SUMMED, so 15 Ah standby + 0.156 Ah alarm yields 15.156 Ah, never 15", () => {
  // 0.625 A x 24 h = 15 Ah exactly; 1.872 A x (5/60) h = 0.156 Ah exactly.
  const result = evaluateCalculationRequirement({
    calculationType: "battery.standby-alarm",
    system: "Fire Alarm",
    family: "Fire Alarm Control Panel",
    inputs: [input("standbyCurrent", 0.625, "A", { documentId: "ds-panel" }), input("alarmCurrent", 1.872, "A", { documentId: "ds-panel" }), input("standbyHours", 24, "h", { sourceType: "Code" }), input("alarmMinutes", 5, "min", { sourceType: "Code" }), input("deratingFactor", 1.25, "ratio", { sourceType: "Code" })],
  });
  assert.equal(result.state, "CALCULATED_PASS");
  assert.equal(result.output.standbyAh, 15);
  assert.equal(result.output.alarmAh, 0.16);
  // 15 + 0.156 = 15.156 Ah pre-derating. The engine publishes 2dp, hence 15.16.
  assert.equal(result.output.totalAhBeforeDerating, 15.16);
  assert.notEqual(result.output.totalAhBeforeDerating, 15, "the alarm demand must not be discarded by a MAX reading");
  // Derating applied EXACTLY ONCE to the sum: 15.156 * 1.25 = 18.945 Ah.
  assert.equal(result.output.requiredAh, 18.95);
  assert.notEqual(result.output.requiredAh, 15 * 1.25, "derating must not be applied to only the larger term");
  assert.notEqual(result.output.requiredAh, 18.945 * 1.25, "derating must not be applied twice");
});

test("battery: derating is applied once and only once to the summed demand", () => {
  const run = (factor) => evaluateCalculationRequirement({
    calculationType: "battery.standby-alarm",
    system: "Fire Alarm",
    family: "Fire Alarm Control Panel",
    inputs: [input("standbyCurrent", 0.625, "A", { documentId: "ds-panel" }), input("alarmCurrent", 1.872, "A", { documentId: "ds-panel" }), input("standbyHours", 24, "h", { sourceType: "Code" }), input("alarmMinutes", 5, "min", { sourceType: "Code" }), input("deratingFactor", factor, "ratio", { sourceType: "Code" })],
  });
  const once = run(1.25);
  const doubled = run(1.5625); // 1.25 * 1.25
  assert.equal(once.output.totalAhBeforeDerating, doubled.output.totalAhBeforeDerating, "pre-derating demand is factor-independent");
  assert.ok(once.output.requiredAh < doubled.output.requiredAh, "a larger factor must increase demand");
  // Exactly linear in the factor, applied once.
  assert.equal(once.output.requiredAh, Math.round(15.156 * 1.25 * 100) / 100);
  // 1.0 proves no hidden factor is baked in anywhere.
  assert.equal(run(1).output.requiredAh, 15.16);
});

test("battery: missing governing currents -> REQUIRED_BUT_INPUTS_MISSING; currents are never invented", () => {
  const result = evaluateCalculationRequirement({
    calculationType: "battery.standby-alarm",
    system: "Fire Alarm",
    family: "Fire Alarm Control Panel",
    inputs: [input("standbyHours", 24, "h"), input("alarmMinutes", 5, "min"), input("deratingFactor", 1.25, "ratio")],
  });
  assert.equal(result.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.ok(result.missingInputs.includes("standbyCurrent"));
  assert.ok(result.missingInputs.includes("alarmCurrent"));
});

// ---------------------------------------------------------------------------
// NAC / network rules.
// ---------------------------------------------------------------------------
test("NAC loading: total alarm load exceeding circuit ampacity -> CALCULATED_FAIL (blocking)", () => {
  const pass = evaluateCalculationRequirement({
    calculationType: "power.nac-load",
    system: "Fire Alarm",
    family: "NAC Power Supply",
    inputs: [input("nacAmpacity", 3, "A", { documentId: "ds-nac" }), input("deviceLoads", [{ name: "Horn/Strobe", current: 0.25, quantity: 8 }, { name: "Horn/Strobe", current: 0.5, quantity: 2 }], "A (sum)", { documentId: "ds-horn" })],
  });
  assert.equal(pass.state, "CALCULATED_PASS");
  assert.equal(pass.output.totalAlarmCurrent, 3);
  const fail = evaluateCalculationRequirement({
    calculationType: "power.nac-load",
    system: "Fire Alarm",
    family: "NAC Power Supply",
    inputs: [input("nacAmpacity", 3, "A", { documentId: "ds-nac" }), input("deviceLoads", [{ name: "Horn/Strobe", current: 0.5, quantity: 10 }], "A (sum)", { documentId: "ds-horn" })],
  });
  assert.equal(fail.state, "CALCULATED_FAIL");
  assert.equal(fail.blocking, true);
});

test("network node capacity: node count above the governed maximum -> CALCULATED_FAIL", () => {
  const pass = evaluateCalculationRequirement({ calculationType: "network.node-capacity", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: [input("nodeCount", 6, "count", { documentId: "net-diagram" }), input("maxNetworkNodes", 16, "count", { documentId: "ds-panel" })] });
  assert.equal(pass.state, "CALCULATED_PASS");
  const fail = evaluateCalculationRequirement({ calculationType: "network.node-capacity", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: [input("nodeCount", 20, "count", { documentId: "net-diagram" }), input("maxNetworkNodes", 16, "count", { documentId: "ds-panel" })] });
  assert.equal(fail.state, "CALCULATED_FAIL");
});

// ---------------------------------------------------------------------------
// CCTV storage rule.
// ---------------------------------------------------------------------------
test("cctv storage retention rule reproduces the first-principles HDD count", () => {
  // 2MP, 25 FPS H.265+ ~2Mbps = 2_000_000 bit/s; 18 h/day, 90 days; 10 TB HDD.
  const result = evaluateCalculationRequirement({
    calculationType: "cctv.storage-retention",
    system: "CCTV",
    family: "NVR / Storage",
    inputs: [input("cameraCount", 213, "count", { documentId: "ck-quote" }), input("bitrateBitsPerSecond", 2_000_000, "bit/s", { documentId: "ck-quote" }), input("recordingHoursPerDay", 18, "h/day", { documentId: "ck-quote" }), input("retentionDays", 90, "days", { documentId: "ck-quote" }), input("hddCapacityBytes", 10_000_000_000_000, "bytes", { documentId: "ck-quote" })],
  });
  assert.equal(result.state, "CALCULATED_PASS");
  // 213 * 2e6 * 18 * 3600 * 90 / 8 = 213*2e6=4.26e8; *18=7.668e9; *3600=2.76048e13; *90=2.484432e15; /8=3.10554e14 bytes = 310.554 TB raw.
  assert.equal(result.state, "CALCULATED_PASS");
  assert.ok(result.output.recommendedHddCount >= 31, "2MP/18h/90d demand should require ~31 10TB HDDs");
});

test("cctv storage: missing retention days -> REQUIRED_BUT_INPUTS_MISSING", () => {
  const result = evaluateCalculationRequirement({
    calculationType: "cctv.storage-retention",
    system: "CCTV",
    family: "NVR / Storage",
    inputs: [input("cameraCount", 10, "count"), input("bitrateBitsPerSecond", 2_000_000, "bit/s"), input("recordingHoursPerDay", 18, "h/day"), input("hddCapacityBytes", 10_000_000_000_000, "bytes")],
  });
  assert.equal(result.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.ok(result.missingInputs.includes("retentionDays"));
});

// ---------------------------------------------------------------------------
// UPS runtime rule.
// ---------------------------------------------------------------------------
test("UPS runtime sizing passes when calculated runtime meets the requirement", () => {
  const pass = evaluateCalculationRequirement({
    calculationType: "power.runtime",
    system: "UPS",
    family: "UPS Unit",
    inputs: [input("batteryAh", 100, "Ah", { documentId: "ds-ups" }), input("systemVoltage", 48, "V", { documentId: "ds-ups" }), input("loadWatts", 800, "W", { documentId: "load-schedule" }), input("efficiency", 0.9, "ratio", { documentId: "ds-ups" }), input("requiredRuntimeHours", 4, "h", { sourceType: "Code" })],
  });
  // 100 * 48 * 0.9 / 800 = 5.4 h >= 4 h.
  assert.equal(pass.state, "CALCULATED_PASS");
  assert.equal(pass.output.runtimeHours, 5.4);
  const fail = evaluateCalculationRequirement({
    calculationType: "power.runtime",
    system: "UPS",
    family: "UPS Unit",
    inputs: [input("batteryAh", 60, "Ah", { documentId: "ds-ups" }), input("systemVoltage", 48, "V", { documentId: "ds-ups" }), input("loadWatts", 1500, "W", { documentId: "load-schedule" }), input("efficiency", 0.9, "ratio", { documentId: "ds-ups" }), input("requiredRuntimeHours", 4, "h", { sourceType: "Code" })],
  });
  // 60 * 48 * 0.9 / 1500 = 1.728 h < 4 h.
  assert.equal(fail.state, "CALCULATED_FAIL");
  assert.equal(fail.blocking, true);
});

// ---------------------------------------------------------------------------
// 4B-2 -- DERIVED evidence contract consumed by Stage 4A.
// ---------------------------------------------------------------------------
test("completed calculations produce DERIVED evidence that satisfies the Stage 4A contract", () => {
  const result = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs(), performedAt: "2026-09-19T00:00:00.000Z" });
  const derived = buildDerivedCalculationEvidence({ calculationType: result.calculationType, system: result.system, scope: { system: "Fire Alarm", family: "Fire Alarm Control Panel" }, rule: null, executed: { state: result.state, result: result.result, blocking: result.blocking, output: result.output, headroom: result.headroom, trace: result.trace }, inputs: slcInputs(), inputProvenance: null, performedAt: "2026-09-19T00:00:00.000Z" });
  assert.ok(derived);
  assert.equal(isDerivedEvidenceComplete(derived), true, "the derived evidence must pass evidence-authority-policy's completeness gate");
  assert.equal(isCompleteTrace(derived), true);
  assert.equal(derived.calculationType, "slc.loop-and-expansion");
  assert.equal(derived.dimension, "capacity");
  assert.equal(derived.result, "PASS");
  assert.equal(derived.blocking, false);
  assert.equal(derived.engine, CALCULATION_ENGINE_VERSION);
  assert.ok(derived.inputProvenance.length === derived.inputs.length, "provenance must be aligned 1:1 with inputs");
});

test("calculations are deterministic: identical inputs and provenance produce identical evidence", () => {
  const runOnce = () => evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs(), performedAt: "2026-09-19T00:00:00.000Z" });
  const first = runOnce();
  const second = runOnce();
  assert.deepEqual(first.evidence, second.evidence);
  assert.equal(first.output.status, second.output.status);
  assert.deepEqual(describeCalculation(first), describeCalculation(second));
});

// ---------------------------------------------------------------------------
// Staleness.
// ---------------------------------------------------------------------------
test("a calculation with no performedAt is unconfirmable (stale)", () => {
  assert.equal(isCalculationStale({ calculation: {} }).stale, true);
  assert.equal(isCalculationStale({}).stale, true);
});

test("requirement/product evidence version drift marks the calculation stale", () => {
  const calculation = { calculationType: "slc.loop-and-expansion", performedAt: "2026-09-19T00:00:00.000Z", inputFingerprint: { requirementProfileVersion: "profile-1", productEvidenceVersion: "evidence-1" } };
  assert.equal(isCalculationStale({ calculation, requirementProfileVersion: "profile-1" }).stale, false);
  assert.equal(isCalculationStale({ calculation, requirementProfileVersion: "profile-2" }).stale, true);
  assert.equal(isCalculationStale({ calculation, productEvidenceVersion: "evidence-2" }).stale, true);
  assert.equal(isCalculationStale({ calculation, requirementProfileVersion: "profile-2", productEvidenceVersion: "evidence-2" }).stale, true);
  assert.equal(isCalculationStale({ calculation: { ...calculation, inputFingerprint: null } }).stale, true);
});

// ---------------------------------------------------------------------------
// 4B-6 -- engineer-facing language.
// ---------------------------------------------------------------------------
test("describeCalculation produces explicit, evidence-backed lines and describeMissingInputs names the gap", () => {
  const pass = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs({ detectors: 400, modules: 100, ceiling: 500, expansionPart: "6815", loopsAdded: 2 }) });
  const lines = describeCalculation(pass);
  assert.ok(lines.some((line) => line.includes("Expansion required and sized")));
  assert.ok(lines.some((line) => line.includes("6815")));
  const fail = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs({ detectors: 600, ceiling: 500 }) });
  assert.ok(describeCalculation(fail).some((line) => line.includes("exceeds verified capacity")));
  const missing = evaluateCalculationRequirement({ calculationType: "battery.standby-alarm", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: [] });
  const missingLines = describeMissingInputs(missing);
  assert.ok(missingLines[0].includes("standbyCurrent"));
  assert.ok(missingLines[0].includes("alarmCurrent"));
  const nope = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "CCTV", family: "Recorder" });
  assert.ok(describeCalculation(nope)[0].includes("no governed calculation requirement applies"));
});

// ---------------------------------------------------------------------------
// 4B-5 -- matching integration is authority-inert (score/rank/approval inert)
// and never reads prices.
// ---------------------------------------------------------------------------
const matchingProfile = () => ({
  versionNumber: 1,
  boqItem: { id: "boq-panel", description: "Fire alarm control panel", system: "Fire Alarm", category: "Control Equipment", productFamily: "Fire Alarm Control Panel" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [{ id: "r1", normalizedRequirement: "Addressable SLC capacity", priority: "Critical Mandatory", sources: [{ sourceType: "Design Calculation" }], attributes: [{ name: "Capacity", operator: "Minimum", normalizedValue: 189, normalizedUnit: "points" }] }],
  standards: [{ body: "UL", number: "864" }],
  manufacturers: [],
  compatibility: [],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
});
const matchingProduct = () => ({
  id: "p-panel",
  manufacturer: "Honeywell",
  family: "Fire Alarm Control Panel",
  partNumber: "IFP-2100",
  description: "Fire alarm control panel",
  lifecycleStatus: "Active",
  reviewStatus: "Reviewed",
  price: 12000,
  attributes: [{ name: "Capacity", normalizedValue: 378, normalizedUnit: "points", evidence: { documentId: "ds-panel" } }],
  standards: [{ body: "UL", number: "864" }],
  compatibility: [],
  accessories: [],
  source: { sheet: "Catalogue", row: 3 },
});

test("feedCalculationsIntoEnvelope attaches DERIVED capacity evidence without re-scoring, re-ranking, or approval", () => {
  const result = runProductMatching({ profile: matchingProfile(), products: [matchingProduct()] });
  const candidate = result.candidates[0];
  const originalScore = candidate.score;
  const capacityEnvelope = candidate.evidenceEnvelope.find((entry) => entry.dimension === "capacity");
  assert.ok(capacityEnvelope, "the capacity dimension envelope must exist");
  const passCalc = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs(), performedAt: "2026-09-19T00:00:00.000Z" });
  const fed = feedCalculationsIntoEnvelope({ envelope: capacityEnvelope, calculationEvidence: [passCalc.evidence] });
  assert.equal(fed.dimension, "capacity");
  assert.equal(fed.derivedEvidence.length, 1);
  assert.equal(fed.derivedEvidence[0].ruleId, "slc.loop-and-expansion");
  assert.equal(fed.derivedEvidence[0].result, "PASS");
  // Pass stays pass; nothing about score/ranking/approval changed.
  assert.equal(fed.pass, capacityEnvelope.pass);
  assert.equal(fed.result, capacityEnvelope.result);
  assert.equal(candidate.score, originalScore, "candidate score must be byte-identical");
  assert.equal(candidate.approvalReady, false);
  assert.equal(candidate.reviewStatus, "Needs Review");
  assert.equal(JSON.stringify(fed.derivedEvidence).includes("12000"), false, "price must never leak into calculation evidence");
});

test("a blocking calculation marks the dimension for engineer review but never auto-approves or auto-fails the candidate", () => {
  const result = runProductMatching({ profile: matchingProfile(), products: [matchingProduct()] });
  const candidate = result.candidates[0];
  const capacityEnvelope = candidate.evidenceEnvelope.find((entry) => entry.dimension === "capacity");
  const failCalc = evaluateCalculationRequirement({ calculationType: "slc.loop-and-expansion", system: "Fire Alarm", family: "Fire Alarm Control Panel", inputs: slcInputs({ detectors: 600, ceiling: 500 }), performedAt: "2026-09-19T00:00:00.000Z" });
  assert.equal(failCalc.state, "CALCULATED_FAIL");
  const fed = feedCalculationsIntoEnvelope({ envelope: capacityEnvelope, calculationEvidence: [failCalc.evidence] });
  assert.equal(fed.engineeringReviewRecommended, true);
  assert.equal(fed.conflicts.blocking, true);
  assert.equal(fed.result, capacityEnvelope.result, "the envelope result itself is unchanged; only the advisory flag is raised");
  const conflict = resolveCrossDomainConflict({ authorityClass: "ENGINEERING_DESIGN", role: "DEFINING" }, { authorityClass: "PRODUCT_TECHNICAL", role: "VERIFYING" }, { consistent: false, dimension: "capacity" });
  assert.equal(conflict.state, "TECHNICAL_CONFLICT");
  const agree = resolveCrossDomainConflict({ authorityClass: "ENGINEERING_DESIGN", role: "DEFINING" }, { authorityClass: "PRODUCT_TECHNICAL", role: "VERIFYING" }, { consistent: true, dimension: "capacity" });
  assert.equal(agree.state, "CALCULATION_DEFINES_PRODUCT_VERIFIES");
  assert.equal(agree.blocking, false);
});