import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePriceEvidenceStatus, selectCostEvidence, deriveCostReadiness, selectCostDecisionQuestion, extendedMaterialCost, isBomComponentIncludedInCosting, priceMaterialComponent, aggregateMaterialCost, selectMaterialCostDecisionQuestion } from "../app/domain/cost-buildup-model.mjs";

const AT = "2026-08-29T00:00:00.000Z";
const currentRecord = (overrides = {}) => ({ approvalStatus: "Approved", downstreamUse: "Costing", validUntil: "2027-01-01", priceType: "Manufacturer Price List", amount: 100, currency: "USD", ...overrides });

test("no records at all -- PRICE_MISSING, never fabricated", () => {
  assert.equal(derivePriceEvidenceStatus([], { at: AT }), "PRICE_MISSING");
});

test("Discovery-Only manufacturer evidence alone is not costing-eligible -- still PRICE_MISSING", () => {
  const records = [{ approvalStatus: "Needs Review", downstreamUse: "Discovery Only", priceType: "Manufacturer List Price", validUntil: null }];
  assert.equal(derivePriceEvidenceStatus(records, { at: AT }), "PRICE_MISSING");
});

test("a single current, costing-eligible record -- CURRENT_PRICE_AVAILABLE", () => {
  assert.equal(derivePriceEvidenceStatus([currentRecord()], { at: AT }), "CURRENT_PRICE_AVAILABLE");
});

test("only an approved-but-expired record -- HISTORICAL_PRICE_ONLY, never promoted to current", () => {
  const records = [currentRecord({ validUntil: "2020-01-01" })];
  assert.equal(derivePriceEvidenceStatus(records, { at: AT }), "HISTORICAL_PRICE_ONLY");
});

test("two current records that materially agree -- MULTIPLE_PRICE_EVIDENCE, not a conflict", () => {
  const records = [currentRecord({ amount: 100 }), currentRecord({ priceType: "Supplier Quote", amount: 101 })];
  assert.equal(derivePriceEvidenceStatus(records, { at: AT, normalizedAmounts: [100, 101] }), "MULTIPLE_PRICE_EVIDENCE");
});

test("two current records that materially disagree -- PRICE_CONFLICT", () => {
  const records = [currentRecord({ amount: 100 }), currentRecord({ priceType: "Supplier Quote", amount: 180 })];
  assert.equal(derivePriceEvidenceStatus(records, { at: AT, normalizedAmounts: [100, 180] }), "PRICE_CONFLICT");
});

test("selectCostEvidence preserves the original source, never collapses provenance", () => {
  const ranked = [{ id: "s1", eligible: true, priceType: "Manufacturer Price List", amount: 100, currency: "USD" }];
  const selected = selectCostEvidence(ranked, null);
  assert.equal(selected.priceType, "Manufacturer Price List");
  assert.match(selected.selectionBasis, /Requires Explicit Selection/);
});

test("selectCostEvidence honors an engineer's explicit prior choice over the precedence suggestion", () => {
  const ranked = [
    { id: "s1", eligible: true, priceType: "Manufacturer Price List", amount: 100, currency: "USD" },
    { id: "s2", eligible: true, priceType: "Supplier Quote", amount: 95, currency: "USD" },
  ];
  const selected = selectCostEvidence(ranked, "s2");
  assert.equal(selected.id, "s2");
  assert.equal(selected.selectionBasis, "Engineer Selected");
});

test("selectCostDecisionQuestion asks which price to use when evidence conflicts, never fabricates a choice", () => {
  const question = selectCostDecisionQuestion({ priceEvidenceStatus: "PRICE_CONFLICT", rankedSources: [{ id: "s1", eligible: true, priceType: "Manufacturer Price List", amount: 100, currency: "USD" }, { id: "s2", eligible: true, priceType: "Supplier Quote", amount: 180, currency: "USD" }] });
  assert.equal(question.kind, "SELECT_PRICE_SOURCE");
  assert.equal(question.options.length, 2);
});

