import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildLinkShortlist } from "../worker/engineering-knowledge-api.mjs";
import { scoreRequirementLink as domainScore } from "../app/domain/engineering-knowledge.mjs";

// Real Al Mousa defect, hermetic. `_requirement_456` ("all cables must be sized
// twisted shielded and installed according to the protocols specified by the fire
// alarm system manufacturer") and `_requirement_449` are Approved,
// approved_for_downstream=1, Mandatory, Fire Alarm and genuinely cable-applicable,
// but they score 12 against a "CWZ category fire resistant cable" BOQ row --
// `Same engineering system (+8)` plus `Technical attributes/context: cable (+4)` --
// and `buildLinkShortlist` admits only `confidence >= 25 || (mandatory && >= 15)`.
// They were therefore unreachable through every existing route.
//
// Acceptance A-G. NO project database: a real in-memory SQLite, real handler code.

const PROJECT = "proj-cable";
const OTHER_PROJECT = "proj-foreign";
const USER = "local-development-user";
const HUMAN = "omair";
const REQ_CABLE = "req-456";
const REQ_OTHER = "req-449";
const REQ_UNAPPROVED = "req-unapproved";
const REQ_NOT_DOWNSTREAM = "req-not-downstream";
const REQ_FOREIGN = "req-foreign";

const setup = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, deleted_at TEXT, archived_at TEXT, current_version_id TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, superseded_at TEXT, status TEXT, version_number INT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, project_id TEXT, extraction_version_id TEXT, source_document_id TEXT,
      row_type TEXT, description TEXT, item_number TEXT, sequence INT, system_value TEXT, category TEXT,
      subcategory TEXT, specification_reference TEXT, approved_for_downstream INT);
    CREATE TABLE technical_requirements (id TEXT PRIMARY KEY, project_id TEXT, requirement_type TEXT, requirement_category TEXT,
      category TEXT, system TEXT, engineering_domain TEXT, original_text TEXT, normalized_requirement TEXT,
      condition TEXT, exception TEXT, source_document_id TEXT, source_location TEXT, confidence INT,
      review_status TEXT, approved_for_downstream INT);
    CREATE TABLE boq_requirement_links (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_id TEXT,
      link_method TEXT, confidence REAL, evidence TEXT, status TEXT, scope_type TEXT, scope_id TEXT,
      version_number INT, previous_version_id TEXT, superseded_at TEXT, reviewed_by TEXT, reviewed_at TEXT,
      review_reason TEXT, created_by TEXT);
    CREATE TABLE document_audit_events (id TEXT PRIMARY KEY, project_id TEXT, actor_user_id TEXT, action TEXT,
      old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
    CREATE TABLE engineering_knowledge_decisions (id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT,
      entity_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, evidence TEXT,
      scope_type TEXT, scope_id TEXT, decided_by TEXT, decided_role TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  db.prepare("INSERT INTO projects VALUES (?,?,?,NULL)").run(PROJECT, USER, "org-1");
  db.prepare("INSERT INTO projects VALUES (?,?,?,NULL)").run(OTHER_PROJECT, USER, "org-1");
  db.prepare("INSERT INTO documents VALUES ('doc-1',?,NULL,NULL,'dv-1')").run(PROJECT);
  db.prepare("INSERT INTO document_versions VALUES ('dv-1','doc-1')").run();
  db.prepare("INSERT INTO boq_extraction_versions VALUES ('ex-1','doc-1','dv-1',NULL,'Completed',1)").run();

  const cable = (id, { project = PROJECT, doc = "doc-1", ex = "ex-1", rowType = "BOQ Item" } = {}) =>
    db.prepare("INSERT INTO boq_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)")
      .run(id, project, ex, doc, rowType, "CWZ category fire resistant cable with all accessories", id, 1, "Fire Alarm", "Fire Resistant Cable", null, null);

  cable("CABLE-CURRENT");                       // the real target
  cable("CABLE-STALE", { ex: "ex-superseded" }); // extraction superseded -> not current
  cable("CABLE-HEADING", { rowType: "Section Header" }); // not a BOQ Item
  cable("CABLE-FOREIGN", { project: OTHER_PROJECT });

  db.prepare("INSERT INTO boq_extraction_versions VALUES ('ex-superseded','doc-1','dv-1','2026-01-01','Completed',1)").run();

  const req = (id, { project = PROJECT, status = "Approved", downstream = 1, text = "all cables must be sized twisted shielded and installed according to the protocols specified by the fire alarm system manufacturer" } = {}) =>
    db.prepare(`INSERT INTO technical_requirements
      (id, project_id, requirement_type, requirement_category, category, system, engineering_domain,
       original_text, normalized_requirement, condition, exception, source_document_id,
       source_location, confidence, review_status, approved_for_downstream)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, project, "Mandatory", "Manufacturer", "Manufacturer", "Fire Alarm", "Fire Alarm", text, text, null, null, "doc-1", JSON.stringify({ pageFrom: 12 }), 90, status, downstream);

  req(REQ_CABLE);
  req(REQ_OTHER, { text: "fire alarm cables must be supported by the building structure at intervals not exceeding 10 3 3 05 m" });
  req(REQ_UNAPPROVED, { status: "Needs Review", downstream: 0 });
  req(REQ_NOT_DOWNSTREAM, { status: "Approved", downstream: 0 });
  req(REQ_FOREIGN, { project: OTHER_PROJECT });
  return db;
};

const d1 = (db) => {
  const stmt = (sql, args = []) => {
    const s = db.prepare(sql);
    return {
      bind: (...a) => stmt(sql, a),
      run: async () => { const i = s.run(...args); return { success: true, meta: { changes: Number(i.changes || 0) } }; },
      all: async () => ({ results: s.all(...args), success: true, meta: {} }),
      first: async () => s.get(...args) ?? null,
    };
  };
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list || []) out.push(await s.run()); return out; }, withSession() { return this; } };
};

// The propose-exact route is a HUMAN-AUTHORITY mutation and must fail closed
// without a truthful configured human identity.
const envFor = (db, opts = {}) => {
  const { human } = opts;
  const humanId = "human" in opts ? human : HUMAN;
  return {
    DB: d1(db), APP_ACCESS_MODE: "single-user", LOCAL_DEVELOPMENT_USER_ID: USER,
    APP_HUMAN_ID: humanId, APP_HUMAN_NAME: humanId ? "Omair" : null, APP_ORGANIZATION_ID: "org-1",
  };
};
const BASE = "http://localhost:4183";

const post = async (db, body, envOpts) => {
  const { handleEngineeringKnowledgeApi } = await import("../worker/engineering-knowledge-api.mjs");
  const response = await handleEngineeringKnowledgeApi(
    new Request(`${BASE}/api/requirement-links/propose-exact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }),
    envFor(db, envOpts),
  );
  const text = await response.text();
  return { status: response.status, body: (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() };
};
const REASON = "The BOQ row is the CWZ BS6387 fire resistant cable line and this approved clause governs cable sizing and installation for exactly that cable.";
const propose = (db, boqItemId, requirementId = REQ_CABLE, reason = REASON, envOpts) => post(db, { boqItemId, requirementId, reason }, envOpts);
const currentLink = (db, itemId, reqId) => db.prepare("SELECT * FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id=? AND superseded_at IS NULL").all(itemId, reqId);

