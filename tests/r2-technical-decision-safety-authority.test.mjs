import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  evaluateSafety,
  validateOverride,
  TECHNICAL_DECISION_AUTHORITY_CODES,
  technicalDecisionGate,
} from "../app/domain/confidence-safety-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const matchApi = read("worker/product-matching-api.mjs");
const safetyApi = read("worker/confidence-safety-api.mjs");

// R2 -- 4D Technical Decision -> Safety -> Technical Approval authority.
// The governed 4D decision is the engineering authority for a candidate.
// Safety must fail closed on it so an unacceptable / stale / unresolved /
// absent decision can never become technically approvable through the
// independent Safety path. Warning states are NOT rejections.

const item = { id: "boq-1", projectId: "project-1", system: "Fire Alarm", category: "Detection Device", description: "Addressable smoke detector", unit: "No.", quantity: 20, productFamily: "Addressable Smoke Detector", sourceDocumentId: "doc-1", sourceLocation: { sheet: "BOQ", row: 12 }, extractionConfidence: 96 };
const profile = { id: "profile-1", versionNumber: 1, readiness: { status: "Ready for Matching" }, confidence: { applicability: 95 }, standards: [{ body: "EN54", number: "7" }], compatibility: [{ targetItem: "Farenhyt protocol" }], accessories: [{ accessory: "Detector base" }], categoryFields: { environment: "Indoor" }, derivedRequirements: [] };
const provenance = { complete: true, confidence: 100, documentClassificationConfidence: 98, specificationExtractionConfidence: 96 };
const user = { id: "reviewer-1" };
const price = { productId: "p1", candidateId: "candidate-1", approvalStatus: "Approved", sourceId: "quote-1", currency: "SAR", validUntil: "2099-01-01" };
const baseCandidate = (overrides = {}) => ({ id: "candidate-1", searchStage: "Structured", technicalStatus: "Technically Compliant", recommendationTier: "Recommended Candidate", confidence: "High Confidence", product: { id: "p1", partNumber: "IDP-PHOTO-W", reviewStatus: "Reviewed", sourceReliability: "Manufacturer Verified" }, comparisons: [{ pass: true, result: "Pass" }], standards: [{ pass: true, result: "Verified Compliant", evidence: { documentId: "datasheet" } }], compatibility: [{ pass: true, result: "Verified Compatible", evidence: { documentId: "compatibility" } }], accessories: [{ pass: true, result: "Pass" }], lifecycle: { state: "Active", result: "Pass", blocking: false, warning: false }, mandatoryFailures: [], commercialAvailability: "Valid Current Price Available", provenance: { productSource: { documentId: "catalogue" } }, ...overrides });
const decision = (overrides = {}) => ({ state: "TECHNICALLY_ACCEPTABLE", authority: "SYSTEM_DETERMINISTIC_EVALUATION", deterministic: true, reasons: [], exceptionReasons: [], technicalFailures: [], warnings: [], requiresAcknowledgment: false, versionFingerprints: { decisionVersion: "technical-decision-1.0.0", requirementProfileVersion: 1, itemId: "boq-1" }, ...overrides });
const evaluate = (candidateOverrides = {}, other = {}) => evaluateSafety({ item, profile, candidate: baseCandidate(candidateOverrides), provenance, prices: [price], user, ...other });

// Baseline proof: the fixture is genuinely eligible, so any 4D effect below is
// caused by the 4D gate and nothing else.
test("R2 baseline -- the governed fixture is technically eligible before any 4D gate exists", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision() });
  assert.equal(result.approvalEligibility.technical, "Eligible for Technical Approval");
  assert.equal(result.approvalReady, true);
});

// CASE A -- ACCEPTABLE: Safety continues; 4D does not itself approve.
test("R2 CASE A -- an ACCEPTABLE 4D decision does not block Safety and does not itself approve", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision() });
  assert.equal(result.blocks.some((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.BLOCKED), false);
  assert.equal(result.approvalReady, true, "4D acceptance removes no existing gate");
  assert.equal(result.approvalEligibility.price, "Price Approval Disabled", "4D acceptance is never commercial authority");
});