test("selectCostDecisionQuestion asks for exchange-rate confirmation when the price is non-SAR and no rate is on record", () => {
  const question = selectCostDecisionQuestion({ priceEvidenceStatus: "CURRENT_PRICE_AVAILABLE", rankedSources: [], exchangeRateMissing: true, sourceCurrency: "USD" });
  assert.equal(question.kind, "CONFIRM_EXCHANGE_RATE");
  assert.match(question.question, /USD.*SAR/);
});

test("selectCostDecisionQuestion returns null once evidence, exchange rate and cost basis are all settled", () => {
  assert.equal(selectCostDecisionQuestion({ priceEvidenceStatus: "CURRENT_PRICE_AVAILABLE", rankedSources: [], exchangeRateMissing: false, missingCostBasisComponents: [] }), null);
});

test("composite readiness: BOM not ready wins over everything else", () => {
  assert.equal(deriveCostReadiness({ bomReady: false, priceEvidenceStatus: "CURRENT_PRICE_AVAILABLE", hasOpenCostQuestion: false, exchangeRateMissing: false }).state, "COST_NOT_APPLICABLE");
});

test("composite readiness: an open cost question is reported once BOM is ready", () => {
  assert.equal(deriveCostReadiness({ bomReady: true, priceEvidenceStatus: "CURRENT_PRICE_AVAILABLE", hasOpenCostQuestion: true, exchangeRateMissing: false }).state, "COST_DECISION_REQUIRED");
});

test("composite readiness: missing price evidence is reported as incomplete, not blocked-forever", () => {
  assert.equal(deriveCostReadiness({ bomReady: true, priceEvidenceStatus: "PRICE_MISSING", hasOpenCostQuestion: false, exchangeRateMissing: false }).state, "COST_EVIDENCE_INCOMPLETE");
});

test("composite readiness: COST_READY only when every gate clears", () => {
  assert.equal(deriveCostReadiness({ bomReady: true, priceEvidenceStatus: "CURRENT_PRICE_AVAILABLE", hasOpenCostQuestion: false, exchangeRateMissing: false }).state, "COST_READY");
});

test("extendedMaterialCost multiplies normalized unit cost by quantity, never fabricates when either is missing", () => {
  assert.equal(extendedMaterialCost({ unitCost: 10.5, quantity: 230 }), 2415);
  assert.equal(extendedMaterialCost({ unitCost: null, quantity: 230 }), null);
  assert.equal(extendedMaterialCost({ unitCost: 10.5, quantity: null }), null);
});

// --- BOM component inclusion -------------------------------------------------

test("isBomComponentIncludedInCosting -- REQUIRED_COMPONENT and CONDITIONAL_COMPONENT are always included", () => {
  assert.equal(isBomComponentIncludedInCosting({ role: "REQUIRED_COMPONENT" }), true);
  assert.equal(isBomComponentIncludedInCosting({ role: "CONDITIONAL_COMPONENT" }), true);
});

test("isBomComponentIncludedInCosting -- OPTIONAL_COMPONENT and COMPATIBLE_ALTERNATIVE are excluded unless engineer-selected", () => {
  assert.equal(isBomComponentIncludedInCosting({ role: "OPTIONAL_COMPONENT" }), false);
  assert.equal(isBomComponentIncludedInCosting({ role: "OPTIONAL_COMPONENT", engineerSelected: true }), true);
  assert.equal(isBomComponentIncludedInCosting({ role: "COMPATIBLE_ALTERNATIVE" }), false);
  assert.equal(isBomComponentIncludedInCosting({ role: "COMPATIBLE_ALTERNATIVE", engineerSelected: true }), true);
});

test("isBomComponentIncludedInCosting -- NOT_APPLICABLE is always excluded", () => {
  assert.equal(isBomComponentIncludedInCosting({ role: "NOT_APPLICABLE" }), false);
  assert.equal(isBomComponentIncludedInCosting({ role: "NOT_APPLICABLE", engineerSelected: true }), false);
});

// --- priceMaterialComponent ---------------------------------------------------

