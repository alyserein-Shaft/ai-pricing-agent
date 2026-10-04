import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// Real Al Mousa defect. suggest-links gated link SUGGESTION on
// boq_items.approved_for_downstream=1, so an intentionally unresolved item could
// never receive governed requirement evidence -- and the only workaround (approve
// the item first) inverts cause and effect. Al Mousa items L and M
// ("Fire alarm manual station", approved_for_downstream=0) could not receive the
// approved break-glass requirement at all.
//
// Acceptance A-G. Hermetic: a real in-memory SQLite, no project database.

const PROJECT = "proj-1";
const USER = "local-development-user";
// The HUMAN identity the confirm route records as reviewer. Distinct from USER,
// which is the synthetic development application actor.
const HUMAN = "omair-primary";
const REQ_BREAKGLASS = "req-breakglass";

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
  db.prepare("INSERT INTO documents VALUES (?,?,NULL,NULL,'dv-1')").run("doc-1", PROJECT);
  db.prepare("INSERT INTO document_versions VALUES ('dv-1','doc-1')").run();
  db.prepare("INSERT INTO boq_extraction_versions VALUES ('ex-1','doc-1','dv-1',NULL,'Completed',1)").run();

  const item = (id, description, { approved = 0, rowType = "BOQ Item", system = "Fire Alarm", doc = "doc-1", ex = "ex-1" } = {}) =>
    db.prepare("INSERT INTO boq_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, PROJECT, ex, doc, rowType, description, id, 1, system, null, null, null, approved);

  // L/M shaped UNRESOLVED items, an approved item, an unrelated Fire Alarm item,
  // a non-Fire-Alarm item, and rows that must fail closed.
  item("L", "Fire alarm manual station", { approved: 0 });
  item("M", "Fire alarm manual station (weather proof)", { approved: 0 });
  item("APPROVED-MCP", "Fire alarm manual station", { approved: 1 });
  item("OTHER-FA", "Duct detector", { approved: 1 });
  item("OTHER-ELEC", "Lighting panel", { approved: 1, system: "Electrical" });
  item("HEADING-ROW", "SECTION A - FIRE ALARM", { approved: 1, rowType: "Section Header" });
  item("ARCHIVED-DOC", "Fire alarm manual station", { approved: 0, doc: "doc-archived" });

  db.prepare("INSERT INTO documents VALUES ('doc-archived',?,NULL,'2026-01-01','dv-1')").run(PROJECT);

  db.prepare(`INSERT INTO technical_requirements
    (id, project_id, requirement_type, requirement_category, category, system, engineering_domain,
     original_text, normalized_requirement, condition, exception, source_document_id,
     source_location, confidence, review_status, approved_for_downstream)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(REQ_BREAKGLASS, PROJECT, "Mandatory", "Installation", "Installation", "Unknown", "Fire Alarm",
      "Manual call points are required to be of the break glass type and should be installed along all designated escape routes as indicated in the drawings.",
      "manual call points are required to be of the break glass type", null, null, "doc-1",
      JSON.stringify({ pageFrom: 14, clause: "C" }), 83, "Approved", 1);
  return db;
};

// Minimal D1 binding surface for the canonical handlers (prepare/bind/run/all/
// first/batch). It supplies NO governance: every query, status and audit row
// comes from the real handler code.
const d1 = (db) => {
  const stmt = (sql, args = []) => {
    const s = db.prepare(sql);
    const bound = (a) => ({ bind: (...x) => stmt(sql, x), run: async () => { const i = s.run(...a); return { success: true, meta: { changes: Number(i.changes || 0) } }; }, all: async () => ({ results: s.all(...a), success: true, meta: {} }), first: async () => s.get(...a) ?? null });
    return bound(args);
  };
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list || []) out.push(await s.run()); return out; }, withSession() { return this; } };
};

// The confirm route is a HUMAN-AUTHORITY mutation: it calls requireHumanActor
// (worker/human-actor.mjs) and returns 403 HUMAN_ACTOR_NOT_CONFIGURED when the
// server has no truthful human identity. This stub must therefore configure one,
// or confirmation fails closed and the link legitimately stays 'Suggested'. That
// is the correct production behaviour being reproduced here, not a bug.
const envFor = (db) => ({
  DB: d1(db),
  APP_ACCESS_MODE: "single-user",
  LOCAL_DEVELOPMENT_USER_ID: USER,
  APP_HUMAN_ID: HUMAN,
  APP_HUMAN_NAME: "Omair",
  APP_ORGANIZATION_ID: "org-1",
});
const BASE = "http://localhost:4183";

const postKnowledge = async (db, path, body) => {
  const { handleEngineeringKnowledgeApi } = await import("../worker/engineering-knowledge-api.mjs");
  const response = await handleEngineeringKnowledgeApi(new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }), envFor(db));
  const text = await response.text();
  return { status: response.status, body: (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() };
};

const suggest = (db) => postKnowledge(db, `/api/projects/${PROJECT}/engineering-knowledge/suggest-links`);
const linksFor = (db, itemId) => db.prepare("SELECT * FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id=? AND superseded_at IS NULL").all(itemId, REQ_BREAKGLASS);

test("A: unresolved L/M-shaped items CAN receive a Suggested link; B: their approved_for_downstream stays 0", async () => {
  const db = setup();
  const result = await suggest(db);
  assert.equal(result.status, 201, JSON.stringify(result.body).slice(0, 200));

  for (const id of ["L", "M"]) {
    const rows = linksFor(db, id);
    assert.equal(rows.length, 1, `${id} must receive exactly one current link`);
    assert.equal(rows[0].status, "Suggested");
    assert.equal(db.prepare("SELECT approved_for_downstream a FROM boq_items WHERE id=?").get(id).a, 0, `${id} must remain unapproved`);
  }
});

test("C: a Suggested link does NOT reach the Understanding evidence reader", async () => {
  const db = setup();
  await suggest(db);
  const { confirmedSpecifications } = await import("../worker/estimator-understanding-api.mjs");
  const items = db.prepare("SELECT id,system_value FROM boq_items").all().map((r) => ({ boqItemId: r.id, system: r.system_value }));
  const map = await confirmedSpecifications(envFor(db).DB, PROJECT, items);
  for (const list of Object.values(map)) {
    assert.ok(!list.some((c) => c.id === REQ_BREAKGLASS), "Suggested links are not authoritative evidence");
  }
});

test("D: after governed confirmation the link DOES reach the item-specific evidence path", async () => {
  const db = setup();
  await suggest(db);
  const link = linksFor(db, "L")[0];
  // The confirm route commits the link UPDATE/decision batch and THEN recomputes
  // the requirement profile, which needs tables far outside this slice's scope.
  // Any such post-commit error is tolerated here, but the assertions below are
  // the real proof: if confirmation had genuinely failed, the link would still
  // read 'Suggested' and these would fail.
  await postKnowledge(db, `/api/requirement-links/${link.id}/confirm`, { reason: "Break-glass actuation applies to this manual call point." }).catch(() => undefined);

  const confirmed = linksFor(db, "L")[0];
  assert.equal(confirmed.status, "Confirmed", "confirmation must have committed");
  assert.equal(confirmed.reviewed_by, HUMAN, "a Confirmed link records the HUMAN reviewer, never the synthetic development actor");
  assert.ok(confirmed.review_reason, "a Confirmed link records its reason");

  const { confirmedSpecifications } = await import("../worker/estimator-understanding-api.mjs");
  const map = await confirmedSpecifications(envFor(db).DB, PROJECT, [{ boqItemId: "L", system: "Fire Alarm" }, { boqItemId: "M", system: "Fire Alarm" }]);
  assert.ok(map.L.some((c) => c.id === REQ_BREAKGLASS), "confirmed link becomes item-specific evidence");
  assert.ok(!(map.M || []).some((c) => c.id === REQ_BREAKGLASS), "M still holds only a Suggested link, so it must receive nothing");
});

test("E: an unrelated Fire Alarm item does NOT receive the link", async () => {
  const db = setup();
  await suggest(db);
  assert.equal(linksFor(db, "OTHER-FA").length, 0, "a duct detector must not get the manual-call-point requirement");
});

test("F: a non-Fire-Alarm item does NOT receive the link", async () => {
  const db = setup();
  await suggest(db);
  assert.equal(linksFor(db, "OTHER-ELEC").length, 0, "an Electrical item must not get a Fire Alarm requirement");
});

test("fail-closed: section-header rows and items on a non-current document never receive links", async () => {
  const db = setup();
  await suggest(db);
  assert.equal(linksFor(db, "HEADING-ROW").length, 0, "a section header is not a demand row");
  assert.equal(linksFor(db, "ARCHIVED-DOC").length, 0, "an archived/non-current document version is out of scope");
});

test("G: already-approved items continue to work exactly as before", async () => {
  const db = setup();
  await suggest(db);
  const approved = linksFor(db, "APPROVED-MCP");
  assert.equal(approved.length, 1, "an approved item still receives its Suggested link");
  assert.equal(approved[0].status, "Suggested");
});

test("publishApprovedEngineeringKnowledge keeps its approved-item gate (unchanged)", async () => {
  // Structural guard: the broadened suggestion gate must NOT leak into the
  // publish path, which legitimately still requires an approved item.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../worker/engineering-knowledge-api.mjs", import.meta.url), "utf8");
  const publishBlock = source.slice(source.indexOf("export const publishApprovedEngineeringKnowledge"), source.indexOf("const suggestLinks"));
  const suggestBlock = source.slice(source.indexOf("const suggestLinks"));
  assert.match(publishBlock, /b\.approved_for_downstream=1/, "publish still requires an approved item");
  const suggestQuery = suggestBlock.slice(0, suggestBlock.indexOf("const active ="));
  assert.doesNotMatch(suggestQuery, /approved_for_downstream/, "suggestion eligibility must not require downstream approval");
  assert.match(suggestQuery, /currentBoqItemPredicate/, "currentness guards must be preserved");
});
