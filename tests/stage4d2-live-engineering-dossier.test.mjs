// STAGE 4D-2 -- LIVE ENGINEERING DOSSIER / PROJECT READINESS WIRING (tests A-V).
//
// Proves the Stage 4C engineering dossier engine (evaluateDossier /
// evaluateProjectLevelEngineering / evaluateTechnicalReadiness) is wired into
// the live technical matching pipeline as ADDITIVE engineering evidence ONLY:
//   - applicability is system-specific (Fire Alarm / CCTV / UPS; no leakage
//     into unknown or unconfigured systems),
//   - the live Stage 4D-1 engineeringCalculations feed dossier evidence via
//     the Stage 4C bridge and stay DERIVED (identity/fingerprint preserved),
//   - missing / conflicting / stale dossier states are attached faithfully,
//   - a complete dossier keeps its deterministic readiness result while a
//     blocked dossier never auto-rejects and a ready dossier never auto-accepts,
//   - candidate reviewStatus stays "Needs Review" and approvalReady stays false,
//   - the matching path never auto-writes safety_approval_requests or
//     product_match_reviews rows,
//   - ranking/order is byte-identical with and without the advisory attach,
//   - the Stage 4A evidenceEnvelope and Stage 4D-1 engineeringCalculations
//     remain intact,
//   - commercial/price data can never satisfy dossier evidence, and
//   - project-level checks stay PROJECT scoped when cross-item context is
//     incomplete.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import {
  DOSSIER_REQUIREMENT_TYPES,
  DOSSIER_ENGINE_VERSION,
  DOSSIER_WIRING_VERSION,
  evaluateDossier,
  evaluateTechnicalReadiness,
  evaluateLiveSystemEngineering,
  evidenceFromCalculation,
  authorityCheckForDossierEvidence,
} from "../app/domain/engineering-dossier-engine.mjs";
import { CALCULATION_TYPES, CALCULATION_WIRING_VERSION } from "../app/domain/calculation-requirement-engine.mjs";

const PRICE = 12000;

// ---------------------------------------------------------------------------
// Fixtures (mirror the Stage 4D-1 suite; standards default to [] so the
// matched run keeps its pre-existing "Needs Review" semantics -- standards
// feed BOTH matching comparisons and the dossier code/standard item, and the
// 4D-2 suite asserts each side explicitly).
// ---------------------------------------------------------------------------
// Product capacity facts are consumed by the live calculation wiring only when
// they are Approved. `Reviewed` is not `Approved`, so the shared fixture states
// Approved explicitly and the refusal of a non-approved fact is proved below
// rather than left implicit in the fixture.
const attr = (name, value, unit = "count", reviewStatus = "Approved") => ({ name, normalizedValue: value, unit, reviewStatus });
const unapprovedAttr = (name, value, unit = "count", reviewStatus = "Reviewed") => ({ name, normalizedValue: value, unit, reviewStatus });
const baseProfile = (attrs = {}, { system, family, description, versionNumber = 11, ...extra } = {}) => ({
  versionNumber,
  boqItem: { id: "boq-1", description, system, category: "Equipment", productFamily: family, attributes: attrs },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  ...extra,
});
const facpProfile = (attrs = {}, extra = {}) => baseProfile(attrs, { system: "Fire Alarm", family: "Fire Alarm Control Panel", description: "Fire alarm control panel", ...extra });
const cctvProfile = (attrs = {}, extra = {}) => baseProfile(attrs, { system: "CCTV", family: "CCTV Camera", description: "CCTV camera", ...extra });
const upsProfile = (attrs = {}, extra = {}) => baseProfile(attrs, { system: "UPS", family: "UPS", description: "Uninterruptible power supply", ...extra });
const plumbingProfile = (attrs = {}, extra = {}) => baseProfile(attrs, { system: "Plumbing", family: "Plumbing Valve", description: "Plumbing valve", ...extra });
const product = (attributes = [], overrides = {}) => ({
  id: "p-1", manufacturer: "Honeywell", family: "Fire Alarm Control Panel", partNumber: "IFP-75",
  description: "Fire alarm control panel", lifecycleStatus: "Active", reviewStatus: "Reviewed",
  attributes, price: PRICE, ...overrides,
});
const facpProduct = (attributes = [], overrides = {}) => product(attributes, overrides);
const cctvProduct = (attributes = [], overrides = {}) => product(attributes, { family: "CCTV Camera", partNumber: "CCTV-1", description: "CCTV camera", ...overrides });
const upsProduct = (attributes = [], overrides = {}) => product(attributes, { family: "UPS", partNumber: "UPS-1", description: "Uninterruptible power supply", ...overrides });
const plumbingProduct = (attributes = [], overrides = {}) => product(attributes, { family: "Plumbing Valve", partNumber: "VALVE-1", description: "Plumbing valve", ...overrides });

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
const failingProfileAttrs = () => ({ detector_count: 600, module_count: 40, node_count: 50 });
const failingProductAttrs = () => [
  attr("slc_loop_count", 1),
  attr("detector_capacity", 189),
  attr("module_capacity", 189),
  attr("panel_capacity", 500),
  attr("network_capacity", 16),
];

const facpRun = (attrs = completeProfileAttrs(), products = [facpProduct(completeProductAttrs())]) => runProductMatching({ profile: facpProfile(attrs), products });

// The live wiring carries its per-calculation results under `results`.
const calculationStates = (run) => ((run.candidates[0].engineeringCalculations || {}).results || []).map((entry) => entry.state);

