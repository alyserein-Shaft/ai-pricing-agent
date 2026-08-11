import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { approveSupplierPriceRow, canonicalSupplierProductCandidates } from "../worker/supplier-price-intake-api.mjs";

const d1 = raw => ({
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
PRAGMA foreign_keys=ON;
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE documents(id TEXT PRIMARY KEY);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, original_filename TEXT NOT NULL);
CREATE TABLE product_manufacturers(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE library_products(id TEXT PRIMARY KEY,manufacturer_id TEXT,part_number TEXT,normalized_part_number TEXT,description TEXT,identity_status TEXT,approved_for_discovery INTEGER,review_status TEXT,canonical_product_id TEXT);
CREATE VIEW canonical_library_products AS SELECT requested.id AS requested_product_id,canonical.* FROM library_products requested JOIN library_products canonical ON canonical.id=COALESCE(requested.canonical_product_id,requested.id);
CREATE TABLE supplier_products(id TEXT PRIMARY KEY,product_id TEXT,supplier_id TEXT,supplier_product_code TEXT,deleted_at TEXT);
CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT,normalized_name TEXT,status TEXT);
CREATE TABLE supplier_quotes(id TEXT PRIMARY KEY,supplier_id TEXT,project_id TEXT,quote_number TEXT,quote_version INTEGER,quote_date TEXT,valid_until TEXT,currency TEXT,source_document_id TEXT,source_document_version_id TEXT,review_status TEXT,created_by TEXT,superseded_at TEXT,deleted_at TEXT);
CREATE UNIQUE INDEX quote_document_version ON supplier_quotes(project_id,supplier_id,quote_number,source_document_version_id);
CREATE TABLE supplier_quote_lines(id TEXT PRIMARY KEY,supplier_quote_id TEXT,line_number INTEGER,product_id TEXT,supplier_product_code TEXT,manufacturer TEXT,part_number TEXT,description TEXT,quantity TEXT,unit_price_minor INTEGER,discount_basis_points INTEGER,net_price_minor INTEGER,currency TEXT,source_location TEXT,mapping_confidence INTEGER,review_status TEXT,original_values TEXT,source_intake_row_id TEXT UNIQUE);
CREATE TABLE product_sources(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,document_version_id TEXT,checksum TEXT,source_type TEXT,authority TEXT,scope_type TEXT,file_name TEXT,release_version TEXT,effective_from TEXT,valid_until TEXT,currency TEXT,validity_state TEXT,review_status TEXT,downstream_use TEXT,metadata TEXT,created_by TEXT);
CREATE UNIQUE INDEX source_checksum ON product_sources(checksum,scope_type,project_id);
CREATE TABLE price_records(id TEXT PRIMARY KEY,product_id TEXT,source_id TEXT,supplier_id TEXT,project_id TEXT,amount_minor INTEGER,currency TEXT,price_type TEXT,unit TEXT,minimum_quantity INTEGER,discount_basis_points INTEGER,effective_from TEXT,valid_until TEXT,validity_state TEXT,approval_status TEXT,downstream_use TEXT,terms TEXT,source_location TEXT,reviewed_by TEXT,reviewed_at TEXT);
CREATE TABLE supplier_quote_intake_runs(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,document_version_id TEXT,source_checksum TEXT,quotation_reference TEXT);
CREATE TABLE supplier_quote_intake_rows(id TEXT PRIMARY KEY,intake_run_id TEXT,project_id TEXT,document_id TEXT,document_version_id TEXT,row_type TEXT,sheet_name TEXT,row_number INTEGER,item_number TEXT,supplier_name TEXT,quotation_reference TEXT,manufacturer TEXT,part_number TEXT,description TEXT,unit TEXT,quantity REAL,currency TEXT,unit_price_minor INTEGER,discount_basis_points INTEGER,net_price_minor INTEGER,issue_date TEXT,valid_until TEXT,raw_values TEXT,review_status TEXT,product_id TEXT,mapping_basis TEXT,mapped_by TEXT,mapped_at TEXT,review_reason TEXT,reviewed_by TEXT,reviewed_at TEXT,promoted_supplier_quote_id TEXT,promoted_price_record_id TEXT);
CREATE TABLE supplier_quote_intake_events(id TEXT PRIMARY KEY,project_id TEXT,intake_run_id TEXT,row_id TEXT,action TEXT,previous_value TEXT,new_value TEXT,reason TEXT,actor_user_id TEXT,request_id TEXT);
`;

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec("INSERT INTO projects VALUES ('p1'); INSERT INTO documents VALUES ('d1'); INSERT INTO document_versions VALUES ('vA','quote-A.xlsx'),('vB','quote-B.xlsx'); INSERT INTO product_manufacturers VALUES ('m1','Honeywell'); INSERT INTO library_products VALUES ('product1','m1','2151','2151','Smoke detector','Active',1,'Reviewed',NULL); INSERT INTO suppliers VALUES ('supplier1','Acme Fire','acmefire','Active');");
  const insertRun = raw.prepare("INSERT INTO supplier_quote_intake_runs VALUES (?,?,?,?,?,?)");
  insertRun.run("runA", "p1", "d1", "vA", "sha-A", "Q-100");
  insertRun.run("runB", "p1", "d1", "vB", "sha-B", "Q-100");
  const insertRow = raw.prepare("INSERT INTO supplier_quote_intake_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const values = (id, run, version, net, date) => [id,run,"p1","d1",version,"SUPPLIER_LINE","Prices",7,"1","Acme Fire","Q-100","Honeywell","2151","Smoke detector","EA",10,"SAR",net,1000,net,date,"2026-12-31",JSON.stringify({ model:"2151",net:net/100 }),"Needs Review","product1","MANUFACTURER_EXACT_MODEL","mapper",`${date}T09:00:00Z`,null,null,null,null,null];
  insertRow.run(...values("rowA", "runA", "vA", 9000, "2026-08-01"));
  insertRow.run(...values("rowB", "runB", "vB", 9500, "2026-08-10"));
  return { raw, DB: d1(raw) };
};

const approve = async (DB, raw, rowId, requestId) => {
  const row = raw.prepare("SELECT * FROM supplier_quote_intake_rows WHERE id=?").get(rowId);
  const response = await approveSupplierPriceRow({ DB }, { row, projectId:"p1", actor:{ id:"estimator1" }, reason:"Verified exact supplier quotation evidence", requestId, stamp:"2026-08-11T10:00:00Z" });
  return { status: response.status, body: await response.json() };
};

test("database-backed quotation revisions preserve immutable A and B evidence", async () => {
  const { raw, DB } = fixture();
  await approve(DB, raw, "rowA", "request-A");
  const before = raw.prepare("SELECT * FROM supplier_quote_lines WHERE source_intake_row_id='rowA'").get();
  await approve(DB, raw, "rowB", "request-B");
  const quotes = raw.prepare("SELECT * FROM supplier_quotes ORDER BY quote_version").all();
  assert.deepEqual(quotes.map(row => [row.quote_version,row.source_document_version_id]), [[1,"vA"],[2,"vB"]]);
  assert.equal(quotes[0].superseded_at, "2026-08-11T10:00:00Z");
  assert.equal(raw.prepare("SELECT net_price_minor FROM supplier_quote_lines WHERE source_intake_row_id='rowA'").get().net_price_minor, before.net_price_minor);
  assert.equal(raw.prepare("SELECT net_price_minor FROM supplier_quote_lines WHERE source_intake_row_id='rowB'").get().net_price_minor, 9500);
  const prices = raw.prepare("SELECT id,amount_minor,validity_state,downstream_use,terms FROM price_records ORDER BY id").all();
  assert.deepEqual(prices.map(row => [row.amount_minor,row.validity_state,row.downstream_use]), [[9000,"Superseded","Discovery Only"],[9500,"Current","Costing Eligible"]]);
  const provenance = JSON.parse(prices[1].terms);
  assert.equal(provenance.sourceDocumentVersionId, "vB");
  assert.equal(provenance.quotationReference, "Q-100");
  assert.equal(provenance.mappingActorId, "mapper");
  assert.equal(provenance.approvalActorId, "estimator1");
});

test("database-backed approval replay is idempotent", async () => {
  const { raw, DB } = fixture();
  const first = await approve(DB, raw, "rowA", "same-key");
  const second = await approve(DB, raw, "rowA", "same-key");
  assert.equal(first.body.idempotent, false);
  assert.equal(second.body.idempotent, true);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM supplier_quotes").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM supplier_quote_lines").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM price_records").get().count, 1);
});

test("supplier intake candidates reuse canonical matching eligibility", async () => {
  const { raw, DB } = fixture();
  const row = raw.prepare("SELECT * FROM supplier_quote_intake_rows WHERE id='rowA'").get();
  assert.deepEqual((await canonicalSupplierProductCandidates(DB,row)).map(candidate => candidate.productId), ["product1"]);
  raw.prepare("UPDATE library_products SET approved_for_discovery=0 WHERE id='product1'").run();
  assert.deepEqual(await canonicalSupplierProductCandidates(DB,row), []);
  raw.prepare("UPDATE library_products SET approved_for_discovery=1,identity_status='Inactive' WHERE id='product1'").run();
  assert.deepEqual(await canonicalSupplierProductCandidates(DB,row), []);
  raw.prepare("UPDATE library_products SET identity_status='Active',review_status='Rejected' WHERE id='product1'").run();
  assert.deepEqual(await canonicalSupplierProductCandidates(DB,row), []);
  raw.exec("UPDATE library_products SET part_number='2151X',normalized_part_number='2151X',review_status='Reviewed' WHERE id='product1'; INSERT INTO library_products VALUES ('alias1','m1','2151','2151','Alias observation','Active',1,'Reviewed','product1');");
  assert.deepEqual(await canonicalSupplierProductCandidates(DB,row), []);
});
