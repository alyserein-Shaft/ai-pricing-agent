import test from "node:test";
import assert from "node:assert/strict";
import { commercialLineTotals } from "../app/domain/commercial-summary.mjs";

test("draft, technically eligible and commercially approved totals remain distinct", () => {
  const totals = commercialLineTotals([
    { final_value_minor: 10000, approval_ready: 1, commercially_approved: 1 },
    { final_value_minor: 20000, approval_ready: 1, commercially_approved: 0 },
    { final_value_minor: 40000, approval_ready: 0, commercially_approved: 1 },
  ], "SAR", "2026-08-09T00:00:00Z");
  assert.equal(totals.draftCalculated.amountMinor, 70000);
  assert.equal(totals.technicallyEligible.amountMinor, 30000);
  assert.equal(totals.commerciallyApproved.amountMinor, 10000);
  assert.equal(totals.commerciallyApproved.includedLineCount, 1);
  assert.equal(totals.commerciallyApproved.excludedLineCount, 2);
});

test("empty project reports zero approved totals", () => {
  const totals = commercialLineTotals([], "SAR", null);
  assert.equal(totals.draftCalculated.state, "Not Started");
  assert.equal(totals.commerciallyApproved.amountMinor, 0);
  assert.equal(totals.commerciallyApproved.includedLineCount, 0);
});

test("technical readiness alone never creates commercial approval", () => {
  const totals = commercialLineTotals([
    { final_value_minor: 5000, approval_ready: 1, commercially_approved: 0 },
  ]);
  assert.equal(totals.technicallyEligible.amountMinor, 5000);
  assert.equal(totals.commerciallyApproved.amountMinor, 0);
});
