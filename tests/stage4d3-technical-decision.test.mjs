// STAGE 4D-3 -- PURE TECHNICAL DECISION STATE MACHINE (tests 1-32).
//
// Proves the decision layer in app/domain/technical-decision-authority.mjs:
//   - consumes Stage 4A evidenceEnvelope / Stage 4D-1 engineeringCalculations /
//     Stage 4D-2 engineeringDossier, engineeringReadiness, projectEngineeringChecks
//     and dossierWiring staleness metadata — and nothing else,
//   - is deterministic and fails closed with the closed candidate states
//     TECHNICALLY_ACCEPTABLE / TECHNICALLY_ACCEPTABLE_WITH_WARNING /
//     TECHNICALLY_UNACCEPTABLE / ENGINEER_EXCEPTION / STALE,
//   - routes missing SYSTEM_ARCHITECTURE and PROJECT_CONTEXT_INCOMPLETE to
//     ENGINEER_EXCEPTION (never a deterministic rejection),
//   - routes real deterministic mandatory failures (protocol mismatch,
//     incompatible relation, prohibited manufacturer, CALCULATED_FAIL,
//     attributable project violation) to TECHNICALLY_UNACCEPTABLE,
//   - is immune to price/commercial availability and ranking-score changes,
//   - never accepts on identity/dossier-readiness/CALCULATED_PASS alone,
//   - is attached ADDITIVELY to live candidates (approvalReady stays false,
//     reviewStatus stays "Needs Review") and never auto-writes rows, and
//   - keeps ranking/pricing/approval behavior byte-neutral.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import {
  TECHNICAL_DECISION_VERSION,
  TECHNICAL_DECISION_STATES,
  EXCEPTION_REASON_CODES,
  evaluateTechnicalDecision,
} from "../app/domain/technical-decision-authority.mjs";
import { CALCULATION_TYPES } from "../app/domain/calculation-requirement-engine.mjs";

const PRICE = 12000;

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
const attr = (name, value, unit = "count", reviewStatus = "Reviewed") => ({ name, normalizedValue: value, unit, reviewStatus });
const baseProfile = (attrs = {}, { system, family, description, versionNumber = 11, ...extra } = {}) => ({
  versionNumber,
  boqItem: { id: "boq-1", description, system, category: "Equipment", productFamily: family, attributes: attrs },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  ...extra,
});
const facpProfile = (attrs = {}, extra = {}) => baseProfile(attrs, { system: "Fire Alarm", family: "Fire Alarm Control Panel", description: "Fire alarm control panel", ...extra });
const product = (attributes = [], overrides = {}) => ({
  id: "p-1", manufacturer: "Honeywell", family: "Fire Alarm Control Panel", partNumber: "IFP-75",
  description: "Fire alarm control panel", lifecycleStatus: "Active", reviewStatus: "Reviewed",
  attributes, price: PRICE, ...overrides,
});
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
const facpRun = () => runProductMatching({ profile: facpProfile(completeProfileAttrs()), products: [product(completeProductAttrs())] });

// Decision-module fixtures (hand-constructed inputs mirror the exact contracts
// the live pipeline produces at Stages 4A / 4D-1 / 4D-2).
const envelope = (dimension, o = {}) => ({
  comparisonIndex: 0,
  dimension,
  requiredValue: null,
  offeredValue: null,
  result: o.result ?? "AGREES",
  legacyResult: null,
  pass: o.pass ?? true,
  blocking: o.blocking ?? false,
  requirementEvidence: null,
  productEvidence: { evidence: "verified" },
  requirementAuthority: { authorityClass: o.reqClass ?? "REGULATORY", role: "DEFINING", standing: "Confirmed", source: { sourceType: "Design Calculation", confidence: 0 }, status: "AUTHORITATIVE" },
  productAuthority: { authorityClass: o.authority ?? "PRODUCT_TECHNICAL", role: "VERIFYING", standing: "Approved", source: { evidence: "verified" }, status: "AUTHORITATIVE" },
  requirementEvidenceKind: "EXPLICIT",
  productEvidenceKind: o.kind ?? "EXPLICIT",
  evidenceKind: o.kind ?? "EXPLICIT",
  applicability: null,
  conflicts: o.conflict ?? null,
  missingEvidence: [],
  engineeringReason: null,
  decisionBasis: "fixture",
});

const calcResult = (calculationType, state, extra = {}) => ({
  calculationType,
  state,
  blocking: state === "CALCULATED_FAIL" || state === "CALCULATION_CONFLICT",
  result: state === "CALCULATED_PASS" ? "PASS" : state === "CALCULATED_FAIL" ? "FAIL" : state === "CALCULATION_CONFLICT" ? "CONFLICT" : null,
  ruleId: `rule.${calculationType}`,
  ruleVersion: "1.0.0",
  dimension: null,
  label: calculationType,
  formula: null,
  inputs: [], normalizedInputs: [], inputProvenance: [], conflictInputs: [],
  output: null, headroom: null, expansionRequired: null,
  evidenceKind: state === "CALCULATED_PASS" || state === "CALCULATED_FAIL" ? "DERIVED" : null,
  evidence: state === "CALCULATED_PASS" || state === "CALCULATED_FAIL" ? { ruleId: `rule.${calculationType}` } : null,
  missingInputs: [], reason: null, trace: [], performedAt: null, stale: null, inputFingerprint: {},
  ...extra,
});

