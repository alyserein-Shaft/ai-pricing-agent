import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { analyzeConflict, identityRulesetDocument } from "../app/domain/identity-resolution-engine.mjs";
import { applyIdentityProposal, handleIdentityResolutionApi, reviewIdentityProposal, reverseIdentityDecision } from "../worker/identity-resolution-api.mjs";
import { evidenceIntegrityValues } from "../worker/identity-production-governance.mjs";

const migration15 = await readFile(new URL("../drizzle/0015_identity_resolution_analysis.sql", import.meta.url), "utf8");
const migration16 = await readFile(new URL("../drizzle/0016_governed_identity_decisions.sql", import.meta.url), "utf8");
const migration17 = await readFile(new URL("../drizzle/0017_identity_reapplication_cycles.sql", import.meta.url), "utf8");
const migration18 = await readFile(new URL("../drizzle/0018_verified_library_authorization.sql", import.meta.url), "utf8");
const migration19 = await readFile(new URL("../drizzle/0019_identity_library_scope_isolation.sql", import.meta.url), "utf8");
const migration20 = await readFile(new URL("../drizzle/0020_identity_mutation_compare_and_swap.sql", import.meta.url), "utf8");
const migration21 = await readFile(new URL("../drizzle/0021_identity_production_governance.sql", import.meta.url), "utf8");
const migration22 = await readFile(new URL("../drizzle/0022_complete_product_reference_registry.sql", import.meta.url), "utf8");
const migration23 = await readFile(new URL("../drizzle/0023_canonical_evidence_original_ownership.sql", import.meta.url), "utf8");

const baseSchema = `
CREATE TABLE product_manufacturers (id text PRIMARY KEY,name text,normalized_name text,status text,created_by text,created_at text DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_brands (id text PRIMARY KEY,manufacturer_id text,name text,normalized_name text,status text,created_at text DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_families (id text PRIMARY KEY,brand_id text,parent_family_id text,name text,normalized_name text,engineering_domain text,review_status text,created_at text DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE library_products (id text PRIMARY KEY,manufacturer_id text NOT NULL,brand_id text,family_id text,part_number text NOT NULL,normalized_part_number text NOT NULL,description text NOT NULL,lifecycle_status text NOT NULL DEFAULT 'Unknown — Review Required',country_of_origin text,attributes text NOT NULL DEFAULT '[]',standards text NOT NULL DEFAULT '[]',review_status text NOT NULL DEFAULT 'Needs Review',approved_for_discovery integer NOT NULL DEFAULT 0,created_by text NOT NULL,created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_conflicts (id text PRIMARY KEY,product_id text,conflict_type text NOT NULL,left_value text NOT NULL,right_value text NOT NULL,source_ids text NOT NULL,status text NOT NULL DEFAULT 'Open',resolution text,resolved_by text,resolved_at text,created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at text);
CREATE TABLE product_source_evidence (id text PRIMARY KEY,product_id text NOT NULL,source_id text NOT NULL,sheet text,row_number integer,page integer,cells text NOT NULL DEFAULT '[]',original_text text,parser_version text NOT NULL,created_at text DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE price_records (id text PRIMARY KEY,product_id text NOT NULL,source_id text NOT NULL,supplier_id text,project_id text,amount_minor integer NOT NULL,currency text NOT NULL,price_type text NOT NULL,unit text NOT NULL DEFAULT 'EA',minimum_quantity integer,discount_basis_points integer,effective_from text,valid_until text,validity_state text NOT NULL,approval_status text NOT NULL DEFAULT 'Needs Review',downstream_use text NOT NULL DEFAULT 'Discovery Only',terms text NOT NULL DEFAULT '{}',source_location text NOT NULL,reviewed_by text,reviewed_at text,created_at text DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_match_candidates (id text PRIMARY KEY,product_id text,match_run_id text,payload text);
CREATE TABLE product_match_runs (id text PRIMARY KEY,boq_item_id text);
CREATE TABLE safety_decisions (id text PRIMARY KEY,candidate_id text,payload text);
CREATE TABLE pricing_lines (id text PRIMARY KEY,product_id text,project_id text,payload text);
CREATE TABLE review_queue_items (id text PRIMARY KEY,project_id text,boq_item_id text);
CREATE TABLE review_decisions (id text PRIMARY KEY,review_item_id text,payload text);
CREATE TABLE dashboard_audit_log (id text PRIMARY KEY,payload text);
CREATE TABLE excel_export_jobs (id text PRIMARY KEY,project_id text,payload text);
CREATE TABLE projects (id text PRIMARY KEY,name text NOT NULL,owner_user_id text NOT NULL,archived integer NOT NULL DEFAULT 0,created_at text DEFAULT CURRENT_TIMESTAMP,updated_at text DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE project_members (id text PRIMARY KEY,project_id text NOT NULL,user_id text NOT NULL,role text,status text NOT NULL DEFAULT 'Active',revoked_at text);
CREATE TABLE product_sources (id text PRIMARY KEY,scope_type text,project_id text,checksum text);
CREATE TABLE product_versions (id text PRIMARY KEY,product_id text);
CREATE TABLE product_variants (id text PRIMARY KEY,base_product_id text);
CREATE TABLE product_aliases (id text PRIMARY KEY,product_id text);
CREATE TABLE regional_part_numbers (id text PRIMARY KEY,product_id text);
CREATE TABLE product_attributes (id text PRIMARY KEY,product_id text);
CREATE TABLE product_certifications (id text PRIMARY KEY,product_id text);
CREATE TABLE product_compatibility (id text PRIMARY KEY,source_product_id text,target_product_id text);
CREATE TABLE product_accessories (id text PRIMARY KEY,product_id text,accessory_product_id text);
CREATE TABLE product_packages (id text PRIMARY KEY,product_id text);
CREATE TABLE product_documents (id text PRIMARY KEY,product_id text);
CREATE TABLE supplier_products (id text PRIMARY KEY,product_id text);
CREATE TABLE supplier_quote_lines (id text PRIMARY KEY,product_id text);
CREATE TABLE price_conflicts (id text PRIMARY KEY,product_id text);
CREATE TABLE product_lifecycle_events (id text PRIMARY KEY,product_id text);
CREATE TABLE product_package_components (id text PRIMARY KEY,component_product_id text);
CREATE TABLE product_identity_decisions (id text PRIMARY KEY,left_product_id text,right_product_id text);
`;

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      first: async () => raw.prepare(sql).get(...args),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind(...args) { return operation(args); } };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  },
});

