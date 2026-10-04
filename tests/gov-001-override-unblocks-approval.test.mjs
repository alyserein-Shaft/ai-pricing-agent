import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { handleConfidenceSafetyApi } from "../worker/confidence-safety-api.mjs";

// GOV-001 -- a governed, APPROVED safety override must actually unblock the
// technical approval it is documented to unblock.
//
// Stage 4D resolves a Fire Alarm BOQ line whose engineering dossier cannot be
// closed deterministically to ENGINEER_EXCEPTION. That block is `overridable`
// and confidence-safety-engine.mjs documents exactly one escape hatch for it:
// "the EXISTING governed safety_override path". An approved override does flip
// the block row to 'Overridden' (POST /api/safety/overrides/:id/decide), but the
// approval gate ALSO required /^Eligible/ on the decision's technical_eligibility
// -- a string frozen at evaluation time that still read "Technical Approval
// Disabled". The override was therefore permanently inert: a recorded, approved,
// authorised engineer exception could never be used, and re-evaluating recomputes
// the identical block, so the line was permanently unquotable. Golden E2E proved
// it: PRODUCT_MATCHING ran, safety approval returned 409 APPROVAL_BLOCKED
// forever, with no governed path forward.
//
// The guard pins BOTH directions: the override unblocks, and it still fails
// closed for an open block and for a non-overridable ("Blocked") decision.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
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
CREATE TABLE project_members(project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT, logical_name TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL,scope_id TEXT,supersession_type TEXT NOT NULL,effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL);
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE boq_items(id TEXT PRIMARY KEY, project_id TEXT, row_type TEXT, extraction_version_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, numeric_quantity REAL, original_quantity REAL, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT, review_status TEXT, approved_for_downstream INTEGER, specification_reference TEXT, system_confidence INTEGER, extraction_confidence INTEGER);
CREATE TABLE product_manufacturers(id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT, status TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE library_products(id TEXT PRIMARY KEY, manufacturer_id TEXT, brand_id TEXT, family_id TEXT, part_number TEXT, normalized_part_number TEXT, description TEXT, lifecycle_status TEXT, country_of_origin TEXT, attributes TEXT, standards TEXT, review_status TEXT, approved_for_discovery INTEGER, identity_status TEXT, superseded_by_product_id TEXT, identity_version INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE VIEW canonical_library_products AS
  SELECT id AS requested_product_id, p.* FROM library_products p WHERE p.identity_status<>'Superseded';
CREATE TABLE requirement_profile_versions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, version_number INTEGER, profile TEXT, confidence_summary TEXT, readiness_status TEXT, superseded_at TEXT);
CREATE TABLE product_match_runs(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, search_stage TEXT, score INTEGER, score_components TEXT, technical_status TEXT, recommendation_tier TEXT, confidence_state TEXT, confidence_score INTEGER, matching_basis TEXT, commercial_availability TEXT, explanation TEXT, mandatory_failures TEXT, lifecycle_result TEXT, review_status TEXT);
CREATE TABLE price_records(id TEXT PRIMARY KEY, product_id TEXT, project_id TEXT, approval_status TEXT, valid_until TEXT, currency TEXT);
CREATE TABLE safety_decisions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, candidate_id TEXT, requirement_profile_version_id TEXT, match_run_id TEXT, version_number INTEGER, input_fingerprint TEXT, safety_state TEXT, compliance_state TEXT, confidence_level TEXT, overall_confidence INTEGER, confidence_components TEXT, technical_eligibility TEXT, price_eligibility TEXT, missing_information TEXT, provenance_status TEXT, explanation TEXT, engine_version TEXT, ruleset_version TEXT, model_version TEXT, recalculation_reason TEXT, created_by TEXT, created_at TEXT, superseded_at TEXT);
CREATE TABLE safety_blocks(id TEXT PRIMARY KEY, safety_decision_id TEXT, code TEXT, severity TEXT, scope TEXT, user_message TEXT, technical_message TEXT, resolution_action TEXT, owner TEXT, source TEXT, rule_version TEXT, overridable INTEGER, status TEXT DEFAULT 'Open', resolution_decision_id TEXT);
CREATE TABLE safety_warnings(id TEXT PRIMARY KEY, safety_decision_id TEXT, code TEXT, severity TEXT, scope TEXT, message TEXT, resolution_action TEXT, owner TEXT, source TEXT, rule_version TEXT, acknowledged_by TEXT, acknowledged_at TEXT, acknowledgment_reason TEXT);
CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT, approval_level INTEGER, status TEXT, requested_by TEXT, requested_role TEXT, request_reason TEXT, evidence TEXT, entity_version INTEGER, ruleset_version TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
CREATE TABLE safety_overrides(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_level INTEGER, block_codes TEXT, override_type TEXT, reason TEXT, technical_justification TEXT, commercial_justification TEXT, evidence TEXT, scope TEXT, expires_at TEXT, status TEXT, requested_by TEXT, requested_role TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
`;

const ENGINEER = "engineer1";

const buildDatabase = ({ technicalEligibility, blockStatus, overridable }) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','${ENGINEER}','org1',NULL);
    INSERT INTO project_members VALUES ('p1','${ENGINEER}','Engineering Reviewer','Active',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL,'BOQ');
    INSERT INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ext1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('boq1','p1','BOQ Item','ext1','doc1',1,'1','Addressable smoke detector',5,5,'Each','Each','Fire Alarm','Fire Alarm',NULL,NULL,'GOLDEN-FA-001','{}','{"page":1}','Approved',1,NULL,90,90,NULL);
    INSERT INTO product_manufacturers VALUES ('mfr1','Test Manufacturer','test manufacturer','Reviewed','${ENGINEER}',NULL);
    INSERT INTO library_products VALUES ('prod1','mfr1',NULL,NULL,'GOLDEN-FA-001','GOLDEN-FA-001','Test Product',NULL,NULL,'[]','[]','Reviewed',1,'Active',NULL,1,'${ENGINEER}',NULL,NULL);
    INSERT INTO requirement_profile_versions VALUES ('profile1','p1','boq1',1,'{"confidence":{"applicability":90}}','{}','Ready for Matching',NULL);
    INSERT INTO product_match_runs VALUES ('run1','p1','boq1','profile1',1,'Needs Review',NULL);
    INSERT INTO product_match_candidates VALUES ('cand1','run1','prod1',1,'Deterministic',80,'{}','Compliant','Recommended','High Confidence',80,'[]','No Price Evidence','Exact part number.','[]','{}','Needs Review');
    INSERT INTO safety_decisions (id,project_id,boq_item_id,candidate_id,requirement_profile_version_id,match_run_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,engine_version,ruleset_version,model_version,recalculation_reason,created_by)
      VALUES ('sd1','p1','boq1','cand1','profile1','run1',1,'fp1','Blocked','Compliant','High Confidence',80,'{}','${technicalEligibility}','Price Approval Disabled','[]','Complete','Engineer exception','1','safety-rules-2026-08-02','1','Auto','${ENGINEER}');
    INSERT INTO safety_blocks VALUES ('block1','sd1','TECHNICAL_DECISION_ENGINEER_EXCEPTION','Critical','Engineering Authority','msg','tech','action','Technical Manager','{}','safety-rules-2026-08-02',${overridable},'${blockStatus}',NULL);
    INSERT INTO safety_overrides VALUES ('ovr1','p1','sd1',2,'["TECHNICAL_DECISION_ENGINEER_EXCEPTION"]','Controlled Exception','reason','technical justification',NULL,'[]','Candidate','2099-01-01','Approved','${ENGINEER}','${ENGINEER}','${ENGINEER}','Engineering Reviewer','decided','2026-01-01','2026-01-01');
  `);
  return raw;
};