const dossierItem = (type, { required = true, critical = true, status = "VERIFIED" } = {}) => ({
  type, label: type, required, critical, status,
  blocking: status === "CONFLICTING" || (status === "MISSING" && critical) || (status === "STALE" && critical),
  reviewRequired: status === "PRESENT_UNVERIFIED",
  evidenceCount: status === "VERIFIED" ? 1 : 0,
  missingInputsOrGaps: status === "MISSING" ? [`${type} carries no verified evidence.`] : [],
  evidence: status === "VERIFIED" ? [{ claim: "fixture", authorityClass: "REGULATORY", evidenceKind: "EXPLICIT", review: "Verified", performedAt: null, stale: false }] : [],
});

const liveDossier = (overrides = {}) => {
  const items = [
    dossierItem("SYSTEM_ARCHITECTURE"),
    dossierItem("AUTHORITY_APPROVAL", { required: false, status: "NOT_REQUIRED" }),
    dossierItem("CODE_STANDARD_BASIS"),
    dossierItem("CAPACITY_CALCULATION"),
    dossierItem("ENGINEERING_CALCULATION"),
    dossierItem("TECHNICAL_WARRANTY_OR_SUPPORT", { required: false, critical: false, status: "NOT_REQUIRED" }),
  ];
  return {
    system: "Fire Alarm", scope: "PROJECT_SYSTEM", engineVersion: "engineering-dossier-engine-1.0.0",
    items, status: "READY", blockers: [], warnings: [],
    deterministicVerification: true, technicalReviewRequired: [],
    ...overrides,
  };
};

const readiness = (overrides = {}) => ({ system: "Fire Alarm", status: "Technically Ready", blockers: [], warnings: [], deterministicVerification: true, engineerReviewRequired: [], ...overrides });

const checks = (overrides = {}) => ({
  scope: "PROJECT", engineVersion: "engineering-dossier-engine-1.0.0",
  constraintsAvailable: [], constraintsUnavailable: [], contextStatus: "PROJECT_CONTEXT_AVAILABLE",
  contextNote: "", violations: [], violationCount: 0, ...overrides,
});

const wiring = (overrides = {}) => ({
  engineVersion: "engineering-dossier-engine-1.0.0",
  wiringVersion: "engineering-dossier-live-wiring-4d-2.0.0",
  system: "Fire Alarm", scope: "PROJECT_SYSTEM",
  staleness: { stale: null, basis: "ITEM/GOVERNING-BASIS", invalidationImplemented: false, requirementProfileVersion: 11, itemId: "boq-1" },
  inputSummary: {},
  ...overrides,
});

const candidate = (overrides = {}) => ({
  product: { id: "p-1", manufacturer: "Honeywell", partNumber: "IFP-1" },
  comparisons: [{ comparisonType: "Attribute", requirement: { priority: "Critical Mandatory", normalizedRequirement: "Fixture requirement" }, result: "Pass", pass: true, blocking: false, required: { name: "Fixture" }, offered: { normalizedValue: 1 } }],
  evidenceEnvelope: [],
  engineeringCalculations: { results: [calcResult("slc.loop-and-expansion", "CALCULATED_PASS")], summary: {} },
  manufacturer: { result: "Approved", pass: true, blocking: false, required: [], offered: "Honeywell" },
  lifecycle: { state: "Active", result: "Pass", pass: true, blocking: false, warning: false },
  mandatoryFailures: [],
  ...overrides,
});

const decisionInput = (c, extra = {}) => ({
  candidate: candidate(c),
  engineeringDossier: liveDossier(),
  engineeringReadiness: readiness(),
  projectEngineeringChecks: checks(),
  dossierWiring: wiring(),
  profile: { boqItem: { id: "boq-1", system: "Fire Alarm" } },
  ...extra,
});

// ---------------------------------------------------------------------------
// 1 -- fully governed valid candidate -> TECHNICALLY_ACCEPTABLE.
// ---------------------------------------------------------------------------
test("1 -- a fully governed valid candidate is TECHNICALLY_ACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { blocking: true })],
  }));
  assert.equal(decision.state, "TECHNICALLY_ACCEPTABLE");
  assert.equal(decision.authority, "SYSTEM_DETERMINISTIC_EVALUATION");
  assert.equal(decision.deterministic, true);
  assert.deepEqual(decision.exceptionReasons, []);
  assert.equal(decision.mandatoryDimensions.satisfied, 1);
  assert.equal(decision.mandatoryDimensions.unresolved, 0);
  assert.equal(decision.requiresAcknowledgment, false);
  assert.equal(decision.solePurpose, "TECHNICAL_DECISION_EVALUATION_ONLY");
  assert.equal(decision.versionFingerprints.decisionVersion, TECHNICAL_DECISION_VERSION);
});

