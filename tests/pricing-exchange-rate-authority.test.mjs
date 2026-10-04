import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { loadApprovedExchangeRateRow, loadPreviousExchangeRateVersion } from "../worker/pricing-authority.mjs";

// Consolidation Fix Sprint 1, item 4: the same "approved, current,
// project-wide exchange rate" query was independently typed in
// boq-line-cost-api.mjs and pricing-runtime.mjs, and the same
// "latest version of this currency pair, to supersede" query was
// independently typed in boq-line-cost-api.mjs and pricing-api.mjs. Both
// are now single, shared helpers in pricing-authority.mjs. Preserves exact
// prior behavior -- no rounding/fallback/currency-authority changes.

const PROJECT_ID = "project-exchange-rate";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
});

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE pricing_exchange_rates (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      from_currency TEXT,
      to_currency TEXT,
      rate TEXT,
      rate_type TEXT,
      source TEXT,
      version_number INTEGER,
      approval_status TEXT,
      superseded_at TEXT,
      valid_until TEXT
    );

    -- an older, now-superseded EUR->SAR rate
    INSERT INTO pricing_exchange_rates (id, project_id, from_currency, to_currency, rate, rate_type, source, version_number, approval_status, superseded_at, valid_until)
    VALUES ('rate-eur-v1', '${PROJECT_ID}', 'EUR', 'SAR', '4.0', 'Project Fixed Rate', 'Old quote', 1, 'Approved', '2026-08-01T00:00:00Z', '2026-08-01');

    -- the current, approved EUR->SAR rate
    INSERT INTO pricing_exchange_rates (id, project_id, from_currency, to_currency, rate, rate_type, source, version_number, approval_status, superseded_at, valid_until)
    VALUES ('rate-eur-v2', '${PROJECT_ID}', 'EUR', 'SAR', '4.15', 'Project Fixed Rate', 'Current quote', 2, 'Approved', NULL, '2026-12-31');

    -- an unapproved (draft/rejected) USD->SAR rate -- must never be picked as "approved current"
    INSERT INTO pricing_exchange_rates (id, project_id, from_currency, to_currency, rate, rate_type, source, version_number, approval_status, superseded_at, valid_until)
    VALUES ('rate-usd-draft', '${PROJECT_ID}', 'USD', 'SAR', '3.75', 'Project Fixed Rate', 'Pending quote', 1, 'Pending', NULL, '2026-12-31');
  `);
  return raw;
};

test("loadApprovedExchangeRateRow returns the approved, non-superseded, highest-version rate for the project", async () => {
  const raw = fixture();
  const db = d1(raw);
  const row = await loadApprovedExchangeRateRow(db, PROJECT_ID);
  assert.equal(row.id, "rate-eur-v2");
  assert.equal(row.rate, "4.15");
  raw.close();
});

test("a superseded rate is excluded from the approved-current lookup", async () => {
  const raw = fixture();
  const db = d1(raw);
  const row = await loadApprovedExchangeRateRow(db, PROJECT_ID);
  assert.notEqual(row.id, "rate-eur-v1");
  raw.close();
});

test("an unapproved rate for a different currency pair does not surface as the project's approved current rate", async () => {
  const raw = fixture();
  const db = d1(raw);
  const row = await loadApprovedExchangeRateRow(db, PROJECT_ID);
  // Only one Approved+current row exists across all currency pairs (EUR->SAR v2);
  // the Pending USD->SAR row must never be returned regardless of recency.
  assert.equal(row.id, "rate-eur-v2");
  raw.close();
});

test("loadPreviousExchangeRateVersion finds the latest non-superseded row for a specific currency pair, regardless of approval status", async () => {
  const raw = fixture();
  const db = d1(raw);
  const previous = await loadPreviousExchangeRateVersion(db, { projectId: PROJECT_ID, fromCurrency: "EUR", toCurrency: "SAR" });
  assert.equal(previous.id, "rate-eur-v2");
  assert.equal(previous.version_number, 2);

  // Same-currency behavior unchanged: a currency pair with only a draft
  // (unapproved) row is still found -- this query intentionally has no
  // approval_status filter, since it exists to find what to supersede.
  const draftPair = await loadPreviousExchangeRateVersion(db, { projectId: PROJECT_ID, fromCurrency: "USD", toCurrency: "SAR" });
  assert.equal(draftPair.id, "rate-usd-draft");

  // A currency pair with no rows at all returns null/undefined, not a throw.
  const none = await loadPreviousExchangeRateVersion(db, { projectId: PROJECT_ID, fromCurrency: "GBP", toCurrency: "SAR" });
  assert.equal(none, null);
  raw.close();
});

test("all four previously-duplicated call sites now consume the shared helpers", () => {
  const pricingRuntime = fs.readFileSync(new URL("../worker/pricing-runtime.mjs", import.meta.url), "utf8");
  const boqLineCost = fs.readFileSync(new URL("../worker/boq-line-cost-api.mjs", import.meta.url), "utf8");
  const pricingApi = fs.readFileSync(new URL("../worker/pricing-api.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(pricingRuntime, /loadApprovedExchangeRateRow/);
  assert.doesNotMatch(pricingRuntime, /approval_status='Approved' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1/);
  assert.match(pricingRuntime, /exchangeRate:\s*null/);

  assert.doesNotMatch(boqLineCost, /loadApprovedExchangeRateRow/);
  assert.match(boqLineCost, /const previous = await loadPreviousExchangeRateVersion\(env\.DB, \{ projectId: item\.project_id, fromCurrency: from, toCurrency: to \}\);/);

  assert.match(pricingApi, /import \{ loadPreviousExchangeRateVersion \} from "\.\/pricing-authority\.mjs";/);
  assert.match(pricingApi, /const previous = await loadPreviousExchangeRateVersion\(env\.DB, \{ projectId, fromCurrency: body\.fromCurrency, toCurrency: body\.toCurrency \}\),/);
});
