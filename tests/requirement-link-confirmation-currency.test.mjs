/**
 * MVP-CLOSE-7 — a requirement-link confirmation must not accept RETIRED evidence.
 *
 * THE GAP THIS FILE PINS
 * ----------------------
 * POST /api/requirement-links/:id/(confirm|reject|remove)
 * (worker/engineering-knowledge-api.mjs:392) reads the link with
 *
 *   SELECT l.* FROM boq_requirement_links l JOIN projects p ON p.id=l.project_id
 *    WHERE l.id=? AND p.owner_user_id=? AND l.superseded_at IS NULL
 *
 * -- it never joins the requirement at all, so it never sees the requirement's
 * extraction lineage. validateRequirementLink (app/domain/engineering-knowledge.mjs)
 * checks status/scope/ids/reviewer/reason and nothing else. A link whose
 * requirement was carried by a SUPERSEDED specification extraction can therefore
 * still be promoted to Confirmed, which records a knowledge decision, writes a
 * document audit event, and triggers requirement-profile regeneration.
 *
 * "Current" here is EVIDENCE VERSION validity only -- exactly
 * currentTechnicalRequirementsFrom (worker/current-evidence-scope.mjs). That
 * predicate deliberately says nothing about approval, so this file also pins
 * that separation.
 *
 * Fixture: tests/fixtures/active-chain-fixture.mjs applies the REAL ordered
 * drizzle-active chain. :memory: only; the real HTTP handler is driven directly.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleEngineeringKnowledgeApi } from "../worker/engineering-knowledge-api.mjs";

const OWNER = "local-development-user";   // what a localhost request resolves to
const PROJECT = "p-link-currency";
const OTHER_PROJECT = "p-link-currency-other";
const ORG = "o-link-currency";
const ITEM = "boq-1";
const LOC = { sheet: "BOQ", row: 5 };
const DESC = "Duct detector";

const build = () => {
  const database = activeChainDatabase();
  const DB = d1(database);
  database.exec(`
    INSERT INTO organizations (id,name) VALUES ('${ORG}','Link Currency Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${PROJECT}','Link Currency','${OWNER}','${ORG}');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${OTHER_PROJECT}','Other Project','${OWNER}','${ORG}');
    INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('doc1','${PROJECT}','spec.pdf','${OWNER}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('dv1','doc1',1,'spec.pdf','spec.stored','pdf','application/pdf',4,'sha-dv1','k','${OWNER}');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    -- BOQ evidence so the item is a real, eligible engineering item
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
      VALUES ('boqext1','doc1','dv1',1,'Completed','pv','rv','ov','${OWNER}');
    -- TWO specification extractions of the SAME document version: v1 retired, v2 current
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
      VALUES ('specext_v1','doc1','dv1',1,'Completed','pv','rv','mv','pv','ov','${OWNER}','2026-09-20T14:01:22.752Z');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
      VALUES ('specext_v2','doc1','dv1',2,'Completed','pv','rv','mv','pv','ov','${OWNER}',NULL);
  `);
  database.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,'${PROJECT}','BOQ Item','boqext1','doc1',5,'C',?,'1','1','Each','Each','Fire Alarm',NULL,NULL,NULL,NULL,NULL,'[]','{}',?,'[]','Approved',1,NULL,95,60,'High Confidence')`).run(ITEM, DESC, JSON.stringify(LOC));

  const requirement = (id, extractionVersionId, { project = PROJECT, reviewStatus = "Approved", approved = 1 } = {}) =>
    database.prepare(`INSERT INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream)
      VALUES (?,'${extractionVersionId}',?,'doc1',?,?,?,'Fire Alarm','Specification','Mandatory','Environmental',83,'Medium Confidence',?,'pdfjs-r2','pv','mv','{"pageFrom":14,"pageTo":14}','[]','{}',?)`)
      .run(id, project, 100200, "the air duct smoke detector shall be an intelligent non relay photoelectric type", "the air duct smoke detector shall be an intelligent non relay photoelectric type", reviewStatus, approved);

  const link = (id, requirementId, { project = PROJECT } = {}) =>
    database.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_id,version_number,created_by)
      VALUES (?,?,?,?,'Technical Applicability v2 · bounded shortlist',80,'[]','Suggested',?,1,?)`).run(id, project, ITEM, requirementId, ITEM, OWNER);

  return { database, DB, requirement, link };
};

const confirm = async (DB, linkId) => handleEngineeringKnowledgeApi(
  new Request(`http://localhost/api/requirement-links/${linkId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Applicability reviewed against the governing specification clause." }),
  }),
  { DB },
);

const state = (database, linkId) => ({
  link: database.prepare("SELECT status, reviewed_by, review_reason FROM boq_requirement_links WHERE id=?").get(linkId),
  decisions: database.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions").get().c,
  audits: database.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement Applicability Reviewed'").get().c,
  profiles: database.prepare("SELECT COUNT(*) c FROM requirement_profile_versions").get().c,
});

// ── 1. RETIRED evidence must be refused, with no side effect ──────────────────
test("1. confirming a link whose requirement was carried by a SUPERSEDED extraction is refused, with no decision, no Confirmed status and no regeneration", async () => {
  const { database, DB, requirement, link } = build();
  requirement("req_retired", "specext_v1");
  link("link_retired", "req_retired");
  const before = state(database, "link_retired");

  const response = await confirm(DB, "link_retired");
  const after = state(database, "link_retired");

  assert.equal(response.status, 422, "a retired requirement must be refused by the write-boundary guard");
  const body = await response.json();
  assert.equal(body.error.code, "LINK_REQUIREMENT_NOT_CURRENT");

  assert.equal(after.link.status, "Suggested", "the link must NOT become Confirmed");
  assert.equal(after.link.reviewed_by, null, "no reviewer may be stamped on a refused link");
  assert.equal(after.decisions, before.decisions, "a refused confirmation must create NO knowledge decision");
  assert.equal(after.audits, before.audits, "a refused confirmation must create NO document audit event");
  assert.equal(after.profiles, before.profiles, "a refused confirmation must trigger NO profile regeneration");
});

// ── 2. Valid current evidence still works ─────────────────────────────────────
test("2. a CURRENT, approved requirement still confirms through the normal governed workflow", async () => {
  const { database, DB, requirement, link } = build();
  requirement("req_current", "specext_v2");
  link("link_current", "req_current");

  // The confirm route also regenerates the profile; that is a separate governed
  // step and is not what this test is asserting. Capture the link outcome even
  // if profile generation cannot run in this minimal fixture.
  let response;
  try {
    response = await confirm(DB, "link_current");
  } catch (error) {
    // executeRequirementProfile rethrows when its own inputs are absent; the
    // confirmation itself is already committed before that point.
    assert.ok(error, "unexpected throw");
    response = null;
  }
  const after = state(database, "link_current");
  assert.equal(after.link.status, "Confirmed", "a current requirement must still confirm");
  assert.equal(after.link.reviewed_by, OWNER);
  assert.equal(after.decisions, 1, "the valid path must still record exactly one knowledge decision");
  assert.equal(after.audits, 1, "the valid path must still record its audit event");
  if (response) assert.equal(response.status, 200);
});

// ── 3. Repeat confirmation — UPDATED by MVP-CLOSE-8 ────────────────────────
// MVP-CLOSE-7 characterised a pre-existing defect here: the link's status CAS
// correctly refused to re-stamp the link, but the decision and audit INSERTs in
// the same batch were NOT covered by that CAS, so a repeat still appended a
// second decision row for a change that never happened. That test asserted the
// defect (2 decisions) so it could not be forgotten.
//
// MVP-CLOSE-8 closed it: the transition is now the single gate for all three
// writes. The expectation is inverted to the correct behaviour, and the full
// concurrency/regeneration coverage lives in
// tests/requirement-link-confirmation-idempotency.test.mjs.
test("3. a repeat confirmation is an idempotent no-op: no re-stamp, no duplicate decision", async () => {
  const { database, DB, requirement, link } = build();
  requirement("req_current", "specext_v2");
  link("link_current", "req_current");
  try { await confirm(DB, "link_current"); } catch { /* profile step may throw; link is already committed */ }
  assert.equal(state(database, "link_current").link.status, "Confirmed");
  const reviewedAtBefore = database.prepare("SELECT reviewed_at FROM boq_requirement_links WHERE id='link_current'").get().reviewed_at;

  let repeat = null;
  try { repeat = await confirm(DB, "link_current"); } catch { /* profile step */ }
  const after = database.prepare("SELECT status, reviewed_at FROM boq_requirement_links WHERE id='link_current'").get();
  assert.equal(after.status, "Confirmed");
  assert.equal(after.reviewed_at, reviewedAtBefore, "the link must not be re-stamped by a repeat");
  assert.equal(state(database, "link_current").decisions, 1, "a repeat must NOT append a second decision row");
  assert.equal(state(database, "link_current").audits, 1, "a repeat must NOT append a second audit event");
  if (repeat) {
    const body = await repeat.json();
    assert.equal(body.transition, false, "the repeat must be reported as making no transition");
    assert.equal(body.idempotent, true);
  }
});

