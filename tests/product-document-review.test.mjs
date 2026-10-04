// Product Document Review governance closure.
//
// Covers the missing lifecycle the audit found: `persistReviewedProductDocument`
// lands every product_documents row at Needs Review and nothing could ever move
// it. These tests prove the new governed route moves exactly one row, binds the
// approval to the exact version reviewed, records human provenance, and never
// touches extracted product facts.
//
// Pattern mirrors worker/__tests__/product-attribute-review.test.mjs: a real
// in-memory SQLite database behind the D1 adapter, never a mock DB, so the
// SQL bindings, gates and audit writes run the same statements production
// runs. Fixtures are synthetic (IFP-2100HV-flavoured names only); no capacity
// fact value is asserted or changed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  PRODUCT_DOCUMENT_REVIEW_POLICY_VERSION,
  evaluateProductDocumentReview,
  reviewProductDocument,
  handleProductDocumentReviewApi,
} from "../worker/product-document-review-api.mjs";
import { requireLibraryCapability } from "../worker/library-auth.mjs";

// r7-style adapter: the module speaks the D1 interface, the test drives a real
// in-memory SQLite database through it.
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
});

const schema = `
CREATE TABLE library_products (
  id TEXT PRIMARY KEY,
  part_number TEXT NOT NULL
);
CREATE TABLE product_sources (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  document_version_id TEXT,
  checksum TEXT,
  source_type TEXT NOT NULL,
  authority TEXT,
  scope_type TEXT NOT NULL,
  file_name TEXT,
  release_version TEXT,
  validity_state TEXT,
  review_status TEXT NOT NULL,
  downstream_use TEXT
);
CREATE TABLE product_documents (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  variant_id TEXT,
  document_id TEXT,
  document_version_id TEXT,
  document_type TEXT,
  source_location TEXT,
  source_reliability TEXT,
  review_status TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  attribute_name TEXT NOT NULL,
  original_value TEXT,
  normalized_value TEXT,
  review_status TEXT NOT NULL
);
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

const REASON =
  "Reviewed 351602 rev C scope, revision and IFP-2100HV applicability against the registered first-party source.";

// Focused validation fixtures. Names echo the IFP-2100HV evidence set; the
// values are synthetic and no fact assertion depends on them.
const seed = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO library_products (id, part_number) VALUES ('p-ifp', 'IFP-2100HV');
    INSERT INTO product_sources
      (id, document_id, document_version_id, checksum, source_type, authority, scope_type, file_name, release_version, validity_state, review_status, downstream_use)
    VALUES
      ('s-351602-c', 'doc-351602', 'ver-351602-c', 'sha351602c', 'Product Datasheet', 'Official Manufacturer', 'Global', 'hbt-fire-351602-C.pdf', 'C', 'Current Document \u2014 Applicability Review Required', 'Needs Review', 'Discovery Only'),
      ('s-351602-d', 'doc-351602', 'ver-351602-d', 'sha351602d', 'Product Datasheet', 'Official Manufacturer', 'Global', 'hbt-fire-351602-D.pdf', 'D', 'Current Document \u2014 Applicability Review Required', 'Needs Review', 'Discovery Only'),
      ('s-resale', 'doc-resale', 'ver-resale', 'sharesale', 'Product Datasheet', 'Reseller', 'Global', 'resale-351602.pdf', 'C', 'Current Document \u2014 Applicability Review Required', 'Needs Review', 'Discovery Only');
    INSERT INTO product_documents
      (id, product_id, variant_id, document_id, document_version_id, document_type, source_location, source_reliability, review_status, created_by)
    VALUES
      ('pd-351602-c', 'p-ifp', NULL, 'doc-351602', 'ver-351602-c', 'Product Datasheet', '{"sourceId":"s-351602-c"}', 'Authoritative Manufacturer Source', 'Needs Review', 'seed'),
      ('pd-351602-d', 'p-ifp', NULL, 'doc-351602', 'ver-351602-d', 'Product Datasheet', '{"sourceId":"s-351602-d"}', 'Authoritative Manufacturer Source', 'Needs Review', 'seed'),
      ('pd-resale', 'p-ifp', NULL, 'doc-resale', 'ver-resale', 'Product Datasheet', '{"sourceId":"s-resale"}', 'Authoritative Manufacturer Source', 'Needs Review', 'seed'),
      ('pd-stale', 'p-ifp', NULL, 'doc-351602', 'ver-351602-OLD', 'Product Datasheet', '{"sourceId":"s-351602-c"}', 'Authoritative Manufacturer Source', 'Needs Review', 'seed'),
      ('pd-deleted', 'p-ifp', NULL, 'doc-351602', 'ver-351602-c', 'Product Datasheet', '{"sourceId":"s-351602-c"}', 'Authoritative Manufacturer Source', 'Needs Review', 'seed'),
      ('pd-reject-me', 'p-ifp', NULL, 'doc-351602', 'ver-351602-c', 'Product Datasheet', '{"sourceId":"s-351602-c"}', 'Authoritative Manufacturer Source', 'Needs Review', 'seed');
    UPDATE product_documents SET deleted_at=CURRENT_TIMESTAMP WHERE id='pd-deleted';
    INSERT INTO product_attributes (id, product_id, attribute_name, original_value, normalized_value, review_status)
    VALUES ('attr-loops', 'p-ifp', 'native_slc_loops', '1', '1', 'Needs Review');
  `);
  return d1(raw);
};