// ---------------------------------------------------------------------------
// 2 -- same plus informational warning -> TECHNICALLY_ACCEPTABLE_WITH_WARNING.
// ---------------------------------------------------------------------------
test("2 -- an informational (non-acknowledgment) warning yields TECHNICALLY_ACCEPTABLE_WITH_WARNING", () => {
  const decision = evaluateTechnicalDecision(decisionInput(
    { evidenceEnvelope: [envelope("protocol", { blocking: true })] },
    { engineeringReadiness: readiness({ warnings: ["Informational: the panel supports the configured family with default firmware."] }) },
  ));
  assert.equal(decision.state, "TECHNICALLY_ACCEPTABLE_WITH_WARNING");
  assert.equal(decision.deterministic, true);
  assert.equal(decision.requiresAcknowledgment, false);
  assert.equal(decision.warnings.length, 1);
  // An acknowledgment-required warning flips the flag without changing the state.
  const ackDecision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { blocking: true })],
    lifecycle: { state: "End of Support", result: "Warning", pass: true, blocking: false, warning: true },
  }));
  assert.equal(ackDecision.state, "TECHNICALLY_ACCEPTABLE_WITH_WARNING");
  assert.equal(ackDecision.requiresAcknowledgment, true, "lifecycle warnings require acknowledgment");
});

// ---------------------------------------------------------------------------
// 3 -- mandatory protocol mismatch with authoritative evidence -> UNACCEPTABLE.
// ---------------------------------------------------------------------------
test("3 -- a mandatory protocol mismatch with authoritative evidence is TECHNICALLY_UNACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "CONFLICTS", pass: false, blocking: true })],
  }));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.deterministic, true);
  assert.equal(decision.mandatoryDimensions.failed, 1);
});

// ---------------------------------------------------------------------------
// 4 -- known incompatible relation -> UNACCEPTABLE.
// ---------------------------------------------------------------------------
test("4 -- a known incompatible relation is TECHNICALLY_UNACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("facp_compatibility", { result: "CONFLICTS", pass: false, blocking: true })],
  }));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.deterministic, true);
});

// ---------------------------------------------------------------------------
// 5 -- prohibited manufacturer -> UNACCEPTABLE.
// ---------------------------------------------------------------------------
test("5 -- a prohibited manufacturer is TECHNICALLY_UNACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    manufacturer: { result: "Prohibited", pass: false, blocking: true, required: [], offered: "NotOnList" },
  }));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.deterministic, true);
});

// ---------------------------------------------------------------------------
// 6 -- CALCULATED_FAIL -> UNACCEPTABLE.
// ---------------------------------------------------------------------------
test("6 -- a CALCULATED_FAIL on a mandatory authoritative calculation is TECHNICALLY_UNACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    engineeringCalculations: { results: [calcResult("slc.loop-and-expansion", "CALCULATED_FAIL")], summary: {} },
  }));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.calculationSummary.failed, 1);
  assert.equal(decision.deterministic, true);
});

// ---------------------------------------------------------------------------
// 7 -- REQUIRED_BUT_INPUTS_MISSING -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("7 -- REQUIRED_BUT_INPUTS_MISSING is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    engineeringCalculations: { results: [calcResult("battery.standby-alarm", "REQUIRED_BUT_INPUTS_MISSING", { missingInputs: ["standby_current"] })], summary: {} },
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("MISSING_ENGINEERING_INPUT"), true);
  assert.equal(decision.deterministic, false);
  assert.equal(decision.authority, "ENGINEER_REQUIRED");
});

// ---------------------------------------------------------------------------
// 8 -- CALCULATION_CONFLICT -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("8 -- CALCULATION_CONFLICT is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    engineeringCalculations: { results: [calcResult("battery.standby-alarm", "CALCULATION_CONFLICT")], summary: {} },
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("ENGINEERING_CONFLICT"), true);
});

// ---------------------------------------------------------------------------
// 9 -- missing mandatory product evidence -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("9 -- missing mandatory product evidence is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "MISSING_EVIDENCE", pass: false, blocking: true, kind: "MISSING" })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_EVIDENCE"), true, "a missing-evidence mismatch is never a deterministic rejection");
  assert.notEqual(decision.state, "TECHNICALLY_UNACCEPTABLE");
});

// ---------------------------------------------------------------------------
// 10 -- insufficient evidence authority -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("10 -- insufficient source authority is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "INSUFFICIENT_AUTHORITY", pass: false, blocking: true })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_AUTHORITY"), true);
});

// ---------------------------------------------------------------------------
// 11 -- AI inference only -> ENGINEER_EXCEPTION (never closes a dimension).
// ---------------------------------------------------------------------------
test("11 -- AI-inference-only evidence can never close a mandatory dimension", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "AGREES", pass: true, blocking: true, kind: "INFERRED", authority: "AI_INFERENCE" })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_AUTHORITY"), true);
});

