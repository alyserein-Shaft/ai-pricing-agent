import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { calculatePricingLine, validateManualPriceInput } from "../app/domain/pricing-engine.mjs";
import { evaluateSafety } from "../app/domain/confidence-safety-engine.mjs";

const incompleteProfile = {
  versionNumber: 1,
  boqItem: { id: "boq-new", description: "New BOQ item", system: "", category: "", productFamily: "" },
  readiness: { status: "Missing Critical Information", blockingReasons: ["Specification and category are required"] },
  consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
};

const product = {
  id: "product-1", manufacturer: "Honeywell", family: "Addressable Smoke Detector",
  partNumber: "IDP-PHOTO-W", description: "Addressable smoke detector", lifecycleStatus: "Active",
  reviewStatus: "Reviewed", attributes: [], standards: [], compatibility: [], accessories: [],
};

test("incomplete BOQ information fails closed without fabricated product candidates", () => {
  const result = runProductMatching({ profile: incompleteProfile, products: [product] });
  assert.equal(result.status, "Not Ready");
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.noMatch.blockers, ["Specification and category are required"]);
});

test("manual commercial evidence cannot override failed technical compliance", () => {
  const result = evaluateSafety({
    item: { id: "boq-1", projectId: "p1", system: "Fire Alarm", category: "Detection Device", description: "Smoke detector", unit: "No.", quantity: 1, productFamily: "Smoke Detector", sourceDocumentId: "doc-1", sourceLocation: { row: 1 }, extractionConfidence: 95 },
    profile: { id: "profile-1", versionNumber: 1, readiness: { status: "Ready for Matching" }, confidence: { applicability: 90 }, standards: [], compatibility: [], accessories: [], categoryFields: {}, derivedRequirements: [] },
    candidate: { id: "candidate-1", searchStage: "Structured", technicalStatus: "Non-Compliant", recommendationTier: "Rejected Candidate", confidence: "Low Confidence", product: { id: "product-1", reviewStatus: "Reviewed", sourceReliability: "Manufacturer Verified" }, comparisons: [], standards: [], compatibility: [], accessories: [], lifecycle: { state: "Active", blocking: false }, mandatoryFailures: [{ type: "Voltage", result: "Fail" }], commercialAvailability: "Valid Current Price Available", provenance: { productSource: { documentId: "catalogue" } } },
    provenance: { complete: true, confidence: 100, documentClassificationConfidence: 95, specificationExtractionConfidence: 95 },
    prices: [{ productId: "product-1", candidateId: "candidate-1", approvalStatus: "Approved", sourceId: "quote-1", currency: "SAR", validUntil: "2099-01-01" }],
    user: { id: "reviewer", role: "Technical Reviewer" },
  });
  assert.equal(result.complianceState, "Non-Compliant");
  assert.equal(result.approvalEligibility.price, "Price Approval Disabled");
});

test("undated supplier evidence stays blocked from costing", () => {
  const result = calculatePricingLine({
    projectId: "p1", productId: "product-1", candidateId: "candidate-1", selectedPriceSourceId: "source-1",
    manufacturer: "Honeywell", quantity: 1, unit: "EA", projectCurrency: "SAR", calculatedAt: "2026-08-04T00:00:00Z",
    technicalApproval: { status: "Approved", candidateId: "candidate-1" }, safetyDecision: { priceEligibility: "Eligible for Price Approval" },
    priceSources: [{ id: "source-1", productId: "product-1", projectId: "p1", amount: 100, currency: "SAR", priceType: "Supplier Quote", approvalStatus: "Approved", downstreamUse: "Costing Eligible", validUntil: null }],
    discounts: [], costComponents: [], sellingRule: { method: "Markup", rate: 20, minimumMargin: 5 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 15 }, precision: 2,
  });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("manual pricing requires governed source, reason, validity, scope and role", () => {
  const result = validateManualPriceInput({
    input: { projectId: "p1", boqItemId: "b1", candidateId: "c1", productId: "product-1", price: 10, currency: "SAR" },
    user: { role: "Estimator" }, technicalApproval: { status: "Approved", candidateId: "c1" },
  });
  assert.equal(result.permitted, false);
  assert.ok(result.missing.length > 0);
});
