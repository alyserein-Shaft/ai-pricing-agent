import test from "node:test";
import assert from "node:assert/strict";
import { commercialLineTotals } from "../app/domain/commercial-summary.mjs";
import { validateManualPriceInput } from "../app/domain/pricing-engine.mjs";

test("manual price cannot bypass technical approval", () => {
  const result = validateManualPriceInput({
    input: {
      projectId: "p1", boqItemId: "b1", candidateId: "c1",
      productId: "product1", price: 10, currency: "SAR",
      source: "Supplier quotation Q-1", validUntil: "2099-01-01",
      scope: "Project", reason: "Current supplier evidence",
    },
    user: { id: "u1", role: "Commercial Manager" },
    technicalApproval: null,
  });
  assert.equal(result.permitted, false);
});

test("commercial total excludes merely calculated and technically eligible lines", () => {
  const result = commercialLineTotals([
    { final_value_minor: 100, approval_ready: 0, commercially_approved: 0 },
    { final_value_minor: 200, approval_ready: 1, commercially_approved: 0 },
    { final_value_minor: 300, approval_ready: 1, commercially_approved: 1 },
  ]);
  assert.equal(result.draftCalculated.amountMinor, 600);
  assert.equal(result.technicallyEligible.amountMinor, 500);
  assert.equal(result.commerciallyApproved.amountMinor, 300);
});

test("an empty golden project cannot invent an approved total", () => {
  const result = commercialLineTotals([], "SAR", null);
  assert.equal(result.commerciallyApproved.amountMinor, 0);
  assert.equal(result.commerciallyApproved.includedLineCount, 0);
});