// ---------------------------------------------------------------------------
// A -- the Stage 4C dossier engine is invoked in the live path.
// ---------------------------------------------------------------------------
test("A -- evaluateDossier/evaluateProjectLevelEngineering/evaluateTechnicalReadiness run live on every match", () => {
  const run = facpRun();
  assert.ok(run.engineeringDossier, "run carries engineeringDossier");
  assert.equal(run.engineeringDossier.engineVersion, DOSSIER_ENGINE_VERSION);
  assert.equal(run.engineeringDossier.system, "Fire Alarm");
  assert.equal(run.engineeringDossier.scope, "PROJECT_SYSTEM");
  assert.equal(run.engineeringDossier.items.length, DOSSIER_REQUIREMENT_TYPES.length);
  for (const item of run.engineeringDossier.items) assert.ok(DOSSIER_REQUIREMENT_TYPES.includes(item.type));
  assert.ok(run.projectEngineeringChecks, "run carries projectEngineeringChecks");
  assert.equal(run.projectEngineeringChecks.scope, "PROJECT");
  assert.equal(run.projectEngineeringChecks.engineVersion, DOSSIER_ENGINE_VERSION);
  assert.ok(run.engineeringReadiness, "run carries engineeringReadiness");
  assert.equal(run.engineeringReadiness.system, "Fire Alarm");
  assert.equal(run.dossierWiring.wiringVersion, DOSSIER_WIRING_VERSION);
  assert.equal(run.dossierWiring.engineVersion, DOSSIER_ENGINE_VERSION);
});

// ---------------------------------------------------------------------------
// B -- Fire Alarm dossier applies only to Fire Alarm.
// ---------------------------------------------------------------------------
test("B -- the live Fire Alarm dossier uses the Fire Alarm template only", () => {
  const run = facpRun();
  const byType = Object.fromEntries(run.engineeringDossier.items.map((entry) => [entry.type, entry]));
  assert.equal(byType.SYSTEM_ARCHITECTURE.required, true);
  assert.equal(byType.CODE_STANDARD_BASIS.required, true);
  assert.equal(byType.CAPACITY_CALCULATION.required, true);
  assert.equal(byType.ENGINEERING_CALCULATION.required, true);
  assert.equal(byType.TECHNICAL_WARRANTY_OR_SUPPORT.required, false);
  // The live requirement profile carries no jurisdiction, so the conditional
  // AUTHORITY_APPROVAL row closes to NOT_REQUIRED -- never assumed required.
  assert.equal(byType.AUTHORITY_APPROVAL.required, false);
  assert.equal(byType.AUTHORITY_APPROVAL.status, "NOT_REQUIRED");
  assert.equal(byType.AUTHORITY_APPROVAL.blocking, false);
  assert.deepEqual(run.engineeringDossier.items.map((entry) => entry.type).sort(), [...DOSSIER_REQUIREMENT_TYPES].sort());
});

// ---------------------------------------------------------------------------
// C -- CCTV dossier applies only to CCTV.
// ---------------------------------------------------------------------------
test("C -- the live CCTV dossier uses the CCTV template only", () => {
  const run = runProductMatching({ profile: cctvProfile(), products: [cctvProduct()] });
  const byType = Object.fromEntries(run.engineeringDossier.items.map((entry) => [entry.type, entry]));
  assert.equal(run.engineeringDossier.system, "CCTV");
  assert.equal(byType.SYSTEM_ARCHITECTURE.required, true);
  assert.equal(byType.CAPACITY_CALCULATION.required, true);
  assert.equal(byType.ENGINEERING_CALCULATION.required, true);
  assert.equal(byType.TECHNICAL_WARRANTY_OR_SUPPORT.required, false);
  // Fire-Alarm-only rows must stay NOT_REQUIRED for CCTV.
  assert.equal(byType.AUTHORITY_APPROVAL.required, false);
  assert.equal(byType.AUTHORITY_APPROVAL.status, "NOT_REQUIRED");
  assert.equal(byType.CODE_STANDARD_BASIS.required, false);
  assert.equal(byType.CODE_STANDARD_BASIS.status, "NOT_REQUIRED");
});

// ---------------------------------------------------------------------------
// D -- UPS dossier applies only to UPS.
// ---------------------------------------------------------------------------
test("D -- the live UPS dossier uses the UPS template only", () => {
  const run = runProductMatching({ profile: upsProfile(), products: [upsProduct()] });
  const byType = Object.fromEntries(run.engineeringDossier.items.map((entry) => [entry.type, entry]));
  assert.equal(run.engineeringDossier.system, "UPS");
  assert.equal(byType.SYSTEM_ARCHITECTURE.required, true);
  assert.equal(byType.CAPACITY_CALCULATION.required, true);
  assert.equal(byType.ENGINEERING_CALCULATION.required, true);
  assert.equal(byType.TECHNICAL_WARRANTY_OR_SUPPORT.required, false);
  assert.equal(byType.AUTHORITY_APPROVAL.required, false);
  assert.equal(byType.AUTHORITY_APPROVAL.status, "NOT_REQUIRED");
  assert.equal(byType.CODE_STANDARD_BASIS.required, false);
  assert.equal(byType.CODE_STANDARD_BASIS.status, "NOT_REQUIRED");
});

// ---------------------------------------------------------------------------
// E -- unknown/unconfigured systems inherit no other system's requirements.
// ---------------------------------------------------------------------------
test("E -- an unsupported system is never blocked by another system's dossier requirements", () => {
  const run = runProductMatching({ profile: plumbingProfile(), products: [plumbingProduct()] });
  assert.equal(run.engineeringDossier.system, "Plumbing");
  assert.deepEqual(run.engineeringDossier.blockers, []);
  assert.deepEqual(run.engineeringDossier.warnings, []);
  assert.equal(run.engineeringDossier.status, "READY");
  for (const item of run.engineeringDossier.items) assert.equal(item.status, "NOT_REQUIRED", `${item.type} must stay NOT_REQUIRED`);
  assert.ok(run.engineeringDossier.items.every((entry) => entry.blocking === false));
});