test("A: an exact approved Mandatory pair the scorer cannot reach IS accepted as a Suggested candidate", async () => {
  const db = setup();
  const result = await propose(db, "CABLE-CURRENT");
  assert.equal(result.status, 201, JSON.stringify(result.body).slice(0, 300));
  assert.equal(result.body.link.status, "Suggested");
  assert.equal(result.body.requiresSeparateConfirmation, true);
  assert.equal(result.body.link.linkMethod, "Exact Applicability Proposal v1 · human-nominated");

  const rows = currentLink(db, "CABLE-CURRENT", REQ_CABLE);
  assert.equal(rows.length, 1, "exactly one current link row");
  const row = rows[0];
  // The row records the scorer's HONEST verdict, never a fabricated 100.
  assert.equal(row.status, "Suggested", "a proposal can never be pre-confirmed");
  assert.ok(row.confidence < 15, `confidence must stay the real sub-threshold score, got ${row.confidence}`);
  assert.equal(row.created_by, HUMAN, "recorded under the human actor, not the dev user");
  const evidence = JSON.parse(row.evidence);
  assert.equal(evidence.proposalMethod, "Exact Applicability Proposal (human-nominated pair)");
  assert.ok(evidence.scorerVerdict.note.includes("NOT evidence of applicability"));
});

test("B: a foreign-project requirement is refused", async () => {
  const db = setup();
  const result = await propose(db, "CABLE-CURRENT", REQ_FOREIGN);
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "EXACT_LINK_REQUIREMENT_NOT_IN_PROJECT");
  assert.equal(currentLink(db, "CABLE-CURRENT", REQ_FOREIGN).length, 0, "nothing written");
});

