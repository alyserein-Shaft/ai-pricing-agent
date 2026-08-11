import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { identityExecutableChecksum, identityRulesetDocument } from "../app/domain/identity-resolution-engine.mjs";
import { resolveCanonicalProduct } from "../worker/canonical-product-resolver.mjs";
import { assertIdentitySchemaCompatibility, assertNoDownstreamDependencies, evidenceIntegrityValues, loadVerifiedCanonicalEvidence, sealMoveManifest, verifySealedManifest } from "../worker/identity-production-governance.mjs";

const d1 = (raw) => ({ prepare(sql) { const op = (args=[]) => ({ first: async()=>raw.prepare(sql).get(...args), all: async()=>({ results: raw.prepare(sql).all(...args) }), run: async()=>raw.prepare(sql).run(...args) }); return { ...op(), bind(...args) { return op(args); } }; } });
const productSchema = `
CREATE TABLE product_manufacturers(id text primary key,name text); CREATE TABLE product_brands(id text primary key,name text); CREATE TABLE product_families(id text primary key,name text);
CREATE TABLE library_products(id text primary key,manufacturer_id text,brand_id text,family_id text,identity_status text,superseded_by_product_id text,identity_version integer);
INSERT INTO product_manufacturers VALUES ('m','Honeywell'); INSERT INTO product_brands VALUES ('b','Farenhyt');
`;

test("canonical resolver resolves active, superseded and historical identities and rejects cycles", async () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(productSchema); raw.exec("INSERT INTO library_products VALUES ('active','m','b',NULL,'Active',NULL,2),('old','m','b',NULL,'Superseded','active',3)"); const db=d1(raw);
  assert.equal((await resolveCanonicalProduct(db,"active")).canonicalProductId,"active");
  const old=await resolveCanonicalProduct(db,"old"); assert.equal(old.canonicalProductId,"active"); assert.equal(old.historical.length,2);
  raw.exec("UPDATE library_products SET identity_status='Superseded',superseded_by_product_id='old' WHERE id='active'");
  await assert.rejects(()=>resolveCanonicalProduct(db,"old"),(error)=>error.code==="CANONICAL_PRODUCT_CYCLE"); raw.close();
});

test("canonical evidence verifies immutable row, source, owner and fingerprint", async () => {
  const raw=new DatabaseSync(":memory:"); raw.exec("CREATE TABLE product_sources(id text primary key,checksum text); CREATE TABLE product_source_evidence(id text primary key,product_id text,source_id text,sheet text,row_number integer,page integer,cells text,original_text text,parser_version text,created_at text); CREATE TABLE canonical_evidence_integrity(evidence_id text primary key,row_checksum text,source_checksum text,evidence_fingerprint text,original_product_id text); CREATE TABLE identity_reference_moves(id text,decision_id text,table_name text,record_id text,from_product_id text,to_product_id text); CREATE TABLE governed_identity_decisions(id text,decision_type text,reversal_of_id text); INSERT INTO product_sources VALUES ('s','source-sha'); INSERT INTO product_source_evidence VALUES ('e','p','s','Sheet1',1,NULL,'[]','MODEL','v1','now')");
  const row=raw.prepare("SELECT * FROM product_source_evidence WHERE id='e'").get(), values=await evidenceIntegrityValues(row,"source-sha"); raw.prepare("INSERT INTO canonical_evidence_integrity VALUES ('e',?,?,?,'p')").run(values.rowChecksum,values.sourceChecksum,values.evidenceFingerprint);
  assert.equal((await loadVerifiedCanonicalEvidence(d1(raw),["p"])).length,1);
  raw.prepare("UPDATE product_source_evidence SET cells='[\"tampered\"]' WHERE id='e'").run();
  await assert.rejects(()=>loadVerifiedCanonicalEvidence(d1(raw),["p"]),(error)=>error.code==="IDENTITY_EVIDENCE_MISMATCH"); raw.close();
});

test("sealed manifests reject row, ownership, table and checksum tampering", async () => {
  const manifest=[{table:"price_records",recordId:"r1",fromProductId:"old",toProductId:"active",referenceVersionBefore:1,snapshot:{id:"r1",product_id:"old",amount_minor:100}}]; const seal=await sealMoveManifest(manifest);
  const decision={reference_move_manifest_json:JSON.stringify(manifest),manifest_checksum:seal.manifestChecksum,manifest_row_count:seal.rowCount,manifest_ownership_checksum:seal.ownershipChecksum,manifest_table_checksum:seal.tableChecksum};
  const moves=[{table_name:"price_records",record_id:"r1",from_product_id:"old",to_product_id:"active",record_snapshot_json:JSON.stringify(manifest[0].snapshot)}];
  assert.deepEqual(await verifySealedManifest(decision,moves),seal);
  moves[0].to_product_id="other"; await assert.rejects(()=>verifySealedManifest(decision,moves),(error)=>error.code==="IDENTITY_MANIFEST_MISMATCH");
});

test("registered downstream matching dependencies block reversal", async () => {
  const raw=new DatabaseSync(":memory:"); raw.exec("CREATE TABLE identity_dependency_providers(provider_id text,module_name text,table_name text,product_column text,candidate_table text,candidate_column text,strategy text,enabled integer); CREATE TABLE product_match_candidates(id text,product_id text); INSERT INTO identity_dependency_providers VALUES ('matching','Matching','product_match_candidates','product_id',NULL,NULL,'DIRECT',1); INSERT INTO product_match_candidates VALUES ('c','p1')");
  await assert.rejects(()=>assertNoDownstreamDependencies(d1(raw),["p1","p2"]),(error)=>error.code==="IDENTITY_REVERSAL_DEPENDENCY"&&error.details.blockers[0].module==="Matching"); raw.close();
});

test("schema and executable ruleset integrity fail closed without changing legacy checksum", async () => {
  const raw=new DatabaseSync(":memory:"); raw.exec("CREATE TABLE identity_schema_compatibility(component text,schema_version integer,minimum_worker_version integer,maximum_worker_version integer); INSERT INTO identity_schema_compatibility VALUES ('Identity Resolution',23,23,23)");
  assert.equal((await assertIdentitySchemaCompatibility(d1(raw))).schema_version,23); raw.exec("UPDATE identity_schema_compatibility SET schema_version=24"); await assert.rejects(()=>assertIdentitySchemaCompatibility(d1(raw)),(error)=>error.code==="IDENTITY_SCHEMA_INCOMPATIBLE");
  const ruleset=await identityRulesetDocument(); assert.equal(ruleset.executableChecksum,await identityExecutableChecksum()); assert.match(ruleset.checksum,/^[a-f0-9]{64}$/); raw.close();
});

test("canonical resolver handles 10,000 products and concurrent resolution load", async () => {
  const raw=new DatabaseSync(":memory:"); raw.exec(productSchema); const insert=raw.prepare("INSERT INTO library_products VALUES (?,'m','b',NULL,'Active',NULL,1)"); raw.exec("BEGIN"); for(let i=0;i<10000;i++) insert.run(`p${i}`); raw.exec("COMMIT"); const db=d1(raw), started=performance.now();
  const results=await Promise.all(Array.from({length:200},(_,i)=>resolveCanonicalProduct(db,`p${i*49}`))); assert.equal(results.length,200); assert.ok(performance.now()-started<2000); raw.close();
});
