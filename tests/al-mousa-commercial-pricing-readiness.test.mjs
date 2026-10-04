// Focused slice: Al Mousa commercial pricing readiness + cross-project isolation.
//
// SCOPE: pure domain-gate behavior and static authority-predicate checks.
// No DB writes, no network, no model. Live-state counts are verified
// separately against the miniflare D1 (see EV-20261002-AL-MOUSA-COMMERCIAL-...).
//
// What this pins:
//  1. The pricing engine refuses lines without technical approval, without
//     eligible safety, and without an explicitly selected source
//     (TECHNICAL_APPROVAL_REQUIRED / SAFETY_PRICE_ELIGIBILITY_REQUIRED /
//     PRICE_SOURCE_SELECTION_REQUIRED) — the exact live blocker for Al Mousa.
//  2. The same engine passes a fully-authorized line, including USD->SAR at
//     the governed 3.75 rate (6500 USD -> 24,375 SAR).
//  3. A price scoped to another project is ineligible here
//     ("Price is scoped to another project.") — the Makkah isolation rule.
//  4. The shipped current-pricing predicates scope by project AND scenario,
//     so Makkah runs/lines can never be read as Al Mousa authority.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculatePricingLine,
  selectPriceSources,
  convertCurrency,
} from "../app/domain/pricing-engine.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const AL_MOUSA = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const MAKKAH = "project_62553bdf-a06f-4951-8503-d058ac2d1a94";

const blockedInput = {
  projectId: AL_MOUSA,
  productId: "product_al_mousa_detector",
  candidateId: "candidate_al_mousa_1",
  quantity: "10",
  unit: "Each",
  projectCurrency: "SAR",
  calculatedAt: new Date().toISOString(),
  technicalApproval: null,
  safetyDecision: { priceEligibility: "Price Approval Disabled" },
  priceSources: [],
  selectedPriceSourceId: null,
  sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 0 },
  precision: 2,
};

test("Al Mousa-shaped unapproved line is refused with the exact live blockers", () => {
  const result = calculatePricingLine(blockedInput);
  assert.equal(result.status, "Pricing Blocked");
  assert.equal(result.approvalReady, false);
  for (const code of [
    "TECHNICAL_APPROVAL_REQUIRED",
    "SAFETY_PRICE_ELIGIBILITY_REQUIRED",
    "PRICE_SOURCE_SELECTION_REQUIRED",
  ]) {
    assert.ok(
      result.blockers.includes(code),
      `expected blocker ${code}, got ${result.blockers.join(",")}`,
    );
  }
});

test("a fully-authorized line passes, with USD->SAR at the governed 3.75 rate", () => {
  const source = {
    id: "price_global_farenhyt_list",
    productId: "product_al_mousa_detector",
    projectId: null, // global reusable list price, not project-owned
    amount: 6500,
    currency: "USD",
    priceType: "Manufacturer Price List",
    approvalStatus: "Approved",
    downstreamUse: "Costing",
    effectiveFrom: "2023-03-01T00:00:00.000Z",
    validUntil: "2027-06-30T00:00:00.000Z",
  };
  const result = calculatePricingLine({
    ...blockedInput,
    quantity: "1",
    technicalApproval: { status: "Approved", candidateId: "candidate_al_mousa_1" },
    safetyDecision: { priceEligibility: "Eligible for Price Approval" },
    priceSources: [source],
    selectedPriceSourceId: source.id,
    exchangeRate: {
      from: "USD",
      to: "SAR",
      rate: 3.75,
      source: "SAMA peg",
      version: 1,
      approvalStatus: "Approved",
      validUntil: "2027-06-30T00:00:00.000Z",
    },
  });
  assert.equal(result.approvalReady, true);
  assert.ok(["Draft Price", "Needs Review"].includes(result.status));
  assert.equal(result.selectedSource.amount, 6500);
  assert.equal(result.selectedSource.currency, "USD");
  assert.equal(result.conversion.convertedAmount, 24375);
  assert.equal(result.netMaterialUnitCost, 24375);
});

test("a Makkah-scoped price is ineligible for an Al Mousa line", () => {
  const ranked = selectPriceSources({
    sources: [
      {
        id: "price_makkah_supplier_quote",
        productId: "product_al_mousa_detector",
        projectId: MAKKAH,
        amount: 6000,
        currency: "SAR",
        priceType: "Supplier Quote",
        approvalStatus: "Approved",
        downstreamUse: "Costing",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2027-06-30T00:00:00.000Z",
      },
    ],
    projectId: AL_MOUSA,
    productId: "product_al_mousa_detector",
    quantity: "1",
    at: new Date().toISOString(),
  });
  assert.equal(ranked[0].eligible, false);
  assert.equal(ranked[0].explanation, "Price is scoped to another project.");
});

test("convertCurrency refuses without an approved current rate", () => {
  let thrown = null;
  try {
    convertCurrency({
      amount: 6500,
      sourceCurrency: "USD",
      projectCurrency: "SAR",
      exchangeRate: null,
      precision: 2,
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.code, "EXCHANGE_RATE_REQUIRED");
});

test("current pricing authority is scoped by project AND scenario", () => {
  const authority = readFileSync(
    join(HERE, "..", "worker", "pricing-authority.mjs"),
    "utf8",
  );
  assert.match(authority, /l\.project_id=\?/);
  assert.match(authority, /r\.scenario_id=\?/);
  const lineAuthority = readFileSync(
    join(HERE, "..", "worker", "quotation-line-authority.mjs"),
    "utf8",
  );
  assert.match(lineAuthority, /if \(!scenarioId\)/);
  const pricingApi = readFileSync(
    join(HERE, "..", "worker", "pricing-api.mjs"),
    "utf8",
  );
  assert.match(
    pricingApi,
    /FROM pricing_scenarios WHERE id=\? AND project_id=\?/,
  );
});