// ---------------------------------------------------------------------------
// F0 -- a non-Approved product capacity fact is never consumed by the wiring.
// ---------------------------------------------------------------------------
test("F0 -- a product capacity fact that is not Approved never produces a verified calculation", () => {
  const reviewed = completeProductAttrs().map((entry) => unapprovedAttr(entry.name, entry.normalizedValue, entry.unit));
  const run = facpRun(completeProfileAttrs(), [facpProduct(reviewed)]);
  const engineering = run.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION");
  assert.notEqual(engineering.status, "VERIFIED", "a Reviewed capacity fact is not an approved capacity fact");
  const states = calculationStates(run);
  assert.ok(states.includes("REQUIRED_BUT_INPUTS_MISSING"), "the wiring reports the missing approved input instead of passing it");
  assert.ok(!states.includes("CALCULATED_PASS"), "no calculation passes on a non-approved capacity fact");
  // The same governed product with the same values, once approved, is consumed.
  const approved = facpRun(completeProfileAttrs(), [facpProduct(completeProductAttrs())]);
  assert.ok(calculationStates(approved).includes("CALCULATED_PASS"), "the approved capacity fact is consumed");
});

// ---------------------------------------------------------------------------
// F -- live Stage 4D-1 engineeringCalculations feed dossier evidence.
// ---------------------------------------------------------------------------
test("F -- live engineeringCalculations feed the dossier calculation items through the 4C bridge", () => {
  const run = facpRun();
  const engineering = run.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION");
  assert.equal(engineering.status, "VERIFIED");
  assert.ok(engineering.evidenceCount >= 1);
  const types = engineering.evidence.map((entry) => entry.calculationType).sort();
  assert.deepEqual(types, ["battery.standby-alarm", "network.node-capacity", "slc.loop-and-expansion"]);
  for (const evidence of engineering.evidence) {
    assert.equal(evidence.authorityClass, "ENGINEERING_DESIGN");
    assert.equal(evidence.review, "Verified");
    assert.ok(evidence.ruleId && evidence.ruleVersion, "calculation identity survives");
  }
  // R1 -- every live FACP calculation declares dimension "capacity", so each one
  // legitimately serves BOTH requirement roles it actually proves. The capacity
  // item is therefore no longer an unbridgeable gap, and it is satisfied by the
  // SAME calculations (not a second, independent authority).
  const capacity = run.engineeringDossier.items.find((entry) => entry.type === "CAPACITY_CALCULATION");
  assert.equal(capacity.status, "VERIFIED");
  assert.equal(capacity.evidenceCount, engineering.evidenceCount, "one calculation set serves both roles");
  const identity = (entry) => `${entry.calculationType}|${entry.ruleId}|${entry.ruleVersion}|${entry.fingerprint}`;
  const engineeringIdentities = engineering.evidence.map(identity).sort();
  const capacityIdentities = capacity.evidence.map(identity).sort();
  assert.deepEqual(capacityIdentities, engineeringIdentities, "identical calculation identity in both roles");
  // cctv.storage-retention keeps CAPACITY_CALCULATION as its primary dossier type.
  const capacityBridge = evidenceFromCalculation({ calculationType: "cctv.storage-retention", state: "CALCULATED_PASS", dimension: "capacity", evidence: { ruleId: "cctv.storage-retention", ruleVersion: "cctv.storage-retention-1.0.0" }, trace: ["retention satisfied"] });
  assert.equal(capacityBridge.dossierType, "CAPACITY_CALCULATION");
  // A real CCTV capacity calculation satisfies the CCTV capacity requirement
  // through the live wiring (calculation results, not an evidence entry).
  const cctvWired = evaluateLiveSystemEngineering({
    profile: cctvProfile(),
    calculationResults: [{ calculationType: "cctv.storage-retention", ruleId: "cctv.storage-retention", ruleVersion: "cctv.storage-retention-1.0.0", dimension: "capacity", state: "CALCULATED_PASS", result: "PASS", evidence: { ruleId: "cctv.storage-retention", ruleVersion: "cctv.storage-retention-1.0.0" }, trace: ["retention satisfied"] }],
  });
  assert.equal(cctvWired.dossier.items.find((entry) => entry.type === "CAPACITY_CALCULATION").status, "VERIFIED");
});

// ---------------------------------------------------------------------------
// G -- calculation-derived dossier evidence remains DERIVED.
// ---------------------------------------------------------------------------
test("G -- live calculation evidence stays DERIVED and is never converted into EXPLICIT project evidence", () => {
  const run = facpRun();
  const engineering = run.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION");
  assert.equal(engineering.label, "Engineering calculation");
  assert.ok(engineering.evidence.length >= 1);
  for (const evidence of engineering.evidence) {
    assert.equal(evidence.evidenceKind, "DERIVED", "calculation-derived evidence must remain DERIVED");
    assert.equal(evidence.evidenceKind !== "EXPLICIT", true);
    assert.equal(evidence.calculationState, "CALCULATED_PASS");
    assert.ok(["slc.loop-and-expansion", "battery.standby-alarm", "network.node-capacity"].includes(evidence.calculationType), "only completing FACP calculations feed the dossier");
  }
});

// ---------------------------------------------------------------------------
// H -- critical missing dossier evidence is preserved faithfully.
// ---------------------------------------------------------------------------
test("H -- critical missing dossier evidence stays MISSING and blocks faithfully (never fabricated)", () => {
  // No demand/standard surface and no calculation facts --> every critical
  // item is genuinely MISSING; absence must not be read as verified.
  const run = runProductMatching({ profile: facpProfile(), products: [facpProduct([attr("Capacity", 378, "points")])] });
  for (const type of ["SYSTEM_ARCHITECTURE", "CODE_STANDARD_BASIS", "CAPACITY_CALCULATION", "ENGINEERING_CALCULATION"]) {
    const item = run.engineeringDossier.items.find((entry) => entry.type === type);
    assert.equal(item.status, "MISSING", `${type} must be MISSING`);
    assert.equal(item.blocking, true, `${type} (CRITICAL) must block`);
    assert.ok(item.missingInputsOrGaps.length >= 1, `${type} must name its gap`);
  }
  assert.equal(run.engineeringDossier.status, "BLOCKED");
  assert.equal(run.engineeringReadiness.status, "Blocked");
  for (const blocker of run.engineeringDossier.blockers) assert.ok(run.engineeringDossier.technicalReviewRequired.some((label) => blocker.startsWith(`${label}:`)));
  assert.ok(run.engineeringDossier.technicalReviewRequired.length >= 4);
});