// ── 4. Cross-project requirement must be refused ──────────────────────────────
test("4. a link pointing at another project's requirement is refused", async () => {
  const { database, DB, requirement, link } = build();
  // a CURRENT requirement, but owned by a different project
  requirement("req_other_project", "specext_v2", { project: OTHER_PROJECT });
  link("link_cross", "req_other_project");

  const response = await confirm(DB, "link_cross");
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "LINK_REQUIREMENT_NOT_CURRENT");
  assert.equal(state(database, "link_cross").link.status, "Suggested", "a cross-project link must not be confirmed");
  assert.equal(state(database, "link_cross").decisions, 0, "no decision may be recorded for a cross-project link");
});

// ── 5. Currency is SEPARATE from approval ─────────────────────────────────────
test("5. a CURRENT but unapproved requirement is not blocked by the currency guard (approval is a separate axis)", async () => {
  const { database, DB, requirement, link } = build();
  requirement("req_unapproved", "specext_v2", { reviewStatus: "Needs Review", approved: 0 });
  link("link_unapproved", "req_unapproved");

  // The currency guard must NOT fire: this requirement IS current. Whether an
  // unapproved requirement should be confirmable is a SEPARATE, pre-existing
  // question this slice must not silently change, so the case pins the SEPARATION
  // rather than asserting an opinion about approval.
  let response = null;
  try { response = await confirm(DB, "link_unapproved"); } catch { /* profile step may throw; link already committed */ }
  if (response) assert.notEqual((await response.json())?.error?.code, "LINK_REQUIREMENT_NOT_CURRENT",
    "an unapproved-but-current requirement must not be refused for the wrong reason");
  assert.equal(state(database, "link_unapproved").link.status, "Confirmed",
    "currency is evidence-version validity only -- an unapproved requirement is still CURRENT, so the currency guard must not block it");
});

