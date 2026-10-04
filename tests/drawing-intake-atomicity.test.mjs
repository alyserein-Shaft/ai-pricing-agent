/**
 * DRAWING INTAKE ATOMICITY -- acceptance tests for the success invariant.
 *
 * The invariant under test:
 *
 *   HTTP 201  =>  parent intake exists, bound to the exact document/version,
 *                every child extraction produced is persisted,
 *                and the intake is Completed.
 *
 * The defect these tests exist for: a child write could fail while the handler
 * still returned 201 and marked the intake Completed. D1 has two plausible
 * runtime shapes for a failed batch -- it may REJECT, or it may RESOLVE with
 * `{success:false}` per statement -- and the old code guarded only the first.
 * Both shapes are exercised here.
 *
 * All database work happens against a disposable in-memory database built from
 * the production DDL. No canonical database file is opened for write.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { handleDrawingIntakeApi } from "../worker/drawing-intake-api.mjs";

// The production drawing schema, copied from the canonical D1's DDL.
const DRAWING_SCHEMA = `
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
/* status and revoked_at are required by resolveProjectAuthority ACTIVE_MEMBER
   predicate. Without them the actor resolves to no authority and the handler
   returns 403 before persistence is ever reached. */
CREATE TABLE project_members(id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, original_filename TEXT, extension TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, version_number INTEGER, original_filename TEXT, extension TEXT, sha256 TEXT, object_key TEXT, revision TEXT, byte_size INTEGER);

CREATE TABLE drawing_intake_versions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  review_status TEXT DEFAULT 'Needs Review' NOT NULL,
  superseded_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id)
);

CREATE TABLE drawing_document_classifications (
  id TEXT PRIMARY KEY NOT NULL, intake_version_id TEXT NOT NULL, classification_type TEXT NOT NULL,
  confidence INTEGER NOT NULL, extraction_method TEXT NOT NULL,
  review_status TEXT DEFAULT 'Needs Review' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id));

CREATE TABLE drawing_pages (
  id TEXT PRIMARY KEY NOT NULL, intake_version_id TEXT NOT NULL, page_number INTEGER NOT NULL,
  width REAL, height REAL, coordinate_mode TEXT NOT NULL, classifications TEXT NOT NULL,
  text_count INTEGER NOT NULL, source_review_status TEXT NOT NULL,
  review_status TEXT DEFAULT 'Needs Review' NOT NULL, extraction_method TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, rotation INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id));

CREATE TABLE drawing_metadata (
  id TEXT PRIMARY KEY NOT NULL, intake_version_id TEXT NOT NULL, drawing_number TEXT, revision TEXT,
  sheet_name TEXT, discipline TEXT, scale TEXT, issue_date TEXT, consultant TEXT, contractor TEXT,
  client TEXT, project_name TEXT, sheet_size TEXT, confidence INTEGER NOT NULL,
  extraction_method TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review' NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id));

CREATE TABLE drawing_assets (
  id TEXT PRIMARY KEY NOT NULL, intake_version_id TEXT NOT NULL, page_id TEXT NOT NULL,
  asset_type TEXT NOT NULL, text_content TEXT, bounding_box TEXT, coordinates_available INTEGER NOT NULL,
  detection_confidence INTEGER NOT NULL, detection_method TEXT NOT NULL,
  review_status TEXT DEFAULT 'Needs Review' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id),
  FOREIGN KEY (page_id) REFERENCES drawing_pages(id));

CREATE TABLE drawing_legends (
  id TEXT PRIMARY KEY NOT NULL, intake_version_id TEXT NOT NULL, page_id TEXT NOT NULL,
  legend_version TEXT, confidence INTEGER NOT NULL, detection_method TEXT NOT NULL,
  review_status TEXT DEFAULT 'Needs Review' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id),
  FOREIGN KEY (page_id) REFERENCES drawing_pages(id));

CREATE TABLE drawing_legend_entries (
  id TEXT PRIMARY KEY NOT NULL, legend_id TEXT NOT NULL, sequence INTEGER NOT NULL, entry_type TEXT NOT NULL,
  label TEXT NOT NULL, description TEXT, confidence INTEGER NOT NULL,
  review_status TEXT DEFAULT 'Needs Review' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (legend_id) REFERENCES drawing_legends(id));

CREATE TABLE drawing_search_entries (
  id TEXT PRIMARY KEY NOT NULL, intake_version_id TEXT NOT NULL, page_id TEXT NOT NULL,
  page_number INTEGER NOT NULL, text_content TEXT NOT NULL, drawing_number TEXT, sheet_name TEXT,
  tags TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id),
  FOREIGN KEY (page_id) REFERENCES drawing_pages(id));