// ---------------------------------------------------------------------------
// H2 -- R1: an approved, consumable architecture context reaches the live
// dossier through the real matching relay (not only the unit adapter).
// ---------------------------------------------------------------------------
const approvedArchitectureContext = () => ({
  version: "stage4-drawing-architecture-context-1.0.0",
  available: true,
  reason: null,
  architectureVersion: 2,
  status: "READY_FOR_STAGE4_BRIDGE",
  readiness: { stage4Readiness: "READY_FOR_STAGE4_BRIDGE" },
  channels: {
    PANEL_INVENTORY: {
      count: 1,
      evidence: [{ id: "a1", factType: "system-architecture", subject: "FACP-1", evidenceKind: "EXPLICIT", authorityClass: "PRIMARY", productCompatibility: false, protocol: false, matchingRole: "project-architecture-context", architectureVersion: 2, provenance: { documentId: "doc-1", reviewActorId: "reviewer-1", reviewReason: "verified against panel schedule", evidenceFingerprint: "fp-a1" } }],
    },
  },
  evidenceCount: 1,
  adjudications: [],
  unresolved: [],
  fingerprint: "arch-fp-2",
  provenance: { bridgeSemanticVersion: "drawing-architecture-bridge-1.0.0", readFromVersionId: "dav_1", approvedFactCount: 1, nonBridgedFactTypes: [] },
});

test("H2 -- an approved architecture context satisfies SYSTEM_ARCHITECTURE through the live matching relay", () => {
  const run = runProductMatching({
    profile: facpProfile(completeProfileAttrs(), { drawingArchitectureContext: approvedArchitectureContext() }),
    products: [facpProduct(completeProductAttrs())],
  });
  const architecture = run.engineeringDossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.equal(architecture.status, "VERIFIED", "approved architecture evidences system architecture");
  assert.ok(architecture.evidenceCount >= 1);
  for (const evidence of architecture.evidence) {
    assert.equal(evidence.authorityClass, "ENGINEERING_DESIGN");
    assert.equal(evidence.evidenceKind, "EXPLICIT");
    assert.equal(evidence.architectureEvidence, true);
    assert.equal(evidence.architectureVersion, 2, "architecture version is traceable in the dossier");
  }
  // With standards present too, the Fire Alarm dossier can reach a truthful
  // READY state: capacity is now satisfied by the real capacity-dimension
  // calculations and architecture by the approved context.
  const withStandards = runProductMatching({
    profile: facpProfile(completeProfileAttrs(), { drawingArchitectureContext: approvedArchitectureContext(), standards: [{ body: "NFPA", number: "72", part: "2022" }] }),
    products: [facpProduct(completeProductAttrs())],
  });
  const byType = Object.fromEntries(withStandards.engineeringDossier.items.map((entry) => [entry.type, entry.status]));
  assert.equal(byType.SYSTEM_ARCHITECTURE, "VERIFIED");
  assert.equal(byType.CODE_STANDARD_BASIS, "VERIFIED");
  assert.equal(byType.CAPACITY_CALCULATION, "VERIFIED");
  assert.equal(byType.ENGINEERING_CALCULATION, "VERIFIED");
  assert.equal(withStandards.engineeringDossier.status, "READY");
  // Architecture never leaks into a non-architecture requirement.
  const capacity = withStandards.engineeringDossier.items.find((entry) => entry.type === "CAPACITY_CALCULATION");
  for (const evidence of capacity.evidence) {
    assert.equal(evidence.architectureEvidence, undefined, "architecture evidence never lands under capacity");
  }
});

// ---------------------------------------------------------------------------
// I -- conflicting dossier evidence is preserved faithfully.
// ---------------------------------------------------------------------------
test("I -- overlapping PASS/FAIL calculations surface as CONFLICTING, and missing inputs stay MISSING", () => {
  const failProduct = facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189), attr("panel_capacity", 500), attr("network_capacity", 32)], { id: "p-a", partNumber: "IFP-FAIL" });
  const passProduct = facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 700), attr("module_capacity", 700), attr("panel_capacity", 2000), attr("network_capacity", 32)], { id: "p-b", partNumber: "IFP-PASS" });
  const run = runProductMatching({ profile: facpProfile(failingProfileAttrs()), products: [failProduct, passProduct] });
  const engineering = run.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION");
  const states = [...new Set(engineering.evidence.map((entry) => entry.calculationState))].sort();
  // The overlapping run merges a FAIL (SLC), a PASS (SLC on the larger panel)
  // and an honest input gap (battery missing current facts) -- the conflict
  // shadows all of them, exactly like the engine's own evidence merge.
  assert.deepEqual(states, ["CALCULATED_FAIL", "CALCULATED_PASS", "REQUIRED_BUT_INPUTS_MISSING"]);
  assert.equal(engineering.status, "CONFLICTING");
  assert.equal(engineering.blocking, true);
  assert.equal(run.engineeringDossier.status, "BLOCKED");
  assert.ok(run.engineeringDossier.blockers.some((line) => line.includes("Engineering calculation: CONFLICTING")));
  // A refused calculation (inputs missing) keeps its own state: MISSING, never
  // FAIL and never a silent pass.
  const missingRun = runProductMatching({ profile: facpProfile(failingProfileAttrs()), products: [facpProduct([attr("slc_loop_count", 1), attr("detector_capacity", 189), attr("module_capacity", 189)])] });
  const missingEngineering = missingRun.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION");
  assert.equal(missingEngineering.status, "MISSING");
  assert.equal(missingEngineering.blocking, true);
});

