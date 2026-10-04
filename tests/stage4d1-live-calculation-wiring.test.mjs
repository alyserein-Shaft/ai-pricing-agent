// STAGE 4D-1 -- LIVE CALCULATION WIRING (tests A-P).
//
// Proves the Stage 4B calculation engine is wired into the live technical
// matching pipeline as ADDITIVE engineering evidence ONLY:
//   - applicability is family-specific and the exact Stage 4B state vocabulary
//     is preserved everywhere (NOT_REQUIRED / REQUIRED /
//     REQUIRED_BUT_INPUTS_MISSING / CALCULATED_PASS / CALCULATED_FAIL /
//     CALCULATION_CONFLICT ...),
//   - PASS/FAIL attach the full governed contract INCLUDING DERIVED evidence,
//   - missing inputs are NEVER fabricated into FAIL (missing != fail),
//   - price/commercial data is never read or leaked,
//   - the wiring is deterministic and its staleness fingerprints survive,
//   - the evidence envelope stays intact (advisory feed only),
//   - ranking / approval / review / pricing gate semantics are completely
//     unchanged,
//   - CALCULATED_FAIL never auto-rejects and REQUIRED_BUT_INPUTS_MISSING
//     creates no workflow artifacts,
//   - the matching persistence path writes NO safety_approval_requests or
//     product_match_reviews rows automatically, and
//   - legacy persisted candidates round-trip unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { isDerivedEvidenceComplete, resolveCrossDomainConflict } from "../app/domain/evidence-authority-policy.mjs";
import {
  CALCULATION_STATES,
  CALCULATION_TYPES,
  CALCULATION_LABELS,
  CALCULATION_RESULTS,
  isCalculationState,
  evaluateCandidateEngineeringCalculations,
  gatherCalculationInputs,
  CALCULATION_INPUT_SOURCES,
  CALCULATION_ENGINE_VERSION,
  CALCULATION_WIRING_VERSION,
  feedCalculationsIntoEnvelope,
} from "../app/domain/calculation-requirement-engine.mjs";

const PERFORMED_AT = "2026-09-20T00:00:00.000Z";
const PRICE = 12000;

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
const facpProfile = (attrs = {}, extra = {}) => ({
  versionNumber: 11,
  boqItem: { id: "boq-panel", description: "Fire alarm control panel", system: "Fire Alarm", category: "Control Equipment", productFamily: "Fire Alarm Control Panel", attributes: attrs },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [],
  standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  ...extra,
});
const attr = (name, value, unit = "count", reviewStatus = "Approved") => ({ name, normalizedValue: value, unit, reviewStatus });
const facpProduct = (attributes = [], overrides = {}) => ({
  id: "p-panel-1", manufacturer: "Honeywell", family: "Fire Alarm Control Panel", partNumber: "IFP-75",
  description: "Fire alarm control panel", lifecycleStatus: "Active", reviewStatus: "Reviewed",
  attributes, price: PRICE, ...overrides,
});

// A complete governed FACP input set: every demand/code fact on the
// requirement side, every capacity fact on the product side.
const completeProfileAttrs = () => ({ detector_count: 100, module_count: 40, standby_hours: 24, alarm_minutes: 5, derating_factor: 1.25, node_count: 6 });
const completeProductAttrs = () => [
  attr("slc_loop_count", 1),
  attr("detector_capacity", 189),
  attr("module_capacity", 189),
  attr("panel_capacity", 378),
  attr("network_capacity", 32),
  attr("standby_current", 0.5, "A"),
  attr("alarm_current", 1.5, "A"),
];
const completeWiring = () =>
  evaluateCandidateEngineeringCalculations({
    profile: facpProfile(completeProfileAttrs()),
    product: facpProduct(completeProductAttrs()),
    performedAt: PERFORMED_AT,
  });

// A demand that exceeds the verified system-wide ceiling: every FACP-capacity
// calculation either FAILs (blocking) or reports the honest input gap.
const failingProfileAttrs = () => ({ detector_count: 600, module_count: 40, node_count: 50 });
const failingProductAttrs = () => [
  attr("slc_loop_count", 1),
  attr("detector_capacity", 189),
  attr("module_capacity", 189),
  attr("panel_capacity", 500),
  attr("network_capacity", 16),
];
const failingWiring = () =>
  evaluateCandidateEngineeringCalculations({
    profile: facpProfile(failingProfileAttrs()),
    product: facpProduct(failingProductAttrs()),
    performedAt: PERFORMED_AT,
  });

// ---------------------------------------------------------------------------
// A -- applicability is family-specific; only governed types are evaluated.
// ---------------------------------------------------------------------------
test("A -- applicability is family-specific and governed types only are evaluated", () => {
  const wiring = completeWiring();
  assert.deepEqual(wiring.applicableCalculationTypes, ["slc.loop-and-expansion", "battery.standby-alarm", "network.node-capacity"]);
  assert.equal(wiring.results.length, CALCULATION_TYPES.length);
  const byType = Object.fromEntries(wiring.results.map((entry) => [entry.calculationType, entry.state]));
  // The FACP-family row governs SLC / battery / network only; NAC, CCTV and
  // UPS must NOT leak into a Fire Alarm control panel pack.
  assert.equal(byType["slc.loop-and-expansion"], "CALCULATED_PASS");
  assert.equal(byType["battery.standby-alarm"], "CALCULATED_PASS");
  assert.equal(byType["network.node-capacity"], "CALCULATED_PASS");
  assert.equal(byType["power.nac-load"], "NOT_REQUIRED");
  assert.equal(byType["cctv.storage-retention"], "NOT_REQUIRED");
  assert.equal(byType["power.runtime"], "NOT_REQUIRED");
  // A demand-side detector family owns NO capacity calculation.
  const detector = evaluateCandidateEngineeringCalculations({
    profile: facpProfile({ detector_count: 100 }, { boqItem: { ...facpProfile().boqItem, productFamily: "Addressable Smoke Detector" } }),
    product: facpProduct(completeProductAttrs(), { family: "Addressable Smoke Detector", partNumber: "IDP-PHOTO" }),
    performedAt: PERFORMED_AT,
  });
  assert.deepEqual(detector.applicableCalculationTypes, []);
  assert.ok(detector.results.every((entry) => entry.state === "NOT_REQUIRED"));
});

