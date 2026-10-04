import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { evaluateSafetyForMatchRun } from "../worker/confidence-safety-api.mjs";
import { matchRunStaleness } from "../worker/product-matching-api.mjs";
import { handleConfidenceSafetyApi } from "../worker/confidence-safety-api.mjs";

// Closes the correctness gap the Knowledge & Engineering Backend Reality Audit
// flagged: an engineer editing/approving a requirement profile produced a new,
// non-superseded requirement_profile_versions row, but the product match run
// and safety decisions from BEFORE that edit kept looking exactly as current
// as they did before -- nothing anywhere signalled that product selection no
// longer reflected the requirement that had just changed. Staleness here is
// derived at read time from the authoritative version relationship
// (product_match_runs.requirement_profile_version_id vs. the item's current,
// non-superseded requirement_profile_versions row) -- not a separately
// maintained flag that could itself go stale.

const root = new URL("../", import.meta.url);

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
CREATE TABLE project_members(project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
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
CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_type TEXT, approval_level INTEGER, status TEXT, requested_by TEXT, requested_role TEXT, request_reason TEXT, evidence TEXT, entity_version INTEGER, ruleset_version TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
CREATE TABLE safety_overrides(id TEXT PRIMARY KEY, project_id TEXT, safety_decision_id TEXT, approval_level INTEGER, block_codes TEXT, override_type TEXT, reason TEXT, technical_justification TEXT, commercial_justification TEXT, evidence TEXT, scope TEXT, expires_at TEXT, status TEXT, requested_by TEXT, requested_role TEXT, decided_by TEXT, decided_role TEXT, decision_reason TEXT, decided_at TEXT, created_at TEXT);
`;

const OWNER = { id: "local-development-user", role: "Project User" };

const buildDatabase = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','${OWNER.id}','organization_bd_shaft_internal_pilot',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ext1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('boq1','p1','BOQ Item','ext1','doc1',1,'1','Test Product Item',5,5,'Each','Each','Test System','Uncategorized',NULL,NULL,NULL,NULL,'{}','{"page":1}','Needs Review',0,NULL,90,90);
    INSERT INTO product_manufacturers VALUES ('mfr1','Test Manufacturer','test manufacturer','Reviewed','owner1',NULL);
    INSERT INTO library_products VALUES ('prod1','mfr1',NULL,NULL,'PART-1','PART1','Test Product',NULL,NULL,'[]','[]','Reviewed',1,'Active',NULL,1,'owner1',NULL,NULL);
    INSERT INTO requirement_profile_versions VALUES ('profile1','p1','boq1',1,'{"confidence":{"applicability":90},"standards":[],"compatibility":[],"accessories":[]}','{}','Ready for Matching',NULL);
  `);
  return raw;
};

const insertMatchRun = (raw, { matchRunId, requirementProfileVersionId, candidateId }) => {
  raw.prepare("INSERT INTO product_match_runs VALUES (?,?,?,?,?,?,?)").run(matchRunId, "p1", "boq1", requirementProfileVersionId, 1, "Needs Review", null);
  raw.prepare("INSERT INTO product_match_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    candidateId, matchRunId, "prod1", 1, "Deterministic", 80, "{}", "Compliant", "Recommended", "High Confidence", 80, "[]", "No Price Evidence", "Matches on part number.", "[]", "{}", "Needs Review",
  );
};

