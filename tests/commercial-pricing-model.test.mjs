import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCommercialPricing,
} from "../app/domain/pricing-engine.mjs";

test("commercial pricing is calculated from authoritative total cost", () => {
  const result = calculateCommercialPricing({
    totalCost: 120,
    sellingRule: {
      method: "Markup",
      rate: 25,
      minimumMargin: 10,
    },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
    precision: 2,
  });

  assert.equal(result.totalCost, 120);
  assert.equal(result.grossSelling, 150);
  assert.equal(result.netSelling, 150);
  assert.equal(result.margin, 20);
  assert.equal(result.markup, 25);
  assert.equal(result.vat, 22.5);
  assert.equal(result.finalValue, 172.5);
  assert.equal(result.approvalReady, true);
});

test("customer discount cannot silently breach minimum margin", () => {
  const result = calculateCommercialPricing({
    totalCost: 100,
    sellingRule: {
      method: "Markup",
      rate: 25,
      minimumMargin: 10,
    },
    customerDiscount: { percentage: 20 },
    vatRule: { rate: 15 },
  });

  assert.equal(result.status, "Pricing Blocked");
  assert.equal(result.approvalReady, false);
  assert.deepEqual(result.blockers, [
    "CUSTOMER_DISCOUNT_MINIMUM_BREACH",
  ]);
});

test("target margin remains distinct from markup", () => {
  const result = calculateCommercialPricing({
    totalCost: 100,
    sellingRule: {
      method: "Target Margin",
      rate: 20,
      minimumMargin: 10,
    },
    customerDiscount: { percentage: 0 },
    vatRule: { applicable: false },
  });

  assert.equal(result.grossSelling, 125);
  assert.equal(result.margin, 20);
  assert.equal(result.markup, 25);
  assert.equal(result.finalValue, 125);
});

test("invalid commercial inputs fail closed", () => {
  assert.throws(
    () =>
      calculateCommercialPricing({
        totalCost: -1,
        sellingRule: { method: "Markup", rate: 20 },
      }),
    { code: "INVALID_TOTAL_COST" },
  );

  assert.throws(
    () =>
      calculateCommercialPricing({
        totalCost: 100,
        sellingRule: { method: "Markup", rate: 20 },
        customerDiscount: { percentage: 101 },
      }),
    { code: "INVALID_CUSTOMER_DISCOUNT" },
  );
});
