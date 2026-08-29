import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCommercialCostFreshness,
} from "../app/domain/commercial-pricing-authority.mjs";

const locked = {
  readiness: "COST_READY",
  currency: "SAR",
  materialSubtotal: 43000,
  serviceSubtotal: 10000,
  totalCost: 53000,
  materialBreakdown: [
    {
      scope: "Primary Product",
      partNumber: "DET-001",
      extendedCost: 30000,
      evidenceSource: "Supplier Quote",
    },
    {
      scope: "Required Component",
      partNumber: "BASE-001",
      extendedCost: 13000,
      evidenceSource: "Price List",
    },
  ],
};

const currentModel = (overrides = {}) => ({
  readiness: { state: "COST_READY" },
  summary: {
    currency: "SAR",
    materialSubtotal: 43000,
    serviceSubtotal: 10000,
    totalCost: 53000,
    ...(overrides.summary || {}),
  },
  materialBreakdown:
    overrides.materialBreakdown || locked.materialBreakdown,
  currentBlocker: overrides.currentBlocker,
});

test("commercial approval cost lock remains valid when Full-BOM evidence is unchanged", () => {
  const result = assertCommercialCostFreshness({
    lockedCost: locked,
    currentCostModel: currentModel(),
  });

  assert.equal(result.totalCost, 53000);
  assert.equal(result.currency, "SAR");
});

test("commercial approval becomes stale when Full-BOM total cost changes", () => {
  assert.throws(
    () =>
      assertCommercialCostFreshness({
        lockedCost: locked,
        currentCostModel: currentModel({
          summary: {
            materialSubtotal: 48000,
            serviceSubtotal: 10000,
            totalCost: 58000,
          },
        }),
      }),
    { code: "STALE_PRICING_COST" },
  );
});

test("commercial approval becomes stale when BOM evidence changes even if total cost is unchanged", () => {
  assert.throws(
    () =>
      assertCommercialCostFreshness({
        lockedCost: locked,
        currentCostModel: currentModel({
          materialBreakdown: [
            {
              scope: "Primary Product",
              partNumber: "DET-001",
              extendedCost: 32000,
              evidenceSource: "Supplier Quote",
            },
            {
              scope: "Required Component",
              partNumber: "BASE-001",
              extendedCost: 11000,
              evidenceSource: "Price List",
            },
          ],
        }),
      }),
    { code: "STALE_PRICING_COST" },
  );
});

test("commercial approval becomes stale if current Cost Build-Up is no longer ready", () => {
  assert.throws(
    () =>
      assertCommercialCostFreshness({
        lockedCost: locked,
        currentCostModel: {
          readiness: { state: "COST_EVIDENCE_INCOMPLETE" },
          summary: {
            currency: "SAR",
            materialSubtotal: 43000,
            serviceSubtotal: null,
            totalCost: null,
          },
          currentBlocker: "Required base has no current price evidence.",
        },
      }),
    (error) =>
      error?.code === "STALE_PRICING_COST" &&
      /Required base/.test(error.message),
  );
});