const productsFor = (raw, conflict) => {
  const left = JSON.parse(conflict.left_value), right = JSON.parse(conflict.right_value);
  return raw.prepare("SELECT p.*,m.name manufacturer,b.name brand,NULL family FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id LEFT JOIN product_brands b ON b.id=p.brand_id WHERE upper(p.part_number) IN (upper(?),upper(?)) ORDER BY p.id").all(left.partNumber, right.partNumber);
};

const createFixture = async (kind = "clean") => {
  const raw = new DatabaseSync(":memory:"); raw.exec(baseSchema); raw.exec(migration15); raw.exec(migration16); raw.exec(migration17); raw.exec(migration18); raw.exec(migration19); raw.exec(migration20); raw.exec(migration21); raw.exec(migration22); raw.exec(migration23);
  const env = { DB: d1(raw), IDENTITY_AUTH_MODE: "sites" };
  for (const [userId, permission, accountStatus = "Active", sessionStatus = "Active"] of [
    ["viewer-1", "Library Viewer"], ["reviewer-1", "Library Reviewer"], ["manager-1", "Library Manager"], ["admin-1", "Administrator"],
    ["disabled-1", "Library Manager", "Disabled", "Active"], ["revoked-1", "Library Manager", "Active", "Revoked"],
  ]) {
    raw.prepare("INSERT INTO library_security_principals (user_id,email,account_status,session_status) VALUES (?,?,?,?)").run(userId, `${userId}@example.test`, accountStatus, sessionStatus);
    raw.prepare("INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by) VALUES (?,?,?,'Active','fixture')").run(`grant-${userId}`, userId, permission);
  }
  const ruleset = await identityRulesetDocument();
  raw.prepare("INSERT INTO product_sources (id,scope_type,project_id,checksum) VALUES ('source_fixture','Global',NULL,'source-checksum-fixture')").run();
  raw.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,status,created_by) VALUES ('m1','Honeywell','HONEYWELL','Reviewed','fixture')").run();
  raw.prepare("INSERT INTO product_brands (id,manufacturer_id,name,normalized_name,status) VALUES ('b1','m1','Farenhyt','FARENHYT','Reviewed')").run();
  const definitions = kind === "resistor"
    ? [["product_a_target", "REL-4.7K", "End Of Line Resistor; 4.7k With Leads"], ["product_z_alt", "REL-47K", "End Of Line Resistor; 47k With Leads"]]
    : kind === "color"
      ? [["product_a_target", "MODEL-W", "Detector (Ivory Color)"], ["product_z_alt", "MODEL-W.", "Detector (Ivory Color)"]]
      : [["product_a_target", "MODEL-1", "Synthetic governed product"], ["product_z_alt", "MODEL-1.", "Synthetic governed product"]];
  for (const [id, part, description] of definitions) raw.prepare("INSERT INTO library_products (id,manufacturer_id,brand_id,part_number,normalized_part_number,description,created_by) VALUES (?,'m1','b1',?,?,?,'fixture')").run(id, part, part, description);
  const conflict = { id: "conflict_fixture", product_id: "product_z_alt", conflict_type: "Identity Collision", left_value: JSON.stringify({ partNumber: definitions[1][1], row: 10, description: definitions[1][2] }), right_value: JSON.stringify({ partNumber: definitions[0][1], row: 20, description: definitions[0][2] }), source_ids: JSON.stringify({ sourceId: "source_fixture", rows: [10, 20], normalizedCollision: "FIXTURE" }), status: "Open" };
  raw.prepare("INSERT INTO product_conflicts (id,product_id,conflict_type,left_value,right_value,source_ids,status) VALUES (?,?,?,?,?,?,'Open')").run(conflict.id, conflict.product_id, conflict.conflict_type, conflict.left_value, conflict.right_value, conflict.source_ids);
  const currentConflict = raw.prepare("SELECT * FROM product_conflicts WHERE id=?").get(conflict.id);
  const products = productsFor(raw, currentConflict);
  const analysis = await analyzeConflict(currentConflict, products);
  raw.prepare("INSERT INTO identity_ruleset_versions (id,semantic_version,checksum,status,rules_json,created_by,behavior_version,executable_checksum) VALUES (?,?,?,?,?,'fixture',?,?)").run(ruleset.id, ruleset.version, ruleset.checksum, ruleset.status, JSON.stringify(ruleset), ruleset.behaviorVersion, ruleset.executableChecksum);
  raw.prepare("INSERT INTO identity_resolution_runs (id,ruleset_version_id,mode,input_fingerprint,status,started_by,completed_at,summary_json) VALUES ('run_fixture',?,'Analysis',?,'Completed','fixture',CURRENT_TIMESTAMP,'{}')").run(ruleset.id, analysis.inputFingerprint);
  raw.prepare("INSERT INTO identity_resolution_cases (id,run_id,conflict_id,input_snapshot_json,status) VALUES ('case_fixture','run_fixture',?,'{}','Analyzed')").run(conflict.id);
  raw.prepare("INSERT INTO identity_resolution_proposals (id,case_id,outcome,classification,relationship_type,confidence,terminal_rule_id,reason_code,explanation_json,required_evidence_json,blockers_json,proposal_fingerprint,status,executable_ruleset_checksum) VALUES ('proposal_fixture','case_fixture',?,?,?,?,?,?,'{}','[]',?,?,'Proposed',?)").run(analysis.outcome, analysis.classification, analysis.relationship, analysis.confidence, analysis.terminalRule, analysis.reasonCode, JSON.stringify(analysis.blockers), analysis.proposalFingerprint, ruleset.executableChecksum);
  for (const product of products) raw.prepare("INSERT INTO identity_resolution_candidates (id,case_id,product_id,retrieval_method,snapshot_json) VALUES (?, 'case_fixture',?,'Conflict Pair','{}')").run(`candidate_${product.id}`, product.id);
  for (const product of products) {
    raw.prepare("INSERT INTO product_source_evidence (id,product_id,source_id,sheet,row_number,cells,parser_version) VALUES (?,?, 'source_fixture','Sheet1',?,'[]','fixture')").run(`evidence_${product.id}`, product.id, product.id === "product_z_alt" ? 10 : 20);
    const evidence = raw.prepare("SELECT * FROM product_source_evidence WHERE id=?").get(`evidence_${product.id}`), integrity = await evidenceIntegrityValues(evidence, "source-checksum-fixture");
    raw.prepare("INSERT INTO canonical_evidence_integrity (evidence_id,row_checksum,source_checksum,evidence_fingerprint,sealed_by,original_product_id) VALUES (?,?,?,?, 'fixture',?)").run(evidence.id, integrity.rowChecksum, integrity.sourceChecksum, integrity.evidenceFingerprint, product.id);
    raw.prepare("INSERT INTO price_records (id,product_id,source_id,amount_minor,currency,price_type,validity_state,source_location) VALUES (?,?, 'source_fixture',10000,'USD','Historical','Historical',?)").run(`price_${product.id}`, product.id, JSON.stringify({ row: product.id === "product_z_alt" ? 10 : 20 }));
  }
  for (const table of ["product_match_candidates", "safety_decisions", "pricing_lines", "review_decisions", "dashboard_audit_log", "excel_export_jobs"]) raw.prepare(`INSERT INTO ${table} (id,payload) VALUES ('sentinel','unchanged')`).run();
  const locks = { proposalVersion: 1, conflictVersion: 1, rulesetVersion: ruleset.version, productVersions: { product_a_target: 1, product_z_alt: 1 }, canonicalProductId: "product_a_target" };
  return { raw, env, ruleset, analysis, locks, actor: { id: "manager-1", role: "Library Manager" } };
};