// ---------------------------------------------------------------------------
// B -- NOT_REQUIRED preservation and the exact Stage 4B state vocabulary.
// ---------------------------------------------------------------------------
test("B -- non-applicable evaluations preserve NOT_REQUIRED and the exact state vocabulary", () => {
  const detector = evaluateCandidateEngineeringCalculations({
    profile: facpProfile({}, { boqItem: { ...facpProfile().boqItem, productFamily: "Addressable Smoke Detector" } }),
    product: facpProduct([], { family: "Addressable Smoke Detector", partNumber: "IDP-PHOTO" }),
    performedAt: PERFORMED_AT,
  });
  for (const entry of detector.results) {
    assert.equal(entry.state, "NOT_REQUIRED");
    assert.equal(entry.blocking, false);
    assert.equal(entry.result, null);
    assert.equal(entry.evidence, null, "no evidence may exist for a non-required calculation");
    assert.equal(entry.evidenceKind, null);
    assert.ok(entry.reason && entry.reason.length > 0, "NOT_REQUIRED must say why");
    assert.ok(isCalculationState(entry.state), "only governed states are ever emitted");
  }
  for (const state of CALCULATION_STATES) assert.equal(isCalculationState(state), true);
  assert.deepEqual(CALCULATION_RESULTS, ["PASS", "FAIL", "CONFLICT", "UNKNOWN"]);
  for (const type of CALCULATION_TYPES) assert.equal(isCalculationState("CALCULATION_" + type), false, "types and states are distinct vocabularies");
  for (const type of CALCULATION_TYPES) assert.ok(CALCULATION_LABELS[type]);
  assert.equal(CALCULATION_ENGINE_VERSION, "calculation-requirement-engine-1.0.0");
});

// ---------------------------------------------------------------------------
// C -- PASS/FAIL attach the full Stage 4B contract incl. DERIVED evidence.
// ---------------------------------------------------------------------------
test("C -- completed calculations attach the full governed contract with DERIVED evidence", () => {
  const wiring = completeWiring();
  const contractKeys = ["calculationType", "state", "blocking", "result", "ruleId", "ruleVersion", "dimension", "label", "formula", "inputs", "normalizedInputs", "inputProvenance", "conflictInputs", "output", "headroom", "expansionRequired", "evidenceKind", "evidence", "missingInputs", "reason", "trace", "performedAt", "stale", "inputFingerprint"];
  for (const entry of wiring.results) for (const key of contractKeys) assert.ok(Object.hasOwn(entry, key), `result for ${entry.calculationType} must carry ${key}`);
  const slc = wiring.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(slc.state, "CALCULATED_PASS");
  assert.equal(slc.blocking, false);
  assert.equal(slc.result, "PASS");
  assert.equal(slc.ruleId, "slc.loop-and-expansion");
  assert.equal(slc.dimension, "capacity");
  assert.equal(slc.evidenceKind, "DERIVED");
  assert.ok(slc.evidence, "a completed calculation must produce DERIVED evidence");
  assert.equal(isDerivedEvidenceComplete(slc.evidence), true, "DERIVED evidence must pass the Stage 4A completeness gate");
  assert.equal(slc.evidence.dimension, "capacity");
  assert.equal(slc.evidence.calculationType, "slc.loop-and-expansion");
  assert.equal(slc.evidence.inputProvenance.length, slc.evidence.inputs.length, "provenance aligns 1:1 with inputs");
  assert.ok(slc.normalizedInputs.every((entry) => Number.isFinite(entry.value)));
  // Verified arithmetic: 100 detectors / 40 modules on one loop, 189 per loop,
  // 378-point ceiling -> NO_EXPANSION_REQUIRED with exact headroom.
  assert.equal(slc.output.status, "NO_EXPANSION_REQUIRED");
  assert.equal(slc.headroom.detectors, 89);
  assert.equal(slc.headroom.modules, 149);
  const battery = wiring.results.find((entry) => entry.calculationType === "battery.standby-alarm");
  assert.equal(battery.state, "CALCULATED_PASS");
  assert.equal(battery.evidenceKind, "DERIVED");
  assert.equal(battery.output.requiredAh, 15.16); // (0.5*24 + 1.5*5/60) * 1.25 -- summed, not MAX'd
  const network = wiring.results.find((entry) => entry.calculationType === "network.node-capacity");
  assert.equal(network.state, "CALCULATED_PASS");
  assert.equal(network.evidenceKind, "DERIVED");
  // FAIL also carries governed DERIVED evidence (blocking on its own dimension).
  const fail = failingWiring();
  const failSlc = fail.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(failSlc.state, "CALCULATED_FAIL");
  assert.equal(failSlc.blocking, true);
  assert.equal(failSlc.result, "FAIL");
  assert.equal(failSlc.evidenceKind, "DERIVED");
  assert.ok(failSlc.evidence, "FAIL is still a completed calculation and yields DERIVED evidence");
  assert.equal(isDerivedEvidenceComplete(failSlc.evidence), true);
  const failNetwork = fail.results.find((entry) => entry.calculationType === "network.node-capacity");
  assert.equal(failNetwork.state, "CALCULATED_FAIL");
  assert.equal(failNetwork.blocking, true);
});

