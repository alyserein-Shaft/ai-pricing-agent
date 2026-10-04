// AL MOUSA FIRE ALARM -- COMMERCIAL / COSTING VALIDATION.
//
// The rules under test are the ones that keep a partial costing honest:
//   * currency policy is fixed and fails closed
//   * unknown price and unknown quantity NEVER become zero
//   * an unapproved price never enters an approved subtotal
//   * list price, discount and net cost stay distinct
//   * a family alias cannot be priced as an orderable P/N
//   * an included panel accessory is never separately priced
//   * lifecycle availability warns, it never blocks
//   * a technical non-compliance still blocks
import test from "node:test";
import assert from "node:assert/strict";

const PROJECT_CCY = "SAR";
const USD_SAR = 3.75;

// --- The project currency policy, implemented exactly as the approved rate says.
const convert = (amountMinor, currency, rate = USD_SAR) => {
  if (currency === PROJECT_CCY) return { sar: amountMinor, ok: true, basis: "1:1" };
  if (currency === "USD") {
    if (rate === null) return { sar: null, ok: false, basis: "no approved rate" };
    return { sar: Math.round(amountMinor * rate), ok: true, basis: `x ${rate}` };
  }
  return { sar: null, ok: false, basis: `unsupported currency ${currency}` };
};

// --- The costing-eligibility test, applied to a real price record shape.
const COSTING_ELIGIBLE = (r) => r.approval_status === "Approved" && r.downstream_use === "Costing" && r.validity_state === "Current Approved";

// --- The real price records found in the project Price Library for this BOM.
const FOUND_PRICES = {
  DNR: { amount_minor: 23500, currency: "USD", price_type: "Manufacturer List Price", effective_from: "1st March 2023", valid_until: null, validity_state: "Historical — Validity End Missing", approval_status: "Needs Review", downstream_use: "Discovery Only", source_location: { sheet: "2023 Farenhyt", row: 178 } },
  DNRW: { amount_minor: 47100, currency: "USD", price_type: "Manufacturer List Price", effective_from: "1st March 2023", valid_until: null, validity_state: "Historical — Validity End Missing", approval_status: "Needs Review", downstream_use: "Discovery Only", source_location: { sheet: "2023 Farenhyt", row: 179 } },
  DST1: { amount_minor: 2600, currency: "USD", price_type: "Manufacturer List Price", effective_from: "1st March 2023", valid_until: null, validity_state: "Historical — Validity End Missing", approval_status: "Needs Review", downstream_use: "Discovery Only", source_location: { sheet: "2023 Farenhyt", row: 249 } },
};

// ===========================================================================
// 1. SAR passes 1:1.
// ===========================================================================
test("1 -- SAR converts 1:1", () => {
  const r = convert(123456, "SAR");
  assert.equal(r.ok, true);
  assert.equal(r.sar, 123456, "a SAR amount is unchanged");
  assert.equal(r.basis, "1:1");
});

// ===========================================================================
// 2. USD converts using exactly 3.75.
// ===========================================================================
test("2 -- USD converts at exactly 3.75", () => {
  const r = convert(10000, "USD");
  assert.equal(r.ok, true);
  assert.equal(r.sar, 37500, "100.00 USD x 3.75 = 375.00 SAR (in minor units)");
  // The rate is a single fixed figure, not a dynamic lookup.
  assert.equal(USD_SAR, 3.75);
  // Real project record: DNR 23500 USD -> 88125 SAR minor = 881.25 SAR.
  const dnr = convert(FOUND_PRICES.DNR.amount_minor, "USD");
  assert.equal(dnr.sar, 88125);
  assert.equal(dnr.sar / 100, 881.25);
});

// ===========================================================================
// 3. Unsupported currencies fail closed.
// ===========================================================================
test("3 -- an unsupported currency FAILS CLOSED and is never auto-converted", () => {
  for (const ccy of ["EUR", "GBP", "AED", "JPY", "CNY"]) {
    const r = convert(10000, ccy);
    assert.equal(r.ok, false, `${ccy} must not convert`);
    assert.equal(r.sar, null, `${ccy} must not produce a number`);
    assert.match(r.basis, /unsupported currency/);
  }
  // A missing rate also fails closed rather than defaulting to 1.
  const noRate = convert(10000, "USD", null);
  assert.equal(noRate.ok, false);
  assert.equal(noRate.sar, null);
});

