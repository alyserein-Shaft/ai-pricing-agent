// Commercial Policy Configuration -- domain contract.
//
// G-1 made an unconfigured commercial policy fail closed. That is only usable
// if something can WRITE a complete policy, and it is only trustworthy if the
// write path refuses to invent one. This suite pins both halves:
//
//   1. normalizeCommercialPolicy is the single definition of "a complete
//      commercial policy", and it is the same definition the read-side guard
//      (missingCommercialPolicy / assertCommercialPolicyConfigured) enforces.
//   2. A policy built this way flows through the real authoritative boundary
//      and produces the arithmetic the existing engine already produces --
//      pricing mathematics are pinned, not changed.
//
// The most important assertions here are the NEGATIVE ones: blanks must be
// rejected rather than defaulted. A validator that filled in a "sensible"
// rate would silently reintroduce exactly the defect G-1 removed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMERCIAL_POLICY_INVALID,
  SUPPORTED_SELLING_METHODS,
  buildCommercialPricingResult,
  missingCommercialPolicy,
  normalizeCommercialPolicy,
  sameCommercialPolicy,
} from "../app/domain/commercial-pricing-authority.mjs";

const readyCost = {
  readiness: { state: "COST_READY" },
  summary: {
    currency: "SAR",
    materialSubtotal: 1000,
    serviceSubtotal: 0,
    totalCost: 1000,
  },
  materialBreakdown: [{ scope: "Primary Product", extendedCost: 1000 }],
};
const readyEvidence = {
  approvalReady: true,
  totalCost: 1000,
  materialTotal: 1000,
  selectedSource: { id: "price-1", priceType: "Supplier Quote" },
};

const price = (settings) => {
  const normalized = normalizeCommercialPolicy(settings);
  assert.equal(
    normalized.ok,
    true,
    `expected a valid policy, got ${JSON.stringify(normalized.errors)}`,
  );
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: normalized.settings,
    evidenceResult: readyEvidence,
  });
  return { settings: normalized.settings, result };
};

const rejectCodes = (settings) => {
  const normalized = normalizeCommercialPolicy(settings);
  assert.equal(normalized.ok, false, "expected the policy to be rejected");
  assert.equal(normalized.code, COMMERCIAL_POLICY_INVALID);
  return normalized.errors.map((entry) => entry.code);
};

// ---------------------------------------------------------------------------
// Completeness: absence must never be defaulted into a decision.
// ---------------------------------------------------------------------------

test("an empty policy is rejected and names every missing policy", () => {
  assert.deepEqual(rejectCodes({}).sort(), [
    "CUSTOMER_DISCOUNT_REQUIRED",
    "SELLING_METHOD_REQUIRED",
    "SELLING_RATE_REQUIRED",
    "VAT_RATE_REQUIRED",
  ]);
});