const userForPermission = { "Library Viewer": "viewer-1", "Library Reviewer": "reviewer-1", "Library Manager": "manager-1", Administrator: "admin-1" };
const reviewRequest = (body, permission = "Library Manager", key = "review-key-0001") => { const userId = userForPermission[permission] || permission; return new Request("https://local/api/identity-resolution/proposals/proposal_fixture/review", { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": userId, "oai-authenticated-user-email": `${userId}@example.test`, "idempotency-key": key }, body: JSON.stringify(body) }); };
const operationRequest = (path, permission, key, body) => { const userId = userForPermission[permission]; return new Request(`https://local/api/identity-resolution/${path}`, { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": userId, "oai-authenticated-user-email": `${userId}@example.test`, "idempotency-key": key }, body: JSON.stringify(body) }); };
const latestBody = (fixture, overrides = {}) => ({ decision: "Approve for Application", reason: "Synthetic fixture reviewed for governed application", ...fixture.locks, ...overrides });

test("proposal review enforces role, substantive reason, versions and immutable audit", async () => {
  const unauthorized = await createFixture();
  let response = await handleIdentityResolutionApi(reviewRequest(latestBody(unauthorized), "Library Viewer"), unauthorized.env);
  assert.equal(response.status, 403); unauthorized.raw.close();
  const missing = await createFixture();
  response = await handleIdentityResolutionApi(reviewRequest(latestBody(missing, { reason: "short" })), missing.env);
  assert.equal(response.status, 422); missing.raw.close();
  const stale = await createFixture();
  response = await handleIdentityResolutionApi(reviewRequest(latestBody(stale, { proposalVersion: 2 })), stale.env);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "IDENTITY_VERSION_LOCK_STALE"); stale.raw.close();
  const fingerprintStale = await createFixture();
  fingerprintStale.raw.prepare("UPDATE library_products SET description='Changed after analysis' WHERE id='product_z_alt'").run();
  response = await handleIdentityResolutionApi(reviewRequest(latestBody(fingerprintStale), "Library Manager", "review-fingerprint-stale"), fingerprintStale.env);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "IDENTITY_PROPOSAL_STALE"); fingerprintStale.raw.close();
  const approved = await createFixture();
  response = await handleIdentityResolutionApi(reviewRequest(latestBody(approved)), approved.env);
  assert.equal(response.status, 201); assert.equal((await response.json()).decision, "Approve for Application");
  assert.equal(approved.raw.prepare("SELECT count(*) n FROM identity_proposal_reviews").get().n, 1);
  assert.equal(approved.raw.prepare("SELECT count(*) n FROM identity_decision_audit WHERE action LIKE 'Review%'").get().n, 1);
  const reviewActor = approved.raw.prepare("SELECT reviewed_by,reviewed_role FROM identity_proposal_reviews").get(); assert.equal(reviewActor.reviewed_by, "manager-1"); assert.equal(reviewActor.reviewed_role, "Library Manager");
  approved.raw.close();
});

test("authenticated reviewer, manager and administrator receive only durable library capabilities", async () => {
  const reviewer = await createFixture();
  let response = await handleIdentityResolutionApi(reviewRequest(latestBody(reviewer, { decision: "Request Evidence" }), "Library Reviewer", "reviewer-evidence"), reviewer.env);
  assert.equal(response.status, 201);
  response = await handleIdentityResolutionApi(operationRequest("proposals/proposal_fixture/apply", "Library Reviewer", "reviewer-apply", { reason: "Reviewer must not apply governed identity" }), reviewer.env);
  assert.equal(response.status, 403);
  response = await handleIdentityResolutionApi(operationRequest("decisions/not-used/reverse", "Library Reviewer", "reviewer-reverse", { reason: "Reviewer must not reverse governed identity" }), reviewer.env);
  assert.equal(response.status, 403); reviewer.raw.close();

  for (const permission of ["Library Manager", "Administrator"]) {
    const fixture = await createFixture();
    response = await handleIdentityResolutionApi(reviewRequest(latestBody(fixture), permission, `${permission}-review`), fixture.env); assert.equal(response.status, 201);
    response = await handleIdentityResolutionApi(operationRequest("proposals/proposal_fixture/apply", permission, `${permission}-apply`, { reason: "Verified governed application permission test" }), fixture.env); assert.equal(response.status, 201); const applied = await response.json();
    response = await handleIdentityResolutionApi(operationRequest(`decisions/${applied.decisionId}/reverse`, permission, `${permission}-reverse`, { reason: "Verified governed reversal permission test" }), fixture.env); assert.equal(response.status, 201);
    const actors = fixture.raw.prepare("SELECT DISTINCT actor_id,actor_role FROM identity_decision_audit ORDER BY actor_id").all();
    assert.equal(actors.length, 1); assert.equal(actors[0].actor_id, userForPermission[permission]); assert.equal(actors[0].actor_role, permission); fixture.raw.close();
  }
});

test("synthetic IR-040 apply preserves observations and prices without downstream mutation", async () => {
  const fixture = await createFixture();
  await handleIdentityResolutionApi(reviewRequest(latestBody(fixture)), fixture.env);
  const downstreamBefore = Object.fromEntries(["product_match_candidates", "safety_decisions", "pricing_lines", "review_decisions", "dashboard_audit_log", "excel_export_jobs"].map((table) => [table, fixture.raw.prepare(`SELECT json_group_array(json_object('id',id,'payload',payload)) value FROM ${table}`).get().value]));
  const result = await applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Apply reviewed synthetic punctuation identity", idempotencyKey: "apply-key-0001" });
  assert.equal(result.status, "Applied"); assert.equal(result.movedReferences, 2); assert.equal(result.observationsPreserved, 2);
  assert.equal(fixture.raw.prepare("SELECT identity_status FROM library_products WHERE id='product_z_alt'").get().identity_status, "Superseded");
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM manufacturer_order_code_observations WHERE status='Active'").get().n, 2);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM product_source_evidence WHERE product_id='product_a_target'").get().n, 2);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM price_records WHERE product_id='product_a_target'").get().n, 2);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM price_records").get().n, 2);
  const downstreamAfter = Object.fromEntries(Object.keys(downstreamBefore).map((table) => [table, fixture.raw.prepare(`SELECT json_group_array(json_object('id',id,'payload',payload)) value FROM ${table}`).get().value]));
  assert.deepEqual(downstreamAfter, downstreamBefore);
  const duplicate = await applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Duplicate synthetic application request", idempotencyKey: "apply-key-0002" });
  assert.equal(duplicate.idempotent, true); assert.equal(fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions WHERE decision_type='Apply'").get().n, 1);
  fixture.raw.close();
});

test("apply transaction rolls back completely after injected failure", async () => {
  const fixture = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(fixture)), fixture.env);
  await assert.rejects(() => applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Exercise atomic rollback for fixture", idempotencyKey: "apply-fail-0001", injectFailure: true }));
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n, 0);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM manufacturer_order_code_observations").get().n, 0);
  assert.equal(fixture.raw.prepare("SELECT product_id FROM product_source_evidence WHERE id='evidence_product_z_alt'").get().product_id, "product_z_alt");
  assert.equal(fixture.raw.prepare("SELECT product_id FROM price_records WHERE id='price_product_z_alt'").get().product_id, "product_z_alt");
  assert.equal(fixture.raw.prepare("SELECT identity_status FROM library_products WHERE id='product_z_alt'").get().identity_status, "Active");
  assert.equal(fixture.raw.prepare("SELECT status FROM product_conflicts WHERE id='conflict_fixture'").get().status, "Open"); fixture.raw.close();
});

