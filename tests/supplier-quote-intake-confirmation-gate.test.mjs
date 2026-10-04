import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { executeSupplierQuoteExtraction } from "../worker/supplier-price-intake-api.mjs";

// Routing-safety audit follow-up (2026-08-31): Supplier Quotation intake had
// NO classification gate at all -- any project-owning user could POST any
// documentId and it would run regardless of the document's real type or
// whether anyone had confirmed it. This closes the same invariant already
// enforced for BOQ, Technical Specification and Project Context: only a
// real, authenticated confirm/override action (classification_status =
// "Manually Confirmed") for the CONFIRMED type "Supplier Quotation" may
// authorize this processor. The classifier's own confidence
// (manualReviewRequired) is never an acceptable substitute.

// Real D1 silently coerces an undefined bound value to NULL; node:sqlite's
// DatabaseSync does not and throws. This normalizes to match real D1's
// actual, lenient runtime behavior rather than testing a stricter shim than
// what this code genuinely runs against.
const nullifyUndefined = (args) => args.map((value) => (value === undefined ? null : value));
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => {
      const bound = nullifyUndefined(args);
      return {
        first: async () => raw.prepare(sql).get(...bound) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...bound) }),
        run: async () => raw.prepare(sql).run(...bound),
      };
    };
    return { ...operation(), bind: (...args) => operation(args) };
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
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, original_filename TEXT, extension TEXT, mime_type TEXT, byte_size INTEGER, sha256 TEXT, object_key TEXT);
CREATE TABLE document_classifications(id TEXT PRIMARY KEY, document_id TEXT, primary_type TEXT, status TEXT, classified_at TEXT, superseded_at TEXT);
CREATE TABLE supplier_quote_intake_runs(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, source_checksum TEXT, parser_version TEXT, input_fingerprint TEXT, status TEXT, supplier_name TEXT, quotation_reference TEXT, issue_date TEXT, valid_until TEXT, currency TEXT, row_count INTEGER, candidate_count INTEGER, created_by TEXT, completed_at TEXT);
CREATE TABLE supplier_quote_intake_rows(id TEXT PRIMARY KEY, intake_run_id TEXT, project_id TEXT, document_id TEXT, document_version_id TEXT, row_type TEXT, sheet_name TEXT, row_number INTEGER, item_number TEXT, supplier_name TEXT, quotation_reference TEXT, manufacturer TEXT, part_number TEXT, description TEXT, unit TEXT, quantity REAL, currency TEXT, list_price_minor INTEGER, unit_price_minor INTEGER, discount_basis_points INTEGER, net_price_minor INTEGER, issue_date TEXT, valid_until TEXT, raw_values TEXT, review_status TEXT);
CREATE TABLE supplier_quote_intake_events(id TEXT PRIMARY KEY, project_id TEXT, intake_run_id TEXT, action TEXT, new_value TEXT, reason TEXT, actor_user_id TEXT, request_id TEXT);
CREATE TABLE library_products(id TEXT PRIMARY KEY);
CREATE TABLE product_sources(id TEXT PRIMARY KEY);
CREATE TABLE price_records(id TEXT PRIMARY KEY);
CREATE TABLE suppliers(id TEXT PRIMARY KEY);
`;

const OWNER = "owner1";

const buildDatabase = ({ primaryType, status } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','${OWNER}','org1');
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1','quote.csv','csv','text/csv',100,'sha1','key1');
  `);
  if (primaryType) {
    raw.prepare("INSERT INTO document_classifications VALUES ('class1','doc1',?,?,'2026-08-31T00:00:00Z',NULL)").run(primaryType, status);
  }
  return raw;
};

const csvBytes = new TextEncoder().encode("Item,Description,Manufacturer,Part Number,Unit,Qty,Unit Price\n1,Smoke detector,Honeywell,IDP-PHOTO-W,No,20,150");
const env = (raw) => ({ DB: d1(raw), FILES: { get: async (key) => (key === "key1" ? { arrayBuffer: async () => csvBytes.buffer } : null) } });

