import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { buildControlledRetryManifest, authorizeControlledRetryRequest, validateControlledRetryRequest, runUnderstandingBatch, handlePerItemRetry, executeRun, TRANSIENT_MODEL_FAILURE_CODES, MAX_PER_ITEM_RETRY_ATTEMPTS } from "../worker/estimator-understanding-api.mjs";

const references = ["27.06.16", "27.06.17", "27.06.10", "26.5.1", "27.01.16", "27.04.04"];
const historical = references.map((itemReference, index) => ({ boqItemId: `item-${index}`, itemReference, status: index === 1 ? "COMPLETED" : index === 4 ? "FAILED" : "NEEDS_REVIEW", inputFingerprint: `old-${index}`, interpretation: index === 4 ? null : JSON.stringify({ confidence: "LOW" }) }));
const current = references.map((itemReference, index) => ({ boqItemId: `item-${index}`, itemNumber: itemReference, sequence: index + 1, rowType: "BOQ Item", description: `Equipment ${index}`, numericQuantity: 1, normalizedUnit: "No", sourceDocumentId: `document-${index}`, evidenceDocumentVersionId: `version-${index}`, evidenceExtractionVersion: 1, sourceLocation: { sheet: "BOQ", row: index + 2 } }));
const quality = { recommendedRetryItemReferences: references };

