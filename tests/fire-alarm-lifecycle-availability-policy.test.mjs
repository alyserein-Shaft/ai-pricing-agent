// Project policy under test (authoritative user decision):
//
//   Product lifecycle and regional availability are NOT hard blockers for
//   technical matching. A technically suitable product with valid evidence
//   may be matched even when another market marks it discontinued, when KSA
//   stock is unconfirmed, or when supplier availability is unchecked. Those
//   become informational/review warnings.
//
// The real blockers that remain are technical/project: protocol
// incompatibility, panel/device incompatibility, required performance not met,
// insufficient capacity, required certification not met, explicit project
// specification prohibition, explicit consultant/AHJ requirement, a
// design/calculation violation, or an unresolved mandatory requirement that
// materially affects correctness.
//
// This suite proves BOTH halves: lifecycle cannot block, and genuine technical
// incompatibility still blocks.
//
// NOTE ON THE FIXTURE. Attribute comparisons are contract-gated and only
// compare normalized forms, so both the requirement and the product attribute
// use `normalizedValue` (same shape as tests/product-matching-engine.test.mjs).
// An attribute that is genuinely satisfied is the only variable under test
// here, so lifecycle is the sole possible cause of any status change.
import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { evaluateTechnicalDecision } from "../app/domain/technical-decision-authority.mjs";
import { canAutoRejectTechnicalCandidate, AUTO_REJECT_ELIGIBLE_FAILURE_TYPES } from "../app/domain/auto-reject-policy.mjs";
import { evaluateSafety } from "../app/domain/confidence-safety-engine.mjs";

const profile = (overrides = {}) => ({
  versionNumber: 1,
  boqItem: { id: "boq-fa-1", description: "Addressable photoelectric smoke detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Smoke Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [{
    id: "r-addressing",
    normalizedRequirement: "Individually addressable device",
    priority: "Critical Mandatory",
    attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }],
  }],
  standards: [],
  compatibility: [],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
  ...overrides,
});

const product = (overrides = {}) => ({
  id: "p-notifier",
  manufacturer: "Notifier",
  family: "Addressable Smoke Detector",
  partNumber: "FSP-951-IV",
  description: "Intelligent addressable photoelectric smoke detector, FlashScan and CLIP protocol",
  lifecycleStatus: "Current",
  reviewStatus: "Reviewed",
  attributes: [{ name: "addressing", normalizedValue: "Addressable" }],
  standards: [],
  compatibility: [],
  accessories: [],
  source: { sheet: "Catalogue", row: 1 },
  ...overrides,
});

const match = (lifecycleStatus, productOverrides = {}, profileOverrides = {}) =>
  runProductMatching({ profile: profile(profileOverrides), products: [product({ lifecycleStatus, ...productOverrides })] }).candidates[0];

// The only satisfied comparison is `addressing`; standards/compatibility/
// accessories are empty so nothing else can contribute a status change.

test("0 -- baseline: a satisfied requirement with a current product is fully compliant", () => {
  const candidate = match("Current");
  assert.equal(candidate.technicalStatus, "Technically Compliant", "sanity check: the fixture has no hidden failure");
  assert.equal(candidate.mandatoryFailures.length, 0);
  assert.equal(candidate.lifecycle.warning, false);
});

test("1 -- US discontinued does not block a technically compliant candidate", () => {
  const candidate = match("Discontinued");
  assert.equal(candidate.technicalStatus, "Compliant with Warnings", "a compliant product is downgraded only to a warning, never to Non-Compliant");
  assert.notEqual(candidate.technicalStatus, "Non-Compliant");
  assert.notEqual(candidate.recommendationTier, "Rejected Candidate");
  assert.equal(candidate.mandatoryFailures.length, 0, "lifecycle must never appear as a mandatory failure");
  assert.equal(candidate.lifecycle.blocking, false, "lifecycle is never blocking");
  assert.equal(candidate.lifecycle.warning, true, "an availability warning is still raised");
});

test("2 -- unknown KSA stock does not block matching and warns instead", () => {
  // Per the regional authority, absent evidence normalises to "Unverified",
  // which is NOT an adverse finding: it must neither block nor downgrade.
  for (const state of ["Unknown", "Unknown — Review Required", "Availability Unconfirmed"]) {
    const candidate = match(state);
    assert.notEqual(candidate.technicalStatus, "Non-Compliant", `${state} must not block`);
    assert.equal(candidate.lifecycle.blocking, false, `${state} must not block`);
    assert.equal(candidate.lifecycle.state, "Unverified", `${state} is absent evidence, not an adverse finding`);
    assert.equal(candidate.lifecycle.warning, false, `${state} must not warn -- the cause is absent evidence`);
  }
});