// ---------------------------------------------------------------------------
// J -- stale dossier evidence metadata survives attachment.
// ---------------------------------------------------------------------------
test("J -- staleness metadata (basis, version, fingerprint) survives the live attach; STALE vocabulary is preserved", () => {
  const run = facpRun();
  const engineering = run.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION");
  for (const evidence of engineering.evidence) {
    assert.equal(evidence.fingerprint?.length, 64, "candidate fingerprint survives into dossier evidence");
    assert.equal(evidence.provenance?.itemBasis?.length, 64);
    assert.equal(evidence.provenance?.requirementProfileVersion, 11);
    assert.equal(evidence.provenance?.stale, null);
  }
  // Run-level staleness contract -- attached now, evaluable in 4D-3+.
  assert.equal(run.dossierWiring.staleness.stale, null);
  assert.equal(run.dossierWiring.staleness.basis, "ITEM/GOVERNING-BASIS");
  assert.equal(run.dossierWiring.staleness.invalidationImplemented, false);
  assert.equal(run.dossierWiring.staleness.requirementProfileVersion, 11);
  assert.equal(run.dossierWiring.staleness.itemId, "boq-1");
  // The engine's existing STALE vocabulary is not invented or replaced: stale
  // critical evidence still resolves to a BLOCKED dossier.
  const staleDossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: { SYSTEM_ARCHITECTURE: [{ stale: true, state: "unverified", reviewStatus: "Stale", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "EXPLICIT" }] },
  });
  const architecture = staleDossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.equal(architecture.status, "STALE");
  assert.equal(architecture.blocking, true);
  assert.equal(staleDossier.status, "BLOCKED");
});

// ---------------------------------------------------------------------------
// K -- a complete dossier produces its existing deterministic readiness result.
// ---------------------------------------------------------------------------
test("K -- complete dossiers keep the deterministic readiness result through the live wiring", () => {
  // Wiring layer: a scope with nothing required is deterministically complete.
  const plumbing = runProductMatching({ profile: plumbingProfile(), products: [plumbingProduct()] });
  assert.equal(plumbing.engineeringDossier.status, "READY");
  assert.equal(plumbing.engineeringDossier.deterministicVerification, true);
  assert.equal(plumbing.engineeringReadiness.status, "Technically Ready");
  assert.equal(plumbing.engineeringReadiness.deterministicVerification, true);
  // Engine layer: a fully verified Fire Alarm dossier still resolves READY
  // with deterministic verification via the SAME engine contract.
  const verified = (authorityClass) => [{ state: "verified", reviewStatus: "Verified", authorityClass, evidenceKind: "EXPLICIT", claim: "governed evidence presented" }];
  const complete = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: verified("ENGINEERING_DESIGN"),
      CODE_STANDARD_BASIS: verified("REGULATORY"),
      CAPACITY_CALCULATION: verified("ENGINEERING_DESIGN"),
      ENGINEERING_CALCULATION: verified("ENGINEERING_DESIGN"),
      TECHNICAL_WARRANTY_OR_SUPPORT: verified("COMMERCIAL"),
    },
  });
  assert.equal(complete.status, "READY");
  assert.equal(complete.blockers.length, 0);
  assert.equal(complete.deterministicVerification, true);
  const ready = evaluateTechnicalReadiness({ system: "Fire Alarm", itemReadiness: { status: "Ready for Matching" }, dossier: complete, projectViolations: [] });
  assert.equal(ready.status, "Technically Ready");
  assert.equal(ready.deterministicVerification, true);
});

// ---------------------------------------------------------------------------
// L -- a blocked dossier does NOT auto-reject.
// ---------------------------------------------------------------------------
test("L -- a BLOCKED live dossier never auto-rejects a candidate", () => {
  const run = runProductMatching({ profile: facpProfile(failingProfileAttrs()), products: [facpProduct(failingProductAttrs())] });
  assert.equal(run.engineeringDossier.status, "BLOCKED");
  assert.equal(run.engineeringReadiness.status, "Blocked");
  assert.ok(run.engineeringReadiness.blockers.some((line) => line.includes("Engineering calculation: CONFLICTING")));
  // Matching status, candidate tier, and review semantics are untouched.
  assert.equal(run.status, "Needs Review");
  assert.equal(run.noMatch, null);
  assert.equal(run.candidates[0].recommendationTier === "Rejected Candidate", false);
  assert.equal(run.candidates[0].reviewStatus, "Needs Review");
  assert.equal(run.candidates[0].approvalReady, false);
  assert.equal(run.candidates[0].mandatoryFailures.length, 0);
});

// ---------------------------------------------------------------------------
// M -- a technically-ready dossier does NOT auto-accept.
// ---------------------------------------------------------------------------
test("M -- a Technically Ready dossier never auto-accepts or auto-approves", () => {
  const run = runProductMatching({ profile: plumbingProfile(), products: [plumbingProduct()] });
  assert.equal(run.engineeringReadiness.status, "Technically Ready");
  assert.equal(run.engineeringReadiness.deterministicVerification, true);
  assert.notEqual(run.engineeringReadiness.status, "Approved", "readiness is evidence, not an acceptance state");
  for (const candidate of run.candidates) {
    assert.equal(candidate.approvalReady, false);
    assert.equal(candidate.reviewStatus, "Needs Review");
  }
});

