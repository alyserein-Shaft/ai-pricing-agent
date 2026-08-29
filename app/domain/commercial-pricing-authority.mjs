import { calculateCommercialPricing } from "./pricing-engine.mjs";

export const buildCommercialPricingResult = ({
  costModel,
  pricingInput,
  evidenceResult,
}) => {
  if (costModel?.error)
    throw Object.assign(
      new Error(costModel.error.message || "Cost build-up is unavailable."),
      { code: costModel.error.code || "COST_BUILDUP_UNAVAILABLE" },
    );

  if (
    costModel?.readiness?.state !== "COST_READY" ||
    costModel?.summary?.totalCost == null
  )
    throw Object.assign(
      new Error(
        costModel?.currentBlocker ||
          "Complete the BOM and Cost Build-Up before calculating the selling price.",
      ),
      {
        code: "COST_BUILDUP_NOT_READY",
        costReadiness: costModel?.readiness?.state || null,
      },
    );

  if (!evidenceResult?.approvalReady)
    throw Object.assign(
      new Error(
        `Pricing evidence is not ready: ${(evidenceResult?.blockers || []).join(", ")}`,
      ),
      { code: "PRICING_COST_EVIDENCE_NOT_READY" },
    );

  const commercial = calculateCommercialPricing({
    totalCost: costModel.summary.totalCost,
    sellingRule: pricingInput.sellingRule,
    customerDiscount: pricingInput.customerDiscount,
    vatRule: pricingInput.vatRule,
    precision: pricingInput.precision,
  });

  const result = {
    ...evidenceResult,
    ...commercial,

    // Cost Build-Up is the commercial cost authority.
    materialTotal: costModel.summary.materialSubtotal,
    totalCost: costModel.summary.totalCost,

    // Until Cost Build-Up exposes a governed Full-BOM direct-cost subtotal,
    // never reuse the legacy primary-only directCost value.
    directCost: null,

    explanation: commercial.approvalReady
      ? `Authoritative Full BOM Cost is ${costModel.summary.totalCost} ${costModel.summary.currency}. Net selling is ${commercial.netSelling}, VAT is ${commercial.vat}, and final value is ${commercial.finalValue}.`
      : `Commercial pricing blocked against authoritative Full BOM Cost ${costModel.summary.totalCost} ${costModel.summary.currency}: ${(commercial.blockers || []).join(", ")}.`,
  };

  const authoritativeCost = {
    readiness: costModel.readiness.state,
    currency: costModel.summary.currency,
    materialSubtotal: costModel.summary.materialSubtotal,
    serviceSubtotal: costModel.summary.serviceSubtotal,
    totalCost: costModel.summary.totalCost,
    materialBreakdown: costModel.materialBreakdown || [],
  };

  return {
    result,
    authoritativeCost,
  };
};

const canonicalCostSnapshot = (snapshot = {}) => ({
  readiness: snapshot.readiness || null,
  currency: snapshot.currency || null,
  materialSubtotal: snapshot.materialSubtotal ?? null,
  serviceSubtotal: snapshot.serviceSubtotal ?? null,
  totalCost: snapshot.totalCost ?? null,
  materialBreakdown: (snapshot.materialBreakdown || [])
    .map((entry) => ({
      scope: entry.scope || null,
      role: entry.role || null,
      partNumber: entry.partNumber || null,
      relationshipType: entry.relationshipType || null,
      quantity: entry.quantity ?? null,
      unitCost: entry.unitCost ?? null,
      extendedCost: entry.extendedCost ?? null,
      evidenceSource: entry.evidenceSource || null,
    }))
    .sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
});

export const assertCommercialCostFreshness = ({
  lockedCost,
  currentCostModel,
}) => {
  if (
    currentCostModel?.readiness?.state !== "COST_READY" ||
    currentCostModel?.summary?.totalCost == null
  )
    throw Object.assign(
      new Error(
        currentCostModel?.currentBlocker ||
          "Current Cost Build-Up is no longer complete. Recalculate pricing before approval.",
      ),
      {
        code: "STALE_PRICING_COST",
        costReadiness: currentCostModel?.readiness?.state || null,
      },
    );

  const currentCost = {
    readiness: currentCostModel.readiness.state,
    currency: currentCostModel.summary.currency,
    materialSubtotal: currentCostModel.summary.materialSubtotal,
    serviceSubtotal: currentCostModel.summary.serviceSubtotal,
    totalCost: currentCostModel.summary.totalCost,
    materialBreakdown: currentCostModel.materialBreakdown || [],
  };

  const locked = canonicalCostSnapshot(lockedCost);
  const current = canonicalCostSnapshot(currentCost);

  if (JSON.stringify(locked) !== JSON.stringify(current))
    throw Object.assign(
      new Error(
        "The authoritative BOM or Cost Build-Up changed after this pricing calculation. Recalculate pricing before approval.",
      ),
      {
        code: "STALE_PRICING_COST",
        lockedCost: locked,
        currentCost: current,
      },
    );

  return current;
};