const row = async (db, id) =>
  (await db.prepare("SELECT * FROM product_documents WHERE id=?").bind(id).first());
const decisions = async (db, entityId) =>
  (await db.prepare("SELECT * FROM product_library_decisions WHERE entity_id=? ORDER BY decided_at").bind(entityId).first());

// A. A newly persisted document starts life as Needs Review.
test("A — a new document persists as Needs Review", async () => {
  const db = seed();
  assert.equal((await row(db, "pd-351602-c")).review_status, "Needs Review");
});

// B. An authorized human approves the exact current document.
test("B — authorized human approves the exact current document", async () => {
  const db = seed();
  const result = await reviewProductDocument(db, {
    documentRowId: "pd-351602-c",
    productId: "p-ifp",
    decision: "Approve",
    reason: REASON,
    decidedBy: "omair-primary",
    decidedRole: "Administrator",
  });
  assert.equal(result.success, true);
  assert.equal(result.to, "Approved");
  assert.deepEqual(result.binding, {
    documentId: "doc-351602",
    documentVersionId: "ver-351602-c",
    sourceId: "s-351602-c",
    checksum: "sha351602c",
    releaseVersion: "C",
  });
});

// C. An approved document reads back as Approved.
test("C — approved document reads as Approved", async () => {
  const db = seed();
  await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal((await row(db, "pd-351602-c")).review_status, "Approved");
});

// D. The same approval repeats idempotently with no new audit row.
test("D — same approval repeats idempotently", async () => {
  const db = seed();
  const first = await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(first.success, true);
  const second = await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(second.success, true);
  assert.equal(second.alreadyApproved, true);
  const count = await db.prepare(
    "SELECT COUNT(*) c FROM product_library_decisions WHERE entity_id=?"
  ).bind("pd-351602-c").first();
  assert.equal(count.c, 1);
});

// E. A stale/replaced document cannot inherit approval.
test("E — stale version binding cannot be approved", async () => {
  const db = seed();
  const evaluation = await evaluateProductDocumentReview(db, "pd-stale");
  assert.equal(evaluation.eligible, false);
  const result = await reviewProductDocument(db, {
    documentRowId: "pd-stale", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "DOCUMENT_EVIDENCE_GATE_FAILED");
  assert.equal((await row(db, "pd-stale")).review_status, "Needs Review");
});

// E2. The HTTP CAS precondition rejects a version-changed row with 409.
test("E2 — handler CAS rejects when the version moved", async () => {
  const db = seed();
  const env = { DB: db, APP_HUMAN_ID: "omair-primary", APP_HUMAN_NAME: "Omair" };
  const request = new Request(
    "http://localhost/api/products/p-ifp/documents/pd-351602-c/review",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "Approve", reason: REASON, documentVersionId: "ver-351602-OLD" }),
    }
  );
  const response = await handleProductDocumentReviewApi(request, env);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "PRODUCT_DOCUMENT_VERSION_CHANGED");
  assert.equal((await row(db, "pd-351602-c")).review_status, "Needs Review");
});

// F. An unauthorized actor cannot approve.
test("F — missing human actor is refused before any write", async () => {
  const db = seed();
  const env = { DB: db };
  const request = new Request(
    "http://localhost/api/products/p-ifp/documents/pd-351602-c/review",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "Approve", reason: REASON }),
    }
  );
  const response = await handleProductDocumentReviewApi(request, env);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "HUMAN_ACTOR_NOT_CONFIGURED");
  assert.equal((await row(db, "pd-351602-c")).review_status, "Needs Review");
});

// F2. A viewer-role actor lacks the approve capability.
test("F2 — library viewer cannot approve", async () => {
  const denied = requireLibraryCapability({ role: "Library Viewer" }, "approve");
  assert.ok(denied);
  assert.equal(denied.status, 403);
});

