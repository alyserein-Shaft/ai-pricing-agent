// G-3 + G-4 -- exactly one FX truth.
//
// G-3: the UI carried a second, wrong rate. `useState(3.755)` and
// `settingsDraft.exchangeRate: 3.755` meant a customer could see, and the commercial
// payload could carry, a rate that is not the project policy. The authoritative rate
// is the engine constant, and the UI now imports it so it cannot drift again.
//
// G-4: `pricing_exchange_rates` is EVIDENCE of the fixed policy, not an override.
// convertCurrency is unconditional -- it multiplies by FIXED_USD_TO_SAR_RATE and
// ignores any record- or client-supplied rate. A record that disagrees must become a
// visible governance conflict, not a silent override and not a silent contradiction.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  convertCurrency,
  evaluateGovernedExchangeRate,
  FIXED_USD_SAR_POLICY,
  FIXED_USD_TO_SAR_RATE,
} from "../app/domain/pricing-engine.mjs";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the project FX policy is exactly SAR 1:1 and USD x 3.75", () => {
  assert.equal(FIXED_USD_TO_SAR_RATE, 3.75);
  assert.equal(FIXED_USD_SAR_POLICY, "FIXED_USD_SAR");
  const sar = convertCurrency({ amount: 100, sourceCurrency: "SAR", projectCurrency: "SAR" });
  assert.equal(sar.rate, 1);
  assert.equal(sar.convertedAmount, 100);
  const usd = convertCurrency({ amount: 100, sourceCurrency: "USD", projectCurrency: "SAR" });
  assert.equal(usd.rate, 3.75);
  assert.equal(usd.convertedAmount, 375);
});

test("G-3: no 3.755 survives anywhere in the shipped UI source", () => {
  // The golden image-width fixtures (33.755...) are unrelated geometry, so the check
  // targets the rate specifically: 3.755 as a standalone number.
  const offenders = pageSource.split("\n")
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /(?<![\d.])3\.755(?![\d])/.test(line))
    .filter(([, line]) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
  assert.deepEqual(offenders, [], `3.755 still present in shipped code: ${JSON.stringify(offenders)}`);
});

test("G-3: the UI takes the rate from the engine instead of restating it", () => {
  assert.ok(
    pageSource.includes('import { FIXED_USD_TO_SAR_RATE } from "./domain/pricing-engine.mjs";'),
    "the UI must import the authoritative rate rather than hardcoding one",
  );
  assert.ok(
    !/exchangeRate:\s*3\.\d+/.test(pageSource),
    "no hardcoded exchangeRate literal may remain in the commercial UI payload",
  );
  assert.ok(
    /useState\(FIXED_USD_TO_SAR_RATE\)/.test(pageSource),
    "the UI rate state must be seeded from the engine constant",
  );
});

test("G-4: an inconsistent USD/SAR record is a visible conflict, not an override", () => {
  const result = evaluateGovernedExchangeRate({ id: "r1", from_currency: "USD", to_currency: "SAR", rate: 3.755 });
  assert.equal(result.consistent, false);
  assert.equal(result.source, "conflicting-record");
  assert.equal(result.authoritativeRate, 3.75);
  assert.equal(result.recordRate, 3.755);
  assert.match(result.conflict, /must be corrected or superseded/i);
});

test("G-4: a consistent record is accepted as evidence of the policy", () => {
  const result = evaluateGovernedExchangeRate({ id: "r1", from_currency: "USD", to_currency: "SAR", rate: 3.75 });
  assert.equal(result.consistent, true);
  assert.equal(result.source, "consistent-record");
  assert.equal(result.conflict, null);
  assert.equal(result.authoritativeRate, 3.75);
});

test("G-4: the absence of a record is not a conflict (the fixed policy stands alone)", () => {
  const result = evaluateGovernedExchangeRate(null);
  assert.equal(result.consistent, true);
  assert.equal(result.source, "no-governed-record");
  assert.equal(result.authoritativeRate, 3.75);
});

test("G-4: an unreadable approved record is flagged rather than trusted", () => {
  const result = evaluateGovernedExchangeRate({ id: "r1", from_currency: "USD", to_currency: "SAR", rate: "three point seven five" });
  assert.equal(result.consistent, false);
  assert.equal(result.source, "unreadable-record");
  assert.match(result.conflict, /unreadable/i);
});

test("G-4: a record for another currency pair is not a conflict with this policy", () => {
  const result = evaluateGovernedExchangeRate({ id: "r1", from_currency: "EUR", to_currency: "SAR", rate: 4.2 });
  assert.equal(result.consistent, true);
  assert.equal(result.source, "other-currency-pair");
  assert.equal(result.authoritativeRate, 3.75);
});

test("G-4: a conflicting record cannot change quotation money", () => {
  // The strongest statement of the contract: whatever the record claims, the money is
  // computed at the fixed policy rate.
  const record = { id: "r1", from_currency: "USD", to_currency: "SAR", rate: 3.755 };
  const evaluation = evaluateGovernedExchangeRate(record);
  const converted = convertCurrency({ amount: 1000, sourceCurrency: "USD", projectCurrency: "SAR" });
  assert.equal(converted.rate, FIXED_USD_TO_SAR_RATE);
  assert.equal(converted.convertedAmount, 3750);
  assert.notEqual(converted.convertedAmount, 1000 * record.rate, "the record must not drive the conversion");
  assert.equal(evaluation.authoritativeRate, converted.rate, "the surfaced authoritative rate is the one that priced the money");
});

test("G-4: there is no dynamic FX -- a client-supplied rate is ignored by the engine", () => {
  // calculateCostModel passes an exchangeRate through; convertCurrency must not use it.
  const withRate = convertCurrency({ amount: 100, sourceCurrency: "USD", projectCurrency: "SAR", exchangeRate: 99 });
  assert.equal(withRate.rate, 3.75);
  assert.equal(withRate.convertedAmount, 375);
});

test("unsupported currencies still fail closed", () => {
  for (const [source, project] of [["EUR", "SAR"], ["USD", "USD"], ["", "SAR"], ["USD", ""]]) {
    assert.throws(
      () => convertCurrency({ amount: 100, sourceCurrency: source, projectCurrency: project }),
      (error) => error.code === "UNSUPPORTED_CURRENCY",
      `${source || "(missing)"} -> ${project || "(missing)"} must fail closed`,
    );
  }
});