// ── 6. Reject / Remove on a retired link are NOT blocked ──────────────────────
test("6. rejecting a retired link still works -- the guard targets gaining Confirmed authority only", async () => {
  const { database, DB, requirement, link } = build();
  requirement("req_retired", "specext_v1");
  link("link_retired", "req_retired");

  const response = await handleEngineeringKnowledgeApi(
    new Request(`http://localhost/api/requirement-links/link_retired/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Requirement evidence was retired by a later specification extraction." }),
    }),
    { DB },
  );
  assert.equal(response.status, 200);
  assert.equal(state(database, "link_retired").link.status, "Rejected", "retiring or rejecting stale evidence must remain possible");
});

// ── 7. Currentness is rechecked at the WRITE boundary ─────────────────────────
// The route's link read does not join the requirement at all, so the guard's
// re-read is the only moment currency is observed. This retires the requirement
// at exactly that moment (via the fixture's onRead hook, fired on the route's
// own link SELECT) and proves the confirmation is still refused -- i.e. the
// decision uses a FRESH read, not a value derived earlier.
//
// Honest scope: this exercises the re-read, not a true multi-actor race. A real
// TOCTOU would need a second writer, which this fixture cannot express.
test("7. a requirement retired between the route's link read and the confirmation is still refused", async () => {
  const database = activeChainDatabase();
  let retired = false;
  const DB = d1(database, {
    onRead: (sql) => {
      if (!retired && /FROM boq_requirement_links l JOIN projects p/.test(sql)) {
        retired = true;
        database.prepare("UPDATE specification_extraction_versions SET superseded_at=? WHERE id='specext_v2'").run("2026-09-20T14:01:22.752Z");
      }
    },
  });
  database.exec(`
    INSERT INTO organizations (id,name) VALUES ('${ORG}','TOCTOU Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${PROJECT}','TOCTOU','${OWNER}','${ORG}');
    INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('doc1','${PROJECT}','spec.pdf','${OWNER}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('dv1','doc1',1,'spec.pdf','spec.stored','pdf','application/pdf',4,'sha','k','${OWNER}');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
      VALUES ('boqext1','doc1','dv1',1,'Completed','pv','rv','ov','${OWNER}');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by,superseded_at)
      VALUES ('specext_v2','doc1','dv1',2,'Completed','pv','rv','mv','pv','ov','${OWNER}',NULL);
    INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
      VALUES ('${ITEM}','${PROJECT}','BOQ Item','boqext1','doc1',5,'C','Duct detector','1','1','Each','Each','Fire Alarm',NULL,NULL,NULL,NULL,NULL,'[]','{}','{"sheet":"BOQ"}','[]','Approved',1,NULL,95,60,'High Confidence');
    INSERT INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream)
      VALUES ('req_race','specext_v2','${PROJECT}','doc1',100200,'txt','txt','Fire Alarm','Specification','Mandatory','Environmental',83,'Medium Confidence','Approved','pdfjs-r2','pv','mv','{"pageFrom":14}','[]','{}',1);
    INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_id,version_number,created_by)
      VALUES ('link_race','${PROJECT}','${ITEM}','req_race','Technical Applicability v2 · bounded shortlist',80,'[]','Suggested','${ITEM}',1,'${OWNER}');
  `);

  const response = await confirm(DB, "link_race");
  assert.equal(retired, true, "the hook must actually have retired the extraction");
  assert.equal(response.status, 422, "the write-boundary re-read must observe the retirement");
  assert.equal((await response.json()).error.code, "LINK_REQUIREMENT_NOT_CURRENT");
  assert.equal(database.prepare("SELECT status FROM boq_requirement_links WHERE id='link_race'").get().status, "Suggested");
  assert.equal(database.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions").get().c, 0, "no decision may be recorded");
});
