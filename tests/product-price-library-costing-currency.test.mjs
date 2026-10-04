import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { handleProductPriceLibraryApi, queryLibraryProducts } from "../worker/product-price-library-api.mjs";

// Costing price-currency correction -- isolated handler/SQL proof (no D1
// writes to any real project, no live route invoked, :memory: only).
// User policy: missing or expired valid_until must not, by itself, block an
// otherwise-authorized Costing price. Covers exactly the required scope:
// expired and missing dates; unapproved and Discovery Only records; governed
// review without expiry; malformed supplied dates; agreement between
// eligibility and counts; preservation of dates/audit history.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
CREATE TABLE product_manufacturers(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE product_brands(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE product_families(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE library_products(id TEXT PRIMARY KEY, part_number TEXT, description TEXT, identity_status TEXT, superseded_by_product_id TEXT, review_status TEXT, approved_for_discovery INTEGER DEFAULT 0);
CREATE TABLE canonical_library_products(id TEXT PRIMARY KEY, requested_product_id TEXT, manufacturer_id TEXT, brand_id TEXT, family_id TEXT, part_number TEXT, description TEXT, attributes TEXT, standards TEXT, approved_for_discovery INTEGER DEFAULT 0);
CREATE TABLE product_sources(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, checksum TEXT, source_type TEXT, authority TEXT, scope_type TEXT, file_name TEXT, release_version TEXT, effective_from TEXT, valid_until TEXT, currency TEXT, validity_state TEXT, review_status TEXT, downstream_use TEXT, metadata TEXT, created_by TEXT, supplier_id TEXT);
CREATE TABLE price_records(id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, project_id TEXT, amount_minor INTEGER, currency TEXT, price_type TEXT, effective_from TEXT, valid_until TEXT, validity_state TEXT, approval_status TEXT, downstream_use TEXT, source_location TEXT, terms TEXT, reviewed_by TEXT, reviewed_at TEXT, supplier_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_library_decisions(id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT, entity_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, decided_by TEXT, decided_role TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_source_evidence(id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, created_at TEXT);
CREATE TABLE product_attributes(id TEXT PRIMARY KEY, product_id TEXT, deleted_at TEXT, created_at TEXT);
CREATE TABLE product_certifications(id TEXT PRIMARY KEY, product_id TEXT, deleted_at TEXT, created_at TEXT);
CREATE TABLE product_compatibility(id TEXT PRIMARY KEY, source_product_id TEXT, deleted_at TEXT, created_at TEXT);
CREATE TABLE product_accessories(id TEXT PRIMARY KEY, product_id TEXT, deleted_at TEXT, created_at TEXT);
CREATE TABLE product_documents(id TEXT PRIMARY KEY, product_id TEXT, deleted_at TEXT, created_at TEXT);
CREATE TABLE manufacturer_order_code_observations(canonical_product_id TEXT, original_order_code TEXT, original_product_id TEXT, source_id TEXT, source_row INTEGER, review_status TEXT, status TEXT);
CREATE TABLE product_lifecycle_events(id TEXT PRIMARY KEY, product_id TEXT, obsolete_part_number TEXT, lifecycle_status TEXT, replacement_candidates TEXT, source_location TEXT, created_at TEXT);
CREATE TABLE suppliers(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE product_aliases(id TEXT PRIMARY KEY, product_id TEXT, alias TEXT, deleted_at TEXT);
`;

const REQUEST = (path, { method = "GET", body } = {}) => new Request(`https://localhost${path}`, {
  method,
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

const buildDb = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO product_manufacturers VALUES ('mfr1','Acme');
    INSERT INTO product_families VALUES ('fam1','Heat Detector');
    INSERT INTO library_products VALUES ('requested1','ASD-100','Heat detector','Confirmed',NULL,'Reviewed',1);
    INSERT INTO canonical_library_products VALUES ('product1','requested1','mfr1',NULL,'fam1','ASD-100','Heat detector','[]','[]',1);
  `);
  return { raw, env: { DB: d1(raw) } };
};

const seedPriceRecord = (raw, overrides = {}) => {
  const row = {
    id: `price_${Math.random().toString(36).slice(2)}`, product_id: "product1", source_id: null, project_id: null,
    amount_minor: 10000, currency: "USD", price_type: "Manufacturer Price List", effective_from: null,
    valid_until: null, validity_state: "No Validity Provided", approval_status: "Needs Review", downstream_use: "Discovery Only",
    source_location: "{}", terms: "{}", reviewed_by: null, reviewed_at: null, supplier_id: null,
    ...overrides,
  };
  raw.prepare(`INSERT INTO price_records (id,product_id,source_id,project_id,amount_minor,currency,price_type,effective_from,valid_until,validity_state,approval_status,downstream_use,source_location,terms,reviewed_by,reviewed_at,supplier_id)
    VALUES (@id,@product_id,@source_id,@project_id,@amount_minor,@currency,@price_type,@effective_from,@valid_until,@validity_state,@approval_status,@downstream_use,@source_location,@terms,@reviewed_by,@reviewed_at,@supplier_id)`).run(row);
  return row;
};

// ---------------------------------------------------------------------------
// Expired and missing dates; unapproved and Discovery Only records
// ---------------------------------------------------------------------------

test("costing_eligible_price_count (SQL) counts approved+Costing records regardless of expired/missing valid_until, and still excludes unapproved / Discovery Only records", async () => {
  const { raw, env } = buildDb();
  seedPriceRecord(raw, { approval_status: "Approved", downstream_use: "Costing", valid_until: "2020-01-01" }); // expired
  seedPriceRecord(raw, { approval_status: "Approved", downstream_use: "Costing", valid_until: null }); // missing
  seedPriceRecord(raw, { approval_status: "Approved", downstream_use: "Costing", valid_until: "2099-01-01" }); // future-dated but still current
  seedPriceRecord(raw, { approval_status: "Needs Review", downstream_use: "Costing", valid_until: "2099-01-01" }); // unapproved -- must NOT count
  seedPriceRecord(raw, { approval_status: "Approved", downstream_use: "Discovery Only", valid_until: "2099-01-01" }); // Discovery Only -- must NOT count
  seedPriceRecord(raw, { approval_status: "Rejected", downstream_use: "Discovery Only", valid_until: null }); // rejected -- must NOT count

  const result = await queryLibraryProducts(env.DB, { query: "ASD-100" });
  const row = result.products.find((entry) => entry.canonicalProductId === "product1");
  assert.equal(row.costingEligiblePrices, 3, "exactly the 3 approved+Costing records count, regardless of expired/missing/future valid_until");
});

// ---------------------------------------------------------------------------
// Governed review without expiry (the actual HTTP handler)
// ---------------------------------------------------------------------------

test("POST /api/price-records/:id/review approves for Costing with no valid_until supplied and none already recorded -- succeeds, not blocked", async () => {
  const { raw, env } = buildDb();
  const record = seedPriceRecord(raw, { valid_until: null, validity_state: "No Validity Provided" });
  const response = await handleProductPriceLibraryApi(REQUEST(`/api/price-records/${record.id}/review`, { method: "POST", body: { decision: "Approve", downstreamUse: "Costing", reason: "Newly reviewed supplier quote, entered now per current pricing policy." } }), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.costingEligible, true, "Costing approval must succeed even with no validity date on record");
  const stored = raw.prepare("SELECT * FROM price_records WHERE id=?").get(record.id);
  assert.equal(stored.approval_status, "Approved");
  assert.equal(stored.downstream_use, "Costing");
  assert.equal(stored.valid_until, null, "the missing date is preserved as missing -- never fabricated or defaulted");
});

test("POST /api/price-records/:id/review approves for Costing with an already-expired valid_until on record -- succeeds, not blocked", async () => {
  const { raw, env } = buildDb();
  const record = seedPriceRecord(raw, { valid_until: "2020-01-01", validity_state: "Historical" });
  const response = await handleProductPriceLibraryApi(REQUEST(`/api/price-records/${record.id}/review`, { method: "POST", body: { decision: "Approve", downstreamUse: "Costing", reason: "Newly reviewed supplier quote, entered now per current pricing policy." } }), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.costingEligible, true, "Costing approval must succeed even with an expired validity date");
  const stored = raw.prepare("SELECT * FROM price_records WHERE id=?").get(record.id);
  assert.equal(stored.approval_status, "Approved");
  assert.equal(stored.valid_until, "2020-01-01", "the historical date is preserved exactly, never silently bumped to 'current'");
});

test("POST /api/price-sources/:id/review approves a source for Costing with no valid_until at all -- succeeds, not blocked", async () => {
  const { raw, env } = buildDb();
  raw.prepare(`INSERT INTO product_sources (id,project_id,document_id,document_version_id,checksum,source_type,authority,scope_type,file_name,release_version,effective_from,valid_until,currency,validity_state,review_status,downstream_use,metadata,created_by)
    VALUES ('source1',NULL,'doc1','dv1','sha1','Manufacturer Price List','Manufacturer','Global','list.xlsx','v1',NULL,NULL,'USD','No Validity Provided','Needs Review','Discovery Only','{}','owner1')`).run();
  raw.prepare("UPDATE price_records SET source_id='source1' WHERE product_id='product1'").run();
  seedPriceRecord(raw, { source_id: "source1" });
  const response = await handleProductPriceLibraryApi(REQUEST("/api/price-sources/source1/review", { method: "POST", body: { downstreamUse: "Costing", reason: "Newly reviewed manufacturer list, entered now per current pricing policy." } }), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.costingEligible, true);
  const storedSource = raw.prepare("SELECT * FROM product_sources WHERE id='source1'").get();
  assert.equal(storedSource.downstream_use, "Costing");
  assert.equal(storedSource.valid_until, null, "date metadata is untouched by this route");
});

// ---------------------------------------------------------------------------
// Malformed supplied dates -- date-format validation preserved
// ---------------------------------------------------------------------------

test("POST /api/price-records/:id/review rejects a malformed supplied validUntil, and never mutates the record", async () => {
  const { raw, env } = buildDb();
  const record = seedPriceRecord(raw);
  const response = await handleProductPriceLibraryApi(REQUEST(`/api/price-records/${record.id}/review`, { method: "POST", body: { decision: "Approve", downstreamUse: "Costing", validUntil: "not-a-date", reason: "Attempting to approve with a bad date." } }), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "PRICE_VALIDITY_MALFORMED");
  const stored = raw.prepare("SELECT * FROM price_records WHERE id=?").get(record.id);
  assert.equal(stored.approval_status, "Needs Review", "a rejected malformed request must never mutate the record");
});

// ---------------------------------------------------------------------------
// Agreement between eligibility and counts
// ---------------------------------------------------------------------------

test("the SQL costing_eligible_price_count and the per-record eligibleForCosting flag agree for the same expired-but-approved-Costing record", async () => {
  const { raw, env } = buildDb();
  // The detail route's prices query INNER JOINs product_sources, so every
  // price_record exercised through it needs a real source row.
  raw.prepare(`INSERT INTO product_sources (id,project_id,document_id,document_version_id,checksum,source_type,authority,scope_type,file_name,release_version,effective_from,valid_until,currency,validity_state,review_status,downstream_use,metadata,created_by)
    VALUES ('source1',NULL,'doc1','dv1','sha1','Manufacturer Price List','Manufacturer','Global','list.xlsx','v1',NULL,NULL,'USD','No Validity Provided','Reviewed','Costing','{}','owner1')`).run();
  const record = seedPriceRecord(raw, { source_id: "source1", approval_status: "Approved", downstream_use: "Costing", valid_until: "2020-01-01" });
  seedPriceRecord(raw, { source_id: "source1", approval_status: "Needs Review", downstream_use: "Costing", valid_until: "2099-01-01" }); // must not count either way

  const listResult = await queryLibraryProducts(env.DB, { query: "ASD-100" });
  const sqlCount = listResult.products.find((entry) => entry.canonicalProductId === "product1").costingEligiblePrices;

  const detailResponse = await handleProductPriceLibraryApi(REQUEST("/api/products/requested1"), env);
  const detail = await detailResponse.json();
  const perRecordCount = detail.prices.filter((row) => row.eligibleForCosting).length;
  const eligibleRecord = detail.prices.find((row) => row.id === record.id);

  assert.equal(sqlCount, 1);
  assert.equal(perRecordCount, sqlCount, "SQL count and per-record eligibility flags must agree on the same set");
  assert.equal(eligibleRecord.eligibleForCosting, true, "the expired-but-approved-Costing record itself is the one flagged eligible");
  assert.equal(eligibleRecord.valid_until, "2020-01-01", "the truthful expired date is still visible on the eligible record -- never hidden or relabeled Current");
  assert.equal(detail.safety.costingEligiblePrices, sqlCount, "the detail route's own safety summary agrees too");
});

// ---------------------------------------------------------------------------
// Preservation of dates and audit history
// ---------------------------------------------------------------------------

test("approving an expired Costing record writes a real product_library_decisions audit row and never touches unrelated fields", async () => {
  const { raw, env } = buildDb();
  const record = seedPriceRecord(raw, { valid_until: "2020-01-01", currency: "USD", amount_minor: 12345 });
  const response = await handleProductPriceLibraryApi(REQUEST(`/api/price-records/${record.id}/review`, { method: "POST", body: { decision: "Approve", downstreamUse: "Costing", reason: "Newly reviewed supplier quote, entered now per current pricing policy." } }), env);
  assert.equal(response.status, 200);
  const decisions = raw.prepare("SELECT * FROM product_library_decisions WHERE entity_id=?").all(record.id);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].entity_type, "Price Record");
  assert.equal(decisions[0].action, "Approved");
  assert.match(decisions[0].reason, /Newly reviewed supplier quote/);
  const previous = JSON.parse(decisions[0].previous_value);
  const next = JSON.parse(decisions[0].new_value);
  assert.equal(previous.approvalStatus, "Needs Review");
  assert.equal(next.approvalStatus, "Approved");
  assert.equal(next.validUntil, "2020-01-01", "the audit trail itself truthfully records the expired date, never a fabricated current one");
  const stored = raw.prepare("SELECT * FROM price_records WHERE id=?").get(record.id);
  assert.equal(stored.amount_minor, 12345, "unrelated fields (amount, currency) are never touched by this review");
  assert.equal(stored.currency, "USD");
});