test("C: an unapproved requirement is refused (both Needs Review and approved_for_downstream=0)", async () => {
  const db = setup();
  const needsReview = await propose(db, "CABLE-CURRENT", REQ_UNAPPROVED);
  assert.equal(needsReview.status, 409);
  assert.equal(needsReview.body.error.code, "EXACT_LINK_REQUIREMENT_NOT_ELIGIBLE");

  const notDownstream = await propose(db, "CABLE-CURRENT", REQ_NOT_DOWNSTREAM);
  assert.equal(notDownstream.status, 409);
  assert.equal(notDownstream.body.error.code, "EXACT_LINK_REQUIREMENT_NOT_ELIGIBLE");
  assert.equal(currentLink(db, "CABLE-CURRENT", REQ_UNAPPROVED).length, 0);
  assert.equal(currentLink(db, "CABLE-CURRENT", REQ_NOT_DOWNSTREAM).length, 0);
});

test("D: a stale / non-BOQ-Item / unknown row is refused by the canonical scope, with no special case", async () => {
  const db = setup();
  for (const id of ["CABLE-STALE", "CABLE-HEADING", "CABLE-FOREIGN", "NO-SUCH-ITEM"]) {
    const result = await propose(db, id);
    assert.equal(result.status, 404, `${id} must be refused`);
    assert.equal(result.body.error.code, "BOQ_ITEM_NOT_FOUND");
  }
});

test("E: a duplicate current link of ANY status is refused instead of accumulating", async () => {
  const db = setup();
  assert.equal((await propose(db, "CABLE-CURRENT")).status, 201);

  const duplicate = await propose(db, "CABLE-CURRENT");
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "EXACT_LINK_DUPLICATE");
  assert.equal(duplicate.body.error.status, "Suggested");
  assert.equal(currentLink(db, "CABLE-CURRENT", REQ_CABLE).length, 1, "still exactly one row");

  // A pre-existing Rejected row is equally a duplicate the reviewer must resolve.
  db.prepare("UPDATE boq_requirement_links SET status='Rejected' WHERE boq_item_id='CABLE-CURRENT' AND requirement_id=?").run(REQ_CABLE);
  const afterReject = await propose(db, "CABLE-CURRENT");
  assert.equal(afterReject.status, 409);
  assert.equal(afterReject.body.error.code, "EXACT_LINK_DUPLICATE");
  assert.equal(afterReject.body.error.status, "Rejected");
});

test("F: the global scorer and shortlist are provably UNCHANGED -- the real Al Mousa pair is still unreachable by them", async () => {
  const db = setup();
  const item = db.prepare("SELECT * FROM boq_items WHERE id='CABLE-CURRENT'").get();
  const requirement = db.prepare("SELECT * FROM technical_requirements WHERE id=?").get(REQ_CABLE);

  // The defect this route exists for is still exactly as measured: below threshold.
  const scored = domainScore({
    boqItem: { description: item.description, system: item.system_value, category: item.category, family: item.subcategory || null, specificationReference: item.specification_reference },
    requirement: { originalText: requirement.original_text, system: requirement.system, category: requirement.category, source: {} },
  });
  assert.ok(scored.confidence < 15, `cable clause must still score below the Mandatory gate, got ${scored.confidence}`);

  // And neither route lowers anything: buildLinkShortlist still omits it.
  const shortlist = buildLinkShortlist(item, [requirement]);
  assert.equal(shortlist.length, 0, "the global shortlist must still NOT propose this pair");

  // Only the human-nominated route reaches it.
  assert.equal((await propose(db, "CABLE-CURRENT")).status, 201);
  assert.equal(currentLink(db, "CABLE-CURRENT", REQ_CABLE).length, 1);
});

test("G: a missing human actor, a short reason and a missing pair each fail closed with a nameable code", async () => {
  const db = setup();
  const noHuman = await propose(db, "CABLE-CURRENT", REQ_CABLE, REASON, { human: undefined });
  assert.equal(noHuman.status, 403, "must refuse without a truthful human identity");
  assert.equal(noHuman.body.error.code, "HUMAN_ACTOR_NOT_CONFIGURED");

  const shortReason = await post(db, { boqItemId: "CABLE-CURRENT", requirementId: REQ_CABLE, reason: "ok" });
  assert.equal(shortReason.status, 422);
  assert.equal(shortReason.body.error.code, "EXACT_LINK_REASON_REQUIRED");

  const noPair = await post(db, { reason: REASON });
  assert.equal(noPair.status, 422);
  assert.equal(noPair.body.error.code, "EXACT_LINK_PAIR_REQUIRED");
  assert.equal(currentLink(db, "CABLE-CURRENT", REQ_CABLE).length, 0, "no partial writes");
});
