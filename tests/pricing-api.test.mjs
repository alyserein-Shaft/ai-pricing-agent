import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handlePricingApi } from "../worker/pricing-api.mjs";
import { commercialApi } from "../app/lib/api-client.ts";
import { pricingLineModel, pricingSourcePresentation } from "../app/components/workspaces/commercial-models.mjs";

const root = new URL("../", import.meta.url);

test("pricing API fails closed without configured application context", async () => { const response = await handlePricingApi(new Request("https://local.test/api/pricing/projects/p1/scenarios"), { DB: {} }); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE"); });
test("Task 12 schema persists scenarios, runs, lines, formulas, discounts, rates, allocations, approvals, exceptions and audit", async () => { const schema = await readFile(new URL("db/schema.ts", root), "utf8"); for (const entity of ["pricingScenarios", "pricingRuns", "pricingLines", "pricingCostComponents", "pricingDiscountApplications", "pricingExchangeRates", "pricingSharedCosts", "pricingCostAllocations", "pricingApprovals", "pricingExceptions", "pricingAuditEvents", "pricingRunComparisons", "projectMembers"]) assert.match(schema, new RegExp(`export const ${entity}`)); });
test("pricing worker exposes protected calculation and review operations", async () => { const api = await readFile(new URL("worker/pricing-api.mjs", root), "utf8"); for (const control of ["project_members", "SAFETY_DECISION_REQUIRED", "STALE_PRICING_VERSION", "PRICING_APPROVAL_BLOCKED", "pricing_audit_events", "input_fingerprint", "locked_versions", "manual-price", "compare", "selected-scenario", "selected_pricing_scenario_id", "Pricing Scenario Selected for Quotation"]) assert.match(api, new RegExp(control)); assert.doesNotMatch(api, /localStorage|sessionStorage/); });
test("pricing API is routed ahead of safety, matching and framework handlers", async () => { const worker = await readFile(new URL("worker/index.ts", root), "utf8"), pricing = worker.indexOf("handlePricingApi(request, env)"), safety = worker.indexOf("handleConfidenceSafetyApi(request, env)"), matching = worker.indexOf("handleProductMatchingApi(request, env, ctx)"), framework = worker.indexOf("handler.fetch(request, env, ctx)"); assert.ok(pricing > 0 && pricing < safety && safety < matching && matching < framework); });
test("Costing UI consumes server-authoritative scenarios and line results", () => { assert.equal(commercialApi.scenarios("p1"), "/api/pricing/projects/p1/scenarios"); assert.equal(commercialApi.selectedScenario("p1"), "/api/pricing/projects/p1/selected-scenario"); assert.match(commercialApi.pricingLine("b1", "s1"), /\/api\/pricing\/items\/b1/); const view=pricingLineModel({id:"b1",description:"Panel"},{line:{status:"Draft Price",output:{netSelling:25}}}); assert.equal(view.result.netSelling,25); });
test("Costing UI commands target durable manual-price and price-source review APIs", () => {
  assert.equal(commercialApi.manualPrice("b1", "s1"), "/api/pricing/items/b1/manual-price?scenarioId=s1");
  assert.equal(commercialApi.productPrices("product-1", "project-1"), "/api/products/product-1/prices?projectId=project-1");
  assert.equal(commercialApi.reviewPriceSource("source-1"), "/api/price-sources/source-1/review");
});
test("persisted Discovery Only evidence is never presented as costing approved", () => {
  assert.deepEqual(pricingSourcePresentation({ type: "Manual Price", downstreamUse: "Discovery Only", eligibleForCosting: false }), { label: "Historical / Discovery Only", costingApproved: false });
  assert.deepEqual(pricingSourcePresentation({ type: "Supplier Quotation", downstreamUse: "Costing", eligibleForCosting: true }), { label: "Current costing-eligible source", costingApproved: true });
});
test("Task 11 authorization now uses durable project membership and controlled override decisions", async () => { const api = await readFile(new URL("worker/confidence-safety-api.mjs", root), "utf8"); assert.match(api, /project_members/); assert.match(api, /\/api\\\/safety\\\/overrides/); assert.match(api, /OVERRIDE_DECISION_ROLE_REQUIRED/); assert.doesNotMatch(api, /request\.headers\.get\("x-user-role"\)/); });
