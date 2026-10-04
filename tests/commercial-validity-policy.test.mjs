// Governed VALID_UNTIL_SUPERSEDED commercial validity policy (R5).
//
// Contract proven here:
//   * The relaxation is DERIVED from a current governed commercial_conditions
//     policy scoped to the price's own source version -- never from a missing
//     date, a brand, a file name or a hard-coded supplier special case.
//   * No governed policy => strict default (undated/expired still blocked).
//   * The policy is NEVER borrowed from another price source version.
//   * A superseded / non-approved / not-current-internal-reference source
//     version lends no authority.
//   * Temporal validity ONLY: approval, downstream_use, rejection, future
//     effective dates and supersession gates are untouched.
//   * No valid_until is ever fabricated or persisted.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { createRequire } from "node:module";
import {
  COMMERCIAL_DATE_FORMAT,
  MISSING_DATE,
  normalizeCommercialDate,
  UNPARSEABLE_DATE,
  VALID_DATE,
} from "../app/domain/commercial-date.mjs";
import {
  priceValidity,
  RELAXABLE_VALIDITY_STATES,
} from "../app/domain/pricing-engine.mjs";
import { resolvePriceValidityPolicy, allowsExpiredOrMissingValidity } from "../worker/commercial-validity-policy.mjs";
import { loadPricingInput } from "../worker/pricing-runtime.mjs";

const require = createRequire(import.meta.url);

const PROJECT_ID = "project-validity-policy";
const SOURCE_ID = "source-own";
const OTHER_SOURCE_ID = "source-other";
const OWN_VERSION = "psv-own";
const OTHER_VERSION = "psv-other";

const scenario = { id: "sc", version_number: 1, project_currency: "SAR", settings: "{}" };
const body = {
  selectedPriceSourceId: "price-1",
  discounts: [],
  costComponents: [],
  sellingRule: { method: "Markup", rate: 25, minimumMargin: 10 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 15 },
};