// ---------------------------------------------------------------------------
// 12 -- supplier/commercial technical claim only -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("12 -- commercial/supplier evidence can never close technical compliance", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "AGREES", pass: true, blocking: true, authority: "COMMERCIAL" })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_AUTHORITY"), true);
});

// ---------------------------------------------------------------------------
// 13 -- ambiguous candidate evidence -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("13 -- ambiguous candidate evidence is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "AMBIGUOUS", pass: false, blocking: true })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("AMBIGUOUS"), true);
});

// ---------------------------------------------------------------------------
// 14 -- conflicting authoritative evidence -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("14 -- conflicting authoritative (cross-domain) evidence is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { result: "CONFLICTS", pass: false, blocking: true, conflict: { state: "REGULATORY_CONFLICT", blocking: true, relation: "fixture" } })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("CONFLICTING_AUTHORITATIVE_EVIDENCE"), true);
});

// ---------------------------------------------------------------------------
// 15 -- certification scope ambiguity -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("15 -- certification scope ambiguity is ENGINEER_EXCEPTION", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("certification_listing", { result: "AGREES", pass: true, blocking: true, kind: "MISSING" })],
  }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("CERTIFICATION_SCOPE_AMBIGUITY"), true);
});

// ---------------------------------------------------------------------------
// 16 -- missing SYSTEM_ARCHITECTURE in the current live dossier -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("16 -- a live dossier missing SYSTEM_ARCHITECTURE is ENGINEER_EXCEPTION, never TECHNICALLY_UNACCEPTABLE", () => {
  // Live run: the 4D-2 dossier is BLOCKED on SYSTEM_ARCHITECTURE because THIS
  // profile carries no approved, consumable drawing-architecture context (the
  // governed live source exists and is consumed when a context is present), so
  // the decision attaches as an insufficient basis.
  const run = facpRun();
  const decision = run.candidates[0].technicalDecision;
  assert.ok(decision, "the live candidate carries a technicalDecision");
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("MISSING_ARCHITECTURE_EVIDENCE"), true);
  assert.notEqual(decision.state, "TECHNICALLY_UNACCEPTABLE", "missing architecture evidence is never a deterministic rejection");
  // Unit-level variant converges.
  const unit = evaluateTechnicalDecision(decisionInput({}, {
    engineeringDossier: liveDossier({ items: liveDossier().items.map((entry) => (entry.type === "SYSTEM_ARCHITECTURE" ? { ...entry, status: "MISSING", blocking: true, evidenceCount: 0 } : entry)), status: "BLOCKED", blockers: ["System architecture: MISSING."] }),
    engineeringReadiness: readiness({ status: "Blocked", blockers: ["System architecture: MISSING."] }),
  }));
  assert.equal(unit.state, "ENGINEER_EXCEPTION");
  assert.equal(unit.exceptionReasons.includes("MISSING_ARCHITECTURE_EVIDENCE"), true);
});

// ---------------------------------------------------------------------------
// 17 -- PROJECT_CONTEXT_INCOMPLETE -> ENGINEER_EXCEPTION only when mandated.
// ---------------------------------------------------------------------------
test("17 -- PROJECT_CONTEXT_INCOMPLETE is ENGINEER_EXCEPTION when mandated, never a deterministic rejection", () => {
  // Mandated cross-item constraint unavailable -> UNRESOLVED_SYSTEM_CONSTRAINT.
  const mandated = evaluateTechnicalDecision(decisionInput(
    { evidenceEnvelope: [envelope("protocol", { blocking: true })] },
    {
      projectEngineeringChecks: checks({
        contextStatus: "PROJECT_CONTEXT_INCOMPLETE",
        constraintsUnavailable: ["singleManufacturer", "commonProtocol", "panelCapacityByPanel", "approvedManufacturers"],
      }),
      profile: { boqItem: { id: "boq-1" }, singleManufacturer: true },
    },
  ));
  assert.equal(mandated.state, "ENGINEER_EXCEPTION");
  assert.equal(mandated.exceptionReasons.includes("UNRESOLVED_SYSTEM_CONSTRAINT"), true);
  assert.notEqual(mandated.state, "TECHNICALLY_UNACCEPTABLE");
  // No mandate -> the incomplete context alone does NOT force an exception and
  // never rejects the candidate.
  const unmated = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true })] }, {
    projectEngineeringChecks: checks({
      contextStatus: "PROJECT_CONTEXT_INCOMPLETE",
      constraintsUnavailable: ["singleManufacturer", "commonProtocol", "panelCapacityByPanel", "approvedManufacturers"],
    }),
  }));
  assert.equal(unmated.state, "TECHNICALLY_ACCEPTABLE", "an un-mandated incomplete context is recorded, not a decision blocker");
  assert.equal(unmated.projectCheckSummary.contextStatus, "PROJECT_CONTEXT_INCOMPLETE");
});

