import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { handleProductPriceLibraryApi } from "../worker/product-price-library-api.mjs";

// R3 — PRODUCT DISCOVERY APPROVAL.
// POST /api/products/:id/approve-discovery must:
//   1. Approve for a governed actor (Administrator/Library Manager) with a
//      substantive reason (>= MIN_GOVERNED_REASON_LENGTH = 5).
//   2. Flip library_products to review_status='Reviewed' +
//      approved_for_discovery=1 and write a governed decision event with the
//      truthful before/after approval values and the actor.
//   3. Return { approvedForDiscovery: true, costingEligible: false } — never
//      grants costing eligibility.
//   4. Reject short reasons (422 REVIEW_REASON_REQUIRED) with zero writes.
//   5. 404 on unknown products.
//   The UI slice then wires this existing governed route (nothing else).

const d1 = (raw) => ({
  prepare(sql) {
    const op = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    });
    return { ...op(), bind: (...values) => op(values) };
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
PRAGMA foreign_keys=ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE product_manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE product_brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE product_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE library_products (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  brand_id TEXT,
  family_id TEXT,
  part_number TEXT NOT NULL,
  normalized_part_number TEXT NOT NULL,
  description TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'Unknown — Review Required',
  country_of_origin TEXT,
  attributes TEXT NOT NULL DEFAULT '[]',
  standards TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  approved_for_discovery INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  identity_status TEXT NOT NULL DEFAULT 'Active',
  superseded_by_product_id TEXT,
  FOREIGN KEY (manufacturer_id) REFERENCES product_manufacturers(id),
  FOREIGN KEY (brand_id) REFERENCES product_brands(id),
  FOREIGN KEY (family_id) REFERENCES product_families(id)
);

CREATE VIEW canonical_library_products AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.* FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';

CREATE TABLE product_library_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_role TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO organizations (id, name, status) VALUES ('org-a', 'Fixture Org', 'Active');
    INSERT INTO organization_memberships (id, organization_id, user_id, status, granted_by) VALUES
      ('mem-a', 'org-a', 'user-a', 'Active', 'seed');
    INSERT INTO product_manufacturers (id, name) VALUES ('mfr-1', 'Honeywell');
    INSERT INTO product_brands (id, name) VALUES ('brand-1', 'Gent');
    INSERT INTO product_families (id, name) VALUES ('fam-1', 'Fire Alarm');
    INSERT INTO library_products (id, manufacturer_id, brand_id, family_id, part_number, normalized_part_number, description, review_status, approved_for_discovery, created_by) VALUES
      ('prod-1', 'mfr-1', 'brand-1', 'fam-1', '9051', '9051', 'Fire alarm detector', 'Needs Review', 0, 'user-a'),
      ('prod-2', 'mfr-1', NULL, NULL, '9052', '9052', 'Fire alarm base', 'Reviewed', 1, 'user-a');
  `);
  return {
    raw,
    env: {
      DB: d1(raw),
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "user-a",
      APP_ORGANIZATION_ID: "org-a",
      APP_USER_EMAIL: "user@test.invalid",
      APP_USER_NAME: "Single User",
    },
  };
};

const approve = (productId, body, env) =>
  handleProductPriceLibraryApi(
    new Request(`http://localhost/api/products/${productId}/approve-discovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  ).then(async (response) => ({ status: response.status, body: await response.json() }));

test("R3 governed approval flips discovery state, records an audit decision, and never grants costing", async () => {
  const { raw, env } = fixture();

  const { status, body } = await approve("prod-1", { reason: "Confirmed in reviewed catalogue with source evidence." }, env);

  assert.equal(status, 200);
  assert.equal(body.approvedForDiscovery, true);
  assert.equal(body.costingEligible, false, "discovery approval must never imply costing eligibility");

  const product = raw.prepare("SELECT review_status, approved_for_discovery FROM library_products WHERE id='prod-1'").get();
  assert.equal(product.review_status, "Reviewed");
  assert.equal(product.approved_for_discovery, 1);

  const decision = raw.prepare("SELECT * FROM product_library_decisions WHERE entity_id='prod-1' AND entity_type='Product' ORDER BY decided_at DESC LIMIT 1").get();
  assert.ok(decision, "a governed decision event must be written");
  assert.equal(decision.action, "Approved for Discovery");
  assert.equal(decision.reason, "Confirmed in reviewed catalogue with source evidence.");
  assert.equal(decision.decided_by, "user-a");
  assert.equal(decision.decided_role, "Administrator");
  assert.deepEqual(JSON.parse(decision.previous_value), { approved: false });
  assert.deepEqual(JSON.parse(decision.new_value), { approved: true });
});

test("R3 short reasons are rejected with zero writes", async () => {
  const { raw, env } = fixture();

  const { status, body } = await approve("prod-1", { reason: "ok" }, env);
  assert.equal(status, 422);
  assert.equal(body.error.code, "REVIEW_REASON_REQUIRED");

  const product = raw.prepare("SELECT review_status, approved_for_discovery FROM library_products WHERE id='prod-1'").get();
  assert.equal(product.review_status, "Needs Review", "product must be untouched");
  assert.equal(product.approved_for_discovery, 0);
  const decisions = raw.prepare("SELECT COUNT(*) count FROM product_library_decisions").get().count;
  assert.equal(decisions, 0, "no decision event may be written for a rejected review");
});

test("R3 unknown products return 404 with zero writes", async () => {
  const { raw, env } = fixture();

  const { status, body } = await approve("prod-unknown", { reason: "Confirmed against the reviewed catalogue." }, env);
  assert.equal(status, 404);
  assert.equal(body.error.code, "PRODUCT_NOT_FOUND");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM product_library_decisions").get().count, 0);
});

test("R3 approval is a governed action gated on a Library Manager/Administrator role", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8"),
  );
  const approveBlock = source.slice(source.indexOf('operation === "approve-discovery"'));
  assert.match(approveBlock, /canGovernGlobal\(user\.role\)/);
  assert.match(approveBlock, /LIBRARY_ROLE_REQUIRED/);
  assert.match(approveBlock, /reason\.length < MIN_GOVERNED_REASON_LENGTH/);
});

test("R3 the Product Library UI wires the governed approval route with a reason and refreshes the record", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  );
  // The detail panel must post a substantive reason (>= the backend's
  // MIN_GOVERNED_REASON_LENGTH = 5) to the existing approve-discovery route,
  // gate the action on Library Manager/Administrator permission, reflect the
  // honest approvedForDiscovery response, and refresh the product list.
  assert.match(source, /\/approve-discovery`/);
  assert.match(source, /approveDiscoveryProduct/);
  assert.match(source, /libraryApprovalReason\.trim\(\)\.length < 5/);
  assert.match(source, /canGovernLibrary/);
  assert.match(source, /Library Manager or Administrator/);
  assert.match(source, /approvedForDiscovery: true/);
  assert.match(source, /libraryProductRefresh/);
  assert.match(source, /Approve for discovery/);
  assert.match(source, /requested_product_id/);
});