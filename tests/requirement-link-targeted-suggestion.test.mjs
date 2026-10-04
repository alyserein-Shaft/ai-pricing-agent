import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// Focused tests for the OPTIONAL target filter on the existing suggest-links
// route. A filterless call must behave exactly as before; a filtered call must
// intersect with the canonical eligible set (never widen it), restrict the
// supersede pass to the same items, and grant no authority.
//
// Hermetic: real in-memory SQLite, real handler.

const PROJECT = "proj-1";
const USER = "local-development-user";
const REQ = "req-breakglass";

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
  `);
  db.prepare("INSERT INTO projects VALUES (?,?,?,NULL)").run(PROJECT, USER, "org-1");
  db.prepare("INSERT INTO documents VALUES (?,?,NULL,NULL,'dv-1')").run("doc-1", PROJECT);
  db.prepare("INSERT INTO document_versions VALUES ('dv-1','doc-1')").run();
  db.prepare("INSERT INTO boq_extraction_versions VALUES ('ex-1','doc-1','dv-1',NULL,'Completed',1)").run();
  const item = (id, description, approved = 0, rowType = "BOQ Item", system = "Fire Alarm", doc = "doc-1") =>
    db.prepare("INSERT INTO boq_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, PROJECT, "ex-1", doc, rowType, description, id, 1, system, null, null, null, approved);
  item("L", "Fire alarm manual station");
  item("M", "Fire alarm manual station (weather proof)");
  item("OTHER-FA", "Fire alarm manual station", 1);   // a third real candidate
  item("OTHER-ELEC", "Fire alarm manual station", 1, "BOQ Item", "Electrical");
  item("STALE-ROW", "Fire alarm manual station", 0, "Section Header");
  db.prepare(`INSERT INTO technical_requirements
    (id, project_id, requirement_type, requirement_category, category, system, engineering_domain,
     original_text, normalized_requirement, condition, exception, source_document_id,
     source_location, confidence, review_status, approved_for_downstream)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(REQ, PROJECT, "Mandatory", "Installation", "Installation", "Unknown", "Fire Alarm",
      "Manual call points are required to be of the break glass type and should be installed along all designated escape routes as indicated in the drawings.",
      "manual call points are required to be the break glass type", null, null, "doc-1",
      JSON.stringify({ pageFrom: 14 }), 83, "Needs Review", 0);
  return db;
};

const d1 = (db) => {
  const stmt = (sql, args = []) => {
    const s = db.prepare(sql);
    const bound = (a) => ({ bind: (...x) => stmt(sql, x), run: async () => { const i = s.run(...a); return { success: true, meta: { changes: Number(i.changes || 0) } }; }, all: async () => ({ results: s.all(...a), success: true, meta: {} }), first: async () => s.get(...a) ?? null });
    return bound(args);
  };
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list || []) out.push(await s.run()); return out; }, withSession() { return this; } };
};
const env = (db) => ({ DB: d1(db), APP_ACCESS_MODE: "single-user", LOCAL_DEVELOPMENT_USER_ID: USER, APP_ORGANIZATION_ID: "org-1" });
const BASE = "http://localhost:4183";

const suggest = async (db, body) => {
  const { handleEngineeringKnowledgeApi } = await import("../worker/engineering-knowledge-api.mjs");
  const response = await handleEngineeringKnowledgeApi(new Request(`${BASE}/api/projects/${PROJECT}/engineering-knowledge/suggest-links`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}),
  }), env(db));
  const text = await response.text();
  return { status: response.status, body: (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() };
};
const currentLinks = (db) => db.prepare("SELECT * FROM boq_requirement_links WHERE superseded_at IS NULL").all();

test("explicit L/M targeting creates exactly two Suggested links", async () => {
  const db = setup();
  const result = await suggest(db, { boqItemIds: ["L", "M"] });
  assert.equal(result.status, 201, JSON.stringify(result.body).slice(0, 200));
  const rows = currentLinks(db);
  assert.equal(rows.length, 2, "exactly the two targeted items");
  assert.deepEqual(rows.map((r) => r.boq_item_id).sort(), ["L", "M"]);
  assert.ok(rows.every((r) => r.status === "Suggested"), "both must be Suggested, never Confirmed");
  // Authority untouched.
  assert.equal(db.prepare("SELECT approved_for_downstream a FROM boq_items WHERE id='L'").get().a, 0);
  assert.equal(db.prepare("SELECT approved_for_downstream a FROM boq_items WHERE id='M'").get().a, 0);
});

test("unrelated shortlist candidates are NOT written", async () => {
  const db = setup();
  await suggest(db, { boqItemIds: ["L", "M"] });
  const ids = currentLinks(db).map((r) => r.boq_item_id);
  assert.ok(!ids.includes("OTHER-FA"), "an in-shortlist but untargeted item must get no link");
  assert.ok(!ids.includes("OTHER-ELEC"), "a non-Fire-Alarm item must get no link");
});

test("omitting the filter preserves existing behaviour exactly", async () => {
  const db = setup();
  const result = await suggest(db, {});
  assert.equal(result.status, 201);
  const ids = currentLinks(db).map((r) => r.boq_item_id).sort();
  // Unfiltered = every eligible item whose shortlist contains the requirement,
  // which is the pre-existing behaviour.
  assert.deepEqual(ids, ["L", "M", "OTHER-ELEC", "OTHER-FA"]);
  assert.ok(!ids.includes("STALE-ROW"), "section headers remain ineligible");
});

test("invalid / non-current item ids fail closed", async () => {
  const db = setup();
  await suggest(db, { boqItemIds: ["L", "does-not-exist", "STALE-ROW", ""] });
  assert.deepEqual(currentLinks(db).map((r) => r.boq_item_id), ["L"], "unknown and non-demand ids create nothing");
});

test("a targeted run does not supersede unrelated Suggested/Needs Review links", async () => {
  const db = setup();
  // Pre-existing unrelated review work.
  db.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,version_number,created_by)
    VALUES ('pre-existing',?,'OTHER-FA','req-other','manual',50,'[]','Suggested',NULL,NULL,1,?)`).run(PROJECT, USER);
  await suggest(db, { boqItemIds: ["L"] });
  const pre = db.prepare("SELECT status,superseded_at FROM boq_requirement_links WHERE id='pre-existing'").get();
  assert.equal(pre.superseded_at, null, "unrelated Suggested work must survive a targeted run");
  assert.equal(pre.status, "Suggested");
  const ids = currentLinks(db).map((r) => r.boq_item_id).sort();
  assert.deepEqual(ids, ["L", "OTHER-FA"], "only the targeted item gains a new link");
});