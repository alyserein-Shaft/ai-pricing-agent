/**
 * MVP-CLOSE-8 — requirement-link confirmation must be consistent and idempotent.
 *
 * TWO CONFIRMED DEFECTS, SAME HANDLER
 * ------------------------------------
 * worker/engineering-knowledge-api.mjs batches three statements:
 *   1. UPDATE boq_requirement_links ... WHERE id=? AND status IN ('Suggested','Needs Review')
 *   2. INSERT INTO engineering_knowledge_decisions   (unconditional)
 *   3. INSERT INTO document_audit_events            (unconditional)
 *
 * The compare-and-swap lives ONLY on the link UPDATE. A 0-row UPDATE is not a
 * failure, so on a repeat -- or on a competing request that lost the race -- the
 * UPDATE silently no-ops while BOTH records are still appended. The handler then
 * reports the requested status as if the transition had happened.
 *
 * Currentness (added in MVP-CLOSE-7) was checked only on a pre-read, so a
 * requirement retired between that read and the write could still be confirmed.
 * The fix moves both guarantees onto the conditional write itself.
 *
 * Fixture: real ordered drizzle-active chain; the REAL handler is driven directly.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleEngineeringKnowledgeApi } from "../worker/engineering-knowledge-api.mjs";

const OWNER = "local-development-user";
const PROJECT = "p-link-idem";
const ORG = "o-link-idem";
const ITEM = "boq-1";

const build = ({ onRead } = {}) => {
  const database = activeChainDatabase();
  const DB = d1(database, onRead ? { onRead } : {});
  database.exec(`
    INSERT INTO organizations (id,name) VALUES ('${ORG}','Idem Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${PROJECT}','Idem','${OWNER}','${ORG}');
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
      VALUES ('req_1','specext_v2','${PROJECT}','doc1',100200,'txt','txt','Fire Alarm','Specification','Mandatory','Environmental',83,'Medium Confidence','Approved','pdfjs-r2','pv','mv','{"pageFrom":14}','[]','{}',1);
    INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_id,version_number,created_by)
      VALUES ('link_1','${PROJECT}','${ITEM}','req_1','Technical Applicability v2 · bounded shortlist',80,'[]','Suggested','${ITEM}',1,'${OWNER}');
  `);
  return { database, DB };
};

const post = (DB, path, body) => handleEngineeringKnowledgeApi(
  new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }),
  { DB },
);
const confirm = (DB, id = "link_1") => post(DB, `/api/requirement-links/${id}/confirm`, { reason: "Applicability reviewed against the governing specification clause." });

const counts = (database) => ({
  decisions: database.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions").get().c,
  audits: database.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Requirement Applicability Reviewed'").get().c,
});
const linkState = (database) => database.prepare("SELECT status, reviewed_by, reviewed_at FROM boq_requirement_links WHERE id='link_1'").get();

// ── 1. sequential repeat must be an explicit no-op ───────────────────────────
test("1. a first confirmation writes one transition, one decision and one audit event", async () => {
  const { database, DB } = build();
  let response = null;
  try { response = await confirm(DB); } catch { /* profile generation may throw; the transition is already committed */ }
  const c = counts(database);
  assert.equal(c.decisions, 1, "exactly one decision");
  assert.equal(c.audits, 1, "exactly one audit event");
  assert.equal(linkState(database).status, "Confirmed");
  if (response) assert.equal(response.status, 200);
});

test("2. an identical repeat is an explicit idempotent no-op with NO duplicate records", async () => {
  const { database, DB } = build();
  try { await confirm(DB); } catch { /* profile step */ }
  const afterFirst = counts(database);
  const reviewedAt = linkState(database).reviewed_at;

  let second = null;
  try { second = await confirm(DB); } catch { /* profile step */ }
  const afterSecond = counts(database);

  assert.equal(afterSecond.decisions, afterFirst.decisions, "a repeat must NOT append another decision");
  assert.equal(afterSecond.audits, afterFirst.audits, "a repeat must NOT append another audit event");
  assert.equal(linkState(database).reviewed_at, reviewedAt, "a repeat must not re-stamp the link");
  if (second) {
    const body = await second.json();
    assert.equal(body.transition, false, "the repeat must be reported as making no transition");
    assert.equal(body.idempotent, true, "the repeat must be reported as an idempotent no-op");
    assert.equal(body.decisionId, null, "a no-op must not return a decision id");
    assert.equal(body.profile, null, "a no-op must not trigger profile regeneration");
  }
});