test("concurrent synthetic apply attempts produce exactly one mutation", async () => {
  const fixture = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(fixture)), fixture.env);
  const results = await Promise.all([
    applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "First concurrent fixture application", idempotencyKey: "concurrent-apply-1" }),
    applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Second concurrent fixture application", idempotencyKey: "concurrent-apply-2" }),
  ]);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions WHERE decision_type='Apply'").get().n, 1);
  assert.equal(results.filter((entry) => entry.idempotent === false).length, 1);
  assert.equal(results.filter((entry) => entry.idempotent === true).length, 1); fixture.raw.close();
});

test("synthetic reversal restores identity and references and rejects double reversal", async () => {
  const fixture = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(fixture)), fixture.env);
  const applied = await applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Apply fixture before reversal validation", idempotencyKey: "apply-reverse-1" });
  const reversed = await reverseIdentityDecision(fixture.env, { decisionId: applied.decisionId, actor: fixture.actor, reason: "Restore exact synthetic identity ownership", idempotencyKey: "reverse-key-0001" });
  assert.equal(reversed.status, "Reversed"); assert.equal(reversed.restoredReferences, 2);
  assert.equal(fixture.raw.prepare("SELECT identity_status FROM library_products WHERE id='product_z_alt'").get().identity_status, "Active");
  assert.equal(fixture.raw.prepare("SELECT superseded_by_product_id value FROM library_products WHERE id='product_z_alt'").get().value, null);
  assert.equal(fixture.raw.prepare("SELECT product_id FROM product_source_evidence WHERE id='evidence_product_z_alt'").get().product_id, "product_z_alt");
  assert.equal(fixture.raw.prepare("SELECT product_id FROM price_records WHERE id='price_product_z_alt'").get().product_id, "product_z_alt");
  assert.equal(fixture.raw.prepare("SELECT status FROM product_conflicts WHERE id='conflict_fixture'").get().status, "Open");
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM manufacturer_order_code_observations WHERE status='Reversed'").get().n, 2);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n, 2);
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM identity_decision_audit").get().n, 3);
  const sameKey = await reverseIdentityDecision(fixture.env, { decisionId: applied.decisionId, actor: fixture.actor, reason: "Restore exact synthetic identity ownership", idempotencyKey: "reverse-key-0001" });
  assert.equal(sameKey.idempotent, true);
  await assert.rejects(() => reverseIdentityDecision(fixture.env, { decisionId: applied.decisionId, actor: fixture.actor, reason: "Attempt forbidden second reversal", idempotencyKey: "reverse-key-0002" }), (error) => error.code === "IDENTITY_DECISION_ALREADY_REVERSED"); fixture.raw.close();
});

