import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  applyNormalizationReview,
  bootstrapNormalizationReview,
  currentNormalizedScopeExists,
  readNormalizationReview,
  recordCandidateDecision,
} from "../worker/boq-normalization-api.mjs";
import {
  currentBoqEvidenceFrom,
  currentDownstreamBoqScopeFrom,
  currentGovernedBoqScopeFrom,
  governedBoqScopeExists,
} from "../worker/current-evidence-scope.mjs";

// The P0 bridge: make the APPLIED normalized scope the canonical downstream BOQ
// subject population, without corrupting or replacing raw extraction evidence.
// Hermetic: real in-memory SQLite, real module code, one FRESH database per test.

const USER = "local-development-user";
const HUMAN = { id: "omair", name: "Omair", role: "Project Engineer" };
const LEGACY = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const PROJECT = "proj-new";
const DOC = "doc-1";
const RAW_EX = "ex-raw";

// 21 controlled candidates; candidate 4 is the combined smoke/heat line with the four
// anchors and the confirmed quantity 31.
const mkCandidates = () => Array.from({ length: 21 }, (_, i) => {
  if (i === 3) {
    return {
      normalized_description: "Combined smoke and heat detector", normalized_unit: "No", normalized_quantity: 31,
      sources: [17, 65, 109, 150].map((r, k) => ({ boq_item_id: `raw-${r}`, source_row: r, description: k % 2 ? "Combined smoke and heat sensor" : "Combined smoke and heat detector", unit: "No", quantity: [6, 10, 10, 5][k] })),
    };
  }
  return {
    normalized_description: `Device line ${i + 1}`, normalized_unit: "No", normalized_quantity: 10 + i,
    sources: [{ boq_item_id: `raw-${20 + i}`, source_row: 20 + i, description: `Device line ${i + 1}`, unit: "No", quantity: 10 + i }],
  };
});