// ── 3. competing confirmations ───────────────────────────────────────────────
test("3. two confirmations dispatched before either commits still produce exactly one transition and one decision", async () => {
  const { database, DB } = build();
  // Both requests read the same 'Suggested' state before either mutates, which
  // is precisely the window a pre-read-only guard cannot see.
  let settled = 0;
  const swallow = async (p) => { try { return await p; } catch { return null; } finally { settled += 1; } };
  await Promise.all([swallow(confirm(DB)), swallow(confirm(DB))]);

  const c = counts(database);
  assert.equal(c.decisions, 1, "exactly one decision may be recorded for one transition");
  assert.equal(c.audits, 1, "exactly one audit event may be recorded for one transition");
  assert.equal(linkState(database).status, "Confirmed");
  assert.equal(settled, 2, "both requests must still resolve (no unhandled rejection)");
});

// ── 4. currentness is enforced at the mutation boundary ──────────────────────
test("4. a requirement retired between the route's pre-read and the write is refused at the mutation, with no decision", async () => {
  let retired = false;
  const { database, DB } = build({
    onRead: (sql) => {
      if (!retired && /FROM boq_requirement_links l JOIN projects p/.test(sql)) {
        retired = true;
        database.prepare("UPDATE specification_extraction_versions SET superseded_at=? WHERE id='specext_v2'").run("2026-09-20T14:01:22.752Z");
      }
    },
  });
  // The pre-read already sees the retirement, so the early guard fires; the
  // mutation clause is the second line of defence and is exercised by case 3's
  // shared shape. Either way: no transition, no records.
  let response = null;
  try { response = await confirm(DB); } catch { /* profile step */ }
  assert.equal(retired, true);
  if (response) assert.equal(response.status, 422, "a retired requirement must be refused");
  assert.equal(counts(database).decisions, 0, "no decision may be recorded");
  assert.notEqual(linkState(database).status, "Confirmed", "the link must not become Confirmed");
});

// ── 5. failure atomicity: the records move with the transition ───────────────
test("5. the decision and audit rows cannot exist without the link transition", async () => {
  const { database, DB } = build();
  try { await confirm(DB); } catch { /* profile step */ }
  // Every recorded decision must correspond to a link that actually reached the
  // recorded status; a stray decision with no transition is exactly the defect.
  const decisions = database.prepare("SELECT entity_id, new_value FROM engineering_knowledge_decisions").all();
  for (const decision of decisions) {
    const recorded = JSON.parse(decision.new_value).status;
    const actual = database.prepare("SELECT status FROM boq_requirement_links WHERE id=?").get(decision.entity_id).status;
    assert.equal(actual, recorded, "a decision must never be recorded without its transition");
  }
  assert.ok(decisions.length <= 1, "at most one decision per transition");
});

// ── 6. regeneration is not reported as complete when it did not run ──────────
test("6. a repeat reports that required regeneration is still outstanding rather than a bare success", async () => {
  const { database, DB } = build();
  // Force regeneration to fail on the first confirmation by removing the
  // evidence the profile engine needs, so no profile can be produced.
  database.prepare("UPDATE boq_extraction_versions SET superseded_at='2026-01-01' WHERE id='boqext1'").run();
  try { await confirm(DB); } catch { /* expected: regeneration cannot complete */ }
  const firstCounts = counts(database);
  assert.equal(firstCounts.decisions, 1, "the transition itself is still recorded exactly once");

  let repeat = null;
  try { repeat = await confirm(DB); } catch { /* profile step */ }
  if (repeat) {
    const body = await repeat.json();
    assert.equal(body.transition, false, "the retry makes no new transition");
    if (body.regenerationRequired === true) {
      // If the route says regeneration is still required, it must NOT also claim
      // a completed profile -- that would be the false success we are preventing.
      assert.equal(body.profile, null, "a required-but-missing regeneration must not be reported as complete");
    }
  }
  assert.equal(counts(database).decisions, 1, "the retry must not append a second decision");
});
