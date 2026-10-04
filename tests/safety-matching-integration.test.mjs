import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { evaluateSafetyForMatchRun, executeSafetyEvaluation, ownedCandidate } from "../worker/confidence-safety-api.mjs";

// Proves the Phase 5 wiring gap is closed: a real product match run must
// itself produce governed safety_decisions rows, not merely wait for an
// engineer to click into an individual candidate. Before this change,
// evaluateSafetyForMatchRun did not exist and executeProductMatching never
// called into confidence-safety-api.mjs at all -- 251 real match runs and
// 1,911 real candidates had produced exactly one (demo) safety_decisions row.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
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
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
CREATE TABLE project_members(project_id TEXT, user_id TEXT, status TEXT, revoked_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE boq_items(id TEXT PRIMARY KEY, project_id TEXT, row_type TEXT, extraction_version_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, numeric_quantity REAL, original_quantity REAL, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT, review_status TEXT, approved_for_downstream INTEGER, specification_reference TEXT, system_confidence INTEGER, extraction_confidence INTEGER);
CREATE TABLE product_manufacturers(id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT, status TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE library_products(id TEXT PRIMARY KEY, manufacturer_id TEXT, brand_id TEXT, family_id TEXT, part_number TEXT, normalized_part_number TEXT, description TEXT, lifecycle_status TEXT, country_of_origin TEXT, attributes TEXT, standards TEXT, review_status TEXT, approved_for_discovery INTEGER, identity_status TEXT, superseded_by_product_id TEXT, identity_version INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT);
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
CREATE TABLE requirement_profile_versions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, version_number INTEGER, profile TEXT, confidence_summary TEXT, readiness_status TEXT, superseded_at TEXT);
CREATE TABLE product_match_runs(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, search_stage TEXT, score INTEGER, score_components TEXT, technical_status TEXT, recommendation_tier TEXT, confidence_state TEXT, confidence_score INTEGER, matching_basis TEXT, commercial_availability TEXT, explanation TEXT, mandatory_failures TEXT, lifecycle_result TEXT, review_status TEXT);
CREATE TABLE product_match_comparisons(id TEXT PRIMARY KEY, candidate_id TEXT, comparison_type TEXT, blocking INTEGER);
CREATE TABLE price_records(id TEXT PRIMARY KEY, product_id TEXT, project_id TEXT, approval_status TEXT, valid_until TEXT, currency TEXT);
CREATE TABLE safety_decisions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, candidate_id TEXT, requirement_profile_version_id TEXT, match_run_id TEXT, version_number INTEGER, input_fingerprint TEXT, safety_state TEXT, compliance_state TEXT, confidence_level TEXT, overall_confidence INTEGER, confidence_components TEXT, technical_eligibility TEXT, price_eligibility TEXT, missing_information TEXT, provenance_status TEXT, explanation TEXT, engine_version TEXT, ruleset_version TEXT, model_version TEXT, recalculation_reason TEXT, created_by TEXT, created_at TEXT, superseded_at TEXT);
CREATE TABLE safety_blocks(id TEXT PRIMARY KEY, safety_decision_id TEXT, code TEXT, severity TEXT, scope TEXT, user_message TEXT, technical_message TEXT, resolution_action TEXT, owner TEXT, source TEXT, rule_version TEXT, overridable INTEGER, status TEXT DEFAULT 'Open', resolution_decision_id TEXT);
CREATE TABLE safety_warnings(id TEXT PRIMARY KEY, safety_decision_id TEXT, code TEXT, severity TEXT, scope TEXT, message TEXT, resolution_action TEXT, owner TEXT, source TEXT, rule_version TEXT, acknowledged_by TEXT, acknowledged_at TEXT, acknowledgment_reason TEXT);
CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT, status TEXT, decided_at TEXT, created_at TEXT);
CREATE TABLE safety_overrides(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_level INTEGER, block_codes TEXT, override_type TEXT, reason TEXT, technical_justification TEXT, commercial_justification TEXT, evidence TEXT, scope TEXT, expires_at TEXT, status TEXT, requested_by TEXT, requested_role TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
`;

const buildDatabase = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  return raw;
};

const OWNER = { id: "owner1", role: "Project User" };

const seedMatchRun = (raw, { matchRunId, candidateIds, requirementProfileVersionId = "profile1" }) => {
  raw.exec(`
    INSERT OR IGNORE INTO projects VALUES ('p1','${OWNER.id}','org1',NULL);
    INSERT OR IGNORE INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT OR IGNORE INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT OR IGNORE INTO boq_extraction_versions VALUES ('ext1','doc1','dv1',1,'Completed',NULL);
    INSERT OR IGNORE INTO boq_items VALUES ('boq1','p1','BOQ Item','ext1','doc1',1,'1','Test Product Item',5,5,'Each','Each','Test System','Uncategorized',NULL,NULL,NULL,NULL,'{}','{"page":1}','Needs Review',0,NULL,90,90);
    INSERT OR IGNORE INTO product_manufacturers VALUES ('mfr1','Test Manufacturer','test manufacturer','Reviewed','owner1',NULL);
    INSERT OR IGNORE INTO library_products VALUES ('prod1','mfr1',NULL,NULL,'PART-1','PART1','Test Product',NULL,NULL,'[]','[]','Reviewed',1,'Active',NULL,1,'owner1',NULL,NULL);
    INSERT OR IGNORE INTO requirement_profile_versions VALUES ('${requirementProfileVersionId}','p1','boq1',1,'{"confidence":{"applicability":90},"standards":[],"compatibility":[],"accessories":[]}','{}','Ready for Matching',NULL);
  `);
  raw.prepare("INSERT INTO product_match_runs VALUES (?,?,?,?,?,?,?)").run(matchRunId, "p1", "boq1", requirementProfileVersionId, 1, "Needs Review", null);
  for (const candidateId of candidateIds) {
    raw.prepare("INSERT INTO product_match_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      candidateId, matchRunId, "prod1", 1, "Deterministic", 80, "{}", "Compliant", "Recommended", "High Confidence", 80, "[]", "No Price Evidence", "Matches on part number.", "[]", "{}", "Needs Review",
    );
  }
};

test("a persisted match run's candidates automatically receive governed safety decisions", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedMatchRun(raw, { matchRunId: "run1", candidateIds: ["cand1", "cand2"] });

  const decisions = await evaluateSafetyForMatchRun(DB, { matchRunId: "run1", user: OWNER });

  assert.equal(decisions.length, 2);
  const rows = raw.prepare("SELECT * FROM safety_decisions ORDER BY candidate_id").all();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.boq_item_id, "boq1");
    assert.equal(row.match_run_id, "run1");
    assert.equal(row.requirement_profile_version_id, "profile1");
    assert.equal(row.version_number, 1);
    assert.equal(row.superseded_at, null);
    assert.equal(row.recalculation_reason, "Automatic safety evaluation on product match completion");
  }
  assert.deepEqual(new Set(rows.map((row) => row.candidate_id)), new Set(["cand1", "cand2"]));
});

test("re-running automatic evaluation on an unchanged match run does not create duplicate decisions", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedMatchRun(raw, { matchRunId: "run1", candidateIds: ["cand1"] });

  await evaluateSafetyForMatchRun(DB, { matchRunId: "run1", user: OWNER });
  await evaluateSafetyForMatchRun(DB, { matchRunId: "run1", user: OWNER });

  const rows = raw.prepare("SELECT * FROM safety_decisions").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version_number, 1);
});

test("forcing recalculation after inputs change supersedes the previous safety decision with a new version", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedMatchRun(raw, { matchRunId: "run1", candidateIds: ["cand1"] });
  await evaluateSafetyForMatchRun(DB, { matchRunId: "run1", user: OWNER });

  const before = raw.prepare("SELECT * FROM safety_decisions WHERE candidate_id='cand1'").get();
  assert.equal(before.price_eligibility, "Price Approval Disabled");

  // Simulate new commercial evidence becoming available since the automatic evaluation ran.
  raw.exec(`INSERT INTO price_records VALUES ('price1','prod1',NULL,'Approved','2099-01-01','SAR')`);
  const candidate = await ownedCandidate(DB, "cand1", OWNER.id);
  await executeSafetyEvaluation(DB, { candidate, user: OWNER, reason: "Reviewer-requested safety recalculation", force: true });

  const rows = raw.prepare("SELECT * FROM safety_decisions WHERE candidate_id='cand1' ORDER BY version_number").all();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].superseded_at, null);
  assert.equal(rows[1].version_number, 2);
  assert.equal(rows[1].superseded_at, null);
  assert.equal(rows[1].recalculation_reason, "Reviewer-requested safety recalculation");
});