CREATE TABLE drawing_intake_audit_events (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, document_id TEXT NOT NULL,
  intake_version_id TEXT NOT NULL, action TEXT NOT NULL, previous_value TEXT, new_value TEXT,
  reason TEXT, actor_user_id TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (project_id) REFERENCES projects(id));
`;

const PROJECT = "project_test_atomicity";
const ORG = "org_test";
const OWNER = "user_owner";
const DOCUMENT = "doc_test_drawing";
const VERSION = "ver_test_drawing";

/**
 * Builds a D1 adapter over a disposable in-memory database.
 *
 * `batchMode` selects the runtime shape under test:
 *   "throwing"     -- rejects if any statement fails (what miniflare does)
 *   "nonthrowing"  -- resolves with D1Result objects, failures reported as
 *                     { success:false, error } (the other documented shape)
 *
 * `sabotage` selects which child table's writes are forced to fail.
 */
function createHarness({ batchMode = "throwing", sabotage = null, silentDrop = null } = {}) {
  const { DatabaseSync } = require_node_sqlite();
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(DRAWING_SCHEMA);

  db.prepare("INSERT INTO projects (id,owner_user_id,organization_id,name) VALUES (?,?,?,?)")
    .run(PROJECT, OWNER, ORG, "Atomicity Test Project");
  db.prepare("INSERT INTO project_members (id,project_id,user_id,role,status,revoked_at) VALUES (?,?,?,?,?,NULL)")
    .run("pm_1", PROJECT, OWNER, "Owner", "Active");
  db.prepare("INSERT INTO documents (id,project_id,document_type,classification_source,current_version_id,original_filename,extension) VALUES (?,?,?,?,?,?,?)")
    .run(DOCUMENT, PROJECT, "Drawing", "upload", VERSION, "test-drawing.pdf", "pdf");
  db.prepare("INSERT INTO document_versions (id,document_id,version_number,original_filename,extension,sha256,object_key,revision) VALUES (?,?,?,?,?,?,?,?)")
    .run(VERSION, DOCUMENT, 1, "test-drawing.pdf", "pdf", "sha_test", "objects/test.pdf", "A");

  const failsFor = (sql) => {
    if (!sabotage) return false;
    return sql.includes(sabotage);
  };

  const statements = [];
  const DB = {
    prepare(sql) {
      // A D1 statement carries no SQL of its own, so the SQL is attached here.
      // Mirrors the real runtime: persist() learns which table failed only from
      // the statement object it was given.
      const op = (args = []) => {
        const stmt = {
          first: async () => db.prepare(sql).get(...args) ?? null,
          all: async () => ({ results: db.prepare(sql).all(...args) }),
          run: async () => db.prepare(sql).run(...args),
          sql,
        };
        return stmt;
      };
      return { ...op(), bind: (...a) => op(a) };
    },
    async batch(batch) {
      if (batchMode === "throwing") {
        db.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of batch) {
            if (failsFor(statement.sql)) throw new Error("D1_ERROR: sabotage: forced statement failure");
            results.push({ ...(await statement.run()), success: true, error: null });
          }
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      if (batchMode === "bare") {
        // A runtime that returns raw driver results with no `success` property
        // at all. Used to prove the repair does not read absence of a failure
        // marker as proof of success.
        db.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of batch) results.push(await statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      // Non-throwing: each statement reports its own outcome and the batch
      // resolves. A silent drop models a runtime that reports success but writes
      // nothing, which only post-write verification can catch.
      const results = [];
      for (const statement of batch) {
        if (failsFor(statement.sql)) {
          results.push({ success: false, error: "sabotage: forced statement failure", meta: {} });
          continue;
        }
        if (silentDrop && statement.sql.includes(silentDrop)) {
          results.push({ success: true, error: null, meta: {} });
          continue;
        }
        try {
          results.push({ ...(await statement.run()), success: true, error: null, meta: {} });
        } catch (error) {
          results.push({ success: false, error: String(error.message), meta: {} });
        }
      }
      return results;
    },
  };

  // A tiny PDF the real extractor accepts.
  const PDF = buildMinimalPdf();

  const FILES = {
    async get() {
      return { async arrayBuffer() { return PDF.buffer; } };
    },
  };

  return { db, DB, FILES };
}

// node:sqlite is a builtin; require it through createRequire so this file can
// stay ESM alongside the module under test.
import { createRequire } from "node:module";
const require_node_sqlite = () => createRequire(import.meta.url)("node:sqlite");

/** A minimal one-page PDF that pdf.js can parse into one page of content. */
function buildMinimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // content stream, built below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const text = "BT /F1 18 Tf 40 520 Td (FIRE ALARM PLAN) Tj ET\n"
    + "BT /F1 10 Tf 40 500 Td (LEVEL 01) Tj ET\n"
    + "BT /F1 10 Tf 40 480 Td (SMOKE DETECTOR) Tj ET\n";
  objects[3] = `<< /Length ${text.length} >>\nstream\n${text}endstream`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

async function startIntake(harness) {
  const request = new Request(
    `http://localhost/api/documents/${encodeURIComponent(DOCUMENT)}/drawing-intake/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "atomicity acceptance test" }),
    },
  );
  // Identity is SERVER-configured, not taken from request headers: this codebase
  // deliberately ignores client identity headers. Passing them (as an earlier
  // version of this test did) leaves the actor unset and the handler never
  // reaches the code under test.
  const env = {
    DB: harness.DB,
    FILES: harness.FILES,
    APP_ACCESS_MODE: "single-user",
    APP_USER_ID: OWNER,
    APP_ORGANIZATION_ID: ORG,
  };
  const response = await handleDrawingIntakeApi(request, env);
  return { status: response.status, body: await response.json() };
}