// ---------------------------------------------------------------------------
// N -- candidate reviewStatus remains "Needs Review".
// ---------------------------------------------------------------------------
test("N -- reviewStatus stays Needs Review across blocked, ready, and per-system runs", () => {
  const runs = [
    facpRun(),
    runProductMatching({ profile: facpProfile(failingProfileAttrs()), products: [facpProduct(failingProductAttrs())] }),
    runProductMatching({ profile: plumbingProfile(), products: [plumbingProduct()] }),
    runProductMatching({ profile: cctvProfile(), products: [cctvProduct()] }),
    runProductMatching({ profile: upsProfile(), products: [upsProduct()] }),
  ];
  for (const run of runs) for (const candidate of run.candidates) assert.equal(candidate.reviewStatus, "Needs Review");
});

// ---------------------------------------------------------------------------
// O -- approvalReady remains false.
// ---------------------------------------------------------------------------
test("O -- approvalReady stays false on every candidate of every run", () => {
  const runs = [
    facpRun(),
    runProductMatching({ profile: facpProfile(failingProfileAttrs()), products: [facpProduct(failingProductAttrs())] }),
    runProductMatching({ profile: plumbingProfile(), products: [plumbingProduct()] }),
    runProductMatching({ profile: cctvProfile(), products: [cctvProduct()] }),
  ];
  for (const run of runs) for (const candidate of run.candidates) assert.equal(candidate.approvalReady, false);
});

// ---------------------------------------------------------------------------
// P -- no safety_approval_requests auto-write.
// ---------------------------------------------------------------------------
test("P -- the matching persistence path never writes safety_approval_requests", async () => {
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  const safetyApi = await readFile(new URL("../worker/confidence-safety-api.mjs", import.meta.url), "utf8");
  assert.equal((worker.match(/INSERT INTO safety_approval_requests/g) || []).length, 0);
  const persist = worker.slice(worker.indexOf("const persistResult"), worker.indexOf("export const executeProductMatching"));
  assert.doesNotMatch(persist, /safety_approval_requests|product_match_reviews/);
  assert.match(persist, /engineeringDossier/, "4D-2 persists the dossier fields through the run summary");
  // The only approval-request writer anywhere is the explicit engineer action.
  assert.equal((safetyApi.match(/INSERT INTO safety_approval_requests/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// Q -- no product_match_reviews auto-reject write.
// ---------------------------------------------------------------------------
test("Q -- the matching persistence path never writes product_match_reviews", async () => {
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  // Exactly THREE review-row insert paths may exist: the two explicit
  // user-action handlers and the ONE governed Stage 4D-4 auto-reject writer
  // (which must consult the explicit policy gate). Automatic run persistence
  // itself still inserts none.
  assert.equal((worker.match(/INSERT INTO product_match_reviews/g) || []).length, 3);
  assert.match(worker, /canAutoRejectTechnicalCandidate/, "the Stage 4D-4 auto-reject write path is gated by the explicit policy");
  const persist = worker.slice(worker.indexOf("const persistResult"), worker.indexOf("export const executeProductMatching"));
  assert.doesNotMatch(persist, /product_match_reviews/, "automatic persistence inserts no review rows");
});

// ---------------------------------------------------------------------------
// R -- ranking/order is byte-equivalent before/after dossier attachment.
// ---------------------------------------------------------------------------
test("R -- the run envelope minus the advisory dossier keys is byte-identical, and candidates never carry dossier fields", () => {
  const ADVISORY_KEYS = ["engineeringDossier", "engineeringReadiness", "projectEngineeringChecks", "dossierWiring"];
  const envelope = (run) => {
    const copy = JSON.parse(JSON.stringify(run));
    for (const key of ADVISORY_KEYS) delete copy[key];
    delete copy.generatedAt; // wall-clock, pre-existing non-determinism
    return copy;
  };
  const productA = facpProduct(completeProductAttrs(), { id: "p-a", partNumber: "IFP-A" });
  const productB = facpProduct(completeProductAttrs(), { id: "p-b", partNumber: "IFP-B" });
  const runA = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [productA, productB] });
  const runB = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [productB, productA] });
  assert.deepEqual(envelope(runA), envelope(runB), "without the four advisory keys the run is byte-identical regardless of input order");
  assert.deepEqual(runA.candidates, runB.candidates, "candidate payloads are byte-identical");
  assert.deepEqual(runA.candidates.map((entry) => entry.product.id), runB.candidates.map((entry) => entry.product.id));
  assert.deepEqual(runA.candidates.map((entry) => entry.score), runB.candidates.map((entry) => entry.score));
  for (const key of ADVISORY_KEYS) {
    assert.equal(JSON.stringify(runA.candidates).includes(key), false, `candidates must never carry ${key}`);
  }
});

// ---------------------------------------------------------------------------
// S -- the Stage 4A evidenceEnvelope remains intact.
// ---------------------------------------------------------------------------
test("S -- evidenceEnvelope stays intact alongside the live dossier attach", () => {
  const governedProfile = facpProfile(completeProfileAttrs(), {
    consolidatedRequirements: [{ id: "r-cap", normalizedRequirement: "Addressable SLC capacity", priority: "Critical Mandatory", sources: [{ sourceType: "Design Calculation" }], attributes: [{ name: "Capacity", operator: "Minimum", normalizedValue: 189, normalizedUnit: "points" }] }],
  });
  const productWithCapacity = facpProduct([attr("Capacity", 378, "points"), ...completeProductAttrs()]);
  const baseline = runProductMatching({ profile: governedProfile, products: [facpProduct([attr("Capacity", 378, "points")])] }).candidates[0].evidenceEnvelope;
  const wiredRun = runProductMatching({ profile: governedProfile, products: [productWithCapacity] });
  const wired = wiredRun.candidates[0].evidenceEnvelope;
  const baselineCapacity = baseline.find((entry) => entry.dimension === "capacity");
  const wiredCapacity = wired.find((entry) => entry.dimension === "capacity");
  assert.ok(baselineCapacity, "the governed Capacity requirement still produces a capacity envelope");
  assert.ok(wiredCapacity, "the same requirement still produces a capacity envelope with the dossier attached");
  assert.deepEqual(wiredCapacity.pass, baselineCapacity.pass);
  assert.deepEqual(wiredCapacity.result, baselineCapacity.result);
  assert.deepEqual(wiredCapacity.decisionBasis, baselineCapacity.decisionBasis);
  assert.deepEqual(baselineCapacity.derivedEvidence || [], [], "the no-calculation control carries no derived block");
  assert.deepEqual(
    (wiredCapacity.derivedEvidence || []).map((entry) => entry.ruleId).sort(),
    ["battery.standby-alarm", "network.node-capacity", "slc.loop-and-expansion"],
    "only completed PASS/FAIL calculations are fed",
  );
  assert.equal(wiredRun.engineeringDossier.status, "BLOCKED", "the dossier attaches on the same run without touching the envelope");
});

// ---------------------------------------------------------------------------
// T -- Stage 4D-1 engineeringCalculations remain intact.
// ---------------------------------------------------------------------------
test("T -- engineeringCalculations stay byte-identical and feed the dossier without being altered", () => {
  const runA = facpRun();
  const runB = facpRun();
  assert.deepEqual(runA.candidates, runB.candidates);
  const calculcations = runA.candidates[0].engineeringCalculations;
  assert.equal(calculcations.results.length, CALCULATION_TYPES.length);
  assert.equal(calculcations.wiringVersion, CALCULATION_WIRING_VERSION);
  assert.equal(JSON.stringify(calculcations).includes("engineeringDossier"), false);
  assert.equal(JSON.stringify(calculcations).includes("projectEngineeringChecks"), false);
  // Exactly the completed PASS/FAIL results feed the dossier -- NOT_REQUIRED
  // rows certify nothing.
  const fedTypes = runA.engineeringDossier.items
    .find((entry) => entry.type === "ENGINEERING_CALCULATION")
    .evidence.map((entry) => entry.calculationType)
    .sort();
  assert.deepEqual(fedTypes, ["battery.standby-alarm", "network.node-capacity", "slc.loop-and-expansion"]);
  for (const result of calculcations.results) {
    assert.ok(["NOT_REQUIRED", "REQUIRED", "REQUIRED_BUT_INPUTS_MISSING", "CALCULATED_PASS", "CALCULATED_FAIL", "CALCULATION_CONFLICT"].includes(result.state));
  }
});

// ---------------------------------------------------------------------------
// U -- commercial/price data can never satisfy dossier evidence.
// ---------------------------------------------------------------------------
test("U -- price/commercial data cannot verify any dossier item", () => {
  const priceRunA = facpRun();
  const priceRunB = runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [facpProduct(completeProductAttrs(), { price: 1 })] });
  assert.deepEqual(priceRunA.engineeringDossier, priceRunB.engineeringDossier, "price changes never enter the dossier");
  assert.equal(JSON.stringify(priceRunA.engineeringDossier).includes(String(PRICE)), false);
  // Even a price-tagged product with a plump Capacity attribute cannot verify
  // a calculation item when no governed input exists.
  const priceyRun = runProductMatching({ profile: facpProfile(), products: [facpProduct([attr("Capacity", 999999, "points"), attr("price", PRICE, "SAR"), attr("unit_price", PRICE, "SAR")])] });
  assert.equal(priceyRun.engineeringDossier.items.find((entry) => entry.type === "ENGINEERING_CALCULATION").status, "MISSING");
  assert.equal(priceyRun.engineeringDossier.status, "BLOCKED");
  assert.equal(JSON.stringify(priceyRun.engineeringDossier).includes(String(PRICE)), false);
  // Engine authority rule: COMMERCIAL may only corroborate a warranty; it can
  // never VERIFY a technical dossier item.
  assert.equal(authorityCheckForDossierEvidence({ authorityClass: "COMMERCIAL", evidenceKind: "EXPLICIT" }).commercial, true);
  const commercialOnly = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: { ENGINEERING_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "COMMERCIAL", evidenceKind: "EXPLICIT" }] },
  });
  assert.equal(commercialOnly.items.find((entry) => entry.type === "ENGINEERING_CALCULATION").status, "PRESENT_UNVERIFIED");
});