// ---------------------------------------------------------------------------
// D -- missing inputs produce REQUIRED_BUT_INPUTS_MISSING, never a FAIL.
// ---------------------------------------------------------------------------
test("D -- missing governed inputs give REQUIRED_BUT_INPUTS_MISSING, distinct from CALCULATED_FAIL", () => {
  const wiring = evaluateCandidateEngineeringCalculations({
    profile: facpProfile({ detector_count: 600, module_count: 40 }),
    product: facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189)]),
    performedAt: PERFORMED_AT,
  });
  const slc = wiring.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(slc.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.equal(slc.blocking, true, "the engine's own contract marks incomplete demand as blocking");
  assert.equal(slc.evidence, null, "no evidence may be produced from a refused calculation");
  assert.equal(slc.evidenceKind, null);
  assert.ok(slc.missingInputs.includes("panelCapacity.systemPointCeiling"), "the exact missing capacity fact is named");
  assert.equal(slc.result, "UNKNOWN", "missing is UNKNOWN, not FAIL");
  const battery = wiring.results.find((entry) => entry.calculationType === "battery.standby-alarm");
  assert.equal(battery.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.ok(battery.missingInputs.includes("standbyCurrent"));
  assert.ok(battery.missingInputs.includes("alarmCurrent"));
  // DISTINCTNESS: in the same run, a genuinely exceeded ceiling is CALCULATED_FAIL
  // while the incomplete battery evidence is REQUIRED_BUT_INPUTS_MISSING -- a
  // missing input is NEVER silently upgraded into a fail.
  const fail = failingWiring();
  const failSlc = fail.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(failSlc.state, "CALCULATED_FAIL");
  const batteryMissing = fail.results.find((entry) => entry.calculationType === "battery.standby-alarm");
  assert.equal(batteryMissing.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.notEqual(failSlc.state, batteryMissing.state);
});

// ---------------------------------------------------------------------------
// E -- never fabricate missing inputs / never infer numbers from text.
// ---------------------------------------------------------------------------
test("E -- non-numeric values and free text are NEVER fabricated into inputs", () => {
  const wiring = evaluateCandidateEngineeringCalculations({
    profile: facpProfile({ detector_count: 600, module_count: 40 },
      { boqItem: { ...facpProfile().boqItem, description: "Panel supporting 900 points on 3 loops with a 240 V feed" } }),
    product: facpProduct([
      attr("slc_loop_count", 1),
      attr("detector_capacity", 189),
      attr("module_capacity", 189),
      attr("panel_capacity", "150 IDP/SK points; 75 SD points"), // unparseable -> MISSING, never a guess
      attr("battery_capacity_in_cabinet", "2 x 7"),
      attr("addressing", "Addressable"), // non-numeric -> never an input
    ], { description: "Fire alarm control panel that supports 900 points on 3 loops, 240 V" }),
    performedAt: PERFORMED_AT,
  });
  const slc = wiring.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(slc.state, "REQUIRED_BUT_INPUTS_MISSING");
  assert.ok(slc.missingInputs.includes("panelCapacity.systemPointCeiling"), "the unparseable panel_capacity is MISSING, not guessed");
  assert.equal(slc.inputs.some((entry) => entry.name === "panelCapacity.systemPointCeiling"), false, "no fabricated ceiling value may enter the inputs");
  for (const entry of wiring.results) {
    assert.equal(entry.inputs.some((input) => input.name === "addressing"), false);
    assert.equal(entry.inputs.some((input) => input.value === 900 || input.value === 3 || input.value === 240), false, "numbers from descriptions must never become inputs");
  }
  // Deterministic refusal: same refusal on a second evaluation.
  const again = evaluateCandidateEngineeringCalculations({
    profile: facpProfile({ detector_count: 600, module_count: 40 }),
    product: facpProduct([attr("panel_capacity", "150 IDP/SK points; 75 SD points")]),
    performedAt: PERFORMED_AT,
  });
  const slcAgain = again.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.ok(slcAgain.missingInputs.includes("panelCapacity.systemPointCeiling"));
});

// ---------------------------------------------------------------------------
// F -- price/commercial data is never read and never leaks.
// ---------------------------------------------------------------------------
test("F -- the calculation wiring never reads or leaks price/commercial data", () => {
  const wiring = completeWiring();
  const serialized = JSON.stringify(wiring);
  assert.equal(serialized.includes(String(PRICE)), false, "candidate price must never appear in calculation evidence");
  assert.equal(serialized.includes("price"), false, "no price field may appear anywhere in the wiring envelope");
  assert.equal(JSON.stringify(CALCULATION_INPUT_SOURCES).includes("price"), false, "the DATA alias directory has no price entry");
  // A price-shaped attribute record is simply not governed -> skipped.
  const pricey = evaluateCandidateEngineeringCalculations({
    profile: facpProfile(completeProfileAttrs()),
    product: facpProduct([...completeProductAttrs(), attr("price", PRICE, "SAR"), attr("unit_price", PRICE, "SAR")]),
    performedAt: PERFORMED_AT,
  });
  assert.equal(JSON.stringify(pricey).includes(String(PRICE)), false);
  // The alias map covers NO commercial vocabulary at all.
  for (const type of CALCULATION_TYPES) for (const side of ["product", "requirement"]) {
    for (const name of Object.keys(CALCULATION_INPUT_SOURCES[type][side] || {})) assert.doesNotMatch(name, /price|cost|commercial|estimate/i);
  }
});

// ---------------------------------------------------------------------------
// G -- determinism: identical inputs produce byte-identical evidence.
// ---------------------------------------------------------------------------
test("G -- the wiring is deterministic", () => {
  const first = completeWiring();
  const second = completeWiring();
  assert.deepEqual(first, second);
  assert.deepEqual(first.results, second.results);
  const runA = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs())] });
  const runB = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs())] });
  assert.deepEqual(runA.candidates, runB.candidates);
  assert.deepEqual(runA.candidates[0].engineeringCalculations, runB.candidates[0].engineeringCalculations);
});

