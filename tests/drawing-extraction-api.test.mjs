import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleDrawingExtractionApi } from "../worker/drawing-extraction-api.mjs";

// GENERAL DRAWING EXTRACTION -- persistence + governed review workflow
// (WORKSTREAM 5/6) integration tests. Same minimal-schema + single-user D1
// shim convention as tests/drawing-classification-confirmation-gate.test.mjs.

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
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, version_number INTEGER, original_filename TEXT, extension TEXT, sha256 TEXT, object_key TEXT, revision TEXT);
CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, summary TEXT, review_status TEXT DEFAULT 'Needs Review', superseded_at TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_pages(id TEXT PRIMARY KEY, intake_version_id TEXT, page_number INTEGER, width REAL, height REAL);
CREATE TABLE drawing_assets(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, asset_type TEXT, text_content TEXT, bounding_box TEXT, coordinates_available INTEGER, detection_confidence INTEGER, detection_method TEXT, review_status TEXT DEFAULT 'Needs Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_document_classifications(id TEXT PRIMARY KEY, intake_version_id TEXT, classification_type TEXT, confidence INTEGER);
CREATE TABLE drawing_metadata(id TEXT PRIMARY KEY, intake_version_id TEXT, drawing_number TEXT, revision TEXT, sheet_name TEXT);
CREATE TABLE drawing_legends(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, confidence INTEGER);
CREATE TABLE drawing_legend_entries(id TEXT PRIMARY KEY, legend_id TEXT, sequence INTEGER, entry_type TEXT, label TEXT, description TEXT, confidence INTEGER);
`;

const migration = `
CREATE TABLE IF NOT EXISTS drawing_extraction_proposals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, intake_version_id TEXT NOT NULL,
  page_number INTEGER NOT NULL, proposal_key TEXT NOT NULL, proposal_type TEXT NOT NULL, raw_label TEXT,
  normalized_value TEXT, bounding_box TEXT, confidence INTEGER, authority_role TEXT NOT NULL, governed_status TEXT NOT NULL,
  hard_review_reasons TEXT NOT NULL, evidence TEXT NOT NULL, source_references TEXT NOT NULL, extraction_method TEXT NOT NULL,
  extraction_version TEXT NOT NULL, review_status TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT,
  corrected_value TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_extraction_proposal_key_idx ON drawing_extraction_proposals (intake_version_id, proposal_key);
CREATE TABLE IF NOT EXISTS drawing_extraction_review_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, proposal_id TEXT NOT NULL, action TEXT NOT NULL,
  previous_value TEXT NOT NULL, new_value TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const box = (x, y, width, height) => JSON.stringify({ x, y, width, height, pageWidth: 1000, pageHeight: 1000 });

const seedFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(migration);
  raw.exec(readFileSync(new URL("../drizzle/0074_drawing_visual_runs.sql", import.meta.url),"utf8"));
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','Test',NULL);
    INSERT INTO documents VALUES ('doc1','p1','Drawing','Manual/Unclassified','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',1,'test.pdf','pdf','sha1','obj1',NULL);
    INSERT INTO drawing_intake_versions VALUES ('iv1','p1','doc1','dv1',1,'Completed','{}','Needs Review',NULL,'owner1',CURRENT_TIMESTAMP);
    INSERT INTO drawing_pages VALUES ('page1','iv1',1,1000,1000);
  `);
  const insertAsset = raw.prepare(
    "INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,coordinates_available,detection_confidence,detection_method) VALUES (?,?,?,?,?,?,1,?,?)",
  );
  // A 3-row schedule + one standalone callout referencing row 1.
  insertAsset.run("a1", "iv1", "page1", "Text", "1", box(100, 500, 5, 12), 99, "PDF text item geometry");
  insertAsset.run("a2", "iv1", "page1", "Text", "MAIN FIRE ALARM CONTROL PANEL (MFACP)", box(130, 500, 200, 12), 99, "PDF text item geometry");
  insertAsset.run("a3", "iv1", "page1", "Text", "2", box(100, 470, 5, 12), 99, "PDF text item geometry");
  insertAsset.run("a4", "iv1", "page1", "Text", "BMS INTERFACE LAN PORT", box(130, 470, 140, 12), 99, "PDF text item geometry");
  insertAsset.run("a5", "iv1", "page1", "Text", "3", box(100, 440, 5, 12), 99, "PDF text item geometry");
  insertAsset.run("a6", "iv1", "page1", "Text", "PRINTER", box(130, 440, 60, 12), 99, "PDF text item geometry");
  insertAsset.run("a7", "iv1", "page1", "Text", "1", box(800, 100, 5, 12), 99, "PDF text item geometry");

  return {
    raw,
    env: { DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" },
  };
};

const req = (path, method = "GET", body = null) =>
  new Request(`https://app.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test("GET before sync -- reports synced:false with no rows, does not error", async () => {
  const { env } = seedFixture();
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.synced, false);
  assert.deepEqual(body.proposals, []);
});