test("Needs Review and 4.7K versus 47K proposals cannot be approved or applied", async () => {
  for (const kind of ["color", "resistor"]) {
    const fixture = await createFixture(kind);
    const response = await handleIdentityResolutionApi(reviewRequest(latestBody(fixture), "Library Manager", `review-${kind}`), fixture.env);
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "IDENTITY_PROPOSAL_NOT_APPLICABLE");
    assert.notEqual(fixture.analysis.outcome, "Existing Product");
    fixture.raw.prepare("INSERT INTO identity_proposal_reviews (id,proposal_id,decision,reason,proposal_version,proposal_fingerprint,ruleset_version_id,ruleset_checksum,conflict_id,conflict_version,product_versions_json,canonical_product_id,revalidation_fingerprint,reviewed_by,reviewed_role,idempotency_key) VALUES (?, 'proposal_fixture','Approve for Application','Synthetic negative-path review',1,?,?,?,'conflict_fixture',1,?,'product_a_target',?,'fixture','Administrator',?)").run(`forced_review_${kind}`, fixture.analysis.proposalFingerprint, fixture.ruleset.id, fixture.ruleset.checksum, JSON.stringify({ product_a_target: 1, product_z_alt: 1 }), fixture.analysis.proposalFingerprint, `forced-${kind}`);
    await assert.rejects(() => applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Must reject forbidden proposal application", idempotencyKey: `apply-forbidden-${kind}` }), (error) => error.code === "IDENTITY_PROPOSAL_NOT_APPLICABLE");
    assert.equal(fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n, 0); fixture.raw.close();
  }
});