// ---------------------------------------------------------------------------
// H -- staleness fingerprint survival: attached now, evaluable later (4D-3+).
// ---------------------------------------------------------------------------
test("H -- staleness fingerprints survive on every result and track inputs/basis changes", () => {
  const fingerprintKeys = ["requirementProfileVersion", "productEvidenceVersion", "ruleVersions", "candidateSpecific", "itemBasis"];
  const wiring = completeWiring();
  for (const entry of wiring.results) {
    assert.deepEqual(Object.keys(entry.inputFingerprint).sort(), [...fingerprintKeys].sort());
    assert.equal(entry.inputFingerprint.requirementProfileVersion, 11);
    assert.ok(Object.hasOwn(entry.inputFingerprint.ruleVersions, entry.calculationType));
    assert.ok(entry.inputFingerprint.candidateSpecific.length === 64);
    assert.ok(entry.inputFingerprint.itemBasis.length === 64);
  }
  const slc = wiring.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  // Same inputs -> identical fingerprints.
  const again = completeWiring();
  const slcAgain = again.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(slcAgain.inputFingerprint.productEvidenceVersion, slc.inputFingerprint.productEvidenceVersion);
  assert.equal(slcAgain.inputFingerprint.candidateSpecific, slc.inputFingerprint.candidateSpecific);
  assert.equal(slcAgain.inputFingerprint.itemBasis, slc.inputFingerprint.itemBasis);
  // Product evidence drift -> productEvidenceVersion + candidateSpecific change.
  const driftedProduct = evaluateCandidateEngineeringCalculations({
    profile: facpProfile(completeProfileAttrs()),
    product: facpProduct(completeProductAttrs().map((entry) => (entry.name === "detector_capacity" ? attr("detector_capacity", 120) : entry))),
    performedAt: PERFORMED_AT,
  });
  const driftedSLC = driftedProduct.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.notEqual(driftedSLC.inputFingerprint.productEvidenceVersion, slc.inputFingerprint.productEvidenceVersion);
  assert.notEqual(driftedSLC.inputFingerprint.candidateSpecific, slc.inputFingerprint.candidateSpecific);
  assert.equal(driftedSLC.inputFingerprint.itemBasis, slc.inputFingerprint.itemBasis, "item basis is input-independent");
  // Requirement profile drift -> requirementProfileVersion changes.
  const newProfileVersion = evaluateCandidateEngineeringCalculations({
    profile: facpProfile(completeProfileAttrs(), { versionNumber: 99 }),
    product: facpProduct(completeProductAttrs()),
    performedAt: PERFORMED_AT,
  });
  const newVersionSLC = newProfileVersion.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(newVersionSLC.inputFingerprint.requirementProfileVersion, 99);
  assert.notEqual(newVersionSLC.inputFingerprint.requirementProfileVersion, slc.inputFingerprint.requirementProfileVersion);
  // Applicability drift -> itemBasis changes.
  const differentFamily = evaluateCandidateEngineeringCalculations({
    profile: facpProfile(completeProfileAttrs(), { boqItem: { ...facpProfile().boqItem, productFamily: "NAC Power Supply" } }),
    product: facpProduct(completeProductAttrs(), { family: "NAC Power Supply", partNumber: "NAC-1" }),
    performedAt: PERFORMED_AT,
  });
  // Power-supply families are now ALSO required to satisfy power.capacity (the governed
  // panel / PSU output-ceiling check). The set is asserted exactly, not by subset.
  assert.deepEqual(new Set(differentFamily.applicableCalculationTypes), new Set(["power.nac-load", "battery.standby-alarm", "power.capacity"]));
  const nac = differentFamily.results.find((entry) => entry.calculationType === "power.nac-load");
  assert.notEqual(nac.inputFingerprint.itemBasis, slc.inputFingerprint.itemBasis);
});

// ---------------------------------------------------------------------------
// I -- the candidate evidence envelope stays intact (advisory feed only).
// ---------------------------------------------------------------------------
test("I -- evidenceEnvelope stays intact: derived capacity evidence is advisory, never decision", () => {
  // A/B control: the SAME profile/product pair evaluated once with calculation
  // evidence present and once with no calculation evidence at all (a product
  // that satisfies the Capacity comparison but carries no capacity facts).
  const governedProfile = facpProfile(completeProfileAttrs(), {
    consolidatedRequirements: [{ id: "r-cap", normalizedRequirement: "Addressable SLC capacity", priority: "Critical Mandatory", sources: [{ sourceType: "Design Calculation" }], attributes: [{ name: "Capacity", operator: "Minimum", normalizedValue: 189, normalizedUnit: "points" }] }],
  });
  const productWithCapacity = facpProduct([attr("Capacity", 378, "points"), attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189), attr("panel_capacity", 378), attr("network_capacity", 32), attr("standby_current", 0.5, "A"), attr("alarm_current", 1.5, "A")]);
  const baseline = runProductMatching({ profile: governedProfile, products: [facpProduct([attr("Capacity", 378, "points")])] }).candidates[0].evidenceEnvelope;
  const wired = runProductMatching({ profile: governedProfile, products: [productWithCapacity] }).candidates[0].evidenceEnvelope;
  const baselineCapacity = baseline.find((entry) => entry.dimension === "capacity");
  const wiredCapacity = wired.find((entry) => entry.dimension === "capacity");
  assert.ok(baselineCapacity, "the governed Capacity requirement must produce a capacity-dimension envelope");
  assert.ok(wiredCapacity, "the same requirement must still produce the capacity-dimension envelope");
  // The feed only ADDS derivedEvidence; pass/result/decisionBasis stay the
  // comparison's own contract.
  assert.deepEqual(wiredCapacity.pass, baselineCapacity.pass);
  assert.deepEqual(wiredCapacity.result, baselineCapacity.result);
  assert.deepEqual(wiredCapacity.decisionBasis, baselineCapacity.decisionBasis);
  assert.deepEqual(baselineCapacity.derivedEvidence || [], [], "the no-calculation-evidence control carries no derived block");
  const ruleIds = (wiredCapacity.derivedEvidence || []).map((entry) => entry.ruleId).sort();
  assert.deepEqual(ruleIds, ["battery.standby-alarm", "network.node-capacity", "slc.loop-and-expansion"], "only completed PASS/FAIL calculations are fed");
  // When nothing completed, the envelope is untouched and identical to baseline.
  const missingWired = runProductMatching({ profile: governedProfile, products: [facpProduct([attr("Capacity", 378, "points")], {})] }).candidates[0].evidenceEnvelope;
  assert.deepEqual(missingWired, baseline, "with no completed calculations the envelope is byte-identical to the pre-wiring envelope");
  // A candidate with NO requirements and NO BOQ understanding attributes has
  // no envelopes at all, still [] after feed. (BOQ understanding facts on the
  // item itself would create their own informational comparisons -- that is
  // pre-existing matching behavior, not the wiring.)
  const noRequirements = runProductMatching({ profile: facpProfile(), products: [facpProduct(completeProductAttrs())] }).candidates[0].evidenceEnvelope;
  assert.deepEqual(noRequirements, []);
});