test("persistence round-trip -- sync persists proposals, and a second sync is idempotent (same row count, no duplicates)", async () => {
  const { raw, env } = seedFixture();
  const first = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const firstBody = await first.json();
  assert.equal(first.status, 201);
  assert.ok(firstBody.proposals.length > 0);
  const countAfterFirst = raw.prepare("SELECT COUNT(*) count FROM drawing_extraction_proposals").get().count;

  const second = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  assert.equal(second.status, 201);
  const countAfterSecond = raw.prepare("SELECT COUNT(*) count FROM drawing_extraction_proposals").get().count;
  assert.equal(countAfterSecond, countAfterFirst);
});

test("persisted proposal carries full provenance -- project/document/version/page/type/bbox/evidence/source refs/authority/status", async () => {
  const { raw, env } = seedFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const row = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Equipment Schedule Item' LIMIT 1").get();
  assert.ok(row);
  assert.equal(row.project_id, "p1");
  assert.equal(row.document_id, "doc1");
  assert.equal(row.intake_version_id, "iv1");
  assert.equal(row.page_number, 1);
  assert.ok(row.bounding_box);
  assert.ok(JSON.parse(row.evidence));
  assert.ok(JSON.parse(row.source_references).length > 0);
  assert.equal(row.authority_role, "Primary");
  assert.equal(row.governed_status, "Verified");
  assert.equal(row.extraction_version, "drawing-general-extraction-engine-1.1.0");
});

