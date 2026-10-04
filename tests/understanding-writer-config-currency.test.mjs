/**
 * MVP-CLOSE-5 — write-side currentness for the two automatic Understanding writers.
 *
 * THE DEFECT THIS FILE PINS
 * -------------------------
 * applyUnderstandingSystemAutoApproval and applyUnderstandingSystemFieldAutoApproval
 * resolved their row with loadUnderstandingReviewRows(db, projectId) -- no
 * currentConfigFingerprint. The resolver treats a null config fingerprint as
 * "no configuration context" and skips config currency entirely, so both writers
 * silently wrote governance records bound to an interpretation produced under a
 * GENUINELY OBSOLETE configuration -- byte-identical output to the
 * current-config case. The config-aware reader called the very same row
 * UNAVAILABLE_OR_STALE / REVALIDATION_REQUIRED.
 *
 * The pure approval policy was never at fault: Gate 1 of
 * evaluateUnderstandingSystemAutoApproval already refuses
 * `proposalState !== "AVAILABLE"`. It was handed a row whose state had been
 * computed with currentness checking switched off.
 *
 * Contract exercised here:
 *   1. a plain current-config interpretation is eligible
 *   2. an authorized retry of the CURRENT base is eligible (shared predicate)
 *   3. a genuinely obsolete base configuration is NOT
 *   4. wrong / missing / mismatched retry metadata is NOT
 *   5. a changed input fingerprint is NOT
 *   6. an idempotent repeat stays a no-op and creates no second decision
 *   7. a newest FAILED attempt must NOT be evaded by approving an older success
 *   8. a caller supplying no configuration context is refused explicitly
 *
 * Fixture: tests/fixtures/active-chain-fixture.mjs applies the REAL ordered
 * drizzle-active chain, so seeds satisfy the real NOT NULL / FK / TRIGGER
 * constraints. :memory: only; no live data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import {
  applyUnderstandingSystemAutoApproval,
  applyUnderstandingSystemFieldAutoApproval,
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
} from "../worker/estimator-understanding-review-api.mjs";
import {
  prepareBoqUnderstandingInput,
  interpretationInputFingerprint,
  interpretationConfigFingerprint,
  stableStringify,
  validateAndMergeBoqInterpretation,
} from "../app/domain/boq-understanding-engine.mjs";

const PROJECT_ID = "p-writer-currency";
const ORG = "o-writer-currency";
const METADATA = { provider: "cloudflare-workers-ai-binding", model: "@cf/meta/llama-3.1-8b-instruct-fast", modelVersion: "@cf/meta/llama-3.1-8b-instruct-fast" };
const CURRENT_CONFIG = interpretationConfigFingerprint(METADATA);
const OBSOLETE_CONFIG = interpretationConfigFingerprint({ ...METADATA, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });

// The on-disk retry construction, built WITHOUT the helper under test.
const rawMix = (base, authorizationFingerprint) =>
  createHash("sha256").update(stableStringify({ baseConfigFingerprint: base, authorizationFingerprint })).digest("hex");
const auth = (seed) => createHash("sha256").update(`writer-authorization:${seed}`).digest("hex");

const QTY = "9";
const LOC = { sheet: "BOQ", row: 15 };
const DESC = "Heat detector";

// The real approval-eligible proposal shape (Fire Alarm / Detection Devices /
// Heat Detector, detector_technology the only non-null attribute, EXTRACTED).
const response = () => ({
  normalizedDescription: { value: "Heat detector", origin: "EXTRACTED", confidence: 100 },
  taxonomyCandidateKey: { value: "FA-1", origin: "INFERRED", confidence: 70 },
  system: { value: "Fire Alarm", origin: "INFERRED", confidence: 70 },
  category: { value: "Detection Devices", origin: "INFERRED", confidence: 70 },
  equipmentType: { value: "Heat Detector", origin: "EXTRACTED", confidence: 100 },
  productFamily: { value: "Heat Detector", origin: "INFERRED", confidence: 70 },
  technicalAttributes: [{ name: "detector_technology", value: "heat detector", origin: "EXTRACTED", confidence: 100 }],
  standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], confidence: "LOW",
});

const build = () => {
  const database = activeChainDatabase();
  const db = d1(database);
  database.exec(`
    INSERT INTO organizations (id,name) VALUES ('${ORG}','Writer Currency Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${PROJECT_ID}','Writer Currency','owner1','${ORG}');
    INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('doc1','${PROJECT_ID}','boq.xlsx','owner1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('dv1','doc1',1,'boq.xlsx','boq.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','k','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','pv','rv','ov','owner1');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by)
      VALUES ('spec-ext1','doc1','dv1',1,'Completed','pv','rv','mv','pv','ov','owner1');
  `);
  const ITEM = "boq-1";
  database.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,'${PROJECT_ID}','BOQ Item','ext1','doc1',15,'C',?,?,?,'Each','Each','Fire Alarm',NULL,NULL,NULL,NULL,NULL,'[]','{}',?,'[]','Approved',1,NULL,95,60,'High Confidence')`).run(ITEM, DESC, QTY, QTY, JSON.stringify(LOC));

  const input = prepareBoqUnderstandingInput({ id: ITEM, rowType: "BOQ Item", description: DESC, numericQuantity: QTY, originalQuantity: QTY, normalizedUnit: "Each", originalUnit: "Each", system: "Fire Alarm", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: LOC }, []);
  const inputFingerprint = interpretationInputFingerprint(input);
  const merged = validateAndMergeBoqInterpretation(input, response());
  const payload = JSON.stringify(merged.interpretation);

  const run = (id, { configFingerprint, mode = "CONTROLLED_PILOT", authorizationFingerprint = null, parentRunId = null }) =>
    database.prepare(`INSERT INTO estimator_understanding_runs (id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by,started_at,run_mode,parent_run_id,authorization_fingerprint)
      VALUES (?,?,?,'x','x','x','p','s',?,'COMPLETED','o',CURRENT_TIMESTAMP,?,?,?)`).run(id, PROJECT_ID, ORG, configFingerprint, mode, parentRunId, authorizationFingerprint);

  const interp = (id, runId, version, { configFingerprint = CURRENT_CONFIG, status = merged.status, errorCode = null, inputFingerprint: ifp = inputFingerprint } = {}) =>
    database.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
      VALUES (?,?,'${runId}',?,?,?,?,'x','x','x','p','s',?,?,?,NULL,'o',CURRENT_TIMESTAMP)`).run(id, ITEM, PROJECT_ID, version, ifp, configFingerprint, status, status === "FAILED" ? null : payload, errorCode);

  return { database, db, ITEM, run, interp, inputFingerprint, merged, payload };
};

const reviewCount = (database, ITEM) => database.prepare("SELECT COUNT(*) c FROM estimator_understanding_review_versions WHERE boq_item_id=?").get(ITEM).c;
const fieldCount = (database, ITEM) => database.prepare("SELECT COUNT(*) c FROM estimator_understanding_field_reviews WHERE boq_item_id=?").get(ITEM).c;

// ── 1. plain current configuration ────────────────────────────────────────────
test("1. both writers accept a plain CURRENT-config interpretation", async () => {
  const { database, db, ITEM, run, interp } = build();
  run("run-a", { configFingerprint: CURRENT_CONFIG });
  interp("interp-a", "run-a", 1, { configFingerprint: CURRENT_CONFIG });

  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, true, JSON.stringify(auto.policy?.reasons || auto.error));
  assert.equal(auto.result.review.status, "APPROVED");
  assert.equal(reviewCount(database, ITEM), 1);

  // field writer: a fresh item, so WHOLE_BLOB_ALREADY_APPROVED does not mask it
  const b = build();
  b.run("run-b", { configFingerprint: CURRENT_CONFIG });
  b.interp("interp-b", "run-b", 1, { configFingerprint: CURRENT_CONFIG });
  const field = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(field.applied, true, JSON.stringify(field.code));
  assert.equal(field.confirmedFields, 3);
  assert.equal(fieldCount(b.database, b.ITEM), 3);
});

// ── 2. valid authorized retry of the current base ─────────────────────────────
test("2. both writers accept a valid authorized retry of the CURRENT base configuration", async () => {
  const a = auth("valid");
  const { db, ITEM, run, interp } = build();
  run("run-p", { configFingerprint: CURRENT_CONFIG });
  interp("interp-p2", "run-p", 2, { status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  run("run-r", { configFingerprint: rawMix(CURRENT_CONFIG, a), mode: "PER_ITEM_RETRY", authorizationFingerprint: a, parentRunId: "run-p" });
  interp("interp-r3", "run-r", 3, { configFingerprint: rawMix(CURRENT_CONFIG, a) });

  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, true, JSON.stringify(auto.policy?.reasons || auto.error));

  const b = build();
  const bAuth = auth("valid-field");
  b.run("run-p", { configFingerprint: CURRENT_CONFIG });
  b.interp("interp-p2", "run-p", 2, { status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  b.run("run-r", { configFingerprint: rawMix(CURRENT_CONFIG, bAuth), mode: "PER_ITEM_RETRY", authorizationFingerprint: bAuth, parentRunId: "run-p" });
  b.interp("interp-r3", "run-r", 3, { configFingerprint: rawMix(CURRENT_CONFIG, bAuth) });
  const field = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(field.applied, true, JSON.stringify(field.code));
});

// ── 3. genuinely obsolete base configuration ──────────────────────────────────
test("3. both writers REFUSE a genuinely obsolete base configuration", async () => {
  const { database, db, ITEM, run, interp } = build();
  run("run-old", { configFingerprint: OBSOLETE_CONFIG });
  interp("interp-old", "run-old", 1, { configFingerprint: OBSOLETE_CONFIG });

  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, false, "an obsolete-config interpretation must never be auto-approved");
  assert.equal(reviewCount(database, ITEM), 0, "no approval may be written");

  const b = build();
  b.run("run-old", { configFingerprint: OBSOLETE_CONFIG });
  b.interp("interp-old", "run-old", 1, { configFingerprint: OBSOLETE_CONFIG });
  const field = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(field.applied, false);
  assert.equal(fieldCount(b.database, b.ITEM), 0, "no field confirmation may be written");
});

test("3b. an otherwise-valid retry under an OBSOLETE base is still refused", async () => {
  const a = auth("obsolete-base");
  const { database, db, ITEM, run, interp } = build();
  run("run-p", { configFingerprint: OBSOLETE_CONFIG });
  interp("interp-p", "run-p", 1, { configFingerprint: OBSOLETE_CONFIG });
  run("run-r", { configFingerprint: rawMix(OBSOLETE_CONFIG, a), mode: "PER_ITEM_RETRY", authorizationFingerprint: a, parentRunId: "run-p" });
  interp("interp-r", "run-r", 2, { configFingerprint: rawMix(OBSOLETE_CONFIG, a) });

  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, false, "retry metadata must not launder an obsolete base configuration");
  assert.equal(reviewCount(database, ITEM), 0);
});

// ── 4. wrong / missing / mismatched retry metadata ────────────────────────────
test("4. both writers REFUSE wrong, missing and mismatched retry metadata", async () => {
  const scenarios = [
    { label: "wrong authorization on the run", storedAuth: auth("real"), persistedAuth: auth("forged") },
    { label: "no authorization at all", storedAuth: auth("real"), persistedAuth: null },
    { label: "empty authorization", storedAuth: auth("real"), persistedAuth: "" },
  ];
  for (const { label, storedAuth, persistedAuth } of scenarios) {
    const { database, db, ITEM, run, interp } = build();
    run("run-p", { configFingerprint: CURRENT_CONFIG });
    interp("interp-p2", "run-p", 2, { status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
    run("run-r", { configFingerprint: rawMix(CURRENT_CONFIG, storedAuth), mode: "PER_ITEM_RETRY", authorizationFingerprint: persistedAuth, parentRunId: "run-p" });
    interp("interp-r3", "run-r", 3, { configFingerprint: rawMix(CURRENT_CONFIG, storedAuth) });

    const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
    assert.equal(auto.applied, false, `whole-blob writer must refuse: ${label}`);
    assert.equal(reviewCount(database, ITEM), 0, `no approval written: ${label}`);
  }
});

// ── 5. changed input fingerprint ──────────────────────────────────────────────
test("5. both writers REFUSE once new Confirmed evidence changes the input fingerprint", async () => {
  const { database, db, ITEM, run, interp } = build();
  run("run-a", { configFingerprint: CURRENT_CONFIG });
  interp("interp-a", "run-a", 1, { configFingerprint: CURRENT_CONFIG });

  database.prepare(`INSERT INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream)
    VALUES ('req-w','spec-ext1','${PROJECT_ID}','doc1',1,'heat detectors','heat detectors shall be individually addressable','Fire Alarm','Specification','Mandatory','Documentation',90,'High Confidence','Approved','Explicit specification wording','pv','mv','{"page":30,"clause":"A"}','[]','{}',1)`).run();
  database.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_id,created_by)
    VALUES ('link-w','${PROJECT_ID}','${ITEM}','req-w','Human-confirmed knowledge link',90,'[]','Confirmed','${ITEM}','owner1')`).run();

  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, false, "an input change must invalidate the prior interpretation");
  assert.equal(reviewCount(database, ITEM), 0);

  const b = build();
  b.run("run-b", { configFingerprint: CURRENT_CONFIG });
  b.interp("interp-b", "run-b", 1, { configFingerprint: CURRENT_CONFIG });
  b.database.prepare(`INSERT INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream)
    VALUES ('req-w2','spec-ext1','${PROJECT_ID}','doc1',1,'heat detectors','heat detectors shall be individually addressable','Fire Alarm','Specification','Mandatory','Documentation',90,'High Confidence','Approved','Explicit specification wording','pv','mv','{"page":30,"clause":"A"}','[]','{}',1)`).run();
  b.database.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_id,created_by)
    VALUES ('link-w2','${PROJECT_ID}','${b.ITEM}','req-w2','Human-confirmed knowledge link',90,'[]','Confirmed','${b.ITEM}','owner1')`).run();
  const field = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(field.applied, false);
  assert.equal(fieldCount(b.database, b.ITEM), 0);
});

// ── 6. idempotent repeat ──────────────────────────────────────────────────────
test("6. an idempotent repeat creates no second decision", async () => {
  const { database, db, ITEM, run, interp } = build();
  run("run-a", { configFingerprint: CURRENT_CONFIG });
  interp("interp-a", "run-a", 1, { configFingerprint: CURRENT_CONFIG });

  const first = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(first.applied, true);
  const second = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(reviewCount(database, ITEM), 1, "a repeat must never duplicate the decision");
  assert.notEqual(second.applied, true, "a repeat must not report a second applied approval");

  const b = build();
  b.run("run-b", { configFingerprint: CURRENT_CONFIG });
  b.interp("interp-b", "run-b", 1, { configFingerprint: CURRENT_CONFIG });
  const f1 = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(f1.applied, true);
  const f2 = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(fieldCount(b.database, b.ITEM), 3, "a repeated field confirmation is a safe no-op");
  assert.ok(f2.results.every((entry) => entry.idempotent === true), "the repeat must be reported as idempotent");
});

// ── 7. newest FAILED attempt must not be evaded ───────────────────────────────
test("7. both writers REFUSE when the newest current attempt FAILED, instead of approving an older success", async () => {
  const a = auth("latest-failed");
  const { database, db, ITEM, run, interp } = build();
  run("run-p", { configFingerprint: CURRENT_CONFIG });
  interp("interp-ok", "run-p", 1, { configFingerprint: CURRENT_CONFIG });
  run("run-r", { configFingerprint: rawMix(CURRENT_CONFIG, a), mode: "PER_ITEM_RETRY", authorizationFingerprint: a, parentRunId: "run-p" });
  interp("interp-bad", "run-r", 2, { configFingerprint: rawMix(CURRENT_CONFIG, a), status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });

  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, false, "must not silently choose the older success to evade the current failure");
  assert.equal(reviewCount(database, ITEM), 0);

  const b = build();
  const bAuth = auth("latest-failed-field");
  b.run("run-p", { configFingerprint: CURRENT_CONFIG });
  b.interp("interp-ok", "run-p", 1, { configFingerprint: CURRENT_CONFIG });
  b.run("run-r", { configFingerprint: rawMix(CURRENT_CONFIG, bAuth), mode: "PER_ITEM_RETRY", authorizationFingerprint: bAuth, parentRunId: "run-p" });
  b.interp("interp-bad", "run-r", 2, { configFingerprint: rawMix(CURRENT_CONFIG, bAuth), status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  const field = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, CURRENT_CONFIG);
  assert.equal(field.applied, false);
  assert.equal(fieldCount(b.database, b.ITEM), 0);
});

// ── 8. no configuration context is an explicit refusal ────────────────────────
test("8. both writers refuse EXPLICITLY when no configuration context is supplied", async () => {
  const { database, db, ITEM, run, interp } = build();
  run("run-a", { configFingerprint: CURRENT_CONFIG });
  interp("interp-a", "run-a", 1, { configFingerprint: CURRENT_CONFIG });

  for (const supplied of [undefined, null, ""]) {
    const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, supplied);
    assert.equal(auto.applied, false);
    assert.equal(auto.error, "UNDERSTANDING_CONFIG_CONTEXT_REQUIRED", "missing config must be an explicit refusal, never a silent opt-out");
  }
  assert.equal(reviewCount(database, ITEM), 0);

  const b = build();
  b.run("run-b", { configFingerprint: CURRENT_CONFIG });
  b.interp("interp-b", "run-b", 1, { configFingerprint: CURRENT_CONFIG });
  for (const supplied of [undefined, null, ""]) {
    const field = await applyUnderstandingSystemFieldAutoApproval(b.db, PROJECT_ID, b.ITEM, supplied);
    assert.equal(field.applied, false);
    assert.equal(field.code, "UNDERSTANDING_CONFIG_CONTEXT_REQUIRED");
  }
  assert.equal(fieldCount(b.database, b.ITEM), 0);
});

// ── preservation: whole-blob precedence and restricted field keys ─────────────
test("9. whole-blob precedence and the restricted field key set are preserved", async () => {
  const { database, db, ITEM, run, interp } = build();
  run("run-a", { configFingerprint: CURRENT_CONFIG });
  interp("interp-a", "run-a", 1, { configFingerprint: CURRENT_CONFIG });
  const auto = await applyUnderstandingSystemAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(auto.applied, true);

  // field writer must still refuse once a whole-blob approval exists
  const field = await applyUnderstandingSystemFieldAutoApproval(db, PROJECT_ID, ITEM, CURRENT_CONFIG);
  assert.equal(field.applied, false);
  assert.equal(field.code, "WHOLE_BLOB_ALREADY_APPROVED");
  assert.equal(fieldCount(database, ITEM), 0);

  // and the approval is genuinely current for a config-aware reader
  const row = (await loadUnderstandingReviewRows(db, PROJECT_ID, { currentConfigFingerprint: CURRENT_CONFIG })).find((r) => r.boqItemId === ITEM);
  assert.equal(safeUnderstandingReviewItem(row).review.status, "APPROVED",
    "a freshly written approval must read as APPROVED to the canonical reader, not REVALIDATION_REQUIRED");
});