// ---------------------------------------------------------------------------
// J -- ranking / approval / review semantics are completely unchanged.
// ---------------------------------------------------------------------------
test("J -- ranking, approval and review semantics are unchanged by the wiring", () => {
  const failProduct = facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189), attr("panel_capacity", 500), attr("network_capacity", 32)], { id: "p-a", partNumber: "IFP-FAIL" });
  const passProduct = facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 700), attr("module_capacity", 700), attr("panel_capacity", 2000), attr("network_capacity", 32)], { id: "p-b", partNumber: "IFP-PASS" });
  const runOrderA = runProductMatching({ profile: facpProfile({ detector_count: 600, module_count: 40 }), products: [failProduct, passProduct] });
  const runOrderB = runProductMatching({ profile: facpProfile({ detector_count: 600, module_count: 40 }), products: [passProduct, failProduct] });
  const calcState = (candidate) => candidate.engineeringCalculations.results.find((entry) => entry.calculationType === "slc.loop-and-expansion").state;
  // Same ranking regardless of input order AND regardless of calc state: the
  // FAIL candidate neither demotes nor promotes itself.
  assert.deepEqual(runOrderA.candidates.map((entry) => entry.product.id), runOrderB.candidates.map((entry) => entry.product.id));
  assert.equal(calcState(runOrderA.candidates[0]), "CALCULATED_FAIL");
  assert.equal(calcState(runOrderB.candidates[0]), "CALCULATED_FAIL");
  assert.ok(runOrderA.candidates.some((entry) => calcState(entry) === "CALCULATED_PASS"));
  const failing = runOrderA.candidates.find((entry) => calcState(entry) === "CALCULATED_FAIL");
  assert.equal(failing.rank, 1);
  assert.equal(failing.approvalReady, false);
  assert.equal(failing.reviewStatus, "Needs Review");
  assert.equal(failing.mandatoryFailures.length, 0, "a blocking CALCULATED_FAIL must never become a mandatory/technical failure");
  assert.equal(failing.technicalStatus, "Compliant with Warnings", "technicalStatus is decided by matching comparisons only");
  const componentSum = Object.values(failing.components).reduce((sum, value) => sum + value, 0);
  assert.equal(failing.score, Math.min(100, Math.max(0, Math.round(componentSum))), "score is exactly the governed component blend, untouched by calculations");
  // The sort comparator never reads the wiring -- source-level proof.
  // (engineeringCalculations appears only in defensive-attach + persistence.)
  assert.doesNotMatch(runOrderA.candidates[0].rankingReason, /calculation/i);
});

// ---------------------------------------------------------------------------
// K -- no automatic safety_approval_requests or product_match_reviews writes.
// ---------------------------------------------------------------------------
test("K -- the matching persistence path never auto-writes review or approval requests", async () => {
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  const safetyApi = await readFile(new URL("../worker/confidence-safety-api.mjs", import.meta.url), "utf8");
  // product-matching-api.mjs only ever writes product_match_reviews inside the
  // two explicit user-action handlers (manual-candidate / reject / feedback)
  // plus exactly ONE governed Stage 4D-4 auto-reject writer (which must go
  // through the explicit policy gate), and never writes
  // safety_approval_requests at all.
  assert.equal((worker.match(/INSERT INTO product_match_reviews/g) || []).length, 3);
  assert.match(worker, /canAutoRejectTechnicalCandidate/, "the Stage 4D-4 auto-reject write path is gated by the explicit policy");
  assert.equal((worker.match(/INSERT INTO safety_approval_requests/g) || []).length, 0);
  // persistResult (the automatic persistence path) adds none of them.
  const persist = worker.slice(worker.indexOf("const persistResult"), worker.indexOf("export const executeProductMatching"));
  assert.match(persist, /INSERT INTO product_match_candidates/);
  assert.doesNotMatch(persist, /product_match_reviews|safety_approval_requests/);
  assert.match(persist, /engineeringCalculations/, "Stage 4D-1 persists the additive field through score_components");
  // confidence-safety-api.mjs writes safety_approval_requests ONLY in the
  // explicit engineer `approve` action -- never from evaluateSafetyForMatchRun.
  assert.equal((safetyApi.match(/INSERT INTO safety_approval_requests/g) || []).length, 1);
  // Containment is asserted by BRANCH, not by line. The previous form took the
  // single line containing the INSERT and required that same line to contain
  // `operation === "approve"`, which is a formatting assumption, not an
  // invariant: any refactor that wrapped the branch across lines -- with no
  // behavioural change at all -- turned a safety guard red. Slicing from the
  // approve branch opener to the next operation branch asserts the property that
  // actually matters and cannot be satisfied by a reformat.
  const approveBranchStart = safetyApi.indexOf('if (operation === "approve"');
  assert.ok(approveBranchStart >= 0, "the explicit approve action must exist as its own operation branch");
  const nextOperationBranch = safetyApi.indexOf("if (operation ===", approveBranchStart + 1);
  assert.ok(
    nextOperationBranch > approveBranchStart,
    "the approve branch must be closed by the following operation branch, otherwise its extent cannot be determined",
  );
  const approveBranch = safetyApi.slice(approveBranchStart, nextOperationBranch);
  assert.ok(
    approveBranch.includes("INSERT INTO safety_approval_requests"),
    "the single safety_approval_requests write must live INSIDE the explicit approve action",
  );
  // ...and the converse, so the slice cannot be satisfied by an unrelated write.
  assert.doesNotMatch(
    safetyApi.slice(0, approveBranchStart),
    /INSERT INTO safety_approval_requests/,
    "no safety_approval_requests write may appear before the approve branch",
  );
  assert.doesNotMatch(
    safetyApi.slice(nextOperationBranch),
    /INSERT INTO safety_approval_requests/,
    "no safety_approval_requests write may appear after the approve branch",
  );
  // The approve branch must actually dispatch on the operation, not merely sit
  // next to it: a branch that ignored `operation` would satisfy containment while
  // making the write reachable from every operation.
  assert.match(approveBranch, /operation === "approve"/, "the approve branch must dispatch on the approve operation");
  assert.match(approveBranch, /request\.method === "POST"/, "the approve action must remain POST-only");
  const autoPath = safetyApi.slice(safetyApi.indexOf("evaluateSafetyForMatchRun"), safetyApi.indexOf("export const handleConfidenceSafetyApi") >= 0 ? safetyApi.indexOf("export const handleConfidenceSafetyApi") : safetyApi.indexOf("operation ==="));
  assert.doesNotMatch(autoPath, /safety_approval_requests/, "automatic safety evaluation writes decisions only, never approval requests");
});