// G. Document approval does NOT approve extracted product facts.
test("G — approving a document leaves product facts untouched", async () => {
  const db = seed();
  await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  const attr = await db.prepare("SELECT * FROM product_attributes WHERE id=?").bind("attr-loops").first();
  assert.equal(attr.review_status, "Needs Review");
  const facts = await db.prepare(
    "SELECT COUNT(*) c FROM product_library_decisions WHERE entity_type='Product Attribute'"
  ).bind().first();
  assert.equal(facts.c, 0);
});

// H. A different revision requires its own independent review.
test("H — revisions are reviewed independently", async () => {
  const db = seed();
  await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal((await row(db, "pd-351602-d")).review_status, "Needs Review");
  const second = await reviewProductDocument(db, {
    documentRowId: "pd-351602-d", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(second.success, true);
  assert.equal(second.binding.releaseVersion, "D");
});

// I. Rejection is distinguishable from absence.
test("I — rejection is recorded, not silent", async () => {
  const db = seed();
  const result = await reviewProductDocument(db, {
    documentRowId: "pd-reject-me", productId: "p-ifp", decision: "Reject",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(result.success, true);
  assert.equal(result.to, "Rejected");
  assert.equal((await row(db, "pd-reject-me")).review_status, "Rejected");
  const audit = await decisions(db, "pd-reject-me");
  assert.equal(audit.action, "Rejected");
  assert.equal(audit.decided_by, "omair-primary");
});

// Gates: non-first-party authority and deleted rows fail closed.
test("gates — reseller authority and deleted rows are refused", async () => {
  const db = seed();
  const resale = await reviewProductDocument(db, {
    documentRowId: "pd-resale", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(resale.success, false);
  assert.equal(resale.code, "DOCUMENT_EVIDENCE_GATE_FAILED");
  const deleted = await reviewProductDocument(db, {
    documentRowId: "pd-deleted", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(deleted.success, false);
});

// Product mismatch answers 404 without leaking which half exists.
test("product mismatch — wrong product id is not found", async () => {
  const db = seed();
  const result = await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-other", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "PRODUCT_DOCUMENT_NOT_FOUND");
});

// Audit provenance: the decision names the human, the version and the reason.
test("audit — decision carries human, version binding and reason", async () => {
  const db = seed();
  await reviewProductDocument(db, {
    documentRowId: "pd-351602-c", productId: "p-ifp", decision: "Approve",
    reason: REASON, decidedBy: "omair-primary", decidedRole: "Administrator",
  });
  const audit = await decisions(db, "pd-351602-c");
  assert.equal(audit.entity_type, "Product Document");
  assert.equal(audit.action, "Approved");
  assert.equal(audit.decided_by, "omair-primary");
  assert.equal(audit.reason, REASON);
  const next = JSON.parse(audit.new_value);
  assert.equal(next.binding.documentVersionId, "ver-351602-c");
  assert.equal(next.binding.checksum, "sha351602c");
});

test("policy — version constant is pinned", () => {
  assert.equal(PRODUCT_DOCUMENT_REVIEW_POLICY_VERSION, "product-document-review-1.0.0");
});

// Routing precedence: this handler is mounted BEFORE handleProductPriceLibraryApi
// (which claims every /api/products/* path and ends in a 404 fallthrough), so it
// must claim ONLY the exact review path and return null for everything else --
// otherwise the mount order would shadow existing product routes.
test("routing — non-review product paths fall through untouched", async () => {
  const db = seed();
  const env = { DB: db, APP_HUMAN_ID: "omair-primary", APP_HUMAN_NAME: "Omair" };
  const cases = [
    ["GET", "http://localhost/api/products/p-ifp"],
    ["GET", "http://localhost/api/products/p-ifp/documents"],
    ["POST", "http://localhost/api/products/p-ifp/approve-discovery"],
    ["GET", "http://localhost/api/products/p-ifp/attributes"],
    ["POST", "http://localhost/api/products/p-ifp/documents/pd-351602-c/approve"],
  ];
  for (const [method, url] of cases) {
    const response = await handleProductDocumentReviewApi(new Request(url, { method }), env);
    assert.equal(response, null, `${method} ${url} must fall through`);
  }
});

test("routing — exact review path is claimed", async () => {
  const db = seed();
  const env = { DB: db, APP_HUMAN_ID: "omair-primary", APP_HUMAN_NAME: "Omair" };
  const response = await handleProductDocumentReviewApi(
    new Request("http://localhost/api/products/p-ifp/documents/pd-reject-me/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "Reject", reason: REASON }),
    }),
    env
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reviewStatus, "Rejected");
});
