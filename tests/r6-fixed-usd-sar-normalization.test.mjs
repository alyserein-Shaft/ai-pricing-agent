import test from "node:test";
import assert from "node:assert/strict";
import { calculatePricingLine, convertCurrency, FIXED_USD_SAR_POLICY, FIXED_USD_TO_SAR_RATE } from "../app/domain/pricing-engine.mjs";

const at = "2026-09-24T00:00:00Z";

const base = {
  projectId: "p1",
  productId: "prod1",
  candidateId: "c1",
  selectedPriceSourceId: "src1",
  manufacturer: "Honeywell",
  quantity: 1,
  unit: "EA",
  projectCurrency: "SAR",
  calculatedAt: at,
  technicalApproval: { status: "Approved", candidateId: "c1" },
  safetyDecision: { priceEligibility: "Eligible for Price Approval" },
  discounts: [],
  costComponents: [],
  sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 0 },
  precision: 2,
};

const source = (overrides = {}) => ({
  id: "src1",
  productId: "prod1",
  projectId: "p1",
  amount: 100,
  currency: "USD",
  priceType: "Supplier Quote",
  approvalStatus: "Approved",
  downstreamUse: "Costing",
  validUntil: "2099-01-01",
  reference: "Q-1",
  ...overrides,
});

test("R6 CASE A/C/E -- fixed USD to SAR normalization needs no FX database row", () => {
  const result = convertCurrency({ amount: 100, sourceCurrency: "USD", projectCurrency: "SAR", precision: 2 });
  assert.equal(result.convertedAmount, 375);
  assert.equal(result.rate, FIXED_USD_TO_SAR_RATE);
  assert.equal(result.policy, FIXED_USD_SAR_POLICY);
  assert.equal(result.method, "Fixed Business Policy");
});

test("R6 CASE B -- USD decimal normalization follows existing two-decimal money precision", () => {
  const result = convertCurrency({ amount: 22, sourceCurrency: "USD", projectCurrency: "SAR", precision: 2 });
  assert.equal(result.convertedAmount, 82.5);
  assert.equal(result.originalAmount, 22);
  assert.equal(result.sourceCurrency, "USD");
});

test("R6 CASE C/J -- SAR passes through with same-currency provenance", () => {
  const result = convertCurrency({ amount: 100, sourceCurrency: "SAR", projectCurrency: "SAR", precision: 2 });
  assert.equal(result.convertedAmount, 100);
  assert.equal(result.rate, 1);
  assert.equal(result.method, "Same Currency");
  assert.equal(result.policy, "SAME_CURRENCY");
});

test("R6 CASE D -- unsupported currency fails closed", () => {
  assert.throws(
    () => convertCurrency({ amount: 100, sourceCurrency: "EUR", projectCurrency: "SAR", precision: 2 }),
    { code: "UNSUPPORTED_CURRENCY" },
  );
});

test("R6 CASE F -- a misleading stored FX row cannot override the fixed policy", () => {
  const result = convertCurrency({ amount: 100, sourceCurrency: "USD", projectCurrency: "SAR", exchangeRate: { from: "USD", to: "SAR", rate: 3.1, approvalStatus: "Approved", validUntil: "2099-01-01" }, precision: 2 });
  assert.equal(result.convertedAmount, 375);
  assert.equal(result.rate, 3.75);
});

test("R6 CASE G/H -- conversion arithmetic does not grant authority to unapproved or Discovery Only prices", () => {
  const blocked = (overrides) => calculatePricingLine({ ...base, priceSources: [source(overrides)] });
  assert.equal(blocked({ approvalStatus: "Needs Review" }).approvalReady, false);
  assert.equal(blocked({ downstreamUse: "Discovery Only" }).approvalReady, false);
});

test("R6 CASE I/K -- priced USD result retains original, normalized, rate, policy, and precision provenance", () => {
  const result = calculatePricingLine({ ...base, priceSources: [source({ amount: 22.13 })] });
  assert.equal(result.approvalReady, true);
  assert.equal(result.originalListPrice, 22.13);
  assert.equal(result.conversion.originalAmount, 22.13);
  assert.equal(result.conversion.convertedAmount, 82.99);
  assert.equal(result.conversion.rate, 3.75);
  assert.equal(result.conversion.policy, FIXED_USD_SAR_POLICY);
  assert.equal(result.conversion.calculation, "22.13 USD × 3.75 = 82.99 SAR");
  assert.equal(result.netMaterialUnitCost, 82.99);
});