test("review audit trail -- approving a schedule item writes actor/reason/old/new to the review_events table", async () => {
  const { raw, env } = seedFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const proposal = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Equipment Schedule Item' LIMIT 1").get();

  const response = await handleDrawingExtractionApi(
    req(`/api/documents/doc1/drawing-extraction/${proposal.id}/approve`, "POST", { reason: "Confirmed against the printed schedule on sheet 1" }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reviewStatus, "Verified");

  const events = raw.prepare("SELECT * FROM drawing_extraction_review_events WHERE proposal_id=?").all(proposal.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "approve");
  assert.equal(events[0].actor_user_id, "owner1");
  assert.match(events[0].reason, /Confirmed against the printed schedule/);
  assert.ok(JSON.parse(events[0].previous_value));
  assert.ok(JSON.parse(events[0].new_value));
});

test("a short/non-substantive reason is rejected with 422, and no row/audit change occurs", async () => {
  const { raw, env } = seedFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const proposal = raw.prepare("SELECT * FROM drawing_extraction_proposals LIMIT 1").get();
  const response = await handleDrawingExtractionApi(
    req(`/api/documents/doc1/drawing-extraction/${proposal.id}/approve`, "POST", { reason: "ok" }),
    env,
  );
  assert.equal(response.status, 422);
  const events = raw.prepare("SELECT COUNT(*) count FROM drawing_extraction_review_events").get();
  assert.equal(events.count, 0);
});

test("conflict state -- a proposal in Conflict cannot be approved directly (hard-review gate enforced server-side)", async () => {
  const { raw, env } = seedFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const proposal = raw.prepare("SELECT * FROM drawing_extraction_proposals LIMIT 1").get();
  await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${proposal.id}/conflict`, "POST", { reason: "Quantity disagrees with the client BOQ for this item" }), env);

  const approveAttempt = await handleDrawingExtractionApi(
    req(`/api/documents/doc1/drawing-extraction/${proposal.id}/approve`, "POST", { reason: "Trying to approve anyway despite the open conflict" }),
    env,
  );
  const body = await approveAttempt.json();
  assert.equal(approveAttempt.status, 422);
  assert.equal(body.error.code, "DRAWING_EXTRACTION_CONFLICT_BLOCKS_APPROVAL");
});

test("identity merge cannot be approved -- an EquipmentCandidate/PanelCandidate proposal blocks the approve action entirely", async () => {
  const { raw, env } = seedFixture();
  // Add a standalone "FACP" acronym token so an alias candidate is produced.
  raw
    .prepare(
      "INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,coordinates_available,detection_confidence,detection_method) VALUES (?,?,?,?,?,?,1,99,'PDF text item geometry')",
    )
    .run("a8", "iv1", "page1", "Text", "FACP", box(800, 300, 30, 12));
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const candidate = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Panel Candidate' LIMIT 1").get();
  assert.ok(candidate, "expected a Panel Candidate proposal for FACP to be persisted");

  const response = await handleDrawingExtractionApi(
    req(`/api/documents/doc1/drawing-extraction/${candidate.id}/approve`, "POST", { reason: "Attempting to confirm FACP equals MFACP" }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "DRAWING_EXTRACTION_IDENTITY_MERGE_NOT_SUPPORTED");

  // Reject remains available for the same proposal type.
  const rejectResponse = await handleDrawingExtractionApi(
    req(`/api/documents/doc1/drawing-extraction/${candidate.id}/reject`, "POST", { reason: "Not a useful alias observation for this drawing" }),
    env,
  );
  assert.equal(rejectResponse.status, 200);
});

test("restore returns a proposal's review_status back to the system's own governed_status", async () => {
  const { raw, env } = seedFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const proposal = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Callout Reference' LIMIT 1").get();
  assert.ok(proposal);
  await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${proposal.id}/reject`, "POST", { reason: "Looked like a false positive at first review" }), env);
  const restored = await handleDrawingExtractionApi(
    req(`/api/documents/doc1/drawing-extraction/${proposal.id}/restore`, "POST", { reason: "Re-reviewed and this is a legitimate callout after all" }),
    env,
  );
  const body = await restored.json();
  assert.equal(body.reviewStatus, "Needs Review"); // the callout's own governed_status
});

test("Not Found behavior -- a document with no drawing intake yet reports 409, not a crash", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(migration);
  raw.exec(readFileSync(new URL("../drizzle/0074_drawing_visual_runs.sql", import.meta.url),"utf8"));
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','Test',NULL);
    INSERT INTO documents VALUES ('doc1','p1','Drawing','Manual/Unclassified','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',1,'test.pdf','pdf','sha1','obj1',NULL);
  `);
  const env = { DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction"), env);
  assert.equal(response.status, 409);
  const syncResponse = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  assert.equal(syncResponse.status, 409);
});

test("a rerun after an engineer has already reviewed a proposal does not silently discard that human review_status", async () => {
  const { raw, env } = seedFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const proposal = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Equipment Schedule Item' LIMIT 1").get();
  await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${proposal.id}/reject`, "POST", { reason: "Engineer determined this row is actually a duplicate" }), env);

  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const afterRerun = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE id=?").get(proposal.id);
  assert.equal(afterRerun.review_status, "Rejected"); // human decision preserved
  assert.equal(afterRerun.governed_status, "Verified"); // system's own reference computation still refreshed
});