const approve = async (raw) => {
  const response = await handleConfidenceSafetyApi(
    new Request("https://example.test/api/match-candidates/cand1/safety/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalType: "Technical", entityVersion: 1, reason: "Governed engineer exception accepted for this candidate" }),
    }),
    {
      DB: d1(raw),
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: ENGINEER,
      APP_ORGANIZATION_ID: "org1",
    },
  );
  return { status: response.status, body: await response.json() };
};

test("GOV-001 -- an approved governed override unblocks technical approval of an overridable engineer exception", async () => {
  const raw = buildDatabase({
    technicalEligibility: "Technical Approval Disabled",
    blockStatus: "Overridden",
    overridable: 1,
  });

  const { status, body } = await approve(raw);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.approved, true);
  assert.equal(body.type, "Technical");
  const rows = raw.prepare("SELECT * FROM safety_approval_requests WHERE safety_decision_id='sd1'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Approved");
  assert.equal(rows[0].requested_role, "Engineering Reviewer");
});

test("GOV-001 -- the override path still fails closed while any block is Open", async () => {
  const raw = buildDatabase({
    technicalEligibility: "Technical Approval Disabled",
    blockStatus: "Open",
    overridable: 1,
  });

  const { status, body } = await approve(raw);

  assert.equal(status, 409);
  assert.equal(body.error.code, "APPROVAL_BLOCKED");
  assert.deepEqual(body.error.blocks, ["TECHNICAL_DECISION_ENGINEER_EXCEPTION"]);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM safety_approval_requests").get().count, 0);
});

test("GOV-001 -- a non-overridable (Blocked) decision can never be unblocked by block status", async () => {
  const raw = buildDatabase({
    technicalEligibility: "Blocked",
    blockStatus: "Overridden",
    overridable: 0,
  });

  const { status, body } = await approve(raw);

  assert.equal(status, 409);
  assert.equal(body.error.code, "APPROVAL_BLOCKED");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM safety_approval_requests").get().count, 0);
});

// MATCH-002 -- the product-matching run fingerprint must not reference an
// identifier that is not in scope.
//
// executeProductMatching built its currentness fingerprint with
// `understandingConfigFingerprint` as a BARE object shorthand, while the local
// value in that function is `currentConfigFingerprint`. The result was a
// ReferenceError on every product-matching run: the processing job failed with
// PRODUCT_MATCHING_FAILED / "understandingConfigFingerprint is not defined", no
// product_match_runs row was ever written, and every downstream Golden stage
// then failed with a misleading 409 MATCH_RUN_REQUIRED. Golden E2E caught it;
// unit tests did not, because they never executed the handler.
//
// The guard is a scope check, not a regex on behaviour: inside executeProductMatching
// the shorthand must not appear, and the fingerprint must carry the defined
// local explicitly.
test("MATCH-002 -- the matching fingerprint resolves the understanding config fingerprint from a defined local", async () => {
  const source = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export const executeProductMatching");
  assert.ok(start > 0, "executeProductMatching must exist");
  const body = source.slice(start, source.indexOf("\nexport ", start + 10) > 0 ? source.indexOf("\nexport ", start + 10) : undefined);
  assert.ok(
    !/(^|[{,\s])understandingConfigFingerprint\s*[,}]/m.test(body),
    "a bare `understandingConfigFingerprint` shorthand inside executeProductMatching is an undefined identifier at runtime",
  );
  assert.match(body, /understandingConfigFingerprint:\s*currentConfigFingerprint/);
  assert.match(body, /const currentConfigFingerprint = interpretationConfigFingerprint\(/);
});
