// Commercial supersession fail-closed repair.
//
// Proven fail-open this suite closes:
//   worker/supplier-price-intake-api.mjs supersedes an older document version's
//   price rows with `UPDATE price_records SET validity_state='Superseded',
//   downstream_use='Discovery Only'` and deliberately does NOT touch
//   approval_status. Before the repair, such a row (approval_status still
//   'Approved', validity_state 'Superseded', valid_until NULL) evaluated to
//   "No Validity Provided" and was then ADMITTED by the governed
//   VALID_UNTIL_SUPERSEDED policy -- a reachable fail-open through an existing
//   governed route.
//
// Also repaired: a price record could outlive a SUPERSEDED governed price-source
//   version, because no pricing read joined price_source_versions at all.
//
// All proof is in-memory SQLite + pure domain. ZERO live project writes.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  calculatePricingLine,
  isCommercialRecordSuperseded,
  priceValidity,
  RELAXABLE_VALIDITY_STATES,
  selectPriceSources,
  STRICT_VALIDITY_STATES,
  TERMINAL_VALIDITY_STATES,
  temporalValidityStates,
} from "../app/domain/pricing-engine.mjs";
import { isSourceVersionSuperseded, loadSupersededPriceSourceIds } from "../worker/commercial-supersession.mjs";

const AT = "2026-09-30T00:00:00.000Z";
const APPROVED_COSTING = { approvalStatus: "Approved", downstreamUse: "Costing" };

const src = (o = {}) => ({
  id: "s1", productId: "p1", projectId: "pr1", amount: 100, currency: "SAR",
  priceType: "Manufacturer List Price", validUntil: "2099-01-01", ...APPROVED_COSTING, ...o,
});
const rank = (s, relaxed = false) =>
  selectPriceSources({ sources: [s], projectId: "pr1", productId: "p1", quantity: 1, region: "SA", at: AT, allowExpiredOrMissingValidity: relaxed })[0];

const line = (over = {}) => ({
  projectId: "pr1", productId: "p1", candidateId: "c1", selectedPriceSourceId: "s1",
  manufacturer: "Honeywell", quantity: 1, unit: "EA", projectCurrency: "SAR", calculatedAt: AT,
  technicalApproval: { status: "Approved", candidateId: "c1" },
  safetyDecision: { priceEligibility: "Eligible for Price Approval" },
  discounts: [], costComponents: [], sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
  customerDiscount: { percentage: 0 }, vatRule: { rate: 0 }, precision: 2, ...over,
});

// ===========================================================================
// 1-4  Field semantics
// ===========================================================================
test("1. normal current price behaviour is unchanged", () => {
  assert.equal(priceValidity(src({ status: "Current Approved" }), AT), "Valid");
  assert.equal(rank(src({ status: "Current Approved" })).eligible, true);
  assert.equal(calculatePricingLine(line({ priceSources: [src({ status: "Current Approved" })] })).status, "Draft Price");
});

test("2. approval_status='Superseded' remains blocked (independent gate, unchanged)", () => {
  const s = src({ approvalStatus: "Superseded", downstreamUse: "Discovery Only", status: "Superseded" });
  assert.equal(rank(s).eligible, false);
  assert.equal(rank(s, true).eligible, false, "relaxation cannot revive it");
  assert.equal(isCommercialRecordSuperseded({ approvalStatus: "Superseded" }), false, "approval is a separate gate, not this resolver's signal");
});

test("3. superseded_at signal remains honoured (forward-compatible; column absent in production price_records)", () => {
  const s = src({ status: "Current Approved", supersededAt: "2026-01-01T00:00:00Z" });
  assert.equal(isCommercialRecordSuperseded(s), true);
  assert.equal(priceValidity(s, AT), "Superseded");
  assert.equal(rank(s).eligible, false);
  assert.equal(rank(s, true).eligible, false);
});