// CASE B -- BLOCKED / UNACCEPTABLE: fail closed, non-overridable.
test("R2 CASE B -- a TECHNICALLY_UNACCEPTABLE decision makes the candidate non-approvable and non-overridable", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision({ state: "TECHNICALLY_UNACCEPTABLE", technicalFailures: [{ type: "CALCULATED_FAIL" }] }) });
  const blocked = result.blocks.find((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.BLOCKED);
  assert.ok(blocked, "the unacceptable decision must produce a block");
  assert.equal(blocked.overridable, false, "a proven deterministic technical failure is not overridable");
  assert.equal(result.approvalReady, false);
  assert.doesNotMatch(result.approvalEligibility.technical, /^Eligible/);
  const override = validateOverride({ safetyDecision: result, request: { approvalLevel: 5, blockCodes: [blocked.code], reason: "Attempted commercial exception", technicalJustification: "Attempted justification", evidence: { documentId: "a" }, scope: "Project", expiresAt: "2099-01-01" }, user });
  assert.equal(override.permitted, false, "no governed exception may rescue a proven technical failure");
});

// CASE C -- MISSING decision: fail closed, non-overridable.
test("R2 CASE C -- an absent 4D decision fails closed", () => {
  for (const value of [undefined, null, {}, { state: null }, { state: "SOMETHING_ELSE" }]) {
    const result = evaluate({ engineeringTechnicalDecision: value });
    const blocked = result.blocks.find((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.MISSING);
    assert.ok(blocked, `absent/unknown decision must fail closed (${JSON.stringify(value)})`);
    assert.equal(blocked.overridable, false);
    assert.equal(result.approvalReady, false);
    assert.doesNotMatch(result.approvalEligibility.technical, /^Eligible/);
  }
  // A candidate with no decision field at all is equally unsafe.
  const noField = evaluate({});
  assert.equal(noField.approvalReady, false);
  assert.ok(noField.blocks.some((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.MISSING));
});

// CASE D -- WARNING: never a rejection; routes to acknowledgment.
test("R2 CASE D -- ACCEPTABLE_WITH_WARNING warns and is not rejected", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision({ state: "TECHNICALLY_ACCEPTABLE_WITH_WARNING", warnings: ["Governing design criterion is advisory."] }) });
  assert.equal(result.blocks.some((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.WARNING), false, "a warning state must never become a block");
  const warned = result.warnings.find((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.WARNING);
  assert.ok(warned, "the warning must be surfaced");
  assert.equal(warned.blocking, false);
  assert.equal(result.approvalEligibility.technical, "Eligible with Required Warning Acknowledgment");
  assert.equal(result.approvalReady, true, "warnings route to acknowledgment, not rejection");
});

// ENGINEER_EXCEPTION: not approvable, but the EXISTING governed override is the
// escape hatch (fail closed without inventing a new approval system).
test("R2 -- ENGINEER_EXCEPTION is not directly approvable but reuses the existing governed exception path", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision({ state: "ENGINEER_EXCEPTION", authority: "ENGINEER_REQUIRED", deterministic: false, exceptionReasons: ["MISSING_ARCHITECTURE_EVIDENCE"] }) });
  const blocked = result.blocks.find((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.EXCEPTION);
  assert.ok(blocked);
  assert.equal(result.approvalReady, false);
  assert.doesNotMatch(result.approvalEligibility.technical, /^Eligible/);
  const override = validateOverride({ safetyDecision: result, request: { approvalLevel: 3, blockCodes: [blocked.code], reason: "Engineer records the project-specific exception basis", technicalJustification: "Documented engineering determination", evidence: { documentId: "panel-schedule" }, scope: "Project", expiresAt: "2099-01-01" }, user });
  assert.equal(override.permitted, true, "an engineer exception routes to the EXISTING governed override mechanism");
});

// STALE: fail closed, non-overridable (consistent with 4D-4 refusing STALE).
test("R2 -- a STALE 4D decision fails closed and is non-overridable", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision({ state: "STALE", exceptionReasons: ["STALE_GOVERNING_BASIS"] }) });
  const blocked = result.blocks.find((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.STALE);
  assert.ok(blocked);
  assert.equal(blocked.overridable, false);
  assert.equal(result.approvalReady, false);
});

// CASE E -- WRONG CANDIDATE: the decision is evaluated per candidate, so a
// blocked decision can never authorize a different candidate.
test("R2 CASE E -- a decision authorizes only the candidate it is attached to", () => {
  const acceptable = evaluateSafety({ item, profile, candidate: baseCandidate({ id: "candidate-A", engineeringTechnicalDecision: decision() }), provenance, prices: [price], user });
  const blocked = evaluateSafety({ item, profile, candidate: baseCandidate({ id: "candidate-B", engineeringTechnicalDecision: decision({ state: "TECHNICALLY_UNACCEPTABLE" }) }), provenance, prices: [price], user });
  assert.equal(acceptable.approvalReady, true);
  assert.equal(blocked.approvalReady, false, "candidate B's blocked decision blocks only B");
  assert.equal(acceptable.approvalEligibility.price, "Price Approval Disabled");
});

