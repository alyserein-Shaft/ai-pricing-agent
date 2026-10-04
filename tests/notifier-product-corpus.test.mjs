import test from "node:test";
import assert from "node:assert/strict";

import { buildCapacityFact, capacityOrUnresolved } from "../app/domain/scoped-product-capacity.mjs";
import {
  FLASHSCAN_PATENT,
  KSA_ACCEPTANCE_STATE,
  NON_COMPATIBLE_ECOSYSTEMS,
  NOTIFIER_EVIDENCE_GAPS,
  NOTIFIER_PRODUCT_IDENTITY,
  NOTIFIER_SCOPED_CAPACITY,
  NOTIFIER_SOURCE_REGISTER,
  SOURCE_EVIDENCE_TIER,
} from "../app/domain/notifier-product-corpus.mjs";

// PHASE D -- GOVERNED NOTIFIER CORPUS.
//
// This corpus is CANDIDATE evidence, never promoted authority. These tests
// assert the properties that keep it honest:
//   * every capacity fact is fully scoped and evidenced
//   * the research corrections are encoded (N16x is not a product; 3,180 is a
//     sum; CLIP is legacy/licence-gated; heat detectors are UL 521)
//   * the negative ecosystem findings are labelled as inference, not fact
//   * the KSA evidence gap stays visible and is never claimed as satisfied

test("EVERY capacity fact in the corpus is fully scoped, evidenced, and buildable", () => {
  assert.ok(NOTIFIER_SCOPED_CAPACITY.length > 0, "the corpus must carry capacity facts");
  for (const raw of NOTIFIER_SCOPED_CAPACITY) {
    const fact = buildCapacityFact({
      ...raw,
      // evidence in the corpus is a provenance object; the builder takes the
      // source id, which is what it persists.
      evidence: raw.evidence.sourceId,
      authority: raw.evidence.authority,
      reviewState: raw.reviewState,
    });
    assert.equal(fact.value, raw.value);
    assert.equal(fact.scopeType, raw.scopeType);
    assert.equal(fact.protocolMode, raw.protocolMode);
    assert.ok(NOTIFIER_SOURCE_REGISTER[raw.evidence.sourceId], "every fact cites a registered source: " + raw.evidence.sourceId);
    assert.ok(String(raw.evidence.locator || "").length > 0, "every fact cites a locator (page/section)");
  }
});

test("CORRECTION 1 -- N16x is a persona, not a product, and carries no part number", () => {
  const n16x = NOTIFIER_PRODUCT_IDENTITY.find((p) => p.model === "N16X");
  assert.ok(n16x, "the N16X persona must be represented");
  assert.deepEqual(n16x.partNumbers, [], "a persona has no purchasable part number");
  assert.equal(n16x.technicalEligibility, "PERSONA_NOT_PRODUCT", "it must not be selectable as a product");

  const n16e = NOTIFIER_PRODUCT_IDENTITY.find((p) => p.model === "N16E");
  assert.ok(n16e.partNumbers.length > 0, "the real model must carry its CPU part numbers");
  assert.equal(n16e.persona.default, "N16E");
  assert.equal(n16e.persona.loops, 3);
  assert.equal(n16e.persona.upgradeTo, "N16X");
  assert.equal(n16e.persona.upgradeLicence, "N16-XUPG", "the upgrade is licence-based, per the research");
});

test("CORRECTION 2 -- 3,180 is a device SUM; the per-class detector maximum stays 1,590", () => {
  const total = NOTIFIER_SCOPED_CAPACITY.find((f) => f.value === 3180 && f.scopeType === "FACP");
  const detectors = NOTIFIER_SCOPED_CAPACITY.find((f) => f.resourceClass === "detector" && f.scopeType === "FACP");
  assert.equal(total.resourceClass, "device", "3,180 is a device-class total");
  assert.equal(detectors.value, 1590, "detector class is 1,590, never 3,180");
  assert.notEqual(total.value, detectors.value);
});