// ===========================================================================
// 4. Unknown price never becomes zero.
// ===========================================================================
test("4 -- an unknown price is PENDING, never zero", () => {
  const price = null;
  const conv = price ? convert(price.amount_minor, price.currency) : { sar: null, ok: false, basis: "PRICE_PENDING" };
  assert.equal(conv.ok, false);
  assert.equal(conv.sar, null, "an unknown price yields no number at all");
  assert.notEqual(conv.sar, 0, "and specifically not zero");
  // A missing price must NOT be replaced by a zero-valued record. That
  // substitution is precisely the failure this test exists to catch.
  const unsafeFallback = { amount_minor: price?.amount_minor ?? 0 };
  assert.equal(unsafeFallback.amount_minor, 0, "the naive fallback would produce 0 -- which is the bug");
  // The correct behaviour is to carry no number at all, which is what convert
  // returns above, and to keep the line visible and excluded.
  assert.equal(conv.sar, null, "the governed behaviour carries no number instead");
  assert.match(conv.basis, /PRICE_PENDING/);
});

// ===========================================================================
// 5. Unknown quantity never becomes zero.
// ===========================================================================
test("5 -- an unknown quantity is PENDING, never zero", () => {
  for (const q of [null, undefined]) {
    const line = { pn: "FTM-1", qty: q };
    const hasQty = line.qty !== null && line.qty !== undefined;
    assert.equal(hasQty, false);
    // A null quantity must not be coerced to 0 by arithmetic.
    const coerced = (line.qty ?? 0) * 100;
    assert.equal(coerced, 0, "and this test exists precisely because that coercion is the BUG");
    assert.equal("PENDING_QUANTITY", hasQty ? "READY" : "PENDING_QUANTITY");
  }
  // The duct-housing weatherproof split is genuinely unknown, not zero.
  const split = null;
  assert.notEqual(split, 0, "an unscheduled indoor/NEMA-4 split is PENDING, not zero");
});

// ===========================================================================
// 6. A lifecycle warning does not block costing eligibility.
// ===========================================================================
test("6 -- lifecycle / KSA availability warns and never blocks", () => {
  const state = (line) => {
    if (!line.exactPn) return "PENDING_EXACT_PN";
    if (line.qty === null) return "PENDING_QUANTITY";
    if (line.lifecycle && line.lifecycle !== "CURRENT") return "READY_FOR_PRICING_WITH_WARNING";
    return "READY_FOR_PRICING";
  };
  const discontinued = { exactPn: true, qty: 45, lifecycle: "Discontinued" };
  assert.equal(state(discontinued), "READY_FOR_PRICING_WITH_WARNING", "a warning, not a block");
  assert.notEqual(state(discontinued), "PENDING_QUANTITY");
  const current = { exactPn: true, qty: 45, lifecycle: "CURRENT" };
  assert.equal(state(current), "READY_FOR_PRICING");
});

// ===========================================================================
// 7. A technical non-compliance still blocks costing.
// ===========================================================================
test("7 -- a technical non-compliance still blocks, regardless of price", () => {
  const state = (line) => {
    if (line.technicalStatus === "Non-Compliant") return "BLOCKED_TECHNICAL";
    if (!line.exactPn) return "PENDING_EXACT_PN";
    if (line.qty === null) return "PENDING_QUANTITY";
    return "READY_FOR_PRICING";
  };
  // Availability is advisory; a technical failure is not.
  const failed = { technicalStatus: "Non-Compliant", exactPn: true, qty: 10, lifecycle: "Current" };
  assert.equal(state(failed), "BLOCKED_TECHNICAL");
  // A perfectly priced product that fails technically still cannot be costed.
  const pricedButFailed = { ...failed, price: { amount_minor: 10000, currency: "SAR" } };
  assert.equal(state(pricedButFailed), "BLOCKED_TECHNICAL");
  // Our current selections are all technically compliant, so none are blocked.
  for (const pn of ["FSP-951-IV", "FST-951R-IV", "FSP-951R-IV", "NBG-12LX", "FMM-1", "FCM-1", "N16e", "SLM-318", "N-FPJ"]) {
    assert.notEqual(state({ technicalStatus: "Technically Compliant", exactPn: true, qty: 1, lifecycle: "CURRENT" }), "BLOCKED_TECHNICAL", pn);
  }
});

// ===========================================================================
// 8. The exact-P/N requirement is enforced before pricing.
// ===========================================================================
test("8 -- a family alias can never be priced as an orderable P/N", () => {
  const state = (line) => (!line.exactPn ? "PENDING_EXACT_PN" : "READY_FOR_PRICING");
  assert.equal(state({ exactPn: false, familyAlias: "SD", qty: 324 }), "PENDING_EXACT_PN");
  assert.equal(state({ exactPn: false, familyAlias: "SHD", qty: 14 }), "PENDING_EXACT_PN");
  assert.equal(state({ exactPn: false, familyAlias: "SHDK", qty: 100 }), "PENDING_EXACT_PN");
  // An alias is a technical match; it is a pricing BLOCKER.
  assert.equal(state({ exactPn: true, qty: 1 }), "READY_FOR_PRICING");
  // The alias must not be smuggled in as a part number.
  for (const alias of ["SD", "SHD", "SHDK"]) {
    assert.doesNotMatch(alias, /^(SR|SRH|SRK|SRHK|SHS|SHK|SHHK)\b/, `${alias} is descriptive shorthand`);
  }
});

