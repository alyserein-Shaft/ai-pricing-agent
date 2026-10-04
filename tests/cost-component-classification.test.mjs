import test from "node:test";
import assert from "node:assert/strict";
import { classifyCostComponentType, summarizeCostComponents } from "../app/domain/pricing-engine.mjs";

test("cost component types are classified by governed meaning, not free-text description", () => {
  assert.equal(classifyCostComponentType("Service"), "SERVICE_LABOUR");
  assert.equal(classifyCostComponentType("Labour"), "SERVICE_LABOUR");
  assert.equal(classifyCostComponentType("Installation"), "INSTALLATION");
  assert.equal(classifyCostComponentType("Testing & Commissioning"), "TESTING_COMMISSIONING");
  assert.equal(classifyCostComponentType("Freight"), "LOGISTICS");
  assert.equal(classifyCostComponentType("Overhead"), "OVERHEAD");
  assert.equal(classifyCostComponentType("Contingency"), "RISK_CONTINGENCY");
  assert.equal(classifyCostComponentType("Subcontract"), "SUBCONTRACT");
  assert.equal(classifyCostComponentType("Unclassified approved cost"), "OTHER_DIRECT_COST");
});

test("service subtotal excludes installation, testing, logistics, overhead, risk, and subcontract", () => {
  const summary = summarizeCostComponents([
    { type: "Service", amount: 100 },
    { type: "Labour", amount: 25 },
    { type: "Installation", amount: 40 },
    { type: "Testing & Commissioning", amount: 30 },
    { type: "Freight", amount: 20 },
    { type: "Overhead", amount: 10 },
    { type: "Contingency", amount: 5 },
    { type: "Subcontract", amount: 50 },
  ]);
  assert.equal(summary.serviceSubtotal, 125);
  assert.equal(summary.installationSubtotal, 40);
  assert.equal(summary.testingCommissioningSubtotal, 30);
  assert.equal(summary.logisticsSubtotal, 20);
  assert.equal(summary.overheadSubtotal, 10);
  assert.equal(summary.riskContingencySubtotal, 5);
  assert.equal(summary.subcontractSubtotal, 50);
  assert.equal(summary.nonMaterialSubtotal, 280);
});

test("material components are not smuggled into non-material totals and empty input remains null", () => {
  assert.equal(summarizeCostComponents([{ type: "Material", amount: 500 }]).nonMaterialSubtotal, null);
  assert.equal(summarizeCostComponents([]).serviceSubtotal, null);
  assert.equal(summarizeCostComponents([]).nonMaterialSubtotal, null);
});