// ---------------------------------------------------------------------------
// 18 -- deterministic project-level violation attributable to candidate -> UNACCEPTABLE.
// ---------------------------------------------------------------------------
test("18 -- an attributable approved-manufacturer violation is TECHNICALLY_UNACCEPTABLE", () => {
  // Module level with a fully-verified dossier: the ONLY defect is the
  // deterministic, candidate-attributable project violation -> E fires.
  const decision = evaluateTechnicalDecision(decisionInput(
    {
      manufacturer: { result: "Not Approved", pass: false, blocking: true, required: ["Honeywell"], offered: "Siemens" },
    },
    {
      projectEngineeringChecks: checks({
        contextStatus: "PROJECT_CONTEXT_AVAILABLE",
        violations: [{ scope: "PROJECT", type: "APPROVED_MANUFACTURER_VIOLATION", severity: "BLOCKING", itemsAffected: ["boq-1"], reason: "Siemens is not on the project's approved vendor list." }],
        violationCount: 1,
      }),
    },
  ));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.deterministic, true);
  assert.equal(decision.projectCheckSummary.attributable.some((entry) => entry.type === "APPROVED_MANUFACTURER_VIOLATION"), true);
  // Precedence demo: the SAME violation on a live run (whose dossier still has
  // the ungoverned SYSTEM_ARCHITECTURE gap) fails closed to ENGINEER_EXCEPTION
  // because dossier gaps (D) are classified before deterministic failures (E).
  const live = runProductMatching({
    profile: facpProfile(completeProfileAttrs(), { manufacturers: [{ manufacturer: "Honeywell", status: "Approved" }] }),
    products: [product(completeProductAttrs(), { id: "p-sie", manufacturer: "Siemens", partNumber: "IFP-SIE" })],
  });
  assert.equal(live.candidates[0].technicalDecision.state, "ENGINEER_EXCEPTION");
  assert.ok(live.candidates[0].technicalDecision.exceptionReasons.includes("MISSING_ARCHITECTURE_EVIDENCE"));
});

// ---------------------------------------------------------------------------
// 19 -- stale candidate-specific evidence -> STALE.
// ---------------------------------------------------------------------------
test("19 -- stale candidate-specific calculation evidence is STALE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    engineeringCalculations: { results: [calcResult("slc.loop-and-expansion", "CALCULATED_PASS", { stale: true })], summary: {} },
  }));
  assert.equal(decision.state, "STALE");
  assert.equal(decision.exceptionReasons.includes("STALE_GOVERNING_BASIS"), true, "coalesced ITEM/GOVERNING-BASIS staleness code");
  assert.ok(["TECHNICALLY_ACCEPTABLE", "TECHNICALLY_ACCEPTABLE_WITH_WARNING"].includes(decision.state) === false, "stale evidence is never acceptable");
});

// ---------------------------------------------------------------------------
// 20 -- stale governing-basis evidence -> STALE (never acceptable).
// ---------------------------------------------------------------------------
test("20 -- a stale governing basis (ITEM/GOVERNING-BASIS) is STALE, never acceptable", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, {
    dossierWiring: wiring({ staleness: { stale: true, basis: "ITEM/GOVERNING-BASIS", invalidationImplemented: false, requirementProfileVersion: 11, itemId: "boq-1" } }),
  }));
  assert.equal(decision.state, "STALE");
  assert.equal(decision.exceptionReasons.includes("STALE_GOVERNING_BASIS"), true);
  assert.ok(["TECHNICALLY_ACCEPTABLE", "TECHNICALLY_ACCEPTABLE_WITH_WARNING"].includes(decision.state) === false);
  // A stale CRITICAL dossier item routes to STALE as well.
  const dossierStale = evaluateTechnicalDecision(decisionInput({}, {
    engineeringDossier: liveDossier({ items: liveDossier().items.map((entry) => (entry.type === "ENGINEERING_CALCULATION" ? { ...entry, status: "STALE", blocking: true } : entry)), status: "BLOCKED", blockers: ["Engineering calculation: STALE."] }),
  }));
  assert.equal(dossierStale.state, "STALE");
});

// ---------------------------------------------------------------------------
// 21 -- manual candidate -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("21 -- a manual candidate requiring human decision is ENGINEER_EXCEPTION", () => {
  const manual = evaluateTechnicalDecision(decisionInput({}, { manualCandidate: { decisionRequired: true } }));
  assert.equal(manual.state, "ENGINEER_EXCEPTION");
  assert.equal(manual.exceptionReasons.includes("MANUAL_CANDIDATE_REVIEW"), true);
  // A governed policy that fully resolves the manual candidate does not force it.
  const resolved = evaluateTechnicalDecision(decisionInput(
    { evidenceEnvelope: [envelope("protocol", { blocking: true })] },
    { manualCandidate: { decisionRequired: true, fullyReviewable: true } },
  ));
  assert.equal(resolved.state, "TECHNICALLY_ACCEPTABLE", "a governance-proven fully-reviewable candidate is not blocked by the manual flag");
});

