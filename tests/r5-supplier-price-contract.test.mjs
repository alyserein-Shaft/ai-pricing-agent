import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { supplierPriceEligibility } from "../app/domain/supplier-price-intake.mjs";
import { selectPriceSources } from "../app/domain/pricing-engine.mjs";

// R5: one canonical costing downstream-use state: "Costing".
// Expiry is freshness evidence, not an independent approval/eligibility
// authority. Legacy "Costing Eligible" is pinned as non-canonical and
// fail-closed until an explicitly authorized data migration exists.

const line = (overrides = {}) => ({
  rowType: "SUPPLIER_LINE",
  productId: "product-1",
  mappingActorId: "mapper-1",
  mappingBasis: "EXACT_CANONICAL_MODEL",
  currency: "SAR",
  netUnitPrice: 10000,
  supplierId: "supplier-1",
  quotationReference: "Q-1",
  documentId: "document-1",
  documentVersionId: "version-1",
  issueDate: "2026-01-01",
  validUntil: "2099-01-01",
  reviewStatus: "Approved",
  downstreamUse: "Costing",
  ...overrides,
});

const at = new Date("2026-09-24T00:00:00Z");

test("R5 CASE A/B/G -- canonical Costing supplier evidence is costing-eligible, including expired validity", () => {
  const result = supplierPriceEligibility(line({ validUntil: "2020-01-01" }), { at });
  assert.equal(result.eligible, true, result.blockers.join(","));
  assert.deepEqual(result.blockers, []);
});

test("R5 CASE E -- missing validity is freshness metadata, not an independent costing blocker", () => {
  const result = supplierPriceEligibility(line({ validUntil: null }), { at });
  assert.equal(result.eligible, true, result.blockers.join(","));
  assert.deepEqual(result.blockers, []);
});

test("R5 CASE C/D/F -- Discovery Only, unapproved, rejected, and legacy Costing Eligible do not receive costing authority", () => {
  for (const overrides of [
    { downstreamUse: "Discovery Only" },
    { reviewStatus: "Needs Review" },
    { reviewStatus: "Rejected" },
    { downstreamUse: "Costing Eligible" },
  ]) {
    const result = supplierPriceEligibility(line(overrides), { at });
    assert.equal(result.eligible, false, JSON.stringify({ overrides, result }));
  }
});

test("R5 CASE I -- pricing selection accepts exact Costing but does not treat legacy Costing Eligible as eligible", () => {
  const base = {
    productId: "product-1", projectId: "project-1", amount: 100, currency: "SAR",
    priceType: "Supplier Quote", approvalStatus: "Approved", validUntil: "2099-01-01",
  };
  const canonical = selectPriceSources({
    sources: [{ ...base, id: "canonical", downstreamUse: "Costing" }],
    projectId: "project-1", productId: "product-1", quantity: 1, at,
  });
  const legacy = selectPriceSources({
    sources: [{ ...base, id: "legacy", downstreamUse: "Costing Eligible" }],
    projectId: "project-1", productId: "product-1", quantity: 1, at,
  });
  assert.equal(canonical[0].eligible, true);
  assert.equal(legacy[0].eligible, false);
});

test("R5 CASE B -- supplier approval writer uses the canonical Costing state", async () => {
  const source = await readFile(new URL("../worker/supplier-price-intake-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Costing Eligible/);
  assert.match(source, /'Current','Approved','Costing'/);
  assert.match(source, /downstreamUse:\s*"Costing"/);
});

test("R5 CASE F/H -- pricing selection remains fail-closed for superseded and missing currency while expiry is opt-in", () => {
  const source = {
    productId: "product-1", projectId: "project-1", amount: 100, currency: null,
    priceType: "Supplier Quote", approvalStatus: "Approved", downstreamUse: "Costing",
    validUntil: "2099-01-01", status: "Rejected",
  };
  const rejected = selectPriceSources({ sources: [source], projectId: "project-1", productId: "product-1", quantity: 1, at, allowExpiredOrMissingValidity: true });
  assert.equal(rejected[0].eligible, false);
  const missingCurrency = selectPriceSources({ sources: [{ ...source, status: null, currency: null }], projectId: "project-1", productId: "product-1", quantity: 1, at, allowExpiredOrMissingValidity: true });
  assert.equal(missingCurrency[0].eligible, true, "price governance authority is separate from FX conversion (R6)");
  assert.equal(missingCurrency[0].currency, null, "FX availability is intentionally not decided by this selector; conversion remains fail-closed in R6");
  // SUPERSEDED CONTRACT (was: expired is eligible once expiry is "opt-in").
  // Approved commercial policy: VALID_UNTIL_SUPERSEDED relaxes ONLY a MISSING
  // validity end date. An explicit valid_until is authoritative evidence, so a
  // past expiry stays an expiry and is never relaxed.
  const expired = selectPriceSources({ sources: [{ ...source, status: null, currency: "SAR", validUntil: "2020-01-01" }], projectId: "project-1", productId: "product-1", quantity: 1, at, allowExpiredOrMissingValidity: true });
  assert.equal(expired[0].eligible, false, "an explicit past expiry must never be relaxed");
  assert.equal(expired[0].validity, "Expired", "still truthfully reported Expired");
  assert.equal(expired[0].validityPolicy, "FIXED_EXPIRY");
  // and the missing-validity case the policy DOES cover remains admitted
  const missing = selectPriceSources({ sources: [{ ...source, status: null, currency: "SAR", validUntil: null }], projectId: "project-1", productId: "product-1", quantity: 1, at, allowExpiredOrMissingValidity: true });
  assert.equal(missing[0].eligible, true, "a MISSING validity date is what the policy covers");
  assert.equal(missing[0].validity, "No Validity Provided");
  assert.equal(missing[0].validityPolicy, "VALID_UNTIL_SUPERSEDED");
});
