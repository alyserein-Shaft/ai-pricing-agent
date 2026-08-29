import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCommercialPricingResult,
} from "../app/domain/commercial-pricing-authority.mjs";

test("commercial selling price uses Full BOM Cost, never the primary-only cost", () => {
  const costModel = {
    readiness: { state: "COST_READY" },
    summary: {
      currency: "SAR",
      materialSubtotal: 43000,
      serviceSubtotal: 10000,
      totalCost: 53000,
    },
    materialBreakdown: [
      { scope: "Primary Product", extendedCost: 30000 },
      { scope: "Required Component", extendedCost: 13000 },
    ],
  };

  const pricingInput = {
    sellingRule: {
      method: "Markup",
      rate: 25,
      minimumMargin: 0,
    },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
    precision: 2,
  };

  // This deliberately contains the old primary-only cost.
  // The commercial result must ignore it as the cost authority.
  const evidenceResult = {
    approvalReady: true,
    totalCost: 30000,
    materialTotal: 30000,
    selectedSource: {
      id: "price-primary",
      priceType: "Supplier Quote",
    },
  };

  const { result, authoritativeCost } =
    buildCommercialPricingResult({
      costModel,
      pricingInput,
      evidenceResult,
    });

  assert.equal(result.totalCost, 53000);
  assert.equal(result.materialTotal, 43000);
  assert.equal(result.grossSelling, 66250);
  assert.equal(result.netSelling, 66250);
  assert.equal(result.directCost, null);

  assert.equal(authoritativeCost.totalCost, 53000);
  assert.equal(authoritativeCost.materialSubtotal, 43000);
  assert.equal(authoritativeCost.serviceSubtotal, 10000);
  assert.equal(authoritativeCost.currency, "SAR");
});

test("commercial pricing fails closed while Cost Build-Up is incomplete", () => {
  assert.throws(
    () =>
      buildCommercialPricingResult({
        costModel: {
          readiness: { state: "COST_EVIDENCE_INCOMPLETE" },
          summary: {
            currency: "SAR",
            materialSubtotal: 43000,
            serviceSubtotal: null,
            totalCost: null,
          },
          currentBlocker:
            "Required base B501-IV has no selected current price evidence.",
        },
        pricingInput: {
          sellingRule: {
            method: "Markup",
            rate: 25,
            minimumMargin: 0,
          },
          customerDiscount: { percentage: 0 },
          vatRule: { rate: 0 },
          precision: 2,
        },
        evidenceResult: {
          approvalReady: true,
          totalCost: 30000,
        },
      }),
    (error) =>
      error?.code === "COST_BUILDUP_NOT_READY" &&
      /B501-IV/.test(error.message),
  );
});

test("commercial pricing also fails closed when primary price evidence is not ready", () => {
  assert.throws(
    () =>
      buildCommercialPricingResult({
        costModel: {
          readiness: { state: "COST_READY" },
          summary: {
            currency: "SAR",
            materialSubtotal: 43000,
            serviceSubtotal: 10000,
            totalCost: 53000,
          },
        },
        pricingInput: {
          sellingRule: {
            method: "Markup",
            rate: 25,
            minimumMargin: 0,
          },
          customerDiscount: { percentage: 0 },
          vatRule: { rate: 0 },
          precision: 2,
        },
        evidenceResult: {
          approvalReady: false,
          blockers: ["PRICE_SOURCE_SELECTION_REQUIRED"],
        },
      }),
    { code: "PRICING_COST_EVIDENCE_NOT_READY" },
  );
});