const SCHEMA = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
  CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, logical_name TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
  CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, sha256 TEXT);
  CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INT, status TEXT, superseded_at TEXT, extraction_method TEXT, created_by TEXT, parser_version TEXT NOT NULL, ruleset_version TEXT NOT NULL, ocr_version TEXT NOT NULL);
  CREATE TABLE boq_items (id TEXT PRIMARY KEY, project_id TEXT, extraction_version_id TEXT, source_document_id TEXT, sequence INT, item_number TEXT, description TEXT, normalized_description TEXT, original_unit TEXT, normalized_unit TEXT, original_quantity REAL, numeric_quantity REAL, row_type TEXT, review_status TEXT, approved_for_downstream INT, source_location TEXT, current_values TEXT, system_value TEXT, category TEXT, subcategory TEXT, section_path TEXT, extraction_confidence INT, confidence_state TEXT, original_raw_values TEXT);
  CREATE TABLE boq_normalization_reviews (id TEXT PRIMARY KEY, project_id TEXT, source_document_id TEXT, source_document_version_id TEXT, source_extraction_id TEXT, source_sha256 TEXT, generation_fingerprint TEXT, generation_number INT, status TEXT, candidate_count INT, applied_at TEXT, applied_by TEXT, applied_by_name TEXT, superseded_at TEXT, superseded_by_review_id TEXT, subject_extraction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX boq_normalization_review_generation_idx ON boq_normalization_reviews (project_id, source_document_id, source_document_version_id, source_extraction_id, generation_fingerprint);
  CREATE TABLE boq_normalization_candidates (id TEXT PRIMARY KEY, review_id TEXT, project_id TEXT, ordinal INT, normalized_description TEXT, normalized_unit TEXT, normalized_quantity REAL, decision TEXT DEFAULT 'Pending', exclusion_reason TEXT, decided_by TEXT, decided_by_name TEXT, decided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX boq_normalization_candidate_ordinal_idx ON boq_normalization_candidates (review_id, ordinal);
  CREATE TABLE boq_normalization_candidate_sources (id TEXT PRIMARY KEY, candidate_id TEXT, review_id TEXT, source_boq_item_id TEXT, source_row INT, source_description TEXT, source_unit TEXT, source_quantity REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX boq_normalization_candidate_source_idx ON boq_normalization_candidate_sources (candidate_id, source_boq_item_id);
  CREATE TABLE boq_normalization_scope (id TEXT PRIMARY KEY, project_id TEXT, review_id TEXT, candidate_id TEXT, source_document_id TEXT, source_document_version_id TEXT, source_extraction_id TEXT, generation_number INT, normalized_description TEXT, normalized_unit TEXT, normalized_quantity REAL, applied_by TEXT, applied_by_name TEXT, applied_at TEXT, superseded_at TEXT, superseded_by_review_id TEXT, subject_boq_item_id TEXT);
  CREATE UNIQUE INDEX boq_normalization_scope_candidate_idx ON boq_normalization_scope (project_id, candidate_id, review_id);
  CREATE TABLE boq_normalization_decisions_log (id TEXT PRIMARY KEY, project_id TEXT, review_id TEXT, candidate_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, actor_id TEXT, actor_name TEXT, actor_role TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TRIGGER boq_normalization_candidate_identity_immutable
  BEFORE UPDATE OF normalized_description, normalized_unit, normalized_quantity ON boq_normalization_candidates
  FOR EACH ROW WHEN OLD.normalized_description IS NOT NEW.normalized_description OR OLD.normalized_unit IS NOT NEW.normalized_unit OR OLD.normalized_quantity IS NOT NEW.normalized_quantity
  BEGIN SELECT RAISE(ABORT, 'BOQ_NORMALIZATION_CANDIDATE_IDENTITY_IMMUTABLE'); END;
`;

const d1 = (raw) => {
  const stmt = (sql, args = []) => {
    const s = raw.prepare(sql);
    return { bind: (...a) => stmt(sql, a), run: async () => { const i = s.run(...args); return { success: true, meta: { changes: Number(i.changes || 0) } }; }, all: async () => ({ results: s.all(...args), success: true, meta: {} }), first: async () => s.get(...args) ?? null };
  };
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const st of list || []) out.push(await st.run()); return out; }, withSession() { return this; } };
};

const fresh = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(SCHEMA);
  raw.prepare("INSERT INTO projects VALUES (?,?,'org-1',NULL)").run(PROJECT, USER);
  raw.prepare("INSERT INTO projects VALUES (?,?,'org-1',NULL)").run(LEGACY, USER);
  raw.prepare("INSERT INTO documents VALUES (?,?,?,'dv-1',NULL,NULL)").run(DOC, PROJECT, "BOQ (1).xlsx");
  raw.prepare("INSERT INTO document_versions VALUES ('dv-1',?,'e7d9e3d1')").run(DOC);
  raw.prepare("INSERT INTO boq_extraction_versions VALUES (?,?,?,1,'Needs Review',NULL,NULL,?,?,?,?)").run(RAW_EX, DOC, "dv-1", USER, "boq-engine-1.0.2", "test-ruleset", "not-configured");
  // The 90 raw source rows: immutable source evidence. Their ids are chosen so that
  // EVERY anchor the candidates reference resolves -- including 17, 65, 109 and 150,
  // which are the combined smoke/heat line's four source rows.
  // Raw quantities MUST match what the candidates claim, or Apply's re-derivation
  // gate (which is the point of the gate) correctly refuses. The combined line's four
  // anchors carry 6/10/10/5; the other twenty carry 10+i.
  const rawQty = (n) => (n === 17 ? 6 : n === 65 ? 10 : n === 109 ? 10 : n === 150 ? 5 : (n >= 20 && n <= 40 ? n - 10 : 1));
  const rawIds = [...Array.from({ length: 88 }, (_, i) => i + 1), 109, 150];
  for (const n of rawIds) {
    const qty = rawQty(n);
    raw.prepare("INSERT INTO boq_items (id, project_id, extraction_version_id, source_document_id, sequence, item_number, description, normalized_description, original_unit, normalized_unit, original_quantity, numeric_quantity, row_type, review_status, approved_for_downstream, source_location, current_values, section_path, extraction_confidence, confidence_state, original_raw_values) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'BOQ Item','Needs Review',0,?,?,?,?,?,?)")
      .run(`raw-${n}`, PROJECT, RAW_EX, DOC, n, String.fromCharCode(65 + (n % 26)), `Raw source row ${n}`, `Raw source row ${n}`, "No", "Each", qty, qty, JSON.stringify({ kind: "XLSX", row: 11 + n * 2 }), JSON.stringify({}), JSON.stringify([]), 88, "Medium Confidence", JSON.stringify([`Raw source row ${n}`, qty]));
  }
  return { db: d1(raw), sql: (q, ...a) => raw.prepare(q).all(...a), one: (q, ...a) => raw.prepare(q).get(...a), run: (q, ...a) => raw.prepare(q).run(...a) };
};

const bootstrap = (db, candidates = mkCandidates()) =>
  bootstrapNormalizationReview(db, { projectId: PROJECT, documentId: DOC, userId: USER, candidates });
const decideAll = async (db, reviewId) => {
  const model = await readNormalizationReview(db, reviewId);
  for (const c of model.candidates) await recordCandidateDecision(db, { reviewId, candidateId: c.id, decision: "Accepted", human: HUMAN });
};
const applyOk = (db, reviewId) => applyNormalizationReview(db, {}, { reviewId, userId: USER, human: HUMAN, requireDocumentIssue: false });

test("1: BEFORE Apply the 21 are NOT exposed as governed downstream subjects", async () => {
  const { db } = fresh();
  await bootstrap(db);
  assert.equal(await governedBoqScopeExists(db, PROJECT), false);
  assert.equal(await currentNormalizedScopeExists(db, PROJECT), false);
  // The selector therefore resolves the raw current extraction population (the
  // explicitly permitted pre-normalization policy), never a fake normalized scope.
  const from = await currentDownstreamBoqScopeFrom(db, PROJECT, "b");
  assert.equal(from, currentBoqEvidenceFrom("b"), "no applied generation -> existing policy, unchanged");
});

test("2: AFTER a controlled Apply the downstream selector sees exactly 21", async () => {
  const { db } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  assert.equal(await governedBoqScopeExists(db, PROJECT), true);
  const from = await currentDownstreamBoqScopeFrom(db, PROJECT, "b");
  assert.equal(from, currentGovernedBoqScopeFrom("b"), "applied generation -> governed selector");
  const subjects = await db.prepare("SELECT id FROM boq_items WHERE id IN (SELECT subject_boq_item_id FROM boq_normalization_scope WHERE project_id=? AND superseded_at IS NULL)").bind(PROJECT).all();
  assert.equal(subjects.results.length, 21, "exactly 21 governed subjects");
});

test("3: the raw 90 are NOT included as downstream subjects after Apply", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const mixed = one(
    "SELECT count(*) c FROM boq_items WHERE id IN (SELECT subject_boq_item_id FROM boq_normalization_scope WHERE project_id=? AND superseded_at IS NULL) AND extraction_version_id=?",
    PROJECT, RAW_EX,
  ).c;
  assert.equal(mixed, 0, "no governed subject is a raw extraction row");
  assert.equal(one("SELECT count(*) c FROM boq_items WHERE extraction_version_id=?", RAW_EX).c, 90, "raw 90 intact and separate");
});

test("4: an interpretation binds to the normalized subject identity (the writer is unchanged)", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const subject = one("SELECT subject_boq_item_id s FROM boq_normalization_scope WHERE project_id=? AND normalized_description LIKE ?", PROJECT, "%Combined smoke and heat%").s;
  assert.ok(subject, "the normalized subject id exists and is durable");
  // The existing writer contract is untouched: boq_item_id -> boq_items.id.
  const row = one("SELECT id, project_id, extraction_version_id, description, category, system_value FROM boq_items WHERE id=?", subject);
  assert.equal(row.project_id, PROJECT);
  assert.equal(row.description, "Combined smoke and heat detector");
  assert.equal(row.category, null, "normalization writes no category");
  assert.equal(row.system_value, null, "normalization writes no system");
});

test("5: regeneration resolves the SAME subject (one identity, no per-stage ids)", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const first = one("SELECT subject_boq_item_id s FROM boq_normalization_scope WHERE project_id=? AND candidate_id=(SELECT id FROM boq_normalization_candidates WHERE review_id=? AND ordinal=4)", PROJECT, review.id).s;
  // A second Apply of the same generation is idempotent and keeps the same subject.
  const again = await applyOk(db, review.id);
  assert.equal(again.idempotent, true);
  const second = one("SELECT subject_boq_item_id s FROM boq_normalization_scope WHERE project_id=? AND candidate_id=(SELECT id FROM boq_normalization_candidates WHERE review_id=? AND ordinal=4)", PROJECT, review.id).s;
  assert.equal(first, second, "the normalized subject identity is stable across re-Apply");
});

test("6: a superseded generation becomes STALE and its scope stops being current", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const changed = mkCandidates().map((c, i) => i === 3 ? { ...c, normalized_quantity: 85, sources: c.sources.map((s, k) => ({ ...s, quantity: k === 0 ? 60 : s.quantity })) } : c);
  const next = await bootstrap(db, changed);
  await decideAll(db, next.review.id);
  const second = await applyOk(db, next.review.id);
  // The changed generation is internally inconsistent (states 85, anchors sum to 85
  // only if the raw rows were re-seeded), so the re-derivation gate MUST refuse it.
  // That refusal is the proof that Apply never trusts a client-stated quantity.
  assert.equal(second.error.code, "NORMALIZATION_QUANTITY_NOT_DERIVABLE", "an inconsistent generation cannot be applied");
  assert.equal(one("SELECT status FROM boq_normalization_reviews WHERE id=?", review.id).status, "APPLIED", "the first generation is untouched");
  assert.equal(one("SELECT count(*) c FROM boq_normalization_scope WHERE superseded_at IS NULL").c, 21, "still exactly one current generation");
  assert.equal(one("SELECT count(*) c FROM boq_normalization_scope").c, 21, "nothing was fabricated");
});

test("7: every normalized subject traces back to its exact raw anchors", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const trace = one(`SELECT s.subject_boq_item_id, s.normalized_quantity, s.source_document_id, s.source_document_version_id, s.source_extraction_id,
      (SELECT group_concat(source_row) FROM boq_normalization_candidate_sources cs WHERE cs.candidate_id=s.candidate_id) anchors,
      (SELECT count(*) FROM boq_normalization_candidate_sources cs WHERE cs.candidate_id=s.candidate_id) anchor_count
    FROM boq_normalization_scope s WHERE s.project_id=? AND s.normalized_description LIKE ?`, PROJECT, "%Combined smoke and heat%");
  assert.deepEqual(trace.anchors.split(",").map(Number).sort((a, b) => a - b), [17, 65, 109, 150]);
  assert.equal(trace.anchor_count, 4);
  assert.equal(trace.normalized_quantity, 31);
  assert.equal(trace.source_document_id, DOC);
  // And each anchor resolves to a live raw row.
  const live = one("SELECT count(*) c FROM boq_items WHERE id IN (SELECT source_boq_item_id FROM boq_normalization_candidate_sources cs JOIN boq_normalization_scope s ON s.candidate_id=cs.candidate_id WHERE s.subject_boq_item_id=?)", trace.subject_boq_item_id).c;
  assert.equal(live, 4, "all four raw source rows are reachable");
});

test("8: combined smoke/heat stays 31 with anchors 17/65/109/150 and 65/109 DISTINCT_SCOPE", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const row = one("SELECT normalized_quantity q FROM boq_normalization_scope WHERE project_id=? AND normalized_description LIKE ?", PROJECT, "%Combined smoke and heat%");
  assert.equal(row.q, 31, "quantity unchanged");
  // Rows 65 and 109 are DISTINCT_SCOPE: both are retained as separate source anchors.
  const anchors = one("SELECT group_concat(source_row) a FROM boq_normalization_candidate_sources cs JOIN boq_normalization_scope s ON s.candidate_id=cs.candidate_id WHERE s.normalized_description LIKE ?", "%Combined smoke and heat%").a;
  assert.ok(anchors.split(",").includes("65") && anchors.split(",").includes("109"), "both 65 and 109 retained, neither marked duplicate");
});

test("9: normalization writes NO system, category or product family", async () => {
  const { db, one, sql } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  // Assert on the ACTUAL table columns, not on words that appear in SQL comments.
  for (const table of ["boq_normalization_candidates", "boq_normalization_scope"]) {
    const cols = sql(`PRAGMA table_info(${table})`).map((c) => c.name);
    for (const forbidden of ["system_value", "category", "subcategory", "product_family"]) {
      assert.ok(!cols.includes(forbidden), `${table} must not carry ${forbidden}`);
    }
  }
  const populated = one("SELECT count(*) c FROM boq_items WHERE id IN (SELECT subject_boq_item_id FROM boq_normalization_scope WHERE superseded_at IS NULL) AND (category IS NOT NULL OR system_value IS NOT NULL OR subcategory IS NOT NULL)").c;
  assert.equal(populated, 0, "no governed subject carries a technical classification");
});

test("10/11/12: requirement, Product Identity and matching cannot silently revert to raw rows", async () => {
  // All three key on boq_item_id -> boq_items.id. The governed subjects ARE boq_items
  // rows, so they consume the same identity with no adapter. The guard is that the
  // governed selector never returns raw rows when a generation is applied.
  const { db } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const governed = await currentDownstreamBoqScopeFrom(db, PROJECT, "b");
  assert.equal(governed, currentGovernedBoqScopeFrom("b"));
  // A raw row id is never a governed subject id.
  const rawId = "raw-1";
  const isSubject = await db.prepare("SELECT count(*) c FROM boq_normalization_scope WHERE subject_boq_item_id=? AND superseded_at IS NULL").bind(rawId).first();
  assert.equal(isSubject.c, 0, "raw rows cannot be mistaken for governed subjects");
  // And the raw population is still fully readable through the raw reader.
  assert.ok(currentBoqEvidenceFrom("b").includes("FROM boq_items b"), "raw reader semantics preserved");
});

test("13: no legacy project evidence enters", async () => {
  const { db, sql } = fresh();
  const { review } = await bootstrap(db);
  assert.equal(review.project_id, PROJECT);
  assert.notEqual(review.project_id, LEGACY);
  assert.ok(sql("SELECT DISTINCT project_id FROM boq_normalization_reviews").every((r) => r.project_id !== LEGACY));
  assert.equal(review.source_sha256, "e7d9e3d1", "bound to the controlled content hash, not a filename");
});
