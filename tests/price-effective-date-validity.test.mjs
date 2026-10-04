// G-5 -- price effective/expiry dates must fail closed.
//
// Proven defect: `priceValidity` compared `new Date(effectiveFrom) > new Date(at)`.
// `new Date("1st March 2023")` is an Invalid Date and every comparison against one
// is false, so an UNPARSEABLE effective_from never returned "Future": the price fell
// through and was treated as already in force. That is a fail-open on the exact gate
// that decides whether a price may be used for costing. The same NaN comparison made
// a malformed valid_until read as "Valid" instead of expired.
//
// These tests drive the real costing eligibility path (selectPriceSources), not only
// the date helper, and cover both the strict Pricing gate and the relaxed Costing
// policy, because the fix must hold in the mode that is deliberately more lenient.
import assert from "node:assert/strict";
import test from "node:test";

import {
  governedDateRemediation,
  parseGovernedPriceDate,
  priceValidity,
  selectPriceSources,
} from "../app/domain/pricing-engine.mjs";

const AT = "2026-09-30T00:00:00.000Z";

const source = (overrides = {}) => ({
  id: "src-1",
  productId: "p1",
  priceType: "Supplier Quote",
  approvalStatus: "Approved",
  downstreamUse: "Costing",
  reliability: 90,
  ...overrides,
});

const select = (sources, extra = {}) =>
  selectPriceSources({ sources, projectId: "pr1", productId: "p1", quantity: 1, region: "SA", at: AT, ...extra });

test("a valid past effective date with a future expiry is Valid and eligible", () => {
  const s = source({ effectiveFrom: "2023-01-01", validUntil: "2027-01-01" });
  assert.equal(priceValidity(s, AT), "Valid");
  assert.equal(select([s])[0].eligible, true);
});

test("a valid current/today effective date is in force", () => {
  const s = source({ effectiveFrom: AT.slice(0, 10), validUntil: "2027-01-01" });
  assert.equal(priceValidity(s, AT), "Valid");
  assert.equal(select([s])[0].eligible, true);
});

test("a valid FUTURE effective date is ineligible (unchanged behaviour)", () => {
  const s = source({ effectiveFrom: "2027-06-01", validUntil: "2028-01-01" });
  assert.equal(priceValidity(s, AT), "Future");
  const chosen = select([s])[0];
  assert.equal(chosen.eligible, false);
  assert.equal(chosen.status, "Future");
  assert.match(chosen.explanation, /not yet effective/i);
});

test("an EXPIRED price is ineligible (expiry policy unchanged)", () => {
  const s = source({ effectiveFrom: "2023-01-01", validUntil: "2024-01-01" });
  assert.equal(priceValidity(s, AT), "Expired");
  assert.equal(select([s])[0].eligible, false);
});

test("a MISSING validity date keeps the existing absence policy (unchanged)", () => {
  const s = source({ effectiveFrom: "2023-01-01" });
  assert.equal(priceValidity(s, AT), "No Validity Provided");
  // Strict Pricing mode still blocks; the relaxed Costing mode still admits it.
  assert.equal(select([s])[0].eligible, false);
  const relaxed = select([s], { allowExpiredOrMissingValidity: true })[0];
  assert.equal(relaxed.eligible, true, "the relaxed Costing policy on ABSENT dates is unchanged");
  // `validity` is the truthful state; `status` is relabelled to "Recommended" for
  // the winning row, so the assertion belongs on validity, not on status.
  assert.equal(relaxed.validity, "No Validity Provided");
  // The recommended row keeps the validity caveat visible rather than relabelling the
  // source as simply "Valid".
  assert.match(relaxed.explanation, /validity: No Validity Provided/i);
  assert.equal(/\bValid Alternative\b/.test(relaxed.status), false, "a source with no validity must not be relabelled Valid");
});

test("an EXPIRING SOON price is eligible in strict mode (unchanged)", () => {
  const s = source({ effectiveFrom: "2023-01-01", validUntil: "2026-10-05" });
  assert.equal(priceValidity(s, AT), "Expiring Soon");
  assert.equal(select([s])[0].eligible, true);
});

test("a REJECTED source stays rejected (unchanged)", () => {
  const s = source({ effectiveFrom: "2023-01-01", validUntil: "2027-01-01", status: "Rejected" });
  assert.equal(priceValidity(s, AT), "Rejected");
  assert.equal(select([s])[0].eligible, false);
});

// ---------------------------------------------------------------- G-5 itself
test("a MALFORMED effective_from is reported and does not read as in force", () => {
  const s = source({ effectiveFrom: "1st March 2023", validUntil: "2027-01-01" });
  assert.equal(priceValidity(s, AT), "Invalid Effective Date");
  // The regression: previously this returned "Valid" and was eligible.
  assert.equal(new Date("1st March 2023") > new Date(AT), false, "documents why the old gate failed open");
});

