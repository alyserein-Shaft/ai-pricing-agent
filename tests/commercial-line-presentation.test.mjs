import test from "node:test";
import assert from "node:assert/strict";

import {
  priceSourceBadge,
  lineTotalsModel,
  handoffChip,
  farenhytPolicyModel,
  applyFarenhytNet,
  currencyDisplay,
  quotationReadinessModel,
  USD_TO_SAR,
} from "../app/domain/commercial-line-presentation.mjs";

test("missing price is MISSING, never zero", () => {
  const badge = priceSourceBadge(null);
  assert.equal(badge.kind, "MISSING");
  assert.equal(badge.label, "Price missing");
  assert.equal(badge.actionable, true);
});

test("stale supplier quote is flagged, not hidden", () => {
  const badge = priceSourceBadge({ kind: "SUPPLIER_QUOTE", reference: "Q-12", validityState: "expired" });
  assert.equal(badge.label, "Supplier quote");
  assert.equal(badge.stale, true);
  const current = priceSourceBadge({ kind: "SUPPLIER_QUOTE", reference: "Q-13", validityState: "current" });
  assert.equal(current.stale, false);
});

test("historical price is labelled discovery-only", () => {
  assert.match(priceSourceBadge({ kind: "HISTORICAL" }).label, /discovery only/i);
});

test("partial totals exclude unpriced lines and say so", () => {
  const totals = lineTotalsModel([
    { extendedCost: 1000, hasPriceSource: true },
    { extendedCost: null, hasPriceSource: false },
  ]);
  assert.equal(totals.pricedCount, 1);
  assert.equal(totals.unpricedCount, 1);
  assert.equal(totals.totalCost, 1000);
  assert.equal(totals.partial, true);
  assert.match(totals.label, /Partial Total.*1 of 2 lines excluded/);
});

test("empty lines are not a zero total", () => {
  const totals = lineTotalsModel([]);
  assert.equal(totals.totalCost, null);
  assert.equal(totals.partial, false);
});

test("handoff chip maps the four governed states and fails closed", () => {
  assert.equal(handoffChip("TECHNICALLY READY").blocksPricing, false);
  assert.equal(handoffChip("TECHNICAL REVIEW REQUIRED").blocksPricing, true);
  assert.equal(handoffChip("TECHNICAL BLOCKED").blocksPricing, true);
  assert.equal(handoffChip("TECHNICAL DATA STALE").blocksPricing, true);
  assert.equal(handoffChip("something-unknown").blocksPricing, true);
});

test("Farenhyt 65% is UNREVIEWED without an approved discount_rules row", () => {
  assert.equal(farenhytPolicyModel(null).governed, false);
  assert.equal(farenhytPolicyModel(null).status, "UNREVIEWED");
  assert.equal(farenhytPolicyModel({ discount_basis_points: 6500, approval_state: "draft" }).governed, false);
  assert.equal(
    farenhytPolicyModel({ id: "r1", discount_basis_points: 6500, approval_state: "approved", superseded_at: null }).governed,
    true,
  );
});

test("Farenhyt net math is list x 0.35 and null-safe", () => {
  assert.equal(applyFarenhytNet(10000), 3500);
  assert.equal(applyFarenhytNet(null), null);
  assert.equal(applyFarenhytNet("many"), null);
});

test("SAR identity, USD at fixed 3.75, other currencies need review", () => {
  assert.equal(USD_TO_SAR, 3.75);
  assert.deepEqual(currencyDisplay(500, "SAR").converted, 500);
  assert.deepEqual(currencyDisplay(100, "USD").converted, 375);
  assert.equal(currencyDisplay(100, "USD").reviewRequired, false);
  const eur = currencyDisplay(100, "EUR");
  assert.equal(eur.converted, null);
  assert.equal(eur.reviewRequired, true);
  const unknown = currencyDisplay(null, "SAR");
  assert.equal(unknown.text, "UNKNOWN");
});

test("quotation readiness requires approval with no exclusions", () => {
  assert.equal(quotationReadinessModel(null).verdict, "NOT READY");
  assert.equal(
    quotationReadinessModel({ approvalState: "approved", excludedLines: 0, unresolvedLines: 0, commercialReady: true }).verdict,
    "READY TO ISSUE",
  );
  const partial = quotationReadinessModel({ approvalState: "approved", excludedLines: 3, unresolvedLines: 0, commercialReady: true });
  assert.equal(quotationReadinessModel({ approvalState: "approved", commercialReady: true }).excludedNote, null, "unknown exclusions are not claimed as zero");
  assert.equal(partial.verdict, "NOT READY");
  assert.match(partial.excludedNote, /3 lines excluded/);
});
