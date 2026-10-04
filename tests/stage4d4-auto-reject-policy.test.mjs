// STAGE 4D-4 -- DETERMINISTIC TECHNICAL AUTO-REJECTION POLICY (tests 1-37).
//
// Stage 4D-3 proved each candidate's technical decision state; Stage 4D-4 is
// the FIRST live automatic technical action and it is DETERMINISTIC REJECTION
// ONLY. This suite proves:
//   - the pure gate canAutoRejectTechnicalCandidate fails closed and only ever
//     allows a PROVEN, CURRENT, CANDIDATE-ATTRIBUTABLE deterministic
//     technical failure (protocol/attribute mismatch, incompatible relation,
//     prohibited manufacturer, blocked lifecycle, certification contradiction,
//     governed CALCULATED_FAIL, attributable project violation),
//   - missing evidence / insufficient authority / ambiguity / missing
//     architecture / calc-input gaps / project-context / regulatory-AHJ /
//     manual / deviation / stale conditions NEVER auto-reject (the engineer
//     exception wins),
//   - the governed write path recordAutoRejections creates exactly one review
//     row per run+candidate, is idempotent, preserves audit history, updates
//     only the candidate review_status (never commercial/selection state), and
//     never writes safety_approval_requests or touches pricing,
//   - ordering/score and price-availability facts never influence eligibility,
//   - the live matching engine attaches autoRejectEligibility additively and
//     deterministically without changing approval/review state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { evaluateTechnicalDecision } from "../app/domain/technical-decision-authority.mjs";
import {
  AUTO_REJECT_POLICY_VERSION,
  AUTO_REJECT_ELIGIBLE_FAILURE_TYPES,
  canAutoRejectTechnicalCandidate,
  evaluateAutoRejectEligibility,
  reasonCodeForAutoReject,
} from "../app/domain/auto-reject-policy.mjs";
import { recordAutoRejections } from "../worker/product-matching-api.mjs";

const PRICE = 12000;

// ---------------------------------------------------------------------------
// Fixtures (mirroring the exact Stage 4A / 4D-1 / 4D-2 contract shapes the
// decision module and the live pipeline produce).
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

const decisionInput = (c = {}, extra = {}) => ({
  candidate: candidate(c),
  engineeringDossier: liveDossier(),
  engineeringReadiness: readiness(),
  projectEngineeringChecks: checks(),
  dossierWiring: wiring(),
  profile: { boqItem: { id: "boq-1", system: "Fire Alarm" } },
  ...extra,
});

// A decision whose mandatory protocol dimension conflicts with authoritative
// governed evidence -> TECHNICALLY_UNACCEPTABLE with an
// ENVELOPE_MANDATORY_MISMATCH technicalFailure (the 4D-4 eligible shape).
const eligibleDecision = (overrides = {}, extra = {}) =>
  evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true, result: "CONFLICTS" })], ...overrides }, extra));