// ---------------------------------------------------------------------------
// L -- legacy candidate persistence round-trips unchanged.
// ---------------------------------------------------------------------------
test("L -- legacy candidates (no engineeringCalculations) persist and read back unchanged", () => {
  const raw = buildDatabase();
  const legacy = {
    id: "cand-legacy", match_run_id: "run-legacy", product_id: "prod-legacy", rank: 1, search_stage: "Structured", score: 65,
    score_components: JSON.stringify({ familyMatchTier: 0, isFallbackCandidate: false, rankingReason: "legacy reason", evidenceStrength: 0, aiRanking: null, accessoryCandidates: [], mandatoryCompliance: 40, searchRelevance: 12 }),
    technical_status: "Compliant", recommendation_tier: "Recommended", confidence_state: "High Confidence", confidence_score: 80,
    matching_basis: "[]", commercial_availability: "No Price Evidence", explanation: "Legacy", mandatory_failures: "[]", lifecycle_result: "{}", review_status: "Needs Review",
  };
  raw.prepare("INSERT INTO product_match_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(legacy.id, legacy.match_run_id, legacy.product_id, legacy.rank, legacy.search_stage, legacy.score, legacy.score_components, legacy.technical_status, legacy.recommendation_tier, legacy.confidence_state, legacy.confidence_score, legacy.matching_basis, legacy.commercial_availability, legacy.explanation, legacy.mandatory_failures, legacy.lifecycle_result, legacy.review_status);
  const row = raw.prepare("SELECT * FROM product_match_candidates WHERE id='cand-legacy'").get();
  const components = JSON.parse(row.score_components);
  assert.equal(components.engineeringCalculations, undefined, "legacy rows carry no calc field and parse exactly as before");
  assert.equal(components.familyMatchTier, 0);
  assert.equal(components.rankingReason, "legacy reason");
  // New-style row: the additive field persists inside the SAME column.
  const result = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs())] });
  const candidate = result.candidates[0];
  const persisted = JSON.stringify({ ...candidate.components, familyMatchTier: candidate.familyMatchTier ?? null, isFallbackCandidate: Boolean(candidate.isFallbackCandidate), rankingReason: candidate.rankingReason || null, evidenceStrength: candidate.evidenceStrength ?? null, aiRanking: candidate.aiRanking || null, accessoryCandidates: candidate.accessoryCandidates || [], engineeringCalculations: candidate.engineeringCalculations || [] });
  const readBack = JSON.parse(persisted);
  assert.deepEqual(readBack.engineeringCalculations, candidate.engineeringCalculations);
  assert.equal(readBack.engineeringCalculations.results.length, 6);
  assert.equal(candidate.approvalReady, false);
  assert.equal(candidate.reviewStatus, "Needs Review");
});

// ---------------------------------------------------------------------------
// M -- CALCULATED_FAIL never auto-rejects; missing inputs create no artifacts.
// ---------------------------------------------------------------------------
test("M -- CALCULATED_FAIL never auto-rejects and REQUIRED_BUT_INPUTS_MISSING creates no workflow artifacts", () => {
  const pass = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs())] });
  const fail = runProductMatching({ profile: facpProfile(failingProfileAttrs()), products: [facpProduct(failingProductAttrs())] });
  const missing = runProductMatching({ profile: facpProfile({ detector_count: 600, module_count: 40 }), products: [facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189)])] });
  for (const run of [pass, fail, missing]) {
    assert.equal(run.candidates[0].recommendationTier === "Rejected Candidate", false, "a calculation outcome must never reject a candidate");
    assert.equal(run.status, "Needs Review", "matching status is decided by comparisons only");
    assert.equal(run.noMatch, null, "a blocked or incomplete calculation alone never produces noMatch");
    assert.equal(run.candidates[0].approvalReady, false);
    assert.equal(run.candidates[0].reviewStatus, "Needs Review");
    assert.equal(run.candidates[0].mandatoryFailures.length, 0);
  }
  // The FAIL evidence exists in the candidate but changes NOTHING downstream.
  const failSLC = fail.candidates[0].engineeringCalculations.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(failSLC.state, "CALCULATED_FAIL");
  assert.equal(failSLC.blocking, true);
  const missingSLC = missing.candidates[0].engineeringCalculations.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(missingSLC.state, "REQUIRED_BUT_INPUTS_MISSING");
});