test("4. validity_state='Superseded' is AUTHORITY: the proven fail-open is closed", () => {
  // Exactly the supplier-price-intake shape: approval untouched, only
  // validity_state superseded, and valid_until absent.
  const s = src({ status: "Superseded", validUntil: null });
  assert.equal(isCommercialRecordSuperseded(s), true);
  assert.equal(priceValidity(s, AT), "Superseded", "decided BEFORE any date reasoning");
  assert.equal(rank(s).eligible, false, "strict");
  assert.equal(rank(s, true).eligible, false, "and NOT revived by VALID_UNTIL_SUPERSEDED");

  const priced = calculatePricingLine(line({ priceSources: [s], allowExpiredOrMissingValidity: true }));
  assert.equal(priced.status, "Pricing Blocked");
  assert.ok(priced.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
  assert.equal(priced.selectedSource, undefined);
});

// ===========================================================================
// 5  Conflicting governed signals fail closed
// ===========================================================================
test("5. contradictory governed supersession signals all fail closed", () => {
  const cases = [
    ["Approved + validity_state Superseded", src({ status: "Superseded", validUntil: null })],
    ["Superseded validity + future expiry", src({ status: "Superseded", validUntil: "2099-01-01" })],
    ["Superseded + superseded_at together", src({ status: "Superseded", supersededAt: "2026-01-01", validUntil: null })],
    ["Rejected + Superseded", src({ status: "Rejected", validUntil: null })],
  ];
  for (const [label, s] of cases) {
    assert.equal(rank(s).eligible, false, `strict must block: ${label}`);
    assert.equal(rank(s, true).eligible, false, `relaxed must block: ${label}`);
  }
});

test("5b. REJECTED and SUPERSEDED stay DISTINCT states (history not rewritten)", () => {
  assert.equal(priceValidity({ status: "Rejected", validUntil: null }, AT), "Rejected");
  assert.equal(priceValidity({ status: "Superseded", validUntil: null }, AT), "Superseded");
  assert.notEqual(priceValidity({ status: "Rejected" }, AT), priceValidity({ status: "Superseded" }, AT));
});

// ===========================================================================
// 6  Source-version supersession
// ===========================================================================
test("6. a superseded governed price-source version cannot supply Costing price", () => {
  const s = src({ status: "Current Approved", sourceVersionSuperseded: true });
  assert.equal(isCommercialRecordSuperseded(s), true);
  assert.equal(rank(s).eligible, false);
  assert.equal(rank(s, true).eligible, false);
});

test("6b. a source with NO version rows is NOT treated as superseded (measured: 26 of 27 sources)", () => {
  const s = src({ status: "Current Approved" });
  assert.equal(isCommercialRecordSuperseded(s), false);
  assert.equal(rank(s).eligible, true);
  assert.equal(rank(src({ status: "Current Approved", sourceVersionSuperseded: false })).eligible, true);
});

test("6c. the loader marks a source superseded only when ALL its versions are", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE price_source_versions (id TEXT PRIMARY KEY, source_id TEXT, superseded_at TEXT);
            CREATE TABLE price_records (id TEXT PRIMARY KEY, source_id TEXT);
            INSERT INTO price_records VALUES ('r1','s-with'),('r2','s-none'),('r3','s-mixed');
            INSERT INTO price_source_versions VALUES ('v1','s-with','2026-01-01');
            INSERT INTO price_source_versions VALUES ('v2','s-mixed','2026-01-01'),('v3','s-mixed',NULL);`);
  const rows = Object.fromEntries(raw.prepare("SELECT * FROM price_records").all().map((r) => [r.id, r]));
  const DB = { prepare: (sql) => ({ all: async () => ({ results: raw.prepare(sql).all() }) }) };
  const set = await loadSupersededPriceSourceIds(DB);
  assert.equal(isSourceVersionSuperseded(rows.r1, set), true, "all versions superseded => superseded");
  assert.equal(isSourceVersionSuperseded(rows.r2, set), false, "no version rows => NOT superseded");
  assert.equal(isSourceVersionSuperseded(rows.r3, set), false, "one current version remains => NOT superseded");
  raw.close();
});

test("6d. a database with no governed version rows degrades safely, it does not fail the pricing read", async () => {
  const DB = { prepare: () => ({ all: async () => { throw new Error("no such table: price_source_versions"); } }) };
  const set = await loadSupersededPriceSourceIds(DB);
  assert.equal(set.size, 0);
  assert.equal(isSourceVersionSuperseded({ source_id: "anything" }, set), false);
});

// ===========================================================================
// 7-8  VALID_UNTIL_SUPERSEDED cannot revive; still works for current evidence
// ===========================================================================
test("7. VALID_UNTIL_SUPERSEDED cannot revive superseded evidence", () => {
  for (const over of [
    { status: "Superseded", validUntil: null },
    { status: "Superseded", validUntil: "2099-01-01" },
    { status: "Superseded", validUntil: null, supersededAt: "2026-01-01" },
    { status: "Superseded", validUntil: null, sourceVersionSuperseded: true },
  ]) {
    assert.ok(!temporalValidityStates(true).includes(priceValidity(src(over), AT)), `must stay terminal: ${JSON.stringify(over)}`);
  }
});

test("8. missing validity + current evidence remains eligible under governed policy", () => {
  const s = src({ status: "Current Approved", validUntil: null });
  assert.equal(priceValidity(s, AT), "No Validity Provided");
  assert.equal(rank(s, true).eligible, true);
  assert.equal(calculatePricingLine(line({ priceSources: [s], allowExpiredOrMissingValidity: true })).status, "Draft Price");
});

// ===========================================================================
// 9-14  Every other gate still blocks
// ===========================================================================
test("9. explicit expired remains blocked under the policy", () => {
  const s = src({ status: "Current Approved", validUntil: "2020-01-01" });
  assert.equal(priceValidity(s, AT), "Expired");
  assert.equal(rank(s, true).eligible, false);
});

test("10. malformed dates remain blocked under the policy", () => {
  for (const over of [{ validUntil: "garbage" }, { effectiveFrom: "garbage", validUntil: null }]) {
    const s = src({ status: "Current Approved", ...over });
    assert.equal(priceValidity(s, AT), "Unparseable", JSON.stringify(over));
    assert.equal(rank(s, true).eligible, false, JSON.stringify(over));
  }
});

test("11. future-effective remains blocked under the policy", () => {
  const s = src({ status: "Current Approved", validUntil: "2099-01-01", effectiveFrom: "2099-06-01" });
  assert.equal(priceValidity(s, AT), "Future");
  assert.equal(rank(s, true).eligible, false);
});

test("12. Rejected remains blocked under the policy", () => {
  const s = src({ status: "Rejected", validUntil: null });
  assert.equal(priceValidity(s, AT), "Rejected");
  assert.equal(rank(s, true).eligible, false);
});

test("13. Discovery Only remains blocked under the policy", () => {
  assert.equal(rank(src({ status: "Current Approved", downstreamUse: "Discovery Only", validUntil: null }), true).eligible, false);
});

test("14. Needs Review remains blocked under the policy", () => {
  assert.equal(rank(src({ status: "Current Approved", approvalStatus: "Needs Review", validUntil: null }), true).eligible, false);
});

test("14b. terminal states can never enter the eligible sets (guards future edits)", () => {
  for (const state of TERMINAL_VALIDITY_STATES) {
    assert.ok(!STRICT_VALIDITY_STATES.includes(state), `${state} must not be strict-eligible`);
    assert.ok(!RELAXABLE_VALIDITY_STATES.includes(state), `${state} must not be relaxable`);
  }
  assert.deepEqual(RELAXABLE_VALIDITY_STATES, ["No Validity Provided"], "policy semantics unchanged: missing validity only");
});

// ===========================================================================
// 15  No request-controlled override reintroduced
// ===========================================================================
test("15. no request-controlled override can admit superseded evidence", () => {
  const s = src({ status: "Superseded", validUntil: null });
  for (const flag of [true, false, undefined, 1, "true"]) {
    const priced = calculatePricingLine(line({ priceSources: [s], allowExpiredOrMissingValidity: flag }));
    assert.equal(priced.status, "Pricing Blocked", `flag=${String(flag)} must not revive`);
  }
});

// ===========================================================================
// 16  IFP-2100HV read-only regression (values mirrored, never written)
// ===========================================================================
test("16. IFP-2100HV current values are untouched by this repair", () => {
  // Exact live shape: Needs Review / Discovery Only / valid_until NULL /
  // validity_state 'Historical — Validity End Missing' / effective_from
  // '1st March 2023'. Mirrored as a fixture; production data is NOT modified.
  const ifp = {
    id: "price_6980c523", productId: "product_ec9dcbb1", projectId: "pr1", amount: 6787,
    currency: "USD", priceType: "Manufacturer List Price", unit: "EA",
    approvalStatus: "Needs Review", downstreamUse: "Discovery Only",
    effectiveFrom: "1st March 2023", validUntil: null,
    status: "Historical — Validity End Missing",
  };
  assert.equal(isCommercialRecordSuperseded(ifp), false, "must NOT be superseded");
  assert.equal(priceValidity(ifp, AT), "No Validity Provided");
  // Still blocked for its own real reasons -- never Approved/Costing by this slice.
  const ranked = selectPriceSources({
    sources: [ifp], projectId: "pr1", productId: "product_ec9dcbb1", quantity: 1, region: "SA",
    at: AT, allowExpiredOrMissingValidity: true,
  })[0];
  assert.equal(ranked.eligible, false, "Needs Review + Discovery Only still block");
  assert.equal(priceValidity(ifp, AT), "No Validity Provided", "not expired");
  assert.notEqual(priceValidity(ifp, AT), "Superseded");
  assert.notEqual(priceValidity(ifp, AT), "Expired");
  assert.equal(ifp.approvalStatus, "Needs Review", "unchanged");
  assert.equal(ifp.downstreamUse, "Discovery Only", "unchanged");
  assert.equal(ifp.validUntil, null, "unchanged");
});