// A minimal, decision-shaped object for defensive gate tests (a real 4D-3
// decision would never combine these shapes; the gate must fail closed anyway).
const decisionShaped = (overrides = {}) => ({
  state: "TECHNICALLY_UNACCEPTABLE",
  authority: "SYSTEM_DETERMINISTIC_EVALUATION",
  deterministic: true,
  exceptionReasons: [],
  reasons: ["Fixture reason."],
  technicalFailures: [{ type: "ENVELOPE_MANDATORY_MISMATCH", dimension: "protocol", reason: "Protocol conflicts." }],
  mandatoryDimensions: { total: 1, satisfied: 0, failed: 1, unresolved: 0, notApplicable: 0 },
  evidenceRefs: [],
  calculationRefs: [],
  versionFingerprints: { decisionVersion: "technical-decision-authority-4d-3.0.0" },
  projectCheckSummary: { contextStatus: "PROJECT_CONTEXT_AVAILABLE", violations: [], attributable: [], blockingViolations: 0, warningViolations: 0, violationCount: 0 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// In-memory write-path harness (mirrors product_match_runs /
// product_match_candidates / product_match_reviews / safety_approval_requests).
// ---------------------------------------------------------------------------
const makeDb = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE product_match_runs(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, status TEXT, input_fingerprint TEXT, engine_version TEXT, ruleset_version TEXT, search_version TEXT, model_version TEXT, search_scope TEXT, summary TEXT, no_match TEXT, candidate_count INTEGER, created_by TEXT, completed_at TEXT, superseded_at TEXT, processing_run_id TEXT);
    CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, search_stage TEXT, score INTEGER, score_components TEXT, technical_status TEXT, recommendation_tier TEXT, confidence_state TEXT, confidence_score INTEGER, matching_basis TEXT, commercial_availability TEXT, explanation TEXT, mandatory_failures TEXT, lifecycle_result TEXT, review_status TEXT);
    CREATE TABLE product_match_reviews(id TEXT PRIMARY KEY, project_id TEXT, match_run_id TEXT, candidate_id TEXT, action TEXT, reason_code TEXT, notes TEXT, evidence TEXT, decided_by TEXT, decided_role TEXT);
    CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT, approval_level INTEGER, status TEXT, requested_by TEXT, requested_role TEXT, request_reason TEXT, evidence TEXT, entity_version INTEGER, ruleset_version TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
  `);
  return raw;
};

const seedRunCandidate = (raw, { runId = "run-1", candidateId = "cand-1", productId = "prod-1", reviewStatus = "Needs Review" } = {}) => {
  if (!raw.prepare("SELECT 1 FROM product_match_runs WHERE id=?").get(runId)) {
    raw.prepare("INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, version_number, status, input_fingerprint, engine_version, ruleset_version, search_version, model_version, search_scope, summary, candidate_count, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(runId, "p1", "boq-1", "profile1", 1, "Needs Review", "fp", "e", "r", "s", "m", "{}", "{}", 1, "owner1");
  }
  raw.prepare("INSERT INTO product_match_candidates (id, match_run_id, product_id, rank, search_stage, score, score_components, technical_status, recommendation_tier, confidence_state, confidence_score, matching_basis, commercial_availability, explanation, mandatory_failures, lifecycle_result, review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(candidateId, runId, productId, 1, "Structured", 90, "{}", "Technically Compliant", "Recommended Candidate", "Verified", 90, "[]", "Supplier RFQ Required", "x", "[]", "{}", reviewStatus);
};

// ---------------------------------------------------------------------------
// 1-8 -- eligible deterministic failures.
// ---------------------------------------------------------------------------
test("1 -- deterministic mandatory protocol mismatch is auto-reject eligible", () => {
  const decision = eligibleDecision();
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(decision.authority, "SYSTEM_DETERMINISTIC_EVALUATION");
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.blockReason, null);
  assert.equal(verdict.reasonCode, "PROTOCOL_MISMATCH");
  assert.ok(verdict.decisionFingerprint, "the proven decision carries a deterministic fingerprint");
});

test("2 -- mandatory attribute mismatch is auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("voltage", { blocking: true, result: "CONFLICTS" })] }));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.reasonCode, "MANDATORY_ATTRIBUTE_MISMATCH");
  assert.deepEqual(verdict.failureTypes, ["ENVELOPE_MANDATORY_MISMATCH"]);
});

test("3 -- known incompatible relation is auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("compatibility", { blocking: true, result: "CONFLICTS" })] }));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.reasonCode, "INCOMPATIBLE_RELATION");
  assert.equal(verdict.technicalFailures[0].dimension, "compatibility");
});

test("4 -- prohibited manufacturer is auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ manufacturer: { result: "Prohibited", pass: false, blocking: true, required: [], offered: "NotAllowedCo" } }));
  assert.ok(decision.technicalFailures.some((entry) => entry.type === "PROHIBITED_MANUFACTURER"));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.reasonCode, "PROHIBITED_MANUFACTURER");
});

// Project policy: lifecycle/availability is advisory only, so it is neither a
// deterministic technical failure nor an automatic rejection ground.
test("5 -- lifecycle state is never a deterministic failure and never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ lifecycle: { state: "Discontinued", result: "Blocked", pass: false, blocking: true, warning: false } }));
  assert.ok(!decision.technicalFailures.some((entry) => entry.type === "BLOCKED_LIFECYCLE"), "lifecycle must never be a deterministic failure");
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, false, "lifecycle must never auto-reject a candidate");
});

test("6 -- exact certification contradiction is auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("certification_listing", { blocking: true, result: "CONFLICTS" })] }));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.reasonCode, "CERTIFICATION_CONTRADICTION");
});

test("7 -- governed CALCULATED_FAIL with DERIVED evidence is auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    engineeringCalculations: { results: [calcResult("slc.loop-and-expansion", "CALCULATED_FAIL", { blocking: true })] },
  }));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.ok(decision.technicalFailures.some((entry) => entry.type === "CALCULATED_FAIL" && entry.calculationType === "slc.loop-and-expansion"));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.reasonCode, "CALCULATED_FAIL");
});

test("8 -- candidate-attributable project violation is auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, {
    projectEngineeringChecks: checks({
      violations: [{ type: "COMMON_PROTOCOL_VIOLATION", severity: "BLOCKING", itemsAffected: ["boq-1"], reason: "Candidate uses a protocol different from the rest of the installed system." }],
      violationCount: 1,
    }),
  }));
  assert.equal(decision.state, "TECHNICALLY_UNACCEPTABLE");
  assert.ok(decision.projectCheckSummary.attributable.some((entry) => entry.type === "COMMON_PROTOCOL_VIOLATION"));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.reasonCode, "PROJECT_VIOLATION");
});

// ---------------------------------------------------------------------------
// 9-22 -- ineligible conditions (engineer exception / stale / mixed win).
// ---------------------------------------------------------------------------
test("9 -- MISSING_EVIDENCE is never auto-reject eligible", () => {
  const realDecision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true, result: "MISSING_EVIDENCE" })] }));
  assert.equal(realDecision.state, "ENGINEER_EXCEPTION");
  assert.equal(canAutoRejectTechnicalCandidate(realDecision, { governingBasisCurrent: true }).eligible, false);
  // Defense: even a malformed decision pretending to be UNACCEPTABLE with a
  // missing-evidence exception mixed in must fail closed.
  const mixed = decisionShaped({ exceptionReasons: ["INSUFFICIENT_EVIDENCE"] });
  assert.equal(canAutoRejectTechnicalCandidate(mixed, { governingBasisCurrent: true }).blockReason, "ENGINEER_EXCEPTION_MIXED_IN");
});

test("10 -- INSUFFICIENT_AUTHORITY is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true, result: "INSUFFICIENT_AUTHORITY" })] }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.ok(decision.exceptionReasons.includes("INSUFFICIENT_AUTHORITY"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("11 -- AMBIGUOUS is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true, result: "AMBIGUOUS" })] }));
  assert.equal(decision.state, "ENGINEER_EXCEPTION");
  assert.ok(decision.exceptionReasons.includes("AMBIGUOUS"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("12 -- missing compatibility evidence is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("compatibility", { blocking: true, result: "MISSING_EVIDENCE" })] }));
  assert.ok(decision.exceptionReasons.includes("MISSING_COMPATIBILITY_EVIDENCE"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("13 -- missing SYSTEM_ARCHITECTURE is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, {
    engineeringDossier: liveDossier({ items: liveDossier().items.map((entry) => (entry.type === "SYSTEM_ARCHITECTURE" ? { ...entry, status: "MISSING", blocking: true, evidenceCount: 0 } : entry)), status: "BLOCKED", blockers: ["System architecture: MISSING."] }),
  }));
  assert.ok(decision.exceptionReasons.includes("MISSING_ARCHITECTURE_EVIDENCE"));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, false);
});

test("14 -- PROJECT_CONTEXT_INCOMPLETE is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, {
    projectEngineeringChecks: checks({ contextStatus: "PROJECT_CONTEXT_INCOMPLETE", constraintsUnavailable: ["singleManufacturer"] }),
    profile: { boqItem: { id: "boq-1", system: "Fire Alarm" }, singleManufacturer: true },
  }));
  assert.ok(decision.exceptionReasons.includes("UNRESOLVED_SYSTEM_CONSTRAINT"));
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, false);
});

test("15 -- regulatory / AHJ clarification is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true, result: "SUPERSEDED" })] }));
  assert.ok(decision.exceptionReasons.includes("REGULATORY_OR_AHJ_CLARIFICATION"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("16 -- manual candidate is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, { manualCandidate: { decisionRequired: true, fullyReviewable: false } }));
  assert.ok(decision.exceptionReasons.includes("MANUAL_CANDIDATE_REVIEW"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
  // The gate also fails closed when the write path flags manual judgment while
  // a nominal failure is present.
  const blocked = canAutoRejectTechnicalCandidate(eligibleDecision(), { governingBasisCurrent: true, manualCandidate: { decisionRequired: true, fullyReviewable: false } });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockReason, "MANUAL_CANDIDATE_JUDGMENT_REQUIRED");
});

test("17 -- approved-deviation required is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, { approvedDeviationRequired: true }));
  assert.ok(decision.exceptionReasons.includes("APPROVED_DEVIATION_REQUIRED"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
  const blocked = canAutoRejectTechnicalCandidate(eligibleDecision(), { governingBasisCurrent: true, approvedDeviationRequired: true });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockReason, "APPROVED_DEVIATION_REQUIRED");
});

test("18 -- a STALE candidate is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({}, {
    dossierWiring: wiring({ staleness: { stale: true, basis: "ITEM/GOVERNING-BASIS", invalidationImplemented: false, requirementProfileVersion: 99, itemId: "boq-1" } }),
  }));
  assert.equal(decision.state, "STALE");
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("19 -- stale governing basis is never auto-reject eligible", () => {
  const decision = decisionShaped({ exceptionReasons: ["STALE_GOVERNING_BASIS"] });
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.blockReason, "STALE_GOVERNING_BASIS");
});

test("20 -- mixed deterministic failure + engineer-exception condition is never auto-reject eligible", () => {
  const decision = decisionShaped({ exceptionReasons: ["INSUFFICIENT_EVIDENCE"] });
  const verdict = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.blockReason, "ENGINEER_EXCEPTION_MIXED_IN");
});

test("21 -- TECHNICALLY_ACCEPTABLE is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({ evidenceEnvelope: [envelope("protocol", { blocking: true })] }));
  assert.equal(decision.state, "TECHNICALLY_ACCEPTABLE");
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("22 -- TECHNICALLY_ACCEPTABLE_WITH_WARNING is never auto-reject eligible", () => {
  const decision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [envelope("protocol", { blocking: true })],
    lifecycle: { state: "Limited", result: "Warning", pass: true, blocking: false, warning: true },
  }));
  assert.equal(decision.state, "TECHNICALLY_ACCEPTABLE_WITH_WARNING");
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

// ---------------------------------------------------------------------------
// 23-28 -- governed write path (recordAutoRejections): one row, idempotent,
// auditable, never approval/pricing.
// ---------------------------------------------------------------------------
test("23 -- an eligible rejection creates exactly one governed review row", async () => {
  const raw = makeDb();
  seedRunCandidate(raw);
  const decision = eligibleDecision();
  const outcome = await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: decision }] },
    governingBasisCurrent: true,
  });
  assert.equal(outcome.recorded, 1);
  assert.equal(outcome.skipped, 0);
  const rows = raw.prepare("SELECT * FROM product_match_reviews").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.action, "Auto-Rejected Technical");
  assert.equal(row.decided_by, "system:deterministic-technical-evaluation");
  assert.equal(row.decided_role, "System");
  assert.equal(row.candidate_id, "cand-1");
  assert.ok(row.reason_code, "the review row carries a governed structured reason code");
  const evidence = JSON.parse(row.evidence);
  assert.ok(evidence.decisionFingerprint, "the evidence bundle records the deterministic decision fingerprint");
  assert.equal(evidence.decisionVersion, decision.versionFingerprints.decisionVersion);
  assert.equal(evidence.policyVersion, AUTO_REJECT_POLICY_VERSION);
  assert.equal(evidence.state, "TECHNICALLY_UNACCEPTABLE");
  assert.equal(evidence.authority, "SYSTEM_DETERMINISTIC_EVALUATION");
  assert.ok(evidence.failedDimensions.length >= 1, "failed dimensions are recorded");
  const status = raw.prepare("SELECT review_status FROM product_match_candidates WHERE id='cand-1'").get().review_status;
  assert.equal(status, "Auto-Rejected Technical");
});

test("24 -- the same run+candidate re-evaluated with the same decision never duplicates", async () => {
  const raw = makeDb();
  seedRunCandidate(raw);
  const decision = eligibleDecision();
  const input = {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: decision }] },
    governingBasisCurrent: true,
  };
  const first = await recordAutoRejections(raw, input);
  assert.equal(first.recorded, 1);
  // The policy fingerprint is deterministic for identical decisions.
  const gateA = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  const gateB = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  assert.equal(gateA.decisionFingerprint, gateB.decisionFingerprint);
  const second = await recordAutoRejections(raw, input);
  assert.equal(second.recorded, 0);
  assert.equal(second.skipped, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM product_match_reviews").get().n, 1, "no duplicate review row");
});

test("25 -- a changed decision fingerprint records a new current rejection while prior audit history is preserved", async () => {
  const raw = makeDb();
  seedRunCandidate(raw, { runId: "run-1", candidateId: "cand-1" });
  const firstDecision = eligibleDecision();
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: firstDecision }] },
    governingBasisCurrent: true,
  });
  // Upstream evidence changes -> a NEW run (new candidate row, new run id).
  seedRunCandidate(raw, { runId: "run-2", candidateId: "cand-2" });
  const secondDecision = evaluateTechnicalDecision(decisionInput({
    evidenceEnvelope: [
      envelope("protocol", { blocking: true, result: "CONFLICTS" }),
      envelope("standards", { blocking: true, result: "CONFLICTS" }),
    ],
  }));
  assert.notEqual(
    canAutoRejectTechnicalCandidate(secondDecision, { governingBasisCurrent: true }).decisionFingerprint,
    canAutoRejectTechnicalCandidate(firstDecision, { governingBasisCurrent: true }).decisionFingerprint,
    "changed evidence changes the resulting decision fingerprint",
  );
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-2",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: secondDecision }] },
    governingBasisCurrent: true,
  });
  const rows = raw.prepare("SELECT match_run_id, candidate_id, evidence FROM product_match_reviews").all();
  assert.equal(rows.length, 2, "the new current rejection is recorded without deleting the prior one");
  const byRun = new Map(rows.map((row) => [row.match_run_id, row]));
  assert.deepEqual([...byRun.keys()].sort(), ["run-1", "run-2"]);
  const prior = JSON.parse(byRun.get("run-1").evidence);
  const current = JSON.parse(byRun.get("run-2").evidence);
  assert.notEqual(prior.decisionFingerprint, current.decisionFingerprint);
  assert.ok(prior.decisionFingerprint && current.decisionFingerprint);
});

test("26 -- auto-reject never creates safety_approval_requests", async () => {
  // Static: the governed writer and the whole matching API have no approval
  // request insert path.
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  assert.equal((worker.match(/INSERT INTO safety_approval_requests/g) || []).length, 0);
  // Runtime harness: even an eligible rejection writes zero approval rows.
  const raw = makeDb();
  seedRunCandidate(raw);
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: eligibleDecision() }] },
    governingBasisCurrent: true,
  });
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM safety_approval_requests").get().n, 0);
});

test("27 -- auto-reject never makes pricing runtime accept the candidate", async () => {
  // GOV-AUTH-1 strengthened this from ignore to refuse: the pricing runtime
  // used to carry no auto-reject vocabulary at all, which meant an
  // auto-rejected candidate with a Technical approval priced exactly like a
  // live one (rejection was audit-only). The runtime now names the refused
  // statuses explicitly in its candidate query -- still no decision
  // consumption (no canAutoReject/autoRejectEligibility/decisionFingerprint
  // machinery), just the enforcement conjunct at the consumption choke.
  const pricing = await readFile(new URL("../worker/pricing-runtime.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(pricing, /canAutoRejectTechnicalCandidate|autoRejectEligibility|decisionFingerprint/);
  assert.match(pricing, /c\.review_status NOT IN \('Rejected','Auto-Rejected Technical'\)/);
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /INSERT INTO pricing|UPDATE.*price_records/, "the auto-reject writer never touches pricing data");
  // The candidate row keeps its governed technical-only status; no pricing or
  // approval state is created next to it.
  const raw = makeDb();
  seedRunCandidate(raw);
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: eligibleDecision() }] },
    governingBasisCurrent: true,
  });
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM safety_approval_requests").get().n, 0);
  assert.equal(raw.prepare("SELECT review_status FROM product_match_candidates WHERE id='cand-1'").get().review_status, "Auto-Rejected Technical");
});

test("28 -- the auto-rejected candidate remains stored, visible, and auditable", async () => {
  const raw = makeDb();
  seedRunCandidate(raw);
  const decision = eligibleDecision();
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: decision }] },
    governingBasisCurrent: true,
  });
  const candidateRows = raw.prepare("SELECT id, product_id, review_status FROM product_match_candidates").all();
  assert.equal(candidateRows.length, 1, "the candidate is never deleted");
  assert.equal(candidateRows[0].product_id, "prod-1");
  assert.equal(candidateRows[0].review_status, "Auto-Rejected Technical");
  const audit = raw.prepare("SELECT * FROM product_match_reviews WHERE candidate_id='cand-1' AND action='Auto-Rejected Technical'").get();
  assert.ok(audit);
  const evidence = JSON.parse(audit.evidence);
  assert.ok(evidence.versionFingerprints, "governing version fingerprints are retained for audit");
  assert.ok(evidence.decisionVersion);
  assert.ok(evidence.failureTypes.length >= 1);
});

// ---------------------------------------------------------------------------
// 29-34 -- status semantics, immunity to ordering/commercial facts, defensive
// handling, and per-candidate scope.
// ---------------------------------------------------------------------------
test("29 -- candidate status reflects technical rejection only, never commercial selection", async () => {
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  // The governed writer updates ONLY review_status, to a dedicated value that
  // is distinct from every approval/selection vocabulary.
  assert.equal((worker.match(/review_status='Auto-Rejected Technical'/g) || []).length, 1, "the single canonical status write lives in the governed auto-reject writer");
  // Scoped to writes on product_match_candidates: the rule is that the
  // candidate's own review_status is never set to an approval/selection value.
  // A read filter on an unrelated table (e.g. product_attributes) is not a
  // candidate status write and must not trip this gate.
  assert.doesNotMatch(worker, /UPDATE\s+product_match_candidates[^;]*review_status\s*=\s*'(Approved|Selected)'/i);
  assert.doesNotMatch(worker, /SET\s+review_status\s*=\s*'(Approved|Selected)'/i);
  const raw = makeDb();
  seedRunCandidate(raw);
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: { candidates: [{ product: { id: "prod-1" }, technicalDecision: eligibleDecision() }] },
    governingBasisCurrent: true,
  });
  const status = raw.prepare("SELECT review_status FROM product_match_candidates WHERE id='cand-1'").get().review_status;
  assert.equal(status, "Auto-Rejected Technical");
  assert.notEqual(status, "Approved");
  assert.notEqual(status, "Selected");
});

test("30 -- ordering/score facts never affect auto-reject eligibility", async () => {
  const decision = eligibleDecision();
  const baseline = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  const reordered = canAutoRejectTechnicalCandidate(decision, {
    governingBasisCurrent: true,
    candidate: { score: 99, aiRanking: { fitScore: 0.99 }, rank: 1 },
  });
  assert.deepEqual(reordered, baseline, "candidate ordering attributes are not inputs to the gate");
  const policy = await readPolicySource();
  assert.doesNotMatch(policy, /\.score\b|aiRanking|\brand\b|commercialAvailability/, "the pure gate never reads candidate ordering/commercial fields");
});

test("31 -- price availability changes never affect auto-reject eligibility", async () => {
  const decision = eligibleDecision();
  const baseline = canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true });
  const withPrice = canAutoRejectTechnicalCandidate(decision, {
    governingBasisCurrent: true,
    candidate: { price: 1000, commercialAvailability: "Project Price Available" },
  });
  assert.deepEqual(withPrice, baseline, "price availability is not an input to the gate");
  const policy = await readPolicySource();
  assert.doesNotMatch(policy, /price|priceRecords/, "the pure gate never reads commercial price facts");
});

test("32 -- identity-only information can never auto-reject", () => {
  // Even a malformed UNACCEPTABLE decision with no proven failure cannot act.
  const noFailure = decisionShaped({ technicalFailures: [] });
  const verdict = canAutoRejectTechnicalCandidate(noFailure, { governingBasisCurrent: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.blockReason, "NO_DETERMINISTIC_FAILURE");
  // A real identity-only decision routes to ENGINEER_EXCEPTION (4D-3 output),
  // which is equally unrejectable.
  const identityOnly = evaluateTechnicalDecision(decisionInput({}));
  assert.equal(identityOnly.state, "ENGINEER_EXCEPTION");
  assert.equal(canAutoRejectTechnicalCandidate(identityOnly, { governingBasisCurrent: true }).eligible, false);
});

test("33 -- defensive malformed/unknown technicalDecision never auto-rejects", () => {
  const cases = [null, undefined, "not-a-decision", 42, [], {}];
  for (const value of cases) {
    const verdict = canAutoRejectTechnicalCandidate(value, { governingBasisCurrent: true });
    assert.equal(verdict.eligible, false, `malformed input ${JSON.stringify(value)} fails closed`);
    assert.equal(verdict.blockReason, "MISSING_DECISION");
  }
  // Unknown state/authority on an otherwise decision-shaped object fails closed.
  assert.equal(canAutoRejectTechnicalCandidate(decisionShaped({ state: "WEIRD" }), { governingBasisCurrent: true }).blockReason, "NOT_TECHNICALLY_UNACCEPTABLE");
  assert.equal(canAutoRejectTechnicalCandidate(decisionShaped({ authority: "ENGINEER_REQUIRED" }), { governingBasisCurrent: true }).blockReason, "NON_DETERMINISTIC_AUTHORITY");
  const unknownFailure = canAutoRejectTechnicalCandidate(decisionShaped({ technicalFailures: [{ type: "MYSTERY_FAILURE", reason: "?" }] }), { governingBasisCurrent: true });
  assert.equal(unknownFailure.eligible, false);
  assert.equal(unknownFailure.blockReason, "INELIGIBLE_FAILURE_TYPE");
  // Currency must be explicitly asserted; a missing currency context fails closed.
  assert.equal(canAutoRejectTechnicalCandidate(eligibleDecision(), {}).blockReason, "GOVERNING_BASIS_NOT_CURRENT");
});

test("34 -- no unrelated candidate on the same BOQ item is modified", async () => {
  const raw = makeDb();
  seedRunCandidate(raw, { runId: "run-1", candidateId: "cand-1", productId: "prod-1" });
  seedRunCandidate(raw, { runId: "run-1", candidateId: "cand-2", productId: "prod-2" });
  const notEligible = evaluateTechnicalDecision(decisionInput({})); // ENGINEER_EXCEPTION
  await recordAutoRejections(raw, {
    projectId: "p1",
    matchRunId: "run-1",
    result: {
      candidates: [
        { product: { id: "prod-1" }, technicalDecision: eligibleDecision() },
        { product: { id: "prod-2" }, technicalDecision: notEligible },
      ],
    },
    governingBasisCurrent: true,
  });
  assert.equal(raw.prepare("SELECT review_status FROM product_match_candidates WHERE id='cand-1'").get().review_status, "Auto-Rejected Technical");
  assert.equal(raw.prepare("SELECT review_status FROM product_match_candidates WHERE id='cand-2'").get().review_status, "Needs Review", "the unrelated candidate is untouched");
  const rows = raw.prepare("SELECT candidate_id FROM product_match_reviews").all();
  assert.deepEqual(rows.map((row) => row.candidate_id), ["cand-1"], "only the eligible candidate got a review row");
});

// ---------------------------------------------------------------------------
// 35-37 -- live integration + purity + currency contract.
// ---------------------------------------------------------------------------
test("35 -- the live engine attaches autoRejectEligibility additively and deterministically", () => {
  const runA = facpRun();
  const runB = facpRun();
  for (const run of [runA, runB]) {
    assert.ok(run.candidates.length >= 1);
    for (const cand of run.candidates) {
      assert.ok(cand.autoRejectEligibility, "every live candidate carries the additive eligibility field");
      assert.equal(cand.autoRejectEligibility.policyVersion, AUTO_REJECT_POLICY_VERSION);
      // Live governed dossiers are blocked on missing SYSTEM_ARCHITECTURE (no
      // governed live source exists), so live candidates are ENGINEER_EXCEPTION
      // -- never deterministic auto-rejects.
      assert.equal(cand.autoRejectEligibility.eligible, false);
      assert.equal(cand.approvalReady, false);
      assert.equal(cand.reviewStatus, "Needs Review");
      // The eligibility field must never ride into persisted score_components.
      const persisted = JSON.stringify({ ...cand.components, engineeringCalculations: cand.engineeringCalculations || [] });
      assert.equal(persisted.includes("autoRejectEligibility"), false);
      assert.equal(persisted.includes("technicalDecision"), false);
    }
  }
  assert.deepEqual(runA.candidates, runB.candidates, "the additive eligibility field is deterministic across identical runs");
});

function readPolicySource() {
  return readFile(new URL("../app/domain/auto-reject-policy.mjs", import.meta.url), "utf8");
}

test("36 -- the policy gate module is pure: no writes, no I/O, no randomness", async () => {
  const source = await readPolicySource();
  assert.doesNotMatch(source, /\bINSERT\b|UPDATE |DELETE FROM|createDatabase|DatabaseSync|fetch\(|crypto\.|Math\.random/, "the gate contains no persistence or I/O");
  assert.equal(AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.length, 5);
  assert.ok(AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("ENVELOPE_MANDATORY_MISMATCH"));
  assert.ok(AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("CALCULATED_FAIL"));
  assert.ok(AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("PROHIBITED_MANUFACTURER"));
  assert.ok(AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("NOT_APPROVED_MANUFACTURER"));
  assert.ok(!AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("BLOCKED_LIFECYCLE"), "lifecycle/availability is advisory only and is never an auto-reject ground");
  assert.ok(AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("PROJECT_VIOLATION"));
});

test("37 -- currency is explicit: stale/governing-basis-not-current decisions cannot act", () => {
  // The gate refuses to act without an explicit current assertion.
  assert.equal(canAutoRejectTechnicalCandidate(eligibleDecision(), { governingBasisCurrent: false }).blockReason, "GOVERNING_BASIS_NOT_CURRENT");
  // The attach-oriented dry-run assumes a fresh run (decision already routed
  // staleness to STALE) and matches the full gate exactly.
  const decision = eligibleDecision();
  assert.deepEqual(evaluateAutoRejectEligibility(decision), canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }));
  assert.equal(evaluateAutoRejectEligibility(null).eligible, false);
  assert.equal(reasonCodeForAutoReject([]), null);
  assert.equal(reasonCodeForAutoReject([{ type: "CALCULATED_FAIL", calculationType: "battery" }]), "CALCULATED_FAIL");
});