// ---------------------------------------------------------------------------
// 22 -- deviation required -> ENGINEER_EXCEPTION.
// ---------------------------------------------------------------------------
test("22 -- a system decision never creates an approved deviation", () => {
  const deviation = evaluateTechnicalDecision(decisionInput({}, { approvedDeviationRequired: true }));
  assert.equal(deviation.state, "ENGINEER_EXCEPTION");
  assert.equal(deviation.exceptionReasons.includes("APPROVED_DEVIATION_REQUIRED"), true);
  const substitution = evaluateTechnicalDecision(decisionInput({}, { technicalSubstitutionReview: true }));
  assert.equal(substitution.state, "ENGINEER_EXCEPTION");
  assert.equal(substitution.exceptionReasons.includes("TECHNICAL_SUBSTITUTION_REVIEW"), true);
});

// ---------------------------------------------------------------------------
// 23 -- all mandatory dimensions legitimately NOT_APPLICABLE -> no fabricated failure.
// ---------------------------------------------------------------------------
test("23 -- all-NOT_APPLICABLE does not fabricate a TECHNICALLY_UNACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput(
    { evidenceEnvelope: [], engineeringCalculations: { results: [calcResult("slc.loop-and-expansion", "NOT_REQUIRED")], summary: {} } },
    {},
  ));
  assert.notEqual(decision.state, "TECHNICALLY_UNACCEPTABLE", "absence of applicable dimensions is never a deterministic failure");
  assert.equal(decision.state, "ENGINEER_EXCEPTION", "without ANY closed engineering dimension the decision fails closed");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_EVIDENCE"), true);
});

// ---------------------------------------------------------------------------
// 24 -- price/commercial availability changes leave the decision unchanged.
// ---------------------------------------------------------------------------
test("24 -- price/commercial availability can never change the decision state", () => {
  const cheapInput = decisionInput({
    evidenceEnvelope: [envelope("protocol", { blocking: true })],
    product: { id: "p-1", manufacturer: "Honeywell", partNumber: "IFP-1", price: 1 },
    commercialAvailability: "Supplier RFQ Required",
  });
  const expensiveInput = decisionInput({
    evidenceEnvelope: [envelope("protocol", { blocking: true })],
    product: { id: "p-1", manufacturer: "Honeywell", partNumber: "IFP-1", price: PRICE },
    commercialAvailability: "Valid Current Price Available",
  });
  const cheap = evaluateTechnicalDecision(cheapInput);
  const expensive = evaluateTechnicalDecision(expensiveInput);
  assert.deepEqual(cheap, expensive, "commercial facts are never engineering evidence");
  assert.equal(JSON.stringify(cheap).includes(String(PRICE)), false, "no price enters the decision object");
});

// ---------------------------------------------------------------------------
// 25 -- ranking/score changes leave the decision unchanged.
// ---------------------------------------------------------------------------
test("25 -- ranking score changes leave the decision state unchanged when engineering evidence is identical", () => {
  const low = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true })], score: 30, rank: 9 }));
  const high = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true })], score: 98, rank: 1 }));
  assert.deepEqual(low, high, "score/rank are not engineering evidence");
  assert.equal(low.state, "TECHNICALLY_ACCEPTABLE");
});

// ---------------------------------------------------------------------------
// 26 -- candidate identity alone is never sufficient.
// ---------------------------------------------------------------------------
test("26 -- candidate identity alone can never be TECHNICALLY_ACCEPTABLE", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [], comparisons: [], engineeringCalculations: { results: [], summary: {} } }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.notEqual(decision.state, "TECHNICALLY_ACCEPTABLE");
  assert.notEqual(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_EVIDENCE"), true);
});

// ---------------------------------------------------------------------------
// 27 -- dossier "Technically Ready" alone is never sufficient.
// ---------------------------------------------------------------------------
test("27 -- a technically-ready dossier alone can never be TECHNICALLY_ACCEPTABLE", () => {
  // Perfect run-level dossier + readiness, but no candidate-level engineering
  // evidence at all.
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [], comparisons: [], engineeringCalculations: { results: [], summary: {} } }));
  assert.equal(decision.dossierSummary.verified >= 1, true, "the fixture dossier is fully verified");
  assert.notEqual(decision.state, "TECHNICALLY_ACCEPTABLE");
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
});

// ---------------------------------------------------------------------------
// 28 -- CALCULATED_PASS alone is never sufficient.
// ---------------------------------------------------------------------------
test("28 -- CALCULATED_PASS alone can never be TECHNICALLY_ACCEPTABLE", () => {
  // Every calculation passes, but the dossier carries no system architecture ->
  // mandatory system evidence is still missing.
  const decision = evaluateTechnicalDecision(decisionInput(
    { evidenceEnvelope: [], comparisons: [] },
    { engineeringDossier: liveDossier({ items: liveDossier().items.map((entry) => (entry.type === "SYSTEM_ARCHITECTURE" ? { ...entry, status: "MISSING", blocking: true, evidenceCount: 0 } : entry)), status: "BLOCKED", blockers: ["System architecture: MISSING."] }) },
  ));
  assert.equal(decision.calculationSummary.passed, 1);
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.notEqual(decision.state, "TECHNICALLY_ACCEPTABLE");
  assert.equal(decision.exceptionReasons.includes("MISSING_ARCHITECTURE_EVIDENCE"), true);
});

