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

// Real P0 defect: the controlled normalized BOQ review was client-state only, so the
// accepted 21-line result was never durable and canonical Understanding (which reads
// boq_items) could not consume it. Hermetic: real in-memory SQLite, real module code,
// one FRESH database per test so applied state can never leak between cases.

const USER = "local-development-user";
const HUMAN = { id: "omair", name: "Omair", role: "Project Engineer" };
const LEGACY = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const PROJECT = "proj-new";

const CANDIDATES = [
  {
    normalized_description: "Smoke detectors (above ceiling)",
    normalized_unit: "No",
    normalized_quantity: 571,
    sources: [11, 59, 103, 144].map((r, i) => ({ boq_item_id: `raw-${r}`, source_row: r, description: "Smoke detectors (above ceiling)", unit: "No", quantity: [131, 192, 192, 56][i] })),
  },
  {
    normalized_description: "Combined smoke and heat detector",
    normalized_unit: "No",
    normalized_quantity: 31,
    sources: [17, 65, 109, 150].map((r, i) => ({
      boq_item_id: `raw-${r}`,
      source_row: r,
      description: r === 65 || r === 109 ? "Combined smoke and heat sensor" : "Combined smoke and heat detector",
      unit: "No",
      quantity: [6, 10, 10, 5][i],
    })),
  },
];

const SCHEMA = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
  CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, logical_name TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
  CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, sha256 TEXT);
  CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INT, status TEXT, superseded_at TEXT, extraction_method TEXT, parser_version TEXT NOT NULL, ruleset_version TEXT NOT NULL, ocr_version TEXT NOT NULL, created_by TEXT);
  CREATE TABLE boq_items (id TEXT PRIMARY KEY, project_id TEXT, extraction_version_id TEXT, source_document_id TEXT,
    sequence INT, item_number TEXT, description TEXT, normalized_description TEXT, original_unit TEXT, normalized_unit TEXT,
    original_quantity REAL, numeric_quantity REAL, row_type TEXT, review_status TEXT, approved_for_downstream INT DEFAULT 0,
    source_location TEXT, current_values TEXT, section_path TEXT, extraction_confidence INT, confidence_state TEXT,
    original_raw_values TEXT, system_value TEXT, category TEXT, subcategory TEXT);
  CREATE TABLE boq_normalization_reviews (id TEXT PRIMARY KEY, project_id TEXT, source_document_id TEXT, source_document_version_id TEXT,
    source_extraction_id TEXT, source_sha256 TEXT, generation_fingerprint TEXT, generation_number INT, status TEXT, candidate_count INT,
    applied_at TEXT, applied_by TEXT, applied_by_name TEXT, superseded_at TEXT, superseded_by_review_id TEXT, subject_extraction_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX boq_normalization_review_generation_idx ON boq_normalization_reviews (project_id, source_document_id, source_document_version_id, source_extraction_id, generation_fingerprint);
  CREATE TABLE boq_normalization_candidates (id TEXT PRIMARY KEY, review_id TEXT, project_id TEXT, ordinal INT, normalized_description TEXT,
    normalized_unit TEXT, normalized_quantity REAL, decision TEXT DEFAULT 'Pending', exclusion_reason TEXT, decided_by TEXT, decided_by_name TEXT,
    decided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX boq_normalization_candidate_ordinal_idx ON boq_normalization_candidates (review_id, ordinal);
  CREATE TABLE boq_normalization_candidate_sources (id TEXT PRIMARY KEY, candidate_id TEXT, review_id TEXT, source_boq_item_id TEXT,
    source_row INT, source_description TEXT, source_unit TEXT, source_quantity REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX boq_normalization_candidate_source_idx ON boq_normalization_candidate_sources (candidate_id, source_boq_item_id);
  CREATE TABLE boq_normalization_scope (id TEXT PRIMARY KEY, project_id TEXT, review_id TEXT, candidate_id TEXT, source_document_id TEXT,
    source_document_version_id TEXT, source_extraction_id TEXT, generation_number INT, normalized_description TEXT, normalized_unit TEXT,
    normalized_quantity REAL, applied_by TEXT, applied_by_name TEXT, applied_at TEXT, superseded_at TEXT, superseded_by_review_id TEXT, subject_boq_item_id TEXT);
  CREATE UNIQUE INDEX boq_normalization_scope_candidate_idx ON boq_normalization_scope (project_id, candidate_id, review_id);
  CREATE TABLE boq_normalization_decisions_log (id TEXT PRIMARY KEY, project_id TEXT, review_id TEXT, candidate_id TEXT, action TEXT,
    previous_value TEXT, new_value TEXT, reason TEXT, actor_id TEXT, actor_name TEXT, actor_role TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TRIGGER boq_normalization_candidate_identity_immutable
  BEFORE UPDATE OF normalized_description, normalized_unit, normalized_quantity ON boq_normalization_candidates
  FOR EACH ROW WHEN OLD.normalized_description IS NOT NEW.normalized_description
    OR OLD.normalized_unit IS NOT NEW.normalized_unit
    OR OLD.normalized_quantity IS NOT NEW.normalized_quantity
  BEGIN SELECT RAISE(ABORT, 'BOQ_NORMALIZATION_CANDIDATE_IDENTITY_IMMUTABLE'); END;
`;

const d1 = (raw) => {
  const stmt = (sql, args = []) => {
    const s = raw.prepare(sql);
    return {
      bind: (...a) => stmt(sql, a),
      run: async () => { const i = s.run(...args); return { success: true, meta: { changes: Number(i.changes || 0) } }; },
      all: async () => ({ results: s.all(...args), success: true, meta: {} }),
      first: async () => s.get(...args) ?? null,
    };
  };
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const st of list || []) out.push(await st.run()); return out; }, withSession() { return this; } };
};

const fresh = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(SCHEMA);
  raw.prepare("INSERT INTO projects VALUES (?,?,'org-1',NULL)").run(PROJECT, USER);
  raw.prepare("INSERT INTO projects VALUES (?,?,'org-1',NULL)").run(LEGACY, USER);
  raw.prepare("INSERT INTO documents VALUES ('doc-1',?,'BOQ (1).xlsx','dv-1',NULL,NULL)").run(PROJECT);
  raw.prepare("INSERT INTO document_versions VALUES ('dv-1','doc-1','e7d9e3d1')").run();
  raw.prepare("INSERT INTO boq_extraction_versions VALUES ('ex-1','doc-1','dv-1',2,'Needs Review',NULL,'native-openxml','boq-engine-1.0.2','test-ruleset','not-configured','tester')").run();
  for (const c of CANDIDATES) for (const s of c.sources) raw.prepare("INSERT INTO boq_items (id, project_id, description, numeric_quantity, row_type, source_location, "
    + "extraction_confidence, confidence_state, original_raw_values, current_values, section_path) "
    + "VALUES (?,?,?,?,'BOQ Item',?,?,?,?,?,?)").run(
    s.boq_item_id, PROJECT, s.description, s.quantity, JSON.stringify({ kind: "XLSX", row: s.source_row }),
    88, "Medium Confidence", JSON.stringify([s.description, s.quantity]), JSON.stringify({ normalized: false }), JSON.stringify([]));
  return {
    db: d1(raw),
    sql: (q, ...a) => raw.prepare(q).all(...a),
    one: (q, ...a) => raw.prepare(q).get(...a),
    run: (q, ...a) => raw.prepare(q).run(...a),
  };
};

const bootstrap = (db, candidates = CANDIDATES) =>
  bootstrapNormalizationReview(db, { projectId: PROJECT, documentId: "doc-1", userId: USER, candidates });

const decideAll = async (db, reviewId, decision = "Accepted") => {
  const model = await readNormalizationReview(db, reviewId);
  for (const c of model.candidates) {
    await recordCandidateDecision(db, { reviewId, candidateId: c.id, decision, reason: decision === "Excluded" ? "not required in this scope" : "", human: HUMAN });
  }
  return model;
};

const applyOk = (db, reviewId) => applyNormalizationReview(db, {}, { reviewId, userId: USER, human: HUMAN, requireDocumentIssue: false });

test("1: raw source BOQ rows are never written, deleted or rewritten by normalization", async () => {
  const { db, one } = fresh();
  const before = one("SELECT count(*) c FROM boq_items").c;
  const beforeIds = one("SELECT group_concat(id) g FROM boq_items").g;
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  // The Apply legitimately MATERIALIZES governed subjects into `boq_items`, so the
  // invariant is that the RAW source rows are untouched -- not that the table did not grow.
  const RAW = "SELECT count(*) c FROM boq_items WHERE id NOT LIKE 'boqitem_norm_%'";
  assert.equal(one(RAW).c, before, "raw population untouched");
  assert.equal(one("SELECT group_concat(id) g FROM boq_items WHERE id NOT LIKE 'boqitem_norm_%'").g, beforeIds, "no raw row was rewritten or removed");
  assert.equal(one("SELECT count(*) c FROM boq_items WHERE id LIKE 'boqitem_norm_%'").c, 2, "2 governed subjects materialized alongside the raw rows");
  assert.equal(before, 8, "all 8 raw source rows still present");
});

test("2: candidates are server-backed and resumable after a fresh read", async () => {
  const { db } = fresh();
  const { review } = await bootstrap(db);
  const reread = await readNormalizationReview(db, review.id);
  assert.equal(reread.candidates.length, 2);
  assert.ok(reread.candidates.every((c) => c.decision === "Pending"), "bootstrap decides nothing");
  assert.ok(reread.candidates[0].sources.length > 0, "anchors are a real relation, not a display string");
});

test("3: candidate decisions survive close/reopen and are attributed to the human", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  const after = await readNormalizationReview(db, review.id);
  assert.ok(after.candidates.every((c) => c.decision === "Accepted"));
  assert.ok(after.candidates.every((c) => c.decided_by === "omair"), "never the synthetic dev user");
  assert.equal(one("SELECT count(*) c FROM boq_normalization_decisions_log WHERE review_id=? AND action='candidate-decision'", review.id).c, 2, "every decision is audited");
});

test("4: another project / document / version cannot inherit these candidates", async () => {
  const { db, sql } = fresh();
  const { review } = await bootstrap(db);
  assert.equal(await currentNormalizedScopeExists(db, LEGACY), false);
  const projects = sql("SELECT DISTINCT project_id FROM boq_normalization_reviews").map((r) => r.project_id);
  assert.ok(projects.every((p) => p !== LEGACY), "no review bound to the legacy project");
  assert.ok(projects.includes(PROJECT));
  // A decision never escapes its own review.
  const model = await readNormalizationReview(db, review.id);
  const updated = await recordCandidateDecision(db, { reviewId: review.id, candidateId: model.candidates[0].id, decision: "Accepted", human: HUMAN });
  assert.equal(updated.candidate.review_id, review.id);
});

test("5: a stale extraction cannot be applied", async () => {
  const { db } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  // Supersede the source extraction, then attempt Apply: it must fail closed.
  await db.prepare("UPDATE boq_extraction_versions SET superseded_at='2026-01-01' WHERE id='ex-1'").run();
  const res = await applyOk(db, review.id);
  assert.equal(res.error.code, "NORMALIZATION_REVIEW_STALE");
  assert.equal(await currentNormalizedScopeExists(db, PROJECT), false);
});

test("6: Apply requires the omair human actor and refuses the development identity", async () => {
  const { db } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  const refused = await applyNormalizationReview(db, {}, { reviewId: review.id, userId: USER, human: null });
  assert.equal(refused.status, 403);
  assert.equal(refused.error.code, "HUMAN_ACTOR_REQUIRED");
  assert.equal(await currentNormalizedScopeExists(db, PROJECT), false);
});

test("7: accepted lines preserve EXACT source anchors and the derived quantity", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const model = await readNormalizationReview(db, review.id);
  const combined = model.candidates.find((c) => c.normalized_description.includes("Combined"));
  assert.equal(combined.sources.length, 4, "all four source rows retained");
  assert.deepEqual(combined.sources.map((s) => s.source_row).sort((a, b) => a - b), [17, 65, 109, 150]);
  const scope = one("SELECT * FROM boq_normalization_scope WHERE project_id=? AND normalized_quantity=31", PROJECT);
  assert.ok(scope, "the combined line is in scope at 31");
  assert.equal(scope.applied_by, "omair");
});

test("8: an excluded candidate does NOT enter downstream scope", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  const model = await readNormalizationReview(db, review.id);
  await recordCandidateDecision(db, { reviewId: review.id, candidateId: model.candidates[0].id, decision: "Accepted", human: HUMAN });
  await recordCandidateDecision(db, { reviewId: review.id, candidateId: model.candidates[1].id, decision: "Excluded", reason: "supplied under another section", human: HUMAN });
  await applyOk(db, review.id);
  assert.equal(one("SELECT count(*) c FROM boq_normalization_scope").c, 1, "only the accepted line");
});

test("9: normalization invents NO system, category or product family", async () => {
  const { db, sql, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  const cols = sql("PRAGMA table_info(boq_normalization_scope)").map((c) => c.name);
  for (const forbidden of ["system_value", "category", "subcategory", "product_family"]) {
    assert.ok(!cols.includes(forbidden), `boq_normalization_scope must not carry ${forbidden}`);
  }
  assert.equal(one("SELECT count(*) c FROM boq_items WHERE category IS NOT NULL").c, 0, "raw rows stay unclassified");
});

test("10: exact re-Apply is idempotent", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  const first = await applyOk(db, review.id);
  assert.equal(first.idempotent, false);
  const second = await applyOk(db, review.id);
  assert.equal(second.idempotent, true);
  assert.equal(one("SELECT count(*) c FROM boq_normalization_scope").c, first.scopeCount, "no duplicate population");
});

test("11: a new generation supersedes the old scope without deleting history", async () => {
  const { db, one } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  // A new generation must stay APPLICABLE, so the change has to alter the generation
  // fingerprint WITHOUT contradicting the seeded source rows. Rewriting only the
  // candidate quantity would leave the raw rows summing to the old total, and the
  // canonical Apply would rightly refuse it as not derivable.
  const changed = CANDIDATES.map((c) => ({ ...c, normalized_description: `${c.normalized_description} (rev 2)` }));
  const next = await bootstrap(db, changed);
  assert.equal(next.created, true);
  assert.ok(next.review.generation_number > review.generation_number);
  await decideAll(db, next.review.id);
  await applyOk(db, next.review.id);
  const live = one("SELECT count(*) c FROM boq_normalization_scope WHERE superseded_at IS NULL").c;
  const history = one("SELECT count(*) c FROM boq_normalization_scope").c;
  assert.ok(history >= live, "history is retained");
  // Supersession is recorded on the governed SCOPE, which is what downstream readers
  // resolve. The old review keeps status 'APPLIED' as the historical record of what it
  // applied; rewriting that would falsify history. What matters is that it contributes
  // nothing to the live scope.
  assert.equal(one("SELECT status FROM boq_normalization_reviews WHERE id=?", review.id).status, "APPLIED");
  assert.equal(one("SELECT count(*) c FROM boq_normalization_scope WHERE review_id=? AND superseded_at IS NULL", review.id).c, 0, "old generation's scope is superseded");
  assert.ok(one("SELECT superseded_by_review_id s FROM boq_normalization_scope WHERE review_id=? LIMIT 1", review.id).s, "supersession records the superseding review");
  assert.equal(live, 2, "only the new generation is live");
});

test("12: BEFORE Apply the downstream reader cannot pretend the normalized scope exists", async () => {
  const { db } = fresh();
  await bootstrap(db);
  assert.equal(await currentNormalizedScopeExists(db, PROJECT), false, "an OPEN review is not scope");
});

test("13: AFTER Apply the downstream reader resolves the normalized scope", async () => {
  const { db } = fresh();
  const { review } = await bootstrap(db);
  await decideAll(db, review.id);
  await applyOk(db, review.id);
  assert.equal(await currentNormalizedScopeExists(db, PROJECT), true);
});

test("14: no legacy project evidence enters this subsystem", async () => {
  const { db, sql } = fresh();
  const { review } = await bootstrap(db);
  assert.equal(review.project_id, PROJECT);
  assert.notEqual(review.project_id, LEGACY);
  assert.ok(sql("SELECT DISTINCT project_id FROM boq_normalization_reviews").every((r) => r.project_id !== LEGACY));
});