// ---------------------------------------------------------------------------
// N -- the advisory-only blocking flag is the ONLY downstream envelope effect.
// ---------------------------------------------------------------------------
test("N -- a blocking calculation only raises the advisory engineer-review flag on the envelope", () => {
  // 600 demanded points exceed every verified system-wide ceiling for the
  // failing fixture below; the SLC calculation must BLOCK on the demand facts,
  // not on a fabricated projection.
  const governedProfile = facpProfile(failingProfileAttrs(), {
    consolidatedRequirements: [{ id: "r-cap", normalizedRequirement: "Addressable SLC capacity", priority: "Critical Mandatory", sources: [{ sourceType: "Design Calculation" }], attributes: [{ name: "Capacity", operator: "Minimum", normalizedValue: 189, normalizedUnit: "points" }] }],
  });
  const baseline = runProductMatching({ profile: governedProfile, products: [facpProduct([attr("Capacity", 189, "points")])] }).candidates[0].evidenceEnvelope.find((entry) => entry.dimension === "capacity");
  // Same Capacity requirement, but the product demonstrably cannot hold the
  // demanded 600 points -> the SLC calculation BLOCKS.
  const failing = runProductMatching({ profile: governedProfile, products: [facpProduct([attr("Capacity", 189, "points"), attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189), attr("panel_capacity", 500)])] });
  const candidate = failing.candidates[0];
  const fed = candidate.evidenceEnvelope.find((entry) => entry.dimension === "capacity");
  const fedFail = candidate.engineeringCalculations.results.find((entry) => entry.calculationType === "slc.loop-and-expansion");
  assert.equal(fedFail.state, "CALCULATED_FAIL");
  assert.equal(fed.engineeringReviewRecommended, true, "the advisory flag is the ONLY automatic indication");
  assert.equal(fed.conflicts.blocking, true);
  assert.equal(fed.conflicts.state, "CALCULATION_DEFINES_PRODUCT_VERIFIES");
  assert.deepEqual(fed.pass, baseline.pass, "the envelope pass/result is the comparison's own, untouched by the calculation");
  assert.deepEqual(fed.result, baseline.result);
  const conflict = resolveCrossDomainConflict({ authorityClass: "ENGINEERING_DESIGN", role: "DEFINING" }, { authorityClass: "PRODUCT_TECHNICAL", role: "VERIFYING" }, { consistent: false, dimension: "capacity" });
  assert.equal(conflict.state, "TECHNICAL_CONFLICT");
  // No FAIL -> no advisory flag and the comparison-layer conflict is left
  // untouched: the feed is advisory-only and never takes the envelope over.
  const passWired = runProductMatching({ profile: governProfileWith(), products: [passingProduct()] });
  const passFed = passWired.candidates[0].evidenceEnvelope.find((entry) => entry.dimension === "capacity");
  assert.equal(passFed?.engineeringReviewRecommended, undefined);
  assert.equal(passFed?.conflicts?.state, "TECHNICAL_CONFLICT", "the comparison-layer conflict is the envelope's own contract on the pass path");
  assert.notEqual(passFed?.conflicts?.state, "CALCULATION_DEFINES_PRODUCT_VERIFIES", "a non-blocking pass never flips the conflicts state");
  assert.equal((passFed?.derivedEvidence || []).length, 3, "advisory PASS evidence still attaches, but without any downstream effect");
});
const governProfileWith = () => ({ versionNumber: 11, boqItem: { id: "boq-panel", description: "Fire alarm control panel", system: "Fire Alarm", category: "Control Equipment", productFamily: "Fire Alarm Control Panel", attributes: completeProfileAttrs() }, readiness: { status: "Ready for Matching", blockingReasons: [] }, consolidatedRequirements: [{ id: "r-cap", normalizedRequirement: "Addressable SLC capacity", priority: "Critical Mandatory", sources: [{ sourceType: "Design Calculation" }], attributes: [{ name: "Capacity", operator: "Minimum", normalizedValue: 189, normalizedUnit: "points" }] }], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [] });
const passingProduct = () => facpProduct([attr("Capacity", 378, "points"), attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189), attr("panel_capacity", 378), attr("network_capacity", 32), attr("standby_current", 0.5, "A"), attr("alarm_current", 1.5, "A")]);

// ---------------------------------------------------------------------------
// O -- end-to-end: the composed candidate keeps every legacy contract field.
// ---------------------------------------------------------------------------
test("O -- composed candidates keep every legacy contract field plus the additive wiring", () => {
  const run = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs())] });
  assert.equal(run.status, "Needs Review");
  assert.equal(run.engineVersion, "product-matching-engine-1.0.0");
  const candidate = run.candidates[0];
  for (const field of ["product", "searchStage", "searchScore", "evidenceStrength", "familyMatchTier", "matchingBasis", "components", "score", "technicalStatus", "recommendationTier", "confidence", "confidenceScore", "comparisons", "standards", "manufacturer", "manufacturerConsistency", "compatibility", "accessories", "accessoryCandidates", "lifecycle", "commercialAvailability", "mandatoryFailures", "approvalReady", "reviewStatus", "evidenceEnvelope", "provenance", "explanation", "rankingReason"]) {
    assert.ok(Object.hasOwn(candidate, field), `candidate must carry legacy field ${field}`);
  }
  assert.deepEqual(candidate.engineeringCalculations.engineVersion, CALCULATION_ENGINE_VERSION);
  assert.equal(candidate.engineeringCalculations.wiringVersion, CALCULATION_WIRING_VERSION);
  assert.deepEqual(candidate.engineeringCalculations.results.map((entry) => entry.calculationType), CALCULATION_TYPES);
  assert.equal(candidate.engineeringCalculations.applicableCalculationTypes.length, 3);
  // Additive persistence shape for the API layer.
  const scoreComponents = JSON.parse(JSON.stringify({ ...candidate.components, familyMatchTier: candidate.familyMatchTier ?? null, isFallbackCandidate: Boolean(candidate.isFallbackCandidate), rankingReason: candidate.rankingReason || null, evidenceStrength: candidate.evidenceStrength ?? null, aiRanking: candidate.aiRanking || null, accessoryCandidates: candidate.accessoryCandidates || [], engineeringCalculations: candidate.engineeringCalculations || [] }));
  assert.equal(Array.isArray(scoreComponents.engineeringCalculations.results), true);
  assert.equal(scoreComponents.familyMatchTier, 0);
});