const approveRequest = (candidateId, entityVersion) => new Request(`http://localhost/api/match-candidates/${candidateId}/safety/approve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ approvalType: "Technical", entityVersion, reason: "Meets requirement and is technically compliant." }),
});
const currentRequest = (candidateId) => new Request(`http://localhost/api/match-candidates/${candidateId}/safety`, { cache: "no-store" });

test("requirement profile v1 -> match run v1 -> safety v1, then a human edit stales both without a rematch", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  const env = { DB };
  insertMatchRun(raw, { matchRunId: "run1", requirementProfileVersionId: "profile1", candidateId: "cand1" });

  // requirement profile v1 -> match run v1 -> safety v1
  const [decision1] = await evaluateSafetyForMatchRun(DB, { matchRunId: "run1", user: OWNER });
  assert.equal(decision1.version_number, 1);
  assert.equal(decision1.requirement_profile_version_id, "profile1");

  const runRow1 = raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get();
  assert.equal((await matchRunStaleness(DB, "boq1", runRow1)).stale, false);
  const beforeEdit = await (await handleConfidenceSafetyApi(currentRequest("cand1"), env)).json();
  assert.equal(beforeEdit.stale, false);

  // human edit produces requirement profile v2 (mirrors persistProfile's own
  // supersede-then-insert -- no product match run exists yet against it)
  raw.exec(`UPDATE requirement_profile_versions SET superseded_at='2026-08-31T09:00:00Z' WHERE id='profile1'`);
  raw.exec(`INSERT INTO requirement_profile_versions VALUES ('profile2','p1','boq1',2,'{"confidence":{"applicability":90},"standards":[],"compatibility":[],"accessories":[]}','{}','Ready for Matching',NULL)`);

  // old match run is no longer treated as current, even though nothing
  // structurally superseded product_match_runs('run1') itself
  assert.equal(runRow1.superseded_at, null);
  assert.equal((await matchRunStaleness(DB, "boq1", runRow1)).stale, true);

  // old safety decision is no longer treated as current/authoritative
  const afterEdit = await (await handleConfidenceSafetyApi(currentRequest("cand1"), env)).json();
  assert.equal(afterEdit.stale, true);
  assert.match(afterEdit.staleReason, /Re-run product matching/);
  assert.equal(afterEdit.decision.id, decision1.id, "the decision itself is untouched -- staleness is derived, not a rewrite of history");

  // approval must be refused while stale, however "fresh" the safety decision version looks
  const blocked = await handleConfidenceSafetyApi(approveRequest("cand1", decision1.version_number), env);
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.error.code, "REQUIREMENT_PROFILE_CHANGED");
});

test("re-running matching against the new profile creates a fresh, non-stale match run and safety decision, and the old ones remain historical", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  const env = { DB };
  insertMatchRun(raw, { matchRunId: "run1", requirementProfileVersionId: "profile1", candidateId: "cand1" });
  const [decision1] = await evaluateSafetyForMatchRun(DB, { matchRunId: "run1", user: OWNER });

  raw.exec(`UPDATE requirement_profile_versions SET superseded_at='2026-08-31T09:00:00Z' WHERE id='profile1'`);
  raw.exec(`INSERT INTO requirement_profile_versions VALUES ('profile2','p1','boq1',2,'{"confidence":{"applicability":90},"standards":[],"compatibility":[],"accessories":[]}','{}','Ready for Matching',NULL)`);

  // what an explicit "Re-run product matching" action does: persistResult's
  // own supersede-then-insert of product_match_runs, bound to the new profile
  raw.exec(`UPDATE product_match_runs SET superseded_at='2026-08-31T09:05:00Z' WHERE id='run1'`);
  insertMatchRun(raw, { matchRunId: "run2", requirementProfileVersionId: "profile2", candidateId: "cand2" });
  const [decision2] = await evaluateSafetyForMatchRun(DB, { matchRunId: "run2", user: OWNER });

  assert.equal(decision2.requirement_profile_version_id, "profile2");
  assert.notEqual(decision2.id, decision1.id);

  const runRow2 = raw.prepare("SELECT * FROM product_match_runs WHERE id='run2'").get();
  assert.equal((await matchRunStaleness(DB, "boq1", runRow2)).stale, false);
  const fresh = await (await handleConfidenceSafetyApi(currentRequest("cand2"), env)).json();
  assert.equal(fresh.stale, false);

  // the old run and its safety decision remain historical and traceable, not deleted or mutated
  const historicalRun = raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get();
  assert.notEqual(historicalRun.superseded_at, null);
  assert.equal(historicalRun.requirement_profile_version_id, "profile1");
  const historicalDecision = raw.prepare("SELECT * FROM safety_decisions WHERE id=?").get(decision1.id);
  assert.equal(historicalDecision.candidate_id, "cand1");
  assert.equal(historicalDecision.requirement_profile_version_id, "profile1");
});

test("the Product Selection UI states the stale condition in plain language with a real re-run action", async () => {
  const workspace = await readFile(new URL("app/components/workspaces/MatchingWorkspace.tsx", root), "utf8");
  assert.match(workspace, /Requirements changed\. Product selection must be re-evaluated\./);
  assert.match(workspace, /Re-run product matching/);
  assert.match(workspace, /matchStale/);
  // the Approve action must be disabled while stale, not just annotated
  // (optional chaining added under Backend & Codebase Consolidation Sprint,
  // item 4: matchingCandidateModel's declared return type is nullable, even
  // though `candidate` is always defined at this call site)
  assert.match(workspace, /disabled=\{!model\?\.approvalEligible \|\| props\.matchStale\}/);
});