// CASE F -- STALE / older decision: the 4D state itself is the currency signal.
test("R2 CASE F -- a stale or incompatible decision cannot authorize approval", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision({ state: "STALE" }) });
  assert.equal(result.approvalReady, false);
  assert.ok(result.blocks.some((entry) => entry.code === TECHNICAL_DECISION_AUTHORITY_CODES.STALE));
});

// CASE G -- COMMERCIAL evidence can never bypass the technical gate.
test("R2 CASE G -- strong commercial evidence cannot override a blocked 4D decision", () => {
  const result = evaluate({ engineeringTechnicalDecision: decision({ state: "TECHNICALLY_UNACCEPTABLE" }) }, { prices: [price], });
  assert.equal(result.approvalReady, false, "an approved current price does not rescue technical authority");
  assert.doesNotMatch(result.approvalEligibility.technical, /^Eligible/);
});

// CASE H -- DISCOVERY / non-governed path stays intact.
test("R2 CASE H -- discovery candidates remain blocked by the discovery rule, unchanged by the 4D gate", () => {
  const result = evaluate({ searchStage: "Semantic Discovery", recommendationTier: "Discovery Candidate", engineeringTechnicalDecision: decision() });
  assert.ok(result.blocks.some((entry) => entry.code === "DISCOVERY_ONLY"), "the pre-existing discovery block is untouched");
  assert.equal(result.approvalReady, false);
  // Retrieval is a matching concern and is NOT gated by Safety: the 4D gate only
  // affects approval eligibility, never candidate retrieval.
  assert.doesNotMatch(read("app/domain/product-matching-engine.mjs"), /technicalDecision\.state\s*===\s*"TECHNICALLY_/, "matching/retrieval must not branch on 4D approval state");
});

// The gate is centralised and pure.
test("R2 -- technicalDecisionGate maps every 4D state through one governed contract", () => {
  assert.equal(technicalDecisionGate(decision()).outcome, "accepted");
  assert.equal(technicalDecisionGate(decision({ state: "TECHNICALLY_ACCEPTABLE_WITH_WARNING" })).outcome, "warning");
  assert.equal(technicalDecisionGate(decision({ state: "TECHNICALLY_UNACCEPTABLE" })).outcome, "blocked");
  assert.equal(technicalDecisionGate(decision({ state: "STALE" })).outcome, "blocked");
  assert.equal(technicalDecisionGate(decision({ state: "ENGINEER_EXCEPTION" })).outcome, "exception");
  assert.equal(technicalDecisionGate(null).outcome, "missing");
  assert.equal(technicalDecisionGate({ state: "UNKNOWN_FUTURE_STATE" }).outcome, "missing", "unknown future states fail closed");
});

// Non-bypassability: the decision is persisted with the candidate (so a later
// approval cannot reload a candidate without it) and both approval write paths
// already gate on Safety's technical eligibility.
test("R2 -- the 4D decision is persisted onto its own candidate and both approval paths gate on eligibility", () => {
  assert.match(matchApi, /engineeringTechnicalDecision:\s*candidate\.technicalDecision\s*\?\?\s*null/, "persistResult must persist the decision with its candidate");
  assert.match(safetyApi, /engineeringTechnicalDecision/, "evaluationInput must expose the persisted decision to Safety");
  // Path 1: direct technical approval.
  assert.match(safetyApi, /\/\^Eligible\/\.test\(current\.technical_eligibility\)/, "direct technical approval must require Eligible eligibility");
  // Path 2: review-workflow "Approve Technical Match".
  const reviewApi = read("worker/review-workflow-api.mjs");
  assert.match(reviewApi, /technical_eligibility\s*!==\s*"Eligible"/, "review technical approval must require Eligible eligibility");
  // The decision module itself stays pure: it never writes.
  const decisionSource = read("app/domain/technical-decision-authority.mjs");
  assert.doesNotMatch(decisionSource, /\bINSERT\b|createDatabase|DatabaseSync|fetch\(/, "the 4D decision module remains a pure evaluator");
});