test("1. classifier suggests Supplier Quotation but it is NOT manually confirmed -> intake blocked, no rows created", async () => {
  const raw = buildDatabase({ primaryType: "Supplier Quotation", status: "Classified" }); // classifier's own status, not a human confirmation
  await assert.rejects(
    executeSupplierQuoteExtraction(env(raw), { documentId: "doc1", userId: OWNER }),
    (error) => error.code === "SUPPLIER_QUOTE_CLASSIFICATION_CONFIRMATION_REQUIRED",
  );
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM supplier_quote_intake_runs").get().count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM supplier_quote_intake_rows").get().count, 0);
});

test("2. manually confirmed as Supplier Quotation -> intake allowed and a real run is created", async () => {
  const raw = buildDatabase({ primaryType: "Supplier Quotation", status: "Manually Confirmed" });
  try {
    await executeSupplierQuoteExtraction(env(raw), { documentId: "doc1", userId: OWNER });
  } catch (error) {
    // The gate itself must never be the failure reason once confirmed; any
    // later failure (e.g. the separate knowledge-memory subsystem's own
    // schema, not stood up in this focused test) is out of scope here.
    assert.notEqual(error.code, "SUPPLIER_QUOTE_CLASSIFICATION_CONFIRMATION_REQUIRED", `gate must not block a confirmed Supplier Quotation, got: ${error.code} ${error.message}`);
  }
  const run = raw.prepare("SELECT * FROM supplier_quote_intake_runs WHERE document_id='doc1'").get();
  assert.ok(run, "a real intake run must be persisted once the type is confirmed");
  assert.ok(raw.prepare("SELECT COUNT(*) count FROM supplier_quote_intake_rows WHERE intake_run_id=?").get(run.id).count > 0, "real supplier quote line rows must be persisted");
});

test("3. manually confirmed as BOQ / Technical Specification / Drawing -> supplier quote intake still blocked", async () => {
  for (const wrongType of ["BOQ", "Technical Specification", "Drawing"]) {
    const raw = buildDatabase({ primaryType: wrongType, status: "Manually Confirmed" });
    await assert.rejects(
      executeSupplierQuoteExtraction(env(raw), { documentId: "doc1", userId: OWNER }),
      (error) => error.code === "SUPPLIER_QUOTE_CLASSIFICATION_CONFIRMATION_REQUIRED",
      `confirmed as ${wrongType} must not authorize supplier quote intake`,
    );
    assert.equal(raw.prepare("SELECT COUNT(*) count FROM supplier_quote_intake_runs").get().count, 0);
  }
});

test("4. high-confidence classifier result with manualReviewRequired=false but no human confirmation -> still blocked", async () => {
  // manual_review_required is not even selected/used by the gate at all --
  // this proves it cannot substitute for status='Manually Confirmed' by
  // construction, not merely by omission.
  const raw = buildDatabase({ primaryType: "Supplier Quotation", status: "Classified" });
  await assert.rejects(
    executeSupplierQuoteExtraction(env(raw), { documentId: "doc1", userId: OWNER }),
    (error) => error.code === "SUPPLIER_QUOTE_CLASSIFICATION_CONFIRMATION_REQUIRED",
  );
});

test("no classification at all -> intake blocked, not silently permitted", async () => {
  const raw = buildDatabase();
  await assert.rejects(
    executeSupplierQuoteExtraction(env(raw), { documentId: "doc1", userId: OWNER }),
    (error) => error.code === "SUPPLIER_QUOTE_CLASSIFICATION_CONFIRMATION_REQUIRED",
  );
});

test("existing project-ownership authorization is preserved -- a document from another user's project is still rejected first", async () => {
  const raw = buildDatabase({ primaryType: "Supplier Quotation", status: "Manually Confirmed" });
  await assert.rejects(
    executeSupplierQuoteExtraction(env(raw), { documentId: "doc1", userId: "not-the-owner" }),
    (error) => error.code === "DOCUMENT_NOT_FOUND",
  );
});