test("governance routes are singular and no bulk apply path exists", async () => {
  const source = await readFile(new URL("../worker/identity-resolution-api.mjs", import.meta.url), "utf8");
  assert.match(source, /proposals\\\/\(\[\^\/\]\+\)\\\/\(review\|apply\)/);
  assert.match(source, /decisions\\\/\(\[\^\/\]\+\)\\\/reverse/);
  assert.doesNotMatch(source, /bulk[-/]apply/i);
});

test("organization scope prevents cross-organization reads and mutation", async () => {
  const fixture = await createFixture();
  fixture.raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org-a','Organization A'),('org-b','Organization B');
    INSERT INTO organization_memberships (id,organization_id,user_id,status,granted_by) VALUES ('org-a-manager','org-a','manager-1','Active','fixture');
    UPDATE library_products SET library_scope='Organization Library',organization_id='org-b' WHERE id IN ('product_a_target','product_z_alt');
    UPDATE product_conflicts SET library_scope='Organization Library',organization_id='org-b' WHERE id='conflict_fixture';
    UPDATE identity_resolution_runs SET library_scope='Organization Library',organization_id='org-b' WHERE id='run_fixture';
    UPDATE identity_resolution_cases SET library_scope='Organization Library',organization_id='org-b' WHERE id='case_fixture';
    UPDATE identity_resolution_candidates SET library_scope='Organization Library',organization_id='org-b' WHERE case_id='case_fixture';
    UPDATE identity_resolution_proposals SET library_scope='Organization Library',organization_id='org-b' WHERE id='proposal_fixture';
  `);
  const headers = { "oai-authenticated-user-id": "manager-1", "oai-authenticated-user-email": "manager-1@example.test" };
  let response = await handleIdentityResolutionApi(new Request("https://local/api/identity-resolution/conflicts", { headers }), fixture.env);
  assert.equal(response.status, 200); assert.equal((await response.json()).conflicts.length, 0);
  response = await handleIdentityResolutionApi(new Request("https://local/api/identity-resolution/runs/run_fixture", { headers }), fixture.env);
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "ORGANIZATION_ACCESS_DENIED");
  response = await handleIdentityResolutionApi(new Request("https://local/api/identity-resolution/cases/case_fixture", { headers }), fixture.env);
  assert.equal(response.status, 403);
  response = await handleIdentityResolutionApi(reviewRequest(latestBody(fixture), "Library Manager", "org-b-denied"), fixture.env);
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "ORGANIZATION_ACCESS_DENIED");
  fixture.raw.prepare("INSERT INTO organization_memberships (id,organization_id,user_id,status,granted_by) VALUES ('org-b-manager','org-b','manager-1','Active','fixture')").run();
  response = await handleIdentityResolutionApi(reviewRequest(latestBody(fixture), "Library Manager", "org-b-approved"), fixture.env);
  assert.equal(response.status, 201); assert.equal((await response.json()).scope.organizationId, "org-b");
  fixture.raw.close();
});

test("client-supplied organization and project scope fields are rejected", async () => {
  const fixture = await createFixture();
  const response = await handleIdentityResolutionApi(reviewRequest(latestBody(fixture, { organizationId: "forged-org" }), "Library Manager", "forged-scope"), fixture.env);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "PRODUCT_SCOPE_MISMATCH");
  assert.equal(fixture.raw.prepare("SELECT count(*) n FROM identity_proposal_reviews").get().n, 0);
  fixture.raw.close();
});

test("mutation-time compare-and-swap rejects every stale apply lock atomically", async () => {
  const mutations = [
    ["target version", (raw) => raw.prepare("UPDATE library_products SET identity_version=identity_version+1 WHERE id='product_a_target'").run()],
    ["non-target version", (raw) => raw.prepare("UPDATE library_products SET identity_version=identity_version+1 WHERE id='product_z_alt'").run()],
    ["conflict version", (raw) => raw.prepare("UPDATE product_conflicts SET conflict_version=conflict_version+1 WHERE id='conflict_fixture'").run()],
    ["proposal fingerprint", (raw) => raw.prepare("UPDATE identity_resolution_proposals SET proposal_fingerprint='changed' WHERE id='proposal_fixture'").run()],
    ["ruleset version", (raw) => { raw.prepare("INSERT INTO identity_ruleset_versions (id,semantic_version,checksum,status,rules_json,created_by) VALUES ('ruleset_changed','changed','changed','Active','{}','fixture')").run(); raw.prepare("UPDATE identity_resolution_runs SET ruleset_version_id='ruleset_changed' WHERE id='run_fixture'").run(); }],
    ["review state", (raw) => raw.prepare("UPDATE identity_proposal_reviews SET decision='Reject' WHERE proposal_id='proposal_fixture'").run()],
    ["product status", (raw) => raw.prepare("UPDATE library_products SET identity_status='Superseded' WHERE id='product_z_alt'").run()],
    ["library scope", (raw) => raw.prepare("UPDATE library_products SET library_scope='Organization Library' WHERE id='product_z_alt'").run()],
    ["evidence owner", (raw) => raw.prepare("UPDATE product_source_evidence SET product_id='product_a_target' WHERE id='evidence_product_z_alt'").run()],
    ["price owner", (raw) => raw.prepare("UPDATE price_records SET product_id='product_a_target' WHERE id='price_product_z_alt'").run()],
    ["reference deleted", (raw) => { raw.prepare("DELETE FROM canonical_evidence_integrity WHERE evidence_id='evidence_product_z_alt'").run(); raw.prepare("DELETE FROM product_source_evidence WHERE id='evidence_product_z_alt'").run(); }],
    ["reference count", (raw) => raw.prepare("INSERT INTO price_records (id,product_id,source_id,amount_minor,currency,price_type,validity_state,source_location) VALUES ('late-price','product_z_alt','source_fixture',1,'USD','Historical','Historical','{}')").run()],
  ];
  for (const [name, mutate] of mutations) {
    const fixture = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(fixture)), fixture.env);
    const before = { decisions: fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n, audits: fixture.raw.prepare("SELECT count(*) n FROM identity_decision_audit").get().n };
    await assert.rejects(() => applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: `CAS failure test for ${name}`, idempotencyKey: `cas-${String(name).replaceAll(" ", "-")}`, beforeMutation: () => mutate(fixture.raw) }), (error) => error.code === "IDENTITY_MUTATION_STALE");
    assert.equal(fixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n, before.decisions, name);
    assert.equal(fixture.raw.prepare("SELECT count(*) n FROM identity_decision_audit").get().n, before.audits, name);
    assert.equal(fixture.raw.prepare("SELECT count(*) n FROM manufacturer_order_code_observations").get().n, 0, name);
    assert.equal(fixture.raw.prepare("SELECT count(*) n FROM identity_reference_moves").get().n, 0, name);
    assert.equal(fixture.raw.prepare("SELECT count(*) n FROM identity_mutation_failures WHERE error_code='IDENTITY_MUTATION_STALE'").get().n, 1, name);
    fixture.raw.close();
  }
});

test("review and reverse guards fail stale mutations before audit or decision commit", async () => {
  const reviewFixture = await createFixture();
  await assert.rejects(() => reviewIdentityProposal(reviewFixture.env, { proposalId: "proposal_fixture", actor: reviewFixture.actor, body: latestBody(reviewFixture), idempotencyKey: "stale-review", beforeMutation: () => reviewFixture.raw.prepare("UPDATE product_conflicts SET conflict_version=2 WHERE id='conflict_fixture'").run() }), (error) => error.code === "IDENTITY_MUTATION_STALE");
  assert.equal(reviewFixture.raw.prepare("SELECT count(*) n FROM identity_proposal_reviews").get().n, 0);
  assert.equal(reviewFixture.raw.prepare("SELECT count(*) n FROM identity_decision_audit").get().n, 0); reviewFixture.raw.close();

  const reverseFixture = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(reverseFixture)), reverseFixture.env);
  const applied = await applyIdentityProposal(reverseFixture.env, { proposalId: "proposal_fixture", actor: reverseFixture.actor, reason: "Prepare fixture for stale reversal", idempotencyKey: "prepare-reverse" });
  const beforeDecisions = reverseFixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n;
  await assert.rejects(() => reverseIdentityDecision(reverseFixture.env, { decisionId: applied.decisionId, actor: reverseFixture.actor, reason: "Reject stale reverse transaction", idempotencyKey: "stale-reverse", beforeMutation: () => reverseFixture.raw.prepare("UPDATE library_products SET identity_version=identity_version+1 WHERE id='product_a_target'").run() }), (error) => error.code === "IDENTITY_MUTATION_STALE");
  assert.equal(reverseFixture.raw.prepare("SELECT count(*) n FROM governed_identity_decisions").get().n, beforeDecisions);
  assert.equal(reverseFixture.raw.prepare("SELECT identity_status FROM library_products WHERE id='product_z_alt'").get().identity_status, "Superseded"); reverseFixture.raw.close();
});

test("idempotency key is payload-bound and concurrent apply/reverse remains deterministic", async () => {
  const fixture = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(fixture)), fixture.env);
  const applied = await applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Stable payload for idempotency", idempotencyKey: "payload-bound" });
  const replay = await applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Stable payload for idempotency", idempotencyKey: "payload-bound" });
  assert.equal(replay.idempotent, true); assert.equal(replay.decisionId, applied.decisionId);
  await assert.rejects(() => applyIdentityProposal(fixture.env, { proposalId: "proposal_fixture", actor: fixture.actor, reason: "Different payload using same key", idempotencyKey: "payload-bound" }), (error) => error.code === "IDEMPOTENCY_KEY_REUSED");
  fixture.raw.close();

  const racing = await createFixture(); await handleIdentityResolutionApi(reviewRequest(latestBody(racing)), racing.env);
  const applyPromise = applyIdentityProposal(racing.env, { proposalId: "proposal_fixture", actor: racing.actor, reason: "Concurrent apply side of race", idempotencyKey: "race-apply" });
  const reversePromise = reverseIdentityDecision(racing.env, { decisionId: "identitydecision_not_yet_committed", actor: racing.actor, reason: "Concurrent reverse side of race", idempotencyKey: "race-reverse" });
  const results = await Promise.allSettled([applyPromise, reversePromise]);
  assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected");
  assert.equal(racing.raw.prepare("SELECT count(*) n FROM governed_identity_decisions WHERE decision_type='Apply'").get().n, 1); racing.raw.close();
});