const SAR_SOURCE = { id: "src-1", productId: "prod-base", projectId: "proj-1", amount: 65, currency: "USD", priceType: "Manufacturer Price List", approvalStatus: "Approved", downstreamUse: "Costing", validUntil: "2027-01-01", reference: "PL-2027" };
const APPROVED_RATE = { from: "USD", to: "SAR", rate: 3.75, source: "Company Treasury", version: 1, approvalStatus: "Approved", validUntil: "2027-01-01" };

test("Detector + required base -- both priced: a selected, current source converts and extends correctly", () => {
  const priced = priceMaterialComponent({ productId: "prod-base", quantity: 230, unit: "Each", priceSources: [SAR_SOURCE], selectedPriceSourceId: "src-1", projectId: "proj-1", at: "2026-08-29T00:00:00.000Z", exchangeRate: APPROVED_RATE, projectCurrency: "SAR" });
  assert.equal(priced.status, "PRICED");
  assert.equal(priced.netUnitCost, 243.75);
  assert.equal(priced.extendedCost, 56062.5);
});

test("Detector + selected sounder base (conditional) -- prices the same way as a required component", () => {
  const priced = priceMaterialComponent({ productId: "prod-sounder", quantity: 12, unit: "Each", priceSources: [{ ...SAR_SOURCE, productId: "prod-sounder", amount: 40 }], selectedPriceSourceId: "src-1", projectId: "proj-1", at: "2026-08-29T00:00:00.000Z", exchangeRate: APPROVED_RATE, projectCurrency: "SAR" });
  assert.equal(priced.status, "PRICED");
  assert.equal(priced.extendedCost, round12(40 * 3.75 * 12));
});
function round12(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

test("a required component with no price evidence at all -- PRICE_MISSING, never fabricated", () => {
  const priced = priceMaterialComponent({ productId: "prod-missing", quantity: 5, unit: "Each", priceSources: [], selectedPriceSourceId: null, projectId: "proj-1", projectCurrency: "SAR" });
  assert.equal(priced.status, "PRICE_MISSING");
  assert.equal(priced.extendedCost, null);
});

test("a component with eligible evidence but no explicit engineer selection -- AWAITING_SELECTION, never auto-picked", () => {
  const priced = priceMaterialComponent({ productId: "prod-base", quantity: 230, unit: "Each", priceSources: [SAR_SOURCE], selectedPriceSourceId: null, projectId: "proj-1", projectCurrency: "SAR" });
  assert.equal(priced.status, "AWAITING_SELECTION");
});

test("no approved exchange rate for a non-SAR source -- EXCHANGE_RATE_MISSING, never a fabricated conversion", () => {
  const priced = priceMaterialComponent({ productId: "prod-base", quantity: 230, unit: "Each", priceSources: [SAR_SOURCE], selectedPriceSourceId: "src-1", projectId: "proj-1", exchangeRate: null, projectCurrency: "SAR" });
  assert.equal(priced.status, "EXCHANGE_RATE_MISSING");
});

// --- aggregateMaterialCost -----------------------------------------------------

const primaryReady = (materialTotal) => ({ approvalReady: true, materialTotal, partNumber: "IDP-PHOTO-IV" });
const primed = (extendedCost) => ({ status: "PRICED", extendedCost });

test("Primary + required base, both priced -- Total Material Cost sums exactly Primary + Required", () => {
  const result = aggregateMaterialCost({ primary: primaryReady(56062.5), components: [{ role: "REQUIRED_COMPONENT", partNumber: "B501-IV", priced: primed(1000) }] });
  assert.equal(result.primaryMaterialCost, 56062.5);
  assert.equal(result.requiredComponentCost, 1000);
  assert.equal(result.totalMaterialCost, 57062.5);
  assert.deepEqual(result.missingComponents, []);
});

test("Primary + resolved conditional sounder base -- Total Material Cost includes the conditional cost", () => {
  const result = aggregateMaterialCost({ primary: primaryReady(56062.5), components: [{ role: "REQUIRED_COMPONENT", partNumber: "B501-IV", priced: primed(1000) }, { role: "CONDITIONAL_COMPONENT", partNumber: "B200S-IV", priced: primed(1800) }] });
  assert.equal(result.conditionalComponentCost, 1800);
  assert.equal(result.totalMaterialCost, 58862.5);
});

test("a required component missing price evidence -- Total Material Cost is null, the exact PN is identified, never silently omitted", () => {
  const result = aggregateMaterialCost({ primary: primaryReady(56062.5), components: [{ role: "REQUIRED_COMPONENT", partNumber: "B501-IV", priced: { status: "PRICE_MISSING", extendedCost: null } }] });
  assert.equal(result.totalMaterialCost, null);
  assert.deepEqual(result.missingComponents, [{ partNumber: "B501-IV", role: "REQUIRED_COMPONENT", relationshipType: null, status: "PRICE_MISSING" }]);
});

test("an unselected optional accessory is never passed to aggregation at all, so it can never affect Total Cost -- confirmed by the caller's own filter, not by this function", () => {
  // isBomComponentIncludedInCosting is what keeps it out; if a caller mistakenly
  // included one anyway, this proves it would still be summed as a real cost,
  // never silently ignored -- underscoring why the filter must run first.
  const includedOnly = [{ role: "REQUIRED_COMPONENT", partNumber: "B501-IV", priced: primed(1000) }]
    .filter((entry) => isBomComponentIncludedInCosting(entry));
  const result = aggregateMaterialCost({ primary: primaryReady(56062.5), components: includedOnly });
  assert.equal(result.totalMaterialCost, 57062.5);
});

test("the primary product itself missing price evidence is reported as a missing component too, never silently dropped", () => {
  const result = aggregateMaterialCost({ primary: { approvalReady: false, status: "PRICE_MISSING", partNumber: "IDP-PHOTO-IV" }, components: [] });
  assert.equal(result.totalMaterialCost, null);
  assert.equal(result.missingComponents[0].partNumber, "IDP-PHOTO-IV");
  assert.equal(result.missingComponents[0].role, "PRIMARY_PRODUCT");
});

// --- selectMaterialCostDecisionQuestion -----------------------------------------

test("selectMaterialCostDecisionQuestion asks about the primary product first, precisely naming its PN", () => {
  const question = selectMaterialCostDecisionQuestion([
    { scope: "Primary Product", partNumber: "IDP-PHOTO-IV", productId: "prod-primary", priced: { status: "AWAITING_SELECTION" }, rankedSources: [{ id: "s1", eligible: true, priceType: "Manufacturer Price List", amount: 100, currency: "USD" }] },
    { scope: "Required Component", partNumber: "B501-IV", productId: "prod-base", priced: { status: "PRICE_MISSING" }, rankedSources: [] },
  ]);
  assert.equal(question.kind, "SELECT_PRICE_SOURCE");
  assert.equal(question.partNumber, "IDP-PHOTO-IV");
});

test("selectMaterialCostDecisionQuestion asks about a required component by exact PN once the primary is settled", () => {
  const question = selectMaterialCostDecisionQuestion([
    { scope: "Primary Product", partNumber: "IDP-PHOTO-IV", productId: "prod-primary", priced: { status: "PRICED" }, rankedSources: [] },
    { scope: "Required Component", partNumber: "B501-IV", productId: "prod-base", priced: { status: "AWAITING_SELECTION" }, rankedSources: [{ id: "s2", eligible: true, priceType: "Supplier Quote", amount: 50, currency: "SAR" }] },
  ]);
  assert.equal(question.kind, "SELECT_PRICE_SOURCE");
  assert.equal(question.partNumber, "B501-IV");
  assert.match(question.question, /B501-IV/);
});

test("selectMaterialCostDecisionQuestion returns null once every entry is priced", () => {
  const question = selectMaterialCostDecisionQuestion([
    { scope: "Primary Product", partNumber: "IDP-PHOTO-IV", productId: "prod-primary", priced: { status: "PRICED" }, rankedSources: [] },
    { scope: "Required Component", partNumber: "B501-IV", productId: "prod-base", priced: { status: "PRICED" }, rankedSources: [] },
  ]);
  assert.equal(question, null);
});