test("CORRECTION 3 -- CLIP is a legacy/exception path requiring a licence", () => {
  const clipCapacity = NOTIFIER_SCOPED_CAPACITY.filter((f) => f.protocolMode === "CLIP");
  assert.ok(clipCapacity.length > 0, "CLIP capacity must be represented so it can be excluded, not ignored");
  for (const fact of clipCapacity) {
    assert.ok(fact.value <= 99 || fact.scopeType === "FACP", "CLIP per-loop ceilings are 99; only FACP totals differ");
  }
  const facp = NOTIFIER_SCOPED_CAPACITY.find((f) => f.resourceClass === "detector" && f.scopeType === "FACP" && f.protocolMode === "CLIP");
  assert.equal(facp.value, 990, "CLIP detector total is 990, roughly half the FlashScan 1,590");
  const flashScanDetectors = NOTIFIER_SCOPED_CAPACITY.find((f) => f.resourceClass === "detector" && f.scopeType === "FACP" && f.protocolMode === "FlashScan");
  assert.ok(flashScanDetectors.value > facp.value, "FlashScan exceeds CLIP; CLIP must never be designed to");
});

test("CORRECTION 4 -- a heat detector is UL 521, not UL 268/217", () => {
  const heat = NOTIFIER_PRODUCT_IDENTITY.find((p) => p.model === "FST-951");
  assert.ok(heat, "the heat detector must be present");
  const standards = heat.listings.map((l) => l.standard);
  assert.ok(standards.includes("UL 521"), "heat detectors are UL 521");
  assert.ok(!standards.includes("UL 268") && !standards.includes("UL 217"), "UL 268/217 must not be asserted for a heat detector");
  assert.ok(heat.documentError, "the manufacturer document error must stay recorded");
});

test("the negative ecosystem findings are labelled INFERENCE, never fact", () => {
  for (const key of ["skIdp", "hochikiSd"]) {
    const entry = NON_COMPATIBLE_ECOSYSTEMS[key];
    assert.equal(entry.compatibleWithNotifierSLC, false);
    assert.equal(
      entry.evidenceTier,
      SOURCE_EVIDENCE_TIER.INFERENCE_BY_EXCLUSION,
      key + " must be labelled inference by exclusion, not a manufacturer statement",
    );
    assert.match(entry.confidence, /INFERENCE/);
  }
});

test("the FlashScan patent named in the project specification is confirmed", () => {
  assert.equal(FLASHSCAN_PATENT.number, "US 5,539,389");
  assert.equal(FLASHSCAN_PATENT.status, "Expired");
});

test("the KSA evidence gap is explicit and never claimed satisfied", () => {
  assert.equal(KSA_ACCEPTANCE_STATE.state, "NOT_EVIDENCED");
  assert.equal(KSA_ACCEPTANCE_STATE.blocksContractualApproval, true, "it blocks contractual approval");
  // It must NOT block the technical handoff, or the whole track stalls on a
  // document we cannot obtain ourselves.
  assert.equal(KSA_ACCEPTANCE_STATE.blocksTechnicalPricingHandoff, false);
  const gap = NOTIFIER_EVIDENCE_GAPS.find((g) => g.id === "GAP-02");
  assert.ok(gap, "the KSA gap must be a tracked gap");
  assert.equal(gap.severity, "BLOCKING_FOR_KSA");
});

test("every product carries a reason, an exact model, and a candidate state", () => {
  for (const product of NOTIFIER_PRODUCT_IDENTITY) {
    assert.ok(product.manufacturer && product.brand, "exact identity requires manufacturer and brand");
    assert.ok(product.model, "exact identity requires a model");
    assert.ok(product.role, "each product states its role");
    assert.ok(product.evidence.length > 0, product.model + " must cite evidence");
    assert.equal(product.reviewState.startsWith("CANDIDATE"), true, product.model + " must remain a candidate, never promoted authority");
  }
});

test("the corpus is NOT ingested -- no product is silently trusted", () => {
  const selectable = NOTIFIER_PRODUCT_IDENTITY.filter((p) => p.technicalEligibility === "TECHNICALLY_ACCEPTABLE_CANDIDATE");
  assert.ok(selectable.length > 0, "candidates exist");
  for (const product of selectable) {
    // Technical eligibility is a technical fact; contractual acceptance is
    // separate and must not be pre-granted.
    assert.equal(product.contractualAcceptance, "CONSULTANT_APPROVAL_REQUIRED");
  }
});

test("a consumer asking for a scope the corpus cannot evidence fails closed", () => {
  // The project spec's 99-node clause has NOT been reconciled with any
  // manufacturer network figure, so a NETWORK-scope lookup must be unresolved
  // rather than silently borrowing a per-FACP number.
  const result = capacityOrUnresolved(NOTIFIER_SCOPED_CAPACITY, { resourceClass: "node", scopeType: "NETWORK", scopeEntity: "N16" });
  assert.equal(result.resolved, false, "a network node count is not evidenced in the corpus");
  assert.equal(result.code, "CAPACITY_NOT_EVIDENCED");
});