test("2b -- KSA regional availability is reported but never blocks technical eligibility", () => {
  const candidate = runProductMatching({
    profile: profile(),
    products: [product({
      lifecycleStatus: "Current",
      regionalLifecycle: [{ region: "US", state: "Discontinued" }],
    })],
  }).candidates[0];
  assert.equal(candidate.technicalStatus, "Technically Compliant", "a US-only phase-out must not downgrade this project");
  assert.equal(candidate.lifecycle.projectRegion, "KSA");
  assert.equal(candidate.lifecycle.projectRegionAvailability, "Unverified", "KSA availability is unconfirmed, not adverse");
  assert.equal(candidate.lifecycle.blocking, false);
});

test("3 -- the availability warning remains visible and reaches the decision surface", () => {
  const candidate = match("Discontinued");
  assert.equal(candidate.lifecycle.state, "Discontinued", "the raw lifecycle state is preserved for the engineer");
  const decision = evaluateTechnicalDecision({ candidate, dossierWiring: { governingBasisCurrent: true }, reasons: [], warnings: [], exceptionReasons: [] });
  assert.ok(
    decision.warnings.some((entry) => /lifecycle/i.test(String(entry))),
    "the technical decision must carry a lifecycle warning",
  );
  assert.ok(!decision.technicalFailures.some((entry) => /LIFECYCLE/i.test(String(entry.type))), "lifecycle is never a deterministic failure");
});

test("3b -- a replacement-candidate lifecycle state is fully clean", () => {
  const candidate = match("Discontinued — Replacement Candidate");
  assert.equal(candidate.lifecycle.warning, false);
  assert.equal(candidate.lifecycle.blocking, false);
  assert.equal(candidate.technicalStatus, "Technically Compliant");
});

test("3c -- lifecycle is never an automatic rejection ground", () => {
  const decision = evaluateTechnicalDecision({
    candidate: match("Discontinued"),
    dossierWiring: { governingBasisCurrent: true },
    reasons: [], warnings: [], exceptionReasons: [],
  });
  assert.ok(!AUTO_REJECT_ELIGIBLE_FAILURE_TYPES.includes("BLOCKED_LIFECYCLE"));
  assert.equal(canAutoRejectTechnicalCandidate(decision, { governingBasisCurrent: true }).eligible, false);
});

test("3d -- safety treats a discontinued candidate as warned, never blocked", () => {
  const candidate = match("Discontinued");
  const safety = evaluateSafety({
    item: candidate.product,
    profile: { readiness: { status: "Ready for Matching", blockingReasons: [] } },
    candidate,
    provenance: { complete: true, productSource: { documentId: "d1" } },
    user: { id: "technical-reviewer" },
  });
  assert.ok(!safety.blocks.some((entry) => entry.code === "LIFECYCLE_BLOCK"), "lifecycle must never produce a safety block");
  assert.ok(safety.warnings.some((entry) => entry.code === "LIFECYCLE_WARNING"), "the availability warning must remain visible");
});

test("4 -- a real technical incompatibility still blocks even when lifecycle is clean", () => {
  const candidate = match("Current", { attributes: [{ name: "addressing", normalizedValue: "Conventional" }] });
  assert.equal(candidate.technicalStatus, "Non-Compliant");
  assert.equal(candidate.recommendationTier, "Rejected Candidate");
  assert.ok(candidate.mandatoryFailures.length > 0, "a proven mandatory mismatch is still a mandatory failure");
});

test("4b -- a discontinued product with a real incompatibility is still blocked, not warned through", () => {
  const candidate = match("Discontinued", { attributes: [{ name: "addressing", normalizedValue: "Conventional" }] });
  assert.equal(candidate.technicalStatus, "Non-Compliant", "lifecycle policy must not launder a genuine technical failure");
  assert.ok(candidate.mandatoryFailures.length > 0);
  assert.equal(candidate.lifecycle.warning, true, "the availability warning is still reported alongside the failure");
});

test("4c -- an unresolved mandatory requirement still routes to Technical Review Required", () => {
  const candidate = runProductMatching({
    profile: profile({
      consolidatedRequirements: [{ id: "r-protocol", normalizedRequirement: "Compatible with Flash Scan and CLIP protocol systems", priority: "Mandatory", attributes: [] }],
    }),
    products: [product({ lifecycleStatus: "Discontinued" })],
  }).candidates[0];
  assert.equal(candidate.technicalStatus, "Technical Review Required");
  assert.equal(candidate.recommendationTier, "Pending Evidence");
  assert.equal(candidate.mandatoryFailures.length, 0, "missing evidence is never a failure");
  assert.ok(candidate.mandatoryUnresolved.length > 0);
});