test("controlled retry manifest resolves exact persisted IDs and fingerprints current evidence",()=>{const manifest=buildControlledRetryManifest("historical-run",quality,historical,current);assert.deepEqual(manifest.itemIds,current.map(row=>row.boqItemId));assert.equal(manifest.itemCount,6);assert.match(manifest.retryFingerprint,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(manifest.items).includes("item-"),false)});
test("controlled retry request rejects missing extra duplicate reordered stale and client-controlled fields",()=>{const manifest=buildControlledRetryManifest("historical-run",quality,historical,current);const valid={mode:"CONTROLLED_RETRY",historicalRunId:"historical-run",retryFingerprint:manifest.retryFingerprint,itemIds:manifest.itemIds};assert.ok(authorizeControlledRetryRequest(valid,manifest).value);for(const body of [{...valid,itemIds:[]},{...valid,itemIds:[...valid.itemIds,"extra"]},{...valid,itemIds:[valid.itemIds[0],...valid.itemIds.slice(0,5)]},{...valid,itemIds:[...valid.itemIds].reverse()},{...valid,retryFingerprint:"stale"},{...valid,model:"forged"}])assert.ok(authorizeControlledRetryRequest(body,manifest).error);assert.ok(validateControlledRetryRequest(null).error)});
test("current document version extraction row and input changes stale the retry fingerprint",()=>{const first=buildControlledRetryManifest("historical-run",quality,historical,current);for(const changed of [{...current[0],evidenceDocumentVersionId:"changed"},{...current[0],evidenceExtractionVersion:2},{...current[0],description:"Changed evidence"}]){const rows=[changed,...current.slice(1)];assert.notEqual(buildControlledRetryManifest("historical-run",quality,historical,rows).retryFingerprint,first.retryFingerprint)}});
test("missing current row and changed recommendation fail closed",()=>{assert.equal(buildControlledRetryManifest("historical-run",quality,historical,current.slice(1)).error,"CONTROLLED_RETRY_EVIDENCE_STALE");assert.equal(buildControlledRetryManifest("historical-run",{recommendedRetryItemReferences:references.slice(0,5)},historical,current).error,"CONTROLLED_RETRY_RECOMMENDATIONS_CHANGED")});
test("partial item failure is isolated and retry output remains understanding-only",async()=>{let calls=0,saves=0;const provider={metadata:{provider:"cloudflare-workers-ai-binding",model:"@cf/meta/llama-3.1-8b-instruct-fast",modelVersion:"8b"},interpret:async()=>{calls+=1;if(calls===2)throw Object.assign(new Error("safe"),{code:"AI_PROVIDER_ERROR"});return {normalizedDescription:{value:"Equipment","origin":"EXTRACTED",confidence:100},confidence:"LOW"}}};const result=await runUnderstandingBatch(current.slice(0,3),{provider,save:async()=>{saves+=1}});assert.equal(result.summary.processed,3);assert.equal(result.summary.failed,1);assert.equal(saves,3);assert.doesNotMatch(JSON.stringify(result),/product_match|pricing|approval|quotation/i)});
test("database unique invariant prevents duplicate controlled retry runs",async()=>{const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE estimator_understanding_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),organization_id TEXT NOT NULL REFERENCES organizations(id),provider TEXT NOT NULL,model TEXT NOT NULL,model_version TEXT NOT NULL,prompt_version TEXT NOT NULL,schema_version TEXT NOT NULL,config_fingerprint TEXT NOT NULL,status TEXT NOT NULL,total_items INTEGER NOT NULL DEFAULT 0,processed_items INTEGER NOT NULL DEFAULT 0,successful_items INTEGER NOT NULL DEFAULT 0,review_items INTEGER NOT NULL DEFAULT 0,failed_items INTEGER NOT NULL DEFAULT 0,requested_by TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT);");db.exec(await readFile(new URL("../drizzle/0059_boq_understanding_controlled_retry.sql",import.meta.url),"utf8"));db.exec("INSERT INTO projects VALUES ('p'); INSERT INTO organizations VALUES ('o'); INSERT INTO users VALUES ('u')");const insert=db.prepare("INSERT INTO estimator_understanding_runs(id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by,run_mode,parent_run_id,authorization_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");insert.run("historical","p","o","cloudflare","8b","8b","p","s","c","COMPLETED","u","CONTROLLED_PILOT",null,null);const args=(id)=>[id,"p","o","cloudflare","8b","8b","p","s","c","PROCESSING","u","CONTROLLED_RETRY","historical","fingerprint"];insert.run(...args("retry-1"));assert.throws(()=>insert.run(...args("retry-2")),/UNIQUE constraint/)});
test("retry source and report cannot persist or expose raw provider material",async()=>{const source=await readFile(new URL("../worker/estimator-understanding-api.mjs",import.meta.url),"utf8");assert.match(source,/JSON\.stringify\(\{ usage: record\.usageMetadata \}\)/);assert.doesNotMatch(source,/raw model output|prompt_json|request_headers|credentials/i);for(const forbidden of ["INSERT INTO product_match","INSERT INTO pricing","INSERT INTO review_decisions","INSERT INTO project_quotation"])assert.doesNotMatch(source,new RegExp(forbidden,"i"))});

// Sprint 1.18 -- per-item retry governance. TRANSIENT_MODEL_FAILURE_CODES
// must exactly track the codes interpretBoqItem itself can actually produce
// on a caught error (boq-understanding-engine.mjs) -- never AI_UNAVAILABLE
// (no provider configured at all, a different, non-retryable state).
test("transient model failure codes match exactly what interpretBoqItem can produce, and exclude AI_UNAVAILABLE",async()=>{const engine=await readFile(new URL("../app/domain/boq-understanding-engine.mjs",import.meta.url),"utf8");for(const code of TRANSIENT_MODEL_FAILURE_CODES)assert.match(engine,new RegExp(code),`interpretBoqItem must be able to produce ${code}`);assert.equal(TRANSIENT_MODEL_FAILURE_CODES.has("AI_UNAVAILABLE"),false);assert.equal(MAX_PER_ITEM_RETRY_ATTEMPTS>0&&MAX_PER_ITEM_RETRY_ATTEMPTS<10,true,"the cap must be a small, deliberate bound, not effectively unlimited")});

const unreachableDb=()=>({DB:{prepare(){throw new Error("no database query should run before this gate")}}});
const requestWithReason=(reason)=>({json:async()=>({reason})});

test("per-item retry requires a substantive reason before touching the database at all",async()=>{
  const response=await handlePerItemRetry(unreachableDb(),{userId:"u"},"p","item-1",requestWithReason("short"));
  assert.equal(response.status,422);
  assert.equal((await response.json()).error.code,"PER_ITEM_RETRY_REASON_REQUIRED");
});

const dbWithLatestInterpretation=(latest)=>({DB:{prepare(sql){
  if(/SELECT \* FROM estimator_item_interpretations WHERE boq_item_id=\? ORDER BY version_number DESC/.test(sql)) return {bind:()=>({first:async()=>latest})};
  throw new Error(`unexpected query for this eligibility-rejection case: ${sql}`);
}}});

test("per-item retry is not eligible when the item has never been interpreted",async()=>{
  const response=await handlePerItemRetry(dbWithLatestInterpretation(null),{userId:"u"},"p","item-1",requestWithReason("a genuine substantive reason"));
  assert.equal(response.status,409);
  assert.equal((await response.json()).error.code,"PER_ITEM_RETRY_NOT_ELIGIBLE");
});

test("per-item retry never applies to a normal approved-or-awaiting-review interpretation, even with a valid reason",async()=>{
  for(const status of ["COMPLETED","NEEDS_REVIEW"]){
    const response=await handlePerItemRetry(dbWithLatestInterpretation({id:"i1",status,error_code:null,run_id:"r1",version_number:1,input_fingerprint:"fp"}),{userId:"u"},"p","item-1",requestWithReason("a genuine substantive reason"));
    assert.equal(response.status,409,status);
    assert.equal((await response.json()).error.code,"PER_ITEM_RETRY_NOT_ELIGIBLE",status);
  }
});

test("per-item retry rejects a FAILED interpretation whose error code is not a recognized transient model-output failure",async()=>{
  const response=await handlePerItemRetry(dbWithLatestInterpretation({id:"i1",status:"FAILED",error_code:"SOME_OTHER_FAILURE",run_id:"r1",version_number:1,input_fingerprint:"fp"}),{userId:"u"},"p","item-1",requestWithReason("a genuine substantive reason"));
  assert.equal(response.status,409);
  assert.equal((await response.json()).error.code,"PER_ITEM_RETRY_NOT_ELIGIBLE");
});

// Fire Alarm E2E fix (evidence/config-aware pilot fairness) -- real Central
// Kitchen - Makkah gap: an item whose evidence reverted to a fingerprint an
// OLDER (no-longer-latest) attempt already recorded must become eligible
// for the pilot MANIFEST again (see alreadyInterpretedItemIds in
// worker/estimator-understanding-api.mjs) so it can compete for a fresh
// governed attempt. executeRun's own `existing()` reuse-check deliberately
// keeps matching ANY historical attempt sharing the current
// (input_fingerprint, config_fingerprint) pair -- not just the item's own
// latest -- because estimator_item_interpretations has a real, load-bearing
// UNIQUE(boq_item_id, input_fingerprint, config_fingerprint) constraint: a
// fresh save() for a pair that already exists on an older, non-latest row
// would fail the database outright, not merely waste an attempt. This
// proves that safety property end to end: even when the ONLY matching row
// is not the item's latest attempt, executeRun still safely reuses it
// (never re-attempts, never crashes) rather than trying -- and failing -- to
// insert a duplicate.
test("Fire Alarm E2E fix -- executeRun safely reuses a matching (fingerprint, config) row even when it is not the item's own latest attempt, never attempting a colliding fresh save", async () => {
  const { prepareBoqUnderstandingInput, interpretationInputFingerprint, interpretationConfigFingerprint } = await import("../app/domain/boq-understanding-engine.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=OFF;");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE organizations(id TEXT PRIMARY KEY);");
  db.exec(await readFile(new URL("../drizzle/0052_boq_item_understanding.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../drizzle/0059_boq_understanding_controlled_retry.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE boq_requirement_links(boq_item_id TEXT, project_id TEXT, status TEXT, superseded_at TEXT, requirement_id TEXT);");
  db.exec("CREATE TABLE technical_requirements(id TEXT, normalized_requirement TEXT, source_location TEXT, approved_for_downstream INTEGER, review_status TEXT);");
  db.exec("CREATE TABLE boq_items(id TEXT PRIMARY KEY, sequence INTEGER, item_number TEXT, row_type TEXT, description TEXT, numeric_quantity INTEGER, original_quantity INTEGER, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT); INSERT INTO boq_items(id, sequence, item_number, row_type, description) VALUES ('boq-x', 1, '1', 'BOQ Item', 'Test widget');");
  db.exec("INSERT INTO projects VALUES ('p'); INSERT INTO organizations VALUES ('o');");

  const boqRow = { boqItemId: "boq-x", itemNumber: "1", sequence: 1, rowType: "BOQ Item", description: "Test widget", numericQuantity: 1, normalizedUnit: "No", sourceDocumentId: "doc-1", evidenceDocumentVersionId: "dv-1", evidenceExtractionVersion: 1, sourceLocation: { sheet: "BOQ", row: 2 } };
  const noProviderMetadata = { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" };
  const currentInputFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(boqRow, []));
  const currentConfigFingerprint = interpretationConfigFingerprint(noProviderMetadata);

  db.exec(`INSERT INTO estimator_understanding_runs(id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by) VALUES ('run-0','p','o','x','x','x','x','x','x','COMPLETED','u')`);
  const insertInterp = db.prepare("INSERT INTO estimator_item_interpretations(id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  // An OLDER attempt (v1, NOT the latest) coincidentally shares the exact
  // fingerprint+config a fresh run would compute right now -- e.g. evidence
  // that changed and then reverted.
  insertInterp.run("i1", "run-0", "p", "boq-x", 1, currentInputFingerprint, currentConfigFingerprint, "x", "x", "x", "x", "x", "NEEDS_REVIEW", "u");
  // The item's real LATEST attempt (v2) was made under DIFFERENT evidence.
  insertInterp.run("i2", "run-0", "p", "boq-x", 2, "different-evidence-fingerprint", currentConfigFingerprint, "x", "x", "x", "x", "x", "NEEDS_REVIEW", "u");

  const d1 = {
    prepare(sql) {
      const operation = (values = []) => ({
        first: async () => db.prepare(sql).get(...values) || null,
        all: async () => ({ results: db.prepare(sql).all(...values) }),
        run: async () => db.prepare(sql).run(...values),
      });
      return { ...operation(), bind: (...values) => operation(values) };
    },
  };
  const env = { DB: d1 };
  const result = await executeRun(env, { userId: "u", organizationId: "o" }, "p", [boqRow]);
  assert.notEqual(result.status, "FAILED", "must never crash on a UNIQUE constraint collision");
  assert.equal(result.summary.reused, 1, "a matching (fingerprint, config) pair anywhere in the item's history is safely reused, never re-attempted");
  const versions = db.prepare("SELECT version_number FROM estimator_item_interpretations WHERE boq_item_id='boq-x'").all();
  assert.equal(versions.length, 2, "no new (colliding) row is inserted");
});

test("Fire Alarm E2E fix -- executeRun genuinely reuses (no new row, no AI call) when the matching (fingerprint, config) row IS the item's own latest attempt", async () => {
  const { prepareBoqUnderstandingInput, interpretationInputFingerprint, interpretationConfigFingerprint } = await import("../app/domain/boq-understanding-engine.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=OFF;");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE organizations(id TEXT PRIMARY KEY);");
  db.exec(await readFile(new URL("../drizzle/0052_boq_item_understanding.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../drizzle/0059_boq_understanding_controlled_retry.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE boq_requirement_links(boq_item_id TEXT, project_id TEXT, status TEXT, superseded_at TEXT, requirement_id TEXT);");
  db.exec("CREATE TABLE technical_requirements(id TEXT, normalized_requirement TEXT, source_location TEXT, approved_for_downstream INTEGER, review_status TEXT);");
  db.exec("CREATE TABLE boq_items(id TEXT PRIMARY KEY, sequence INTEGER, item_number TEXT, row_type TEXT, description TEXT, numeric_quantity INTEGER, original_quantity INTEGER, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT); INSERT INTO boq_items(id, sequence, item_number, row_type, description) VALUES ('boq-x', 1, '1', 'BOQ Item', 'Test widget');");
  db.exec("INSERT INTO projects VALUES ('p'); INSERT INTO organizations VALUES ('o');");

  const boqRow = { boqItemId: "boq-x", itemNumber: "1", sequence: 1, rowType: "BOQ Item", description: "Test widget", numericQuantity: 1, normalizedUnit: "No", sourceDocumentId: "doc-1", evidenceDocumentVersionId: "dv-1", evidenceExtractionVersion: 1, sourceLocation: { sheet: "BOQ", row: 2 } };
  const noProviderMetadata = { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" };
  const currentInputFingerprint = interpretationInputFingerprint(prepareBoqUnderstandingInput(boqRow, []));
  const currentConfigFingerprint = interpretationConfigFingerprint(noProviderMetadata);

  db.exec(`INSERT INTO estimator_understanding_runs(id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by) VALUES ('run-0','p','o','x','x','x','x','x','x','COMPLETED','u')`);
  const insertInterp = db.prepare("INSERT INTO estimator_item_interpretations(id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  // The item's real LATEST (and only) attempt already reflects exactly the
  // current evidence and config -- nothing has changed.
  insertInterp.run("i1", "run-0", "p", "boq-x", 1, currentInputFingerprint, currentConfigFingerprint, "x", "x", "x", "x", "x", "NEEDS_REVIEW", "u");

  const d1 = {
    prepare(sql) {
      const operation = (values = []) => ({
        first: async () => db.prepare(sql).get(...values) || null,
        all: async () => ({ results: db.prepare(sql).all(...values) }),
        run: async () => db.prepare(sql).run(...values),
      });
      return { ...operation(), bind: (...values) => operation(values) };
    },
  };
  const env = { DB: d1 };
  const result = await executeRun(env, { userId: "u", organizationId: "o" }, "p", [boqRow]);
  assert.equal(result.summary.reused, 1, "identical input and config against the item's own latest attempt must still be reused, not re-attempted");
  const versions = db.prepare("SELECT version_number FROM estimator_item_interpretations WHERE boq_item_id='boq-x'").all();
  assert.equal(versions.length, 1, "no new row is created when the item's own latest attempt already covers the current evidence and config");
});