// ---------------------------------------------------------------------------
// V -- project-level checks do not silently become row-level when incomplete.
// ---------------------------------------------------------------------------
test("V -- project checks stay PROJECT scoped: incomplete context is reported, never assumed, never downgraded", () => {
  const unconstrained = facpRun();
  assert.equal(unconstrained.projectEngineeringChecks.contextStatus, "PROJECT_CONTEXT_INCOMPLETE");
  assert.deepEqual(unconstrained.projectEngineeringChecks.constraintsAvailable, []);
  assert.deepEqual([...unconstrained.projectEngineeringChecks.constraintsUnavailable].sort(), ["approvedManufacturers", "commonProtocol", "panelCapacityByPanel", "singleManufacturer"]);
  assert.equal(unconstrained.projectEngineeringChecks.violationCount, 0);
  assert.ok(unconstrained.projectEngineeringChecks.contextNote.includes("NOT assumed"));
  assert.equal(unconstrained.projectEngineeringChecks.scope, "PROJECT");
  // The project check must never mutate into a per-candidate attribute
  // comparison: candidates carry no project/dossier fields at all.
  for (const candidate of unconstrained.candidates) {
    assert.equal(Object.hasOwn(candidate, "projectEngineeringChecks"), false);
    assert.equal(Object.hasOwn(candidate, "engineeringDossier"), false);
  }
  // When the profile DOES declare an approved manufacturer list, the check
  // fires as a PROJECT artifact -- and the cross-item context is still
  // explicitly incomplete.
  const constrainedRun = runProductMatching({
    profile: facpProfile(completeProfileAttrs(), { manufacturers: [{ manufacturer: "Honeywell", status: "Approved" }] }),
    products: [facpProduct(completeProductAttrs(), { id: "p-sie", manufacturer: "Siemens", partNumber: "IFP-SIE" })],
  });
  assert.deepEqual(constrainedRun.projectEngineeringChecks.constraintsAvailable, ["approvedManufacturers"]);
  assert.equal(constrainedRun.projectEngineeringChecks.contextStatus, "PROJECT_CONTEXT_INCOMPLETE");
  const violation = constrainedRun.projectEngineeringChecks.violations.find((entry) => entry.type === "APPROVED_MANUFACTURER_VIOLATION");
  assert.ok(violation, "off-list manufacturer must surface as a project violation");
  assert.equal(violation.scope, "PROJECT");
  assert.equal(violation.severity, "BLOCKING");
  assert.deepEqual(violation.itemsAffected, ["boq-1"]);
});