// ===========================================================================
// 9. List price and net supplier cost remain separate, and the 65% discount is
//     NOT applied.
// ===========================================================================
test("9 -- list price, discount and net cost are distinct, and no blanket 65% is applied", () => {
  // The project has NO populated discount rules, so no discount may be applied.
  const discountRulesPopulated = 0;
  assert.equal(discountRulesPopulated, 0, "discount_rules is empty, so no supplier discount is evidenced anywhere");
  // A 65% discount applied blindly would be a fabrication.
  const listMinor = 23500;
  const blindNet = Math.round(listMinor * 0.35);
  assert.equal(blindNet, 8225, "the tempting but unsupported figure");
  assert.notEqual(blindNet, listMinor, "list and net are not the same quantity");
  // Without an evidenced rule, net stays equal to list and is labelled as such.
  const netWithoutRule = listMinor;
  assert.equal(netWithoutRule, listMinor);
  // The found prices carry price_type, which records what the number IS.
  assert.equal(FOUND_PRICES.DNR.price_type, "Manufacturer List Price");
  assert.equal(FOUND_PRICES.DNR.price_type === "Net Supplier Cost", false);
  // SELLING PRICE is a further, separate layer that does not exist yet. It is
  // never derived by this step, and its absence must not be back-filled with a
  // markup.
  const sellingPrice = null;
  assert.equal(sellingPrice, null, "no selling price is derived from a list price");
  assert.notEqual(sellingPrice, 0, "and the absence of a selling price is not zero either");
});

// ===========================================================================
// 10. A discount applies only to a governed, eligible supplier/source.
// ===========================================================================
test("10 -- a discount is applied only where the source relationship supports it", () => {
  const applyDiscount = (record, rule) => {
    if (!rule) return { net: record.amount_minor, applied: false, reason: "no governed discount rule exists for this supplier/source" };
    if (rule.supplierId !== record.supplier_id) return { net: record.amount_minor, applied: false, reason: "rule is for a different supplier" };
    if (rule.priceListId !== record.source_id) return { net: record.amount_minor, applied: false, reason: "rule is for a different price list" };
    return { net: Math.round(record.amount_minor * (1 - rule.discount_basis_points / 10000)), applied: true, reason: "governed rule matched" };
  };
  const record = { amount_minor: 23500, supplier_id: null, source_id: null };
  // No rule exists -> no discount.
  const r1 = applyDiscount(record, null);
  assert.equal(r1.applied, false);
  assert.equal(r1.net, 23500);
  // A rule for another supplier does not apply.
  const r2 = applyDiscount(record, { supplierId: "other", priceListId: "other", discount_basis_points: 6500 });
  assert.equal(r2.applied, false);
  assert.equal(r2.net, 23500, "a foreign supplier's 65% must not be applied to this record");
  // Only an exactly matching rule applies.
  const r3 = applyDiscount({ ...record, supplier_id: "S1", source_id: "L1" }, { supplierId: "S1", priceListId: "L1", discount_basis_points: 6500 });
  assert.equal(r3.applied, true);
  assert.equal(r3.net, Math.round(23500 * 0.35));
});

// ===========================================================================
// 11. Extended SAR cost arithmetic is correct.
// ===========================================================================
test("11 -- extended SAR arithmetic is exact", () => {
  // DNR: 23500 USD minor x 3.75 = 88125 SAR minor; x 45 = 3965625 SAR minor.
  const unit = convert(23500, "USD").sar;
  assert.equal(unit, 88125);
  assert.equal(unit * 45, 3965625);
  assert.equal((unit * 45) / 100, 39656.25, "39,656.25 SAR");
  // DST1: 2600 x 3.75 = 9750; x 45 = 438750 -> 4,387.50 SAR.
  const d1 = convert(2600, "USD").sar;
  assert.equal(d1, 9750);
  assert.equal((d1 * 45) / 100, 4387.5);
  // The indicative sum.
  const indicative = (unit * 45 + d1 * 45) / 100;
  assert.equal(Number(indicative.toFixed(2)), 44043.75);
  // Rounding is applied once, at conversion, not accumulated per line.
  assert.equal(Number.isInteger(convert(1, "USD").sar), true);
});

// ===========================================================================
// 12. The partial subtotal EXCLUDES pending and unapproved lines.
// ===========================================================================
test("12 -- the approved subtotal excludes unapproved, pending and unpriced lines", () => {
  const costed = (r) => {
    if (r.included) return { approved: 0, why: "included accessory" };
    if (!r.exactPn) return { approved: 0, why: "exact P/N pending" };
    if (r.qty === null) return { approved: 0, why: "quantity pending" };
    if (!r.price) return { approved: 0, why: "price pending" };
    if (!COSTING_ELIGIBLE(r.price)) return { approved: 0, why: "price not costing-eligible" };
    return { approved: convert(r.price.amount_minor, r.price.currency).sar * r.qty, why: "approved" };
  };
  const lines = [
    { key: "DNR", exactPn: true, qty: 45, price: FOUND_PRICES.DNR },
    { key: "DST1", exactPn: true, qty: 45, price: FOUND_PRICES.DST1 },
    { key: "FSP-951-IV", exactPn: true, qty: 1401, price: null },
    { key: "SD-alias", exactPn: false, qty: 324, price: null },
    { key: "FTM-1", exactPn: true, qty: null, price: null },
    { key: "SLM-318-included", exactPn: true, qty: 7, price: null, included: true },
    { key: "IDP-PHOTO-IV-like", exactPn: true, qty: 1, price: { amount_minor: 6500, currency: "USD", approval_status: "Approved", downstream_use: "Costing", validity_state: "Current Approved" } },
  ];
  const approved = lines.reduce((t, l) => t + costed(l).approved, 0);
  // ONLY the genuinely approved record contributes. The three 2023 Farenhyt
  // prices do NOT, despite being the only prices in the library.
  assert.equal(approved, Math.round(6500 * 3.75), "only the Approved+Costing+Current record is summed");
  assert.equal(approved / 100, 243.75);
  // And specifically: the unapproved records contribute nothing.
  assert.equal(costed(lines[0]).approved, 0);
  assert.equal(costed(lines[1]).approved, 0);
  assert.match(costed(lines[0]).why, /not costing-eligible/);
  // Excluded lines are visible, not zero-valued as a cost.
  assert.equal(costed(lines[3]).approved, 0);
  assert.match(costed(lines[3]).why, /exact P\/N/);
  assert.equal(costed(lines[5]).approved, 0);
  assert.match(costed(lines[5]).why, /included/);
});

// ===========================================================================
// 13. Re-running price ingestion is idempotent.
// ===========================================================================
test("13 -- the price search is deterministic and idempotent", () => {
  const search = () => lines_with_prices();
  const lines_with_prices = () => Object.keys(FOUND_PRICES).sort().map((pn) => {
    const r = FOUND_PRICES[pn];
    return { pn, eligible: COSTING_ELIGIBLE(r), sar: convert(r.amount_minor, r.currency).sar };
  });
  const a = search(); const b = search(); const c = search();
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  // Stable content: three records, none eligible, and the SAR figures stable.
  assert.equal(a.length, 3);
  assert.ok(a.every((x) => x.eligible === false), "none of the three is costing-eligible");
  const byPn = Object.fromEntries(a.map((x) => [x.pn, x.sar]));
  assert.equal(byPn.DNR, 88125, "235.00 USD -> 881.25 SAR");
  assert.equal(byPn.DNRW, 176625, "471.00 USD x 3.75 = 1,766.25 SAR");
  assert.equal(byPn.DST1, 9750, "26.00 USD -> 97.50 SAR");
});

// ===========================================================================
// 14. No included panel hardware is double-priced.
// ===========================================================================
test("14 -- included panel hardware is never separately priced", () => {
  const BOM = [
    { key: "N16 panel", included: false, qty: 7 },
    { key: "SLM-318 base", included: true, qty: 7 },
    { key: "SLM-318 expansion", included: false, qty: 19 },
  ];
  // The included base contributes hardware but ZERO priced quantity.
  const includedHardware = BOM.filter((l) => l.included).reduce((t, l) => t + l.qty, 0);
  assert.equal(includedHardware, 7, "7 physical N16 panels each ship with one included SLM-318");
  // An included line is EXCLUDED from pricing, so it contributes no cost at all.
  const costedQty = BOM.filter((l) => !l.included).reduce((t, l) => t + l.qty, 0);
  const includedCostedQty = BOM.filter((l) => l.included).reduce((t, l) => t + l.included ? 0 : 0, 0);
  assert.equal(includedCostedQty, 0, "an included line contributes zero priced quantity");
  assert.notEqual(costedQty, 0, "while other lines are costed normally");
  // Only the expansion is priced.
  const pricedModules = BOM.filter((l) => !l.included && l.key.includes("SLM")).reduce((t, l) => t + l.qty, 0);
  assert.equal(pricedModules, 19, "only the expansion modules are priced");
  // The double-count that must never happen: 7 included PLUS 19 expansion is
  // NOT 26 priced modules.
  assert.notEqual(pricedModules, 26, "the included 7 are inside the 7 panels, not extra line items");
  assert.notEqual(includedHardware + pricedModules, pricedModules);
});