test("a blank rate is NOT a 0% rate", () => {
  const codes = rejectCodes({
    sellingRule: { method: "Markup", rate: "" },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
  assert.ok(codes.includes("SELLING_RATE_REQUIRED"));
});

test("a missing rate is not defaulted to any commercial assumption", () => {
  const codes = rejectCodes({
    sellingRule: { method: "Markup" },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
  assert.ok(codes.includes("SELLING_RATE_REQUIRED"));
});

test("absence must not mean 0%: a missing discount is rejected", () => {
  for (const absent of [undefined, null, "", "   "]) {
    const codes = rejectCodes({
      sellingRule: { method: "Markup", rate: 20 },
      customerDiscount: { percentage: absent },
      vatRule: { rate: 15 },
    });
    assert.ok(
      codes.includes("CUSTOMER_DISCOUNT_REQUIRED"),
      `percentage=${JSON.stringify(absent)} must not be read as 0`,
    );
  }
});

test("a non-numeric discount is invalid rather than silently coerced", () => {
  for (const junk of [{}, [], true, "ten percent", Number.NaN]) {
    const codes = rejectCodes({
      sellingRule: { method: "Markup", rate: 20 },
      customerDiscount: { percentage: junk },
      vatRule: { rate: 15 },
    });
    assert.ok(
      codes.includes("INVALID_CUSTOMER_DISCOUNT"),
      `percentage=${JSON.stringify(junk)} must not be coerced`,
    );
  }
});

test("a missing VAT rule is rejected", () => {
  const codes = rejectCodes({
    sellingRule: { method: "Markup", rate: 20 },
    customerDiscount: { percentage: 0 },
  });
  assert.ok(codes.includes("VAT_RATE_REQUIRED"));
});

test("only the engine's rate-based methods are configurable; no method is invented", () => {
  assert.deepEqual([...SUPPORTED_SELLING_METHODS], ["Markup", "Target Margin"]);
  // "Fixed" exists in pricing-engine.mjs but takes a fixedPrice rather than a
  // rate; it is deliberately not configurable here and says so.
  const codes = rejectCodes({
    sellingRule: { method: "Fixed", rate: 20 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
  assert.ok(codes.includes("UNSUPPORTED_SELLING_METHOD"));
});

test("Target Margin 100% or more is rejected with the engine's own rule", () => {
  const codes = rejectCodes({
    sellingRule: { method: "Target Margin", rate: 100 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
  assert.ok(codes.includes("INVALID_MARGIN"));
});

test("out-of-range commercial values are rejected", () => {
  assert.ok(
    rejectCodes({
      sellingRule: { method: "Markup", rate: 20 },
      customerDiscount: { percentage: 101 },
      vatRule: { rate: 15 },
    }).includes("INVALID_CUSTOMER_DISCOUNT"),
  );
  assert.ok(
    rejectCodes({
      sellingRule: { method: "Markup", rate: 20 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: -1 },
    }).includes("INVALID_VAT"),
  );
  assert.ok(
    rejectCodes({
      sellingRule: { method: "Markup", rate: -5 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: 15 },
    }).includes("INVALID_SELLING_RATE"),
  );
});

// ---------------------------------------------------------------------------
// Single source of truth: what the writer accepts, the reader must accept.
// ---------------------------------------------------------------------------

test("every policy the writer accepts also satisfies the G-1 read guard", () => {
  const accepted = [
    { sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 15 } },
    { sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 0 } },
    { sellingRule: { method: "Target Margin", rate: 25, minimumMargin: 10 }, customerDiscount: { percentage: 5 }, vatRule: { rate: 15 } },
    { sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { applicable: false } },
  ];
  for (const candidate of accepted) {
    const normalized = normalizeCommercialPolicy(candidate);
    assert.equal(normalized.ok, true);
    assert.deepEqual(
      missingCommercialPolicy(normalized.settings),
      [],
      "an accepted policy must not read back as unconfigured",
    );
  }
});

test("a configured policy is canonicalised to the shape the engine reads", () => {
  const normalized = normalizeCommercialPolicy({
    sellingRule: { rate: "20", method: " Markup " },
    customerDiscount: { percentage: "0" },
    vatRule: { rate: "15" },
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.settings, {
    sellingRule: { method: "Markup", rate: 20 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
});

test("HTML number inputs (strings) are accepted without becoming absence", () => {
  const normalized = normalizeCommercialPolicy({
    sellingRule: { method: "Markup", rate: "20", minimumMargin: "10" },
    customerDiscount: { percentage: "0" },
    vatRule: { rate: "15" },
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.settings.sellingRule.minimumMargin, 10);
});

test("an explicit VAT-not-applicable decision is preserved, not treated as missing", () => {
  const { settings, result } = price({
    sellingRule: { method: "Markup", rate: 20 },
    customerDiscount: { percentage: 0 },
    vatRule: { applicable: false },
  });
  assert.deepEqual(settings.vatRule, { applicable: false });
  assert.equal(result.vat, 0);
  assert.equal(result.finalValue, 1200);
});

// ---------------------------------------------------------------------------
// Explicit zero is a real decision, and it survives persistence semantics.
// ---------------------------------------------------------------------------

test("explicit zeros persist as zeros and are distinguishable from missing", () => {
  const { settings } = price({
    sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
  });
  assert.equal(settings.sellingRule.rate, 0);
  assert.equal(settings.sellingRule.minimumMargin, 0);
  assert.equal(settings.customerDiscount.percentage, 0);
  assert.equal(settings.vatRule.rate, 0);
  // ...and the stored zeros still satisfy the read guard, which is exactly the
  // distinction G-1 introduced: 0 configured is not "absent".
  assert.deepEqual(missingCommercialPolicy(settings), []);
});

test("0% VAT and 15% VAT are distinguishable policies, not the same policy", () => {
  const zero = price({ sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 0 } });
  const fifteen = price({ sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 15 } });
  assert.equal(sameCommercialPolicy(zero.settings, fifteen.settings), false);
  assert.equal(zero.result.vat, 0);
  assert.equal(zero.result.finalValue, 1200);
  assert.equal(fifteen.result.vat, 180);
  assert.equal(fifteen.result.finalValue, 1380);
});

test("policy equality ignores key order and representation, not values", () => {
  assert.equal(
    sameCommercialPolicy(
      { sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 15 } },
      { vatRule: { rate: "15" }, customerDiscount: { percentage: 0 }, sellingRule: { rate: 20, method: "Markup" } },
    ),
    true,
  );
  assert.equal(
    sameCommercialPolicy(
      { sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 15 } },
      { sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 0 } },
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Pricing mathematics: pinned, not changed. Independent expected values.
// ---------------------------------------------------------------------------

test("Markup 20% / discount 0% / VAT 15% on 1000 SAR yields 1380 SAR", () => {
  // Independent arithmetic: gross = 1000 * 1.20 = 1200.00; discount 0 ->
  // net 1200.00; VAT = 1200.00 * 0.15 = 180.00; final = 1380.00.
  const { result } = price({
    sellingRule: { method: "Markup", rate: 20 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
  assert.equal(result.status, "Draft Price");
  assert.equal(result.grossSelling, 1200);
  assert.equal(result.netSelling, 1200);
  assert.equal(result.vat, 180);
  assert.equal(result.finalValue, 1380);
});

test("Target Margin 50% / discount 0% / VAT 0% on 1000 SAR yields 2000 SAR", () => {
  // Independent arithmetic for the target-margin method: gross =
  // cost / (1 - 0.50) = 2000.00 exactly, so this case is free of any rounding
  // interpretation and proves the method is genuinely reachable, not aliased
  // onto markup (1000 * 1.50 = 1500 would be a different number).
  const { result } = price({
    sellingRule: { method: "Target Margin", rate: 50 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
  });
  assert.equal(result.status, "Draft Price");
  assert.equal(result.grossSelling, 2000);
  assert.equal(result.netSelling, 2000);
  assert.equal(result.margin, 50);
  assert.equal(result.finalValue, 2000);
});

test("Target Margin 50% / discount 10% / VAT 15% on 1000 SAR yields 2070 SAR", () => {
  // Independent arithmetic: gross = 2000.00; discount = 2000 * 0.10 = 200.00;
  // net = 1800.00; VAT = 1800 * 0.15 = 270.00; final = 2070.00.
  const { result } = price({
    sellingRule: { method: "Target Margin", rate: 50 },
    customerDiscount: { percentage: 10 },
    vatRule: { rate: 15 },
  });
  assert.equal(result.netSelling, 1800);
  assert.equal(result.vat, 270);
  assert.equal(result.finalValue, 2070);
});

test("Target Margin 25% / discount 0% / VAT 15% on 1000 SAR yields 1533.33 SAR", () => {
  // Independent arithmetic: gross = 1000 / 0.75 = 1333.333... -> 1333.33;
  // net = 1333.33; VAT = 1333.33 * 0.15 = 199.9995 -> 200.00; final 1533.33.
  // Pinned because it is rounding-sensitive: it fails if anyone "tidies" the
  // engine's intermediate rounding.
  const { result } = price({
    sellingRule: { method: "Target Margin", rate: 25 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 15 },
  });
  assert.equal(result.grossSelling, 1333.33);
  assert.equal(result.vat, 200);
  assert.equal(result.finalValue, 1533.33);
});

// ---------------------------------------------------------------------------
// The minimum-margin guard must survive this slice untouched.
// ---------------------------------------------------------------------------

test("an explicit 0 markup is a real decision and produces 1000 SAR when no minimum margin is set", () => {
  const { result } = price({
    sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
  });
  assert.equal(result.approvalReady, true);
  assert.equal(result.markup, 0);
  assert.equal(result.finalValue, 1000);
});

test("an explicit minimum margin still blocks 0% markup (guard not weakened)", () => {
  assert.throws(
    () =>
      price({
        sellingRule: { method: "Markup", rate: 0, minimumMargin: 10 },
        customerDiscount: { percentage: 0 },
        vatRule: { rate: 0 },
      }),
    { code: "MINIMUM_MARGIN_BREACH" },
  );
});

test("a discount that breaches the configured minimum margin still blocks", () => {
  // Markup 20% / minimum margin 10% would normally pass (16.67% > 10%), but a
  // 50% discount drives the resulting margin below the minimum. The G-1
  // configuration slice must not create a way around this.
  const { result } = price({
    sellingRule: { method: "Markup", rate: 20, minimumMargin: 10 },
    customerDiscount: { percentage: 50 },
    vatRule: { rate: 15 },
  });
  assert.equal(result.status, "Pricing Blocked");
  assert.equal(result.approvalReady, false);
  assert.deepEqual(result.blockers, ["CUSTOMER_DISCOUNT_MINIMUM_BREACH"]);
  assert.equal(result.finalValue, undefined);
});