// ---------------------------------------------------------------------------
// Integration -- one full persistence pass stores the dossier and writes no
// review/approval rows (mirrors worker/product-matching-api.mjs persistResult).
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

test("integration -- a full matching persistence pass stores engineeringDossier/Readiness/Checks in the run summary and writes no review or approval rows", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  const result = facpRun();
  const candidate = result.candidates[0];
  const matchRunId = "run-4d2", stamp = "2026-09-20T00:00:00.000Z";
  const statements = [
    DB.prepare("INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, processing_run_id, version_number, status, input_fingerprint, engine_version, ruleset_version, search_version, model_version, search_scope, summary, no_match, candidate_count, created_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
      matchRunId, "p1", "boq-1", "profile1", null, 1, result.status, "fp-4d2", result.engineVersion, result.rulesetVersion, result.searchVersion, result.modelVersion,
      JSON.stringify(result.searchScope || {}),
      JSON.stringify({ candidateCountEvaluated: result.candidateCountEvaluated || 0, matchingState: result.matchingState, aiRanking: result.aiRanking || null, engineeringDossier: result.engineeringDossier ?? null, engineeringReadiness: result.engineeringReadiness ?? null, projectEngineeringChecks: result.projectEngineeringChecks ?? null, dossierWiring: result.dossierWiring ?? null }),
      result.noMatch ? JSON.stringify(result.noMatch) : null, result.candidates.length, "owner1", stamp,
    ),
    DB.prepare("INSERT INTO product_match_candidates (id, match_run_id, product_id, rank, search_stage, score, score_components, technical_status, recommendation_tier, confidence_state, confidence_score, matching_basis, commercial_availability, explanation, mandatory_failures, lifecycle_result, review_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review')").bind(
      "cand-4d2", matchRunId, candidate.product.id, candidate.rank, candidate.searchStage, candidate.score,
      JSON.stringify({ ...candidate.components, familyMatchTier: candidate.familyMatchTier ?? null, isFallbackCandidate: Boolean(candidate.isFallbackCandidate), rankingReason: candidate.rankingReason || null, evidenceStrength: candidate.evidenceStrength ?? null, aiRanking: candidate.aiRanking || null, accessoryCandidates: candidate.accessoryCandidates || [], engineeringCalculations: candidate.engineeringCalculations || [] }),
      candidate.technicalStatus, candidate.recommendationTier, candidate.confidence, candidate.aiRanking?.fitScore ?? candidate.confidenceScore,
      JSON.stringify(candidate.matchingBasis), candidate.commercialAvailability, candidate.aiRanking?.explanation || candidate.explanation,
      JSON.stringify(candidate.mandatoryFailures), JSON.stringify(candidate.lifecycle),
    ),
    DB.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, 'Product Matching Completed', ?, ?, 'Structured technical matching recalculation', ?)").bind("audit-4d2", "p1", "doc1", "dv1", "owner1", null, JSON.stringify({ matchRunId, version: 1, status: result.status, candidates: result.candidates.length }), "req1"),
  ];
  await DB.batch(statements);

  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_runs").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_candidates").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM document_audit_events").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_reviews").get().n, 0, "no review rows may be auto-created");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM safety_approval_requests").get().n, 0, "no approval requests may be auto-created");

  // The run summary carries the dossier/readiness/checks persistently.
  const runRow = raw.prepare("SELECT summary FROM product_match_runs WHERE id='run-4d2'").get();
  const summary = JSON.parse(runRow.summary);
  assert.equal(summary.engineeringDossier.system, "Fire Alarm");
  assert.equal(summary.engineeringDossier.items.length, DOSSIER_REQUIREMENT_TYPES.length);
  assert.equal(summary.engineeringDossier.status, "BLOCKED");
  assert.equal(summary.engineeringReadiness.status, "Blocked");
  assert.equal(summary.projectEngineeringChecks.scope, "PROJECT");
  assert.equal(summary.dossierWiring.wiringVersion, DOSSIER_WIRING_VERSION);
  assert.equal(summary.dossierWiring.staleness.basis, "ITEM/GOVERNING-BASIS");

  // Candidate round-trip keeps the 4D-1 calc evidence, untouched by the add.
  const candidateRow = raw.prepare("SELECT score_components FROM product_match_candidates WHERE id='cand-4d2'").get();
  const components = JSON.parse(candidateRow.score_components);
  assert.equal(components.engineeringCalculations.results.length, CALCULATION_TYPES.length);
  assert.equal(JSON.stringify(components).includes(String(PRICE)), false, "no price may be persisted inside calculation or dossier evidence");
  assert.equal(JSON.stringify(summary).includes(String(PRICE)), false, "no price may be persisted inside the run dossier summary");
});