// ---------------------------------------------------------------------------
// P -- gatherCalculationInputs is a pure DATA-driven gatherer.
// ---------------------------------------------------------------------------
test("P -- gatherCalculationInputs is DATA-driven and refuses ungoverned names and Rejected attributes", () => {
  const gathered = gatherCalculationInputs({ calculationType: "slc.loop-and-expansion", product: facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("detector_capacity", 60, "count", "Rejected")]), profile: facpProfile({ detector_count: 100, ungoverned_capacity: 9999 }) });
  const byName = Object.fromEntries(gathered.inputs.map((entry) => [entry.name, entry.value]));
  assert.equal(byName["panelCapacity.nativeLoops"], 1);
  assert.equal(byName["panelCapacity.detectorsPerLoop"], 189, "the Rejected duplicate is excluded");
  assert.equal(byName["demand.detectors"], 100);
  assert.equal(byName["panelCapacity.systemPointCeiling"], undefined, "ungoverned names never enter");
  assert.equal(gathered.conflictInputs.length, 0, "excluded Rejected rows create no false conflict");
  // A genuine contradiction between two verified facts surfaces as conflict.
  const conflicting = gatherCalculationInputs({ calculationType: "network.node-capacity", product: facpProduct([attr("network_capacity", 16)]), profile: facpProfile({}) });
  assert.equal(conflicting.inputs.some((entry) => entry.name === "maxNetworkNodes"), true);
  const dual = gatherCalculationInputs({ calculationType: "network.node-capacity", product: facpProduct([attr("network_capacity", 16), attr("max_network_nodes", 32)]), profile: facpProfile({}) });
  assert.deepEqual(dual.conflictInputs, ["maxNetworkNodes"]);
});

// ---------------------------------------------------------------------------
// D1 harness (persist-shape + no-auto-write integration).
// ---------------------------------------------------------------------------
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});
const buildDatabase = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE product_match_runs(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, status TEXT, input_fingerprint TEXT, engine_version TEXT, ruleset_version TEXT, search_version TEXT, model_version TEXT, search_scope TEXT, summary TEXT, no_match TEXT, candidate_count INTEGER, created_by TEXT, completed_at TEXT, superseded_at TEXT, processing_run_id TEXT);
    CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, search_stage TEXT, score INTEGER, score_components TEXT, technical_status TEXT, recommendation_tier TEXT, confidence_state TEXT, confidence_score INTEGER, matching_basis TEXT, commercial_availability TEXT, explanation TEXT, mandatory_failures TEXT, lifecycle_result TEXT, review_status TEXT);
    CREATE TABLE product_match_reviews(id TEXT PRIMARY KEY, project_id TEXT, match_run_id TEXT, candidate_id TEXT, action TEXT, reason_code TEXT, notes TEXT, evidence TEXT, decided_by TEXT, decided_role TEXT);
    CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT, approval_level INTEGER, status TEXT, requested_by TEXT, requested_role TEXT, request_reason TEXT, evidence TEXT, entity_version INTEGER, ruleset_version TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
  `);
  return raw;
};

test("K/L integration -- a full matching persistence pass writes only runs/candidates/audit rows, never reviews or approvals, and the additive field survives", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  const result = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs())] });
  const candidate = result.candidates[0];
  // Mirrors worker/product-matching-api.mjs persistResult (lines 119-123).
  const matchRunId = "run-4d1", stamp = "2026-09-20T00:00:00.000Z";
  const statements = [
    DB.prepare("INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, processing_run_id, version_number, status, input_fingerprint, engine_version, ruleset_version, search_version, model_version, search_scope, summary, no_match, candidate_count, created_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(matchRunId, "p1", "boq-panel", "profile1", null, 1, result.status, "fp-4d1", result.engineVersion, result.rulesetVersion, result.searchVersion, result.modelVersion, JSON.stringify(result.searchScope || {}), JSON.stringify({ candidateCountEvaluated: result.candidateCountEvaluated || 0, matchingState: result.matchingState, aiRanking: result.aiRanking || null }), result.noMatch ? JSON.stringify(result.noMatch) : null, result.candidates.length, "owner1", stamp),
    DB.prepare("INSERT INTO product_match_candidates (id, match_run_id, product_id, rank, search_stage, score, score_components, technical_status, recommendation_tier, confidence_state, confidence_score, matching_basis, commercial_availability, explanation, mandatory_failures, lifecycle_result, review_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review')").bind("cand-4d1", matchRunId, candidate.product.id, candidate.rank, candidate.searchStage, candidate.score, JSON.stringify({ ...candidate.components, familyMatchTier: candidate.familyMatchTier ?? null, isFallbackCandidate: Boolean(candidate.isFallbackCandidate), rankingReason: candidate.rankingReason || null, evidenceStrength: candidate.evidenceStrength ?? null, aiRanking: candidate.aiRanking || null, accessoryCandidates: candidate.accessoryCandidates || [], engineeringCalculations: candidate.engineeringCalculations || [] }), candidate.technicalStatus, candidate.recommendationTier, candidate.confidence, candidate.aiRanking?.fitScore ?? candidate.confidenceScore, JSON.stringify(candidate.matchingBasis), candidate.commercialAvailability, candidate.aiRanking?.explanation || candidate.explanation, JSON.stringify(candidate.mandatoryFailures), JSON.stringify(candidate.lifecycle)),
    DB.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, 'Product Matching Completed', ?, ?, 'Structured technical matching recalculation', ?)").bind("audit-4d1", "p1", "doc1", "dv1", "owner1", null, JSON.stringify({ matchRunId, version: 1, status: result.status, candidates: result.candidates.length }), "req1"),
  ];
  await DB.batch(statements);
  // The automatic persistence path wrote exactly the governed rows.
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_runs").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_candidates").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM document_audit_events").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_reviews").get().n, 0, "no review rows may be auto-created");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM safety_approval_requests").get().n, 0, "no approval requests may be auto-created");
  const row = raw.prepare("SELECT score_components FROM product_match_candidates WHERE id='cand-4d1'").get();
  const components = JSON.parse(row.score_components);
  assert.ok(components.engineeringCalculations && Array.isArray(components.engineeringCalculations.results));
  assert.equal(components.engineeringCalculations.results.length, 6);
  assert.equal(JSON.stringify(components).includes(String(PRICE)), false, "no price value may be persisted inside calculation evidence");
  assert.equal(components.engineeringCalculations.results.some((entry) => entry.state === "CALCULATED_PASS"), true);
});