test("a MALFORMED effective_from blocks costing eligibility in BOTH modes", () => {
  const s = source({ effectiveFrom: "1st March 2023", validUntil: "2027-01-01" });
  const strict = select([s])[0];
  assert.equal(strict.eligible, false, "strict mode must not use an unreadable date");
  assert.equal(strict.status, "Unusable Date");
  assert.match(strict.explanation, /unreadable effective_from/i);
  // The relaxed Costing policy must not excuse a data-integrity failure.
  const relaxed = select([s], { allowExpiredOrMissingValidity: true })[0];
  assert.equal(relaxed.eligible, false, "the relaxed Costing policy must not admit an unreadable date");
});

test("a MALFORMED valid_until is reported and does not read as Valid", () => {
  const s = source({ effectiveFrom: "2023-01-01", validUntil: "whenever" });
  assert.equal(priceValidity(s, AT), "Invalid Expiry Date");
  assert.equal(select([s])[0].eligible, false);
  const relaxed = select([s], { allowExpiredOrMissingValidity: true })[0];
  assert.equal(relaxed.eligible, false, "an unreadable expiry cannot be waved through by the relaxed policy");
  assert.match(relaxed.explanation, /unreadable valid_until/i);
});

test("an unreadable date never becomes the recommended source", () => {
  const bad = source({ id: "bad", effectiveFrom: "1st March 2023", validUntil: "2027-01-01", reliability: 99 });
  const good = source({ id: "good", effectiveFrom: "2023-01-01", validUntil: "2027-01-01", reliability: 50 });
  const ranked = select([bad, good]);
  assert.equal(ranked[0].id, "good", "the unreadable-date source must not outrank a readable one");
  assert.equal(ranked[0].status, "Recommended");
  assert.equal(ranked.find((r) => r.id === "bad").eligible, false);
});

test("only ISO-8601 is accepted; arbitrary human strings are not guessed", () => {
  assert.equal(parseGovernedPriceDate("2024-02-29").ok, true);
  assert.equal(parseGovernedPriceDate("2024-02-29T10:00:00Z").ok, true);
  assert.equal(parseGovernedPriceDate("2024-02-29T10:00:00.123Z").ok, true);
  for (const bad of ["1st March 2023", "March 2023", "next tuesday", "2024/03/01", "03-01-2024", "2024-13-01", "not a date", "  "]) {
    const parsed = parseGovernedPriceDate(bad);
    if (bad === "  ") { assert.equal(parsed.present, false); continue; }
    assert.equal(parsed.ok, false, `"${bad}" must not be accepted as a governed date`);
  }
  // Absent is absent, not invalid.
  assert.deepEqual(parseGovernedPriceDate(null), { present: false, ok: true, ms: null, raw: null });
  assert.equal(parseGovernedPriceDate(undefined).present, false);
});

// ------------------------------------------------------------- remediation
test("remediation normalizes only unambiguous legacy dates and reports the rest", () => {
  assert.deepEqual(governedDateRemediation("2024-01-31"), { resolved: true, iso: "2024-01-31", reason: "already-parseable" });
  assert.deepEqual(governedDateRemediation("1st March 2023"), { resolved: true, iso: "2023-03-01", reason: "normalized-legacy-format" });
  assert.deepEqual(governedDateRemediation("March 1, 2023"), { resolved: true, iso: "2023-03-01", reason: "normalized-legacy-format" });
  assert.deepEqual(governedDateRemediation("15 September 2024"), { resolved: true, iso: "2024-09-15", reason: "normalized-legacy-format" });

  // Unresolvable stays unresolved so a human supplies the value.
  for (const [value, reason] of [
    ["sometime next year", "unrecognised-format"],
    ["31 February 2023", "not-a-real-date"],
    ["1st Smarch 2023", "unknown-month"],
    ["99 March 2023", "implausible-day"],
  ]) {
    const result = governedDateRemediation(value);
    assert.equal(result.resolved, false, `"${value}" must not be auto-resolved`);
    assert.equal(result.reason, reason, `"${value}" reason`);
  }
  assert.equal(governedDateRemediation(null).reason, "absent");
});

test("remediation is a data-boundary helper and is NOT applied during costing", () => {
  // A legacy string stays invalid for costing even though remediation could resolve
  // it. The operator must correct the record; costing must not reinterpret it.
  const s = source({ effectiveFrom: "1st March 2023", validUntil: "2027-01-01" });
  assert.equal(priceValidity(s, AT), "Invalid Effective Date");
  assert.equal(select([s])[0].eligible, false);
  // ...and once the record is corrected, the same price becomes usable.
  const corrected = { ...s, effectiveFrom: governedDateRemediation("1st March 2023").iso };
  assert.equal(priceValidity(corrected, AT), "Valid");
  assert.equal(select([corrected])[0].eligible, true);
});

test("an impossible ISO date is invalid rather than rolled over", () => {
  const s = source({ effectiveFrom: "2023-02-30", validUntil: "2027-01-01" });
  assert.equal(parseGovernedPriceDate("2023-02-30").ok, false, "2023-02-30 is not a real date");
  assert.equal(priceValidity(s, AT), "Invalid Effective Date");
  assert.equal(select([s])[0].eligible, false);
});