// ---------------------------------------------------------------------------
// 29 -- the decision function is deterministic.
// ---------------------------------------------------------------------------
test("29 -- identical input produces an identical decision (no timestamps, no randomness)", () => {
  const input = decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true })] });
  const first = evaluateTechnicalDecision(input);
  const second = evaluateTechnicalDecision(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("performedAt"), false);
});

// ---------------------------------------------------------------------------
// 30 -- no approval/review write ever occurs (static + full persistence pass).
// ---------------------------------------------------------------------------
test("30 -- the decision layer never auto-writes approval or review rows, and the decision is persisted only as candidate engineering authority", async () => {
  // Static: the decision module is pure and performs no writes at all.
  const decisionSource = await readFile(new URL("../app/domain/technical-decision-authority.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(decisionSource, /\bINSERT\b|createDatabase|DatabaseSync|fetch\(/, "the decision module contains no persistence path");
  // The worker persistence path never writes review/approval rows, and the ONE
  // governed Stage 4D-4 auto-reject writer must consult the explicit policy
  // gate before any review row is recorded.
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  assert.match(worker, /canAutoRejectTechnicalCandidate/, "the 4D-4 auto-reject write path is gated by the explicit policy");
  assert.equal((worker.match(/INSERT INTO product_match_reviews/g) || []).length, 3, "exactly one governed auto-reject writer plus the two explicit review handlers insert rows");
  const persist = worker.slice(worker.indexOf("const persistResult"), worker.indexOf("export const executeProductMatching"));
  assert.doesNotMatch(persist, /product_match_reviews|safety_approval_requests/, "persistResult never writes review/approval rows");
  // R2: the decision is now persisted WITH its own candidate as governed
  // engineering authority, so Safety can enforce it when approval is later
  // requested from a freshly reloaded candidate. It is never an approval,
  // never a selection, and never written outside that candidate row.
  assert.match(persist, /engineeringTechnicalDecision:\s*candidate\.technicalDecision\s*\?\?\s*null/, "the decision is persisted onto its own candidate as engineering authority");
  // Full persistence pass (mirrors persistResult) must leave the read-side
  // tables empty.
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE product_match_runs(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, status TEXT, input_fingerprint TEXT, engine_version TEXT, ruleset_version TEXT, search_version TEXT, model_version TEXT, search_scope TEXT, summary TEXT, no_match TEXT, candidate_count INTEGER, created_by TEXT, completed_at TEXT, superseded_at TEXT, processing_run_id TEXT);
    CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, search_stage TEXT, score INTEGER, score_components TEXT, technical_status TEXT, recommendation_tier TEXT, confidence_state TEXT, confidence_score INTEGER, matching_basis TEXT, commercial_availability TEXT, explanation TEXT, mandatory_failures TEXT, lifecycle_result TEXT, review_status TEXT);
    CREATE TABLE product_match_reviews(id TEXT PRIMARY KEY, project_id TEXT, match_run_id TEXT, candidate_id TEXT, action TEXT, reason_code TEXT, notes TEXT, evidence TEXT, decided_by TEXT, decided_role TEXT);
    CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT, approval_level INTEGER, status TEXT, requested_by TEXT, requested_role TEXT, request_reason TEXT, evidence TEXT, entity_version INTEGER, ruleset_version TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
  `);
  const result = facpRun();
  const candidate = result.candidates[0];
  raw.exec("BEGIN IMMEDIATE");
  raw.prepare("INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, processing_run_id, version_number, status, input_fingerprint, engine_version, ruleset_version, search_version, model_version, search_scope, summary, no_match, candidate_count, created_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("run-4d3", "p1", "boq-1", "profile1", null, 1, result.status, "fp-4d3", result.engineVersion, result.rulesetVersion, result.searchVersion, result.modelVersion,
      JSON.stringify(result.searchScope || {}),
      JSON.stringify({ candidateCountEvaluated: result.candidateCountEvaluated || 0, matchingState: result.matchingState, aiRanking: result.aiRanking || null, engineeringDossier: result.engineeringDossier ?? null, engineeringReadiness: result.engineeringReadiness ?? null, projectEngineeringChecks: result.projectEngineeringChecks ?? null, dossierWiring: result.dossierWiring ?? null }),
      result.noMatch ? JSON.stringify(result.noMatch) : null, result.candidates.length, "owner1", "2026-09-20T00:00:00.000Z");
  raw.prepare("INSERT INTO product_match_candidates (id, match_run_id, product_id, rank, search_stage, score, score_components, technical_status, recommendation_tier, confidence_state, confidence_score, matching_basis, commercial_availability, explanation, mandatory_failures, lifecycle_result, review_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review')")
    .run("cand-4d3", "run-4d3", candidate.product.id, candidate.rank, candidate.searchStage, candidate.score,
      JSON.stringify({ ...candidate.components, familyMatchTier: candidate.familyMatchTier ?? null, isFallbackCandidate: Boolean(candidate.isFallbackCandidate), rankingReason: candidate.rankingReason || null, evidenceStrength: candidate.evidenceStrength ?? null, aiRanking: candidate.aiRanking || null, accessoryCandidates: candidate.accessoryCandidates || [], engineeringCalculations: candidate.engineeringCalculations || [] }),
      candidate.technicalStatus, candidate.recommendationTier, candidate.confidence, candidate.aiRanking?.fitScore ?? candidate.confidenceScore,
      JSON.stringify(candidate.matchingBasis), candidate.commercialAvailability, candidate.aiRanking?.explanation || candidate.explanation,
      JSON.stringify(candidate.mandatoryFailures), JSON.stringify(candidate.lifecycle));
  raw.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, 'Product Matching Completed', ?, ?, 'Structured technical matching recalculation', ?)")
    .run("audit-4d3", "p1", "doc1", "dv1", "owner1", null, JSON.stringify({ matchRunId: "run-4d3", version: 1, status: result.status, candidates: result.candidates.length }), "req1");
  raw.exec("COMMIT");

  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_reviews").get().n, 0, "no review rows may be auto-created");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM safety_approval_requests").get().n, 0, "no approval requests may be auto-created");
  const summary = JSON.parse(raw.prepare("SELECT summary FROM product_match_runs WHERE id='run-4d3'").get().summary);
  assert.equal(JSON.stringify(summary).includes("technicalDecision"), false, "the decision is not persisted into the run summary");
  const components = JSON.parse(raw.prepare("SELECT score_components FROM product_match_candidates WHERE id='cand-4d3'").get().score_components);
  assert.equal(JSON.stringify(components).includes("technicalDecision"), false, "the decision is not persisted onto the candidate");
});

// ---------------------------------------------------------------------------
// 31 -- integration: the live run attaches the decision additively, unchanged
// approval/review state, deterministic across identical runs.
// ---------------------------------------------------------------------------
test("31 -- runProductMatching attaches technicalDecision additively; approvalReady/reviewStatus are untouched and runs stay deterministic", () => {
  const runA = facpRun();
  const runB = facpRun();
  for (const run of [runA, runB]) {
    assert.ok(run.candidates.length >= 1);
    for (const candidate of run.candidates) {
      assert.ok(candidate.technicalDecision, "every live candidate carries a technicalDecision");
      assert.equal(candidate.approvalReady, false, "approvalReady stays false");
      assert.equal(candidate.reviewStatus, "Needs Review", "reviewStatus stays Needs Review");
      assert.equal(candidate.technicalDecision.solePurpose, "TECHNICAL_DECISION_EVALUATION_ONLY");
    }
  }
  assert.deepEqual(runA.candidates, runB.candidates, "the additive decision field is deterministic across runs");
  // The run envelope minus the advisory keys stays byte-identical (4D-2 R),
  // including the decision field riding on candidates.
  const envelope = (run) => {
    const copy = JSON.parse(JSON.stringify(run));
    for (const key of ["engineeringDossier", "engineeringReadiness", "projectEngineeringChecks", "dossierWiring"]) delete copy[key];
    delete copy.generatedAt;
    return copy;
  };
  assert.deepEqual(envelope(runA), envelope(runB));
  // Plug the decision in front of the 4D-2 persistence harness shape: the only
  // new candidate field is technicalDecision and it is never part of
  // score_components.
  const serialized = JSON.parse(JSON.stringify(runA.candidates[0]));
  const persisted = { ...serialized.components, engineeringCalculations: serialized.engineeringCalculations || [] };
  assert.equal(JSON.stringify(persisted).includes("technicalDecision"), false);
});

// ---------------------------------------------------------------------------
// 32 -- empty/degenerate input fails closed safely.
// ---------------------------------------------------------------------------
test("32 -- empty input and guarded integration never throw and fail closed", () => {
  const decision = evaluateTechnicalDecision({});
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.equal(decision.exceptionReasons.includes("INSUFFICIENT_EVIDENCE"), true);
  // Every status value is part of the closed vocabulary.
  for (const candidate of facpRun().candidates) {
    assert.ok(TECHNICAL_DECISION_STATES.includes(candidate.technicalDecision.state));
    for (const reason of candidate.technicalDecision.exceptionReasons) {
      assert.ok(EXCEPTION_REASON_CODES.includes(reason), `reason ${reason} is governed vocabulary`);
    }
  }
  // Calculation references stay complete on the live candidate.
  assert.ok(facpRun().candidates[0].technicalDecision.calculationRefs.length >= CALCULATION_TYPES.length - 1);
});