function intakeRows(harness) {
  return harness.db
    .prepare("SELECT id,status FROM drawing_intake_versions ORDER BY rowid")
    .all();
}

function childCounts(harness, intakeId) {
  const count = (sql) =>
    harness.db.prepare(sql).all(intakeId)[0].count;
  return {
    pages: count("SELECT count(*) AS count FROM drawing_pages WHERE intake_version_id=?1"),
    assets: count("SELECT count(*) AS count FROM drawing_assets WHERE intake_version_id=?1"),
    search: count("SELECT count(*) AS count FROM drawing_search_entries WHERE intake_version_id=?1"),
  };
}

// ---------------------------------------------------------------------------
// POSITIVE
// ---------------------------------------------------------------------------

test("POSITIVE: valid extraction persists all children and returns 201 Completed", async () => {
  const harness = createHarness({ batchMode: "throwing" });
  const { status, body } = await startIntake(harness);

  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.error, undefined);

  const rows = intakeRows(harness);
  assert.equal(rows.length, 1, "exactly one intake row");
  assert.equal(rows[0].status, "Completed");

  const counts = childCounts(harness, rows[0].id);
  assert.ok(counts.pages > 0, "pages must be persisted");
  assert.ok(counts.assets > 0, "assets must be persisted");
  assert.ok(counts.search > 0, "search entries must be persisted");

  // The reported payload must agree with what is in the database.
  assert.equal(body.pages.length, counts.pages);
  assert.equal(body.assets.length, counts.assets);
});

test("POSITIVE: the success invariant holds under the NON-THROWING batch shape too", async () => {
  // Guards against over-fitting the repair to one runtime behaviour.
  const harness = createHarness({ batchMode: "nonthrowing" });
  const { status, body } = await startIntake(harness);

  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(intakeRows(harness)[0].status, "Completed");
  const counts = childCounts(harness, intakeRows(harness)[0].id);
  assert.ok(counts.pages > 0 && counts.assets > 0 && counts.search > 0);
});

// ---------------------------------------------------------------------------
// NEGATIVE 1 -- batch throws
// ---------------------------------------------------------------------------

test("NEGATIVE 1: a throwing batch yields no 201 and no Completed", async () => {
  const harness = createHarness({ batchMode: "throwing", sabotage: "drawing_search_entries" });
  const { status, body } = await startIntake(harness);

  assert.notEqual(status, 201, "a failed child write must never return 201");
  assert.equal(body.error.code, "DRAWING_INTAKE_PERSISTENCE_FAILED");

  const rows = intakeRows(harness);
  for (const row of rows) {
    assert.notEqual(row.status, "Completed", "no intake may be left Completed after a failed write");
  }
});

// ---------------------------------------------------------------------------
// NEGATIVE 2 -- batch resolves with success:false
// ---------------------------------------------------------------------------