const fixture = ({
  validUntil = null,
  effectiveFrom = null,
  approvalStatus = "Approved",
  downstreamUse = "Costing",
  // source-version governance
  ownApproval = "Approved",
  ownDownstreamUse = "Costing",
  ownReliability = "Current Internal Reference",
  ownSupersededAt = null,
  // policy conditions to insert: [{sourceVersionId, policy, reviewStatus}]
  conditions = [],
} = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT, archived_at TEXT);
    CREATE TABLE project_members (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
    CREATE TABLE pricing_scenarios (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL, project_currency TEXT NOT NULL, settings TEXT NOT NULL, deleted_at TEXT, superseded_at TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, scope_type TEXT, scope_id TEXT, supersession_type TEXT, effective_from TEXT, effective_to TEXT, created_by TEXT, created_at TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT NOT NULL, project_id TEXT NOT NULL, source_document_id TEXT, row_type TEXT, review_status TEXT, approved_for_downstream INTEGER, numeric_quantity REAL, normalized_unit TEXT, updated_at TEXT);
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, boq_item_id TEXT NOT NULL, requirement_profile_version_id TEXT, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT NOT NULL, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT NOT NULL, product_id TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, requested_product_id TEXT NOT NULL, manufacturer_id TEXT NOT NULL, part_number TEXT, lifecycle_status TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT NOT NULL, approval_type TEXT NOT NULL, status TEXT NOT NULL, decided_at TEXT);
    CREATE TABLE price_records (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, supplier_id TEXT, project_id TEXT, amount_minor INTEGER, currency TEXT, price_type TEXT, approval_status TEXT, downstream_use TEXT, effective_from TEXT, valid_until TEXT, minimum_quantity REAL, source_id TEXT, source_location TEXT, terms TEXT, reviewed_at TEXT, created_at TEXT, status TEXT, superseded_at TEXT);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE pricing_exchange_rates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_currency TEXT, to_currency TEXT, rate TEXT, source TEXT, version_number INTEGER, approval_status TEXT, valid_until TEXT, superseded_at TEXT);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, source TEXT, selected_quantity REAL, boq_quantity REAL, drawing_quantity REAL, recognition_version_id TEXT, definition_key TEXT, reason TEXT, decided_by TEXT, created_at TEXT);
    CREATE TABLE price_source_versions (id TEXT PRIMARY KEY, source_id TEXT, version_number INTEGER, approval_state TEXT, downstream_use TEXT, reliability TEXT, superseded_at TEXT);
    CREATE TABLE commercial_conditions (id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL, condition_type TEXT NOT NULL, value_json TEXT NOT NULL, scope_json TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review', created_by TEXT, created_at TEXT);

    INSERT INTO projects VALUES ('${PROJECT_ID}', 'local-development-user', 'org', NULL);
    INSERT INTO documents VALUES ('doc-current','${PROJECT_ID}','doc-version-current',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('doc-version-current','doc-current');
    INSERT INTO pricing_scenarios VALUES ('sc', '${PROJECT_ID}', 1, 'SAR', '{}', NULL, NULL);
    INSERT INTO boq_extraction_versions VALUES ('boq-version-current','doc-current','doc-version-current',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('boq-current','boq-version-current','${PROJECT_ID}','doc-current','BOQ Item','Approved',1,10,'EA','2026-08-10T12:00:00Z');
    INSERT INTO product_manufacturers VALUES ('manufacturer-1','Honeywell');
    INSERT INTO canonical_library_products VALUES ('product-1','product-1','manufacturer-1','IFP-2100HV','Active');
    INSERT INTO requirement_profile_versions VALUES ('profile-current','boq-current',1,NULL);
    INSERT INTO product_match_runs VALUES ('match-current','${PROJECT_ID}','boq-current','profile-current',1,NULL);
    INSERT INTO product_match_candidates (id, match_run_id, product_id) VALUES ('candidate-current','match-current','product-1');
    INSERT INTO safety_decisions VALUES ('safety-current','candidate-current',1,NULL);
    INSERT INTO safety_approval_requests VALUES ('approval-current','safety-current','Technical','Approved','2026-08-10T12:10:00Z');
    INSERT INTO price_source_versions VALUES ('${OWN_VERSION}','${SOURCE_ID}',1,'${ownApproval}','${ownDownstreamUse}','${ownReliability}',${ownSupersededAt ? `'${ownSupersededAt}'` : "NULL"});
    INSERT INTO price_source_versions VALUES ('${OTHER_VERSION}','${OTHER_SOURCE_ID}',1,'Approved','Costing','Current Internal Reference',NULL);
    INSERT INTO price_records (id, product_id, supplier_id, project_id, amount_minor, currency, price_type, approval_status, downstream_use, effective_from, valid_until, minimum_quantity, source_id, source_location, terms, reviewed_at, created_at, status, superseded_at)
      VALUES ('price-1','product-1',NULL,NULL,678700,'USD','Manufacturer List Price','${approvalStatus}','${downstreamUse}',${effectiveFrom ? `'${effectiveFrom}'` : "NULL"},${validUntil ? `'${validUntil}'` : "NULL"},NULL,'${SOURCE_ID}','{}','{}',NULL,'2026-08-10T12:00:00Z',NULL,NULL);
  `);
  conditions.forEach((c, i) => {
    raw.prepare(
      "INSERT INTO commercial_conditions VALUES (?,?,?,?,?,?,?,?)",
    ).run(`cond-${i}`, c.sourceVersionId, c.conditionType ?? "PRICE_VALIDITY_POLICY", JSON.stringify(c.policy ? { policy: c.policy } : {}), "{}", c.reviewStatus ?? "Approved", "policy-owner", c.createdAt ?? `2026-08-1${i}T00:00:00Z`);
  });
  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
  });
  const DB = { prepare(sql) { return { ...operation(sql), bind: (...args) => operation(sql, args) }; }, async batch() { return []; } };
  return { raw, DB };
};

const load = (DB) =>
  loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body });

const GOVERNED = [{ sourceVersionId: OWN_VERSION, policy: "VALID_UNTIL_SUPERSEDED" }];

// --------------------------------------------------------------------------
// A. Governed policy unlocks an undated price; nothing else does.
// --------------------------------------------------------------------------

test("A1 undated + Approved + Costing + governed policy => temporally eligible", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED });
  const input = await load(DB);
  assert.equal(input.validityPolicy.policy, "VALID_UNTIL_SUPERSEDED");
  assert.equal(input.allowExpiredOrMissingValidity, true);
  assert.equal(input.safetyDecision.priceEligibility, "Eligible for Price Approval");
  raw.close();
});

test("A2 undated WITHOUT a governed policy => strict default preserved", async () => {
  const { raw, DB } = fixture({ conditions: [] });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, false);
  assert.equal(input.validityPolicy.policy, "FIXED_EXPIRY");
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

test("A3 the policy is not honoured when the condition itself is not Approved", async () => {
  const { raw, DB } = fixture({ conditions: [{ sourceVersionId: OWN_VERSION, policy: "VALID_UNTIL_SUPERSEDED", reviewStatus: "Needs Review" }] });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, false);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

test("A4 a later Superseded condition withdraws an earlier Approved one", async () => {
  const { raw, DB } = fixture({
    conditions: [
      { sourceVersionId: OWN_VERSION, policy: "VALID_UNTIL_SUPERSEDED", createdAt: "2026-08-10T00:00:00Z" },
      { sourceVersionId: OWN_VERSION, policy: "VALID_UNTIL_SUPERSEDED", reviewStatus: "Superseded", createdAt: "2026-08-11T00:00:00Z" },
    ],
  });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, false, "latest condition speaks; a superseding one withdraws the policy");
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

// --------------------------------------------------------------------------
// B. Never borrowed across source versions.
// --------------------------------------------------------------------------

test("B1 a policy on ANOTHER source version is never borrowed", async () => {
  const { raw, DB } = fixture({ conditions: [{ sourceVersionId: OTHER_VERSION, policy: "VALID_UNTIL_SUPERSEDED" }] });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, false);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

test("B2 a superseded source version lends no authority", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, ownSupersededAt: "2026-09-01T00:00:00Z" });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, false);
  raw.close();
});

test("B3 a source version that is not Approved / Costing / Current Internal Reference lends no authority", async () => {
  for (const variant of [
    { ownApproval: "Needs Review" },
    { ownDownstreamUse: "Discovery Only" },
    { ownReliability: "Unverified" },
  ]) {
    const { raw, DB } = fixture({ conditions: GOVERNED, ...variant });
    const policy = await resolvePriceValidityPolicy(DB, [SOURCE_ID]);
    assert.equal(policy.allows, false, `must not lend authority: ${JSON.stringify(variant)}`);
    raw.close();
  }
});

test("B4 a different condition_type is not treated as the validity policy", async () => {
  const { raw, DB } = fixture({ conditions: [{ sourceVersionId: OWN_VERSION, policy: "VALID_UNTIL_SUPERSEDED", conditionType: "SOMETHING_ELSE" }] });
  assert.equal(await allowsExpiredOrMissingValidity(DB, [SOURCE_ID]), false);
  raw.close();
});

test("B5 an unknown policy value is not treated as VALID_UNTIL_SUPERSEDED", async () => {
  const { raw, DB } = fixture({ conditions: [{ sourceVersionId: OWN_VERSION, policy: "SOMETHING_ELSE" }] });
  assert.equal(await allowsExpiredOrMissingValidity(DB, [SOURCE_ID]), false);
  raw.close();
});

// --------------------------------------------------------------------------
// C. Temporal only -- every other gate survives the policy.
// --------------------------------------------------------------------------

test("C1 Needs Review price stays blocked under the governed policy", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, approvalStatus: "Needs Review" });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, true, "policy is in force");
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled", "approval gate untouched");
  raw.close();
});

test("C2 Discovery Only price stays blocked under the governed policy", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, downstreamUse: "Discovery Only" });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, true);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled", "downstream-scope gate untouched");
  raw.close();
});

test("C3 future-effective price stays blocked under the governed policy", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, validUntil: "2099-01-01", effectiveFrom: "2099-06-01" });
  const input = await load(DB);
  assert.equal(input.allowExpiredOrMissingValidity, true);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled", "future gate untouched");
  raw.close();
});

test("C4 SUPERSEDED (was: expired is admitted) -- an explicit expiry is still truthfully reported Expired and stays blocked", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, validUntil: "2020-01-01" });
  const input = await load(DB);
  assert.equal(input.priceSources[0].validUntil, "2020-01-01", "the real date is preserved, not rewritten");
  assert.equal(
    priceValidity({ status: "Current Approved", supersededAt: null, effectiveFrom: null, validUntil: "2020-01-01" }),
    "Expired",
    "truthfully Expired, never relabelled",
  );
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

// --------------------------------------------------------------------------
// D. Nothing is invented or persisted.
// --------------------------------------------------------------------------

test("D1 resolving the policy never writes, and never fabricates a valid_until", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED });
  const before = raw.prepare("SELECT valid_until, approval_status, downstream_use FROM price_records WHERE id='price-1'").get();
  await resolvePriceValidityPolicy(DB, [SOURCE_ID]);
  await load(DB);
  const after = raw.prepare("SELECT valid_until, approval_status, downstream_use FROM price_records WHERE id='price-1'").get();
  assert.deepEqual(after, before);
  assert.equal(after.valid_until, null, "still NULL -- the policy invents nothing");
  assert.equal(after.approval_status, "Approved");
  assert.equal(after.downstream_use, "Costing");
  raw.close();
});

test("D2 an undated price remains unapproved until a human approves it", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, approvalStatus: "Needs Review", downstreamUse: "Discovery Only" });
  await load(DB);
  const row = raw.prepare("SELECT approval_status, downstream_use, valid_until FROM price_records WHERE id='price-1'").get();
  assert.equal(row.approval_status, "Needs Review", "policy never approves a price record");
  assert.equal(row.downstream_use, "Discovery Only", "policy never grants Costing");
  assert.equal(row.valid_until, null);
  raw.close();
});

// --------------------------------------------------------------------------
// E. EXPLICIT EXPIRY IS AUTHORITATIVE -- never relaxed (approved policy scope)
// --------------------------------------------------------------------------

test("E1 explicit past valid_until + governed policy => BLOCKED (an explicit expiry is authoritative evidence)", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, validUntil: "2020-01-01" });
  const input = await load(DB);
  assert.equal(input.validityPolicy.policy, "VALID_UNTIL_SUPERSEDED", "policy is in force");
  assert.equal(input.allowExpiredOrMissingValidity, true);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled", "explicit expiry still blocks");
  raw.close();
});

test("E2 explicit current valid_until + governed policy => eligible on temporal grounds", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, validUntil: "2099-01-01" });
  const input = await load(DB);
  assert.equal(input.safetyDecision.priceEligibility, "Eligible for Price Approval");
  raw.close();
});

// --------------------------------------------------------------------------
// F. MALFORMED DATES FAIL CLOSED -- absence is not defect
// --------------------------------------------------------------------------

test("F1 malformed effective_from => BLOCKED even under the governed policy (never read as 'not future')", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, effectiveFrom: "not a real date" });
  const input = await load(DB);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  assert.equal(
    priceValidity({ status: "Current Approved", supersededAt: null, effectiveFrom: "not a real date", validUntil: null }),
    "Unparseable",
    "defective evidence must fail closed, never fall through to 'in force'",
  );
  raw.close();
});

test("F2 malformed valid_until => BLOCKED, and is NOT conflated with a missing date", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, validUntil: "31st February 2023" });
  const input = await load(DB);
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  assert.equal(
    priceValidity({ status: "Current Approved", supersededAt: null, effectiveFrom: null, validUntil: "31st February 2023" }),
    "Unparseable",
    "defective evidence, not 'No Validity Provided'",
  );
  raw.close();
});

test("F3 a calendar-impossible date is unparseable, not coerced", () => {
  assert.equal(normalizeCommercialDate("31st February 2023").status, UNPARSEABLE_DATE);
  assert.equal(normalizeCommercialDate("2023-02-30").status, UNPARSEABLE_DATE);
  assert.equal(normalizeCommercialDate("1st March 2023").iso, "2023-03-01");
});

test("F4 the real Farenhyt value '1st March 2023' normalizes deterministically (was Invalid Date via native parsing)", () => {
  const parsed = normalizeCommercialDate("1st March 2023");
  assert.equal(parsed.status, VALID_DATE);
  assert.equal(parsed.iso, "2023-03-01");
  assert.equal(parsed.format, COMMERCIAL_DATE_FORMAT.DAY_FIRST_ORDINAL);
  assert.equal(parsed.raw, "1st March 2023", "original provenance preserved");
  // the defect this closes
  assert.ok(Number.isNaN(new Date("1st March 2023").getTime()), "native parsing really is Invalid Date");
  // and it is not future, so it does not fabricate a Future block either
  assert.equal(priceValidity({ status: "Current Approved", supersededAt: null, effectiveFrom: "1st March 2023", validUntil: null }, "2026-09-30T00:00:00.000Z"), "No Validity Provided");
});

test("F5 absent vs malformed are different states", () => {
  assert.equal(normalizeCommercialDate(null).status, MISSING_DATE);
  assert.equal(normalizeCommercialDate("").status, MISSING_DATE);
  assert.equal(normalizeCommercialDate(undefined).status, MISSING_DATE);
  assert.equal(normalizeCommercialDate("garbage").status, UNPARSEABLE_DATE);
  // only MISSING may ever be relaxed
  assert.deepEqual(RELAXABLE_VALIDITY_STATES, ["No Validity Provided"]);
  assert.ok(!RELAXABLE_VALIDITY_STATES.includes("Unparseable"));
  assert.ok(!RELAXABLE_VALIDITY_STATES.includes("Expired"));
});

test("F6 no stale value is invented or overwritten for a malformed date", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED, validUntil: "garbage" });
  const before = raw.prepare("SELECT valid_until FROM price_records WHERE id='price-1'").get();
  await load(DB);
  const after = raw.prepare("SELECT valid_until FROM price_records WHERE id='price-1'").get();
  assert.deepEqual(after, before);
  assert.equal(after.valid_until, "garbage", "the malformed source value is left exactly as recorded");
  raw.close();
});

// --------------------------------------------------------------------------
// G. PRODUCTION AUTHORITY BOUNDARY -- no arbitrary boolean
// --------------------------------------------------------------------------

test("G1 loadPricingInput accepts NO caller-supplied validity-relaxation option", async () => {
  const { raw, DB } = fixture({ conditions: [] });
  // Even if a future/production caller passes the old option name, it must be ignored.
  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body,
    allowExpiredOrMissingValidity: true,
  });
  assert.equal(input.allowExpiredOrMissingValidity, false, "a caller boolean is NOT commercial authority");
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

test("G2 the relaxation flag is derived from the governed policy alone", async () => {
  const { raw, DB } = fixture({ conditions: GOVERNED });
  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body,
    allowExpiredOrMissingValidity: false, // actively try to DENY it
  });
  assert.equal(input.allowExpiredOrMissingValidity, true, "governed policy still governs");
  assert.equal(input.validityPolicy.policy, "VALID_UNTIL_SUPERSEDED");
  raw.close();
});

test("G3 no production worker accepts the flag from a request body", () => {
  const fs = require("node:fs");
  for (const f of ["worker/pricing-runtime.mjs", "worker/scope-pricing-input.mjs"]) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    // strip // line comments so explanatory prose about the removed bypass is
    // not mistaken for live code
    const code = src.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
    assert.doesNotMatch(code, /allowExpiredOrMissingValidity\s*:\s*body\./, `${f} must not read the flag from a request body`);
    assert.doesNotMatch(code, /body\s*\.\s*allowExpiredOrMissingValidity/, `${f} must not read the flag from a request body`);
    assert.doesNotMatch(code, /\{\s*projectId,\s*boqItemId,\s*candidateId,\s*scenario,\s*body,\s*allowExpiredOrMissingValidity/, `${f} must not destructure the flag as a caller option`);
  }
});