test("NEGATIVE 2: a resolved batch containing success:false yields no 201 and no Completed", async () => {
  // This is the exact shape the old code ignored: the batch RESOLVES, so no
  // exception is raised, and the failure is only visible in the results.
  const harness = createHarness({ batchMode: "nonthrowing", sabotage: "drawing_search_entries" });
  const { status, body } = await startIntake(harness);

  assert.notEqual(status, 201, "a success:false result must never return 201");
  assert.equal(body.error.code, "DRAWING_INTAKE_PERSISTENCE_FAILED");

  for (const row of intakeRows(harness)) {
    assert.notEqual(row.status, "Completed");
  }
});

test("NEGATIVE 2b: diagnostics name the failing statement without leaking bound values", async () => {
  const harness = createHarness({ batchMode: "nonthrowing", sabotage: "drawing_search_entries" });
  const { body } = await startIntake(harness);

  const persistence = body.error.persistence;
  assert.ok(persistence, "diagnostics must be present");
  assert.equal(persistence.table, "drawing_search_entries");
  assert.ok(Number.isInteger(persistence.index), "the failing statement index must be reported");
  assert.ok(persistence.reason, "a reason must be reported");

  // No drawing text may appear in the diagnostics.
  const serialised = JSON.stringify(body.error);
  assert.ok(!serialised.includes("FIRE ALARM PLAN"), "diagnostics must not echo drawing content");
});

// ---------------------------------------------------------------------------
// NEGATIVE 3 -- batch claims success but children are missing
// ---------------------------------------------------------------------------

test("NEGATIVE 3: a batch that reports success but drops children fails closed", async () => {
  // The hardest case: no exception, every result says success:true, but rows
  // were never written. Only post-write verification can catch this.
  const harness = createHarness({ batchMode: "nonthrowing", silentDrop: "drawing_search_entries" });
  const { status, body } = await startIntake(harness);

  assert.notEqual(status, 201, "silently dropped children must not yield 201");
  assert.equal(body.error.code, "DRAWING_INTAKE_PERSISTENCE_FAILED");
  assert.equal(body.error.persistence.label, "drawing_search_entries");

  for (const row of intakeRows(harness)) {
    assert.notEqual(row.status, "Completed", "a silently incomplete intake must not be Completed");
  }
});

// ---------------------------------------------------------------------------
// FAILURE LIFECYCLE
// ---------------------------------------------------------------------------

test("MUTATION GUARD: a result with NO success flag is treated as unproven, not successful", async () => {
  // Some adapters return a bare driver result ({changes,lastInsertRowid}) with no
  // `success` property. Accepting that would silently re-open the defect, because
  // "absence of a failure marker" is not evidence of success. The contract
  // requires an explicit success:true, so an absent flag must fail closed.
  const harness = createHarness({ batchMode: "bare" });
  const { status, body } = await startIntake(harness);

  assert.notEqual(status, 201, "an unproven result must not yield 201");
  assert.equal(body.error.code, "DRAWING_INTAKE_PERSISTENCE_FAILED");
  assert.match(body.error.persistence.reason, /did not assert success/i);
});

test("FAILURE LIFECYCLE: a failed persistence leaves a truthful Failed state, not Processing", async () => {
  const harness = createHarness({ batchMode: "throwing", sabotage: "drawing_search_entries" });
  await startIntake(harness);

  const rows = intakeRows(harness);
  assert.ok(rows.length >= 1, "the parent row exists because it is written before the children");
  for (const row of rows) {
    assert.notEqual(row.status, "Processing", "a dead intake must not be left Processing forever");
    assert.equal(row.status, "Failed");
  }
});

test("FAILURE LIFECYCLE: persistence failure is distinguished from extraction failure", async () => {
  const harness = createHarness({ batchMode: "throwing", sabotage: "drawing_assets" });
  const { status, body } = await startIntake(harness);

  assert.equal(status, 500, "a persistence failure is a server-side persistence problem");
  assert.equal(body.error.code, "DRAWING_INTAKE_PERSISTENCE_FAILED");
  assert.notEqual(body.error.code, "DRAWING_INTAKE_FAILED");
});

// ---------------------------------------------------------------------------
// BINDING
// ---------------------------------------------------------------------------

test("BINDING: the persisted intake is bound to the exact document and version", async () => {
  const harness = createHarness({ batchMode: "throwing" });
  await startIntake(harness);

  const row = harness.db
    .prepare("SELECT project_id,document_id,document_version_id FROM drawing_intake_versions LIMIT 1")
    .get();
  assert.equal(row.project_id, PROJECT);
  assert.equal(row.document_id, DOCUMENT);
  assert.equal(row.document_version_id, VERSION);
});