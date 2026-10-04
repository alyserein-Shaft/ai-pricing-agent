import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");

const activeMigrations = () => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((entry) => ({
    ...entry,
    sql: readFileSync(join(ACTIVE_ROOT, `${entry.tag}.sql`), "utf8"),
  }));
};

const applyMigration = (db, migration) => {
  for (const statement of migration.sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
};

const applyThrough = (db, migrations, index) => {
  for (const migration of migrations.slice(0, index + 1)) applyMigration(db, migration);
};

const openDatabase = (path) => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON");
  return db;
};

const scalar = (db, sql) => {
  const row = db.prepare(sql).get();
  return row ? Object.values(row)[0] : null;
};

const tableColumns = (db, table) => new Set(db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => row.name));
const assertHealthy = (db) => {
  assert.equal(scalar(db, "PRAGMA integrity_check"), "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
};

const insertProject = (db, id = "p1") => db.prepare("INSERT INTO projects (id, name, owner_user_id) VALUES (?, ?, ?)").run(id, "Migration verification", "u1");
const insertDocumentVersion = (db, { id, documentId, uploadSessionId = null, versionNumber = 1, effectiveFrom = null, effectiveTo = null }) => db.prepare("INSERT INTO document_versions (id, document_id, upload_session_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, effective_from, effective_to, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, 'pdf', 'application/pdf', 4, ?, ?, ?, ?, 'u1')").run(id, documentId, uploadSessionId, versionNumber, `${id}.pdf`, `${id}.stored`, `${id}-checksum`, `projects/${id}.pdf`, effectiveFrom, effectiveTo);
const insertLegacyDocumentVersion = (db, { id, documentId, uploadSessionId = null, versionNumber = 1 }) => db.prepare("INSERT INTO document_versions (id, document_id, upload_session_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, 'pdf', 'application/pdf', 4, ?, ?, 'u1')").run(id, documentId, uploadSessionId, versionNumber, `${id}.pdf`, `${id}.stored`, `${id}-checksum`, `projects/${id}.pdf`);
const insertReviewQueue = (db, id = "rq1", projectId = "p1") => db.prepare("INSERT INTO review_queue_items (id, project_id, review_type, priority, priority_score, severity, status, required_role, blocking, source_module, reason_for_review, required_decision, approval_level, safety_state, entity_version, version_number, escalation_status, created_by) VALUES (?, ?, 'Final Estimation Review', 'High', 1, 'High', 'Waiting for Technical Approval', 'Technical Manager', 1, 'Migration Verification', 'Seeded review', 'Approve', 1, 'Approval Ready', 1, 1, 'None', 'u1')").run(id, projectId);

const insertDecision = (db, { id, reviewItemId = "rq1", reviewVersion = 2, requestId, requestFingerprint = "f".repeat(64) }) => db.prepare("INSERT INTO review_decisions (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state, entity_version, review_version, safety_state, reason, evidence, scope, conditions, approval_level, decided_by, decided_role, request_id, request_fingerprint) VALUES (?, ?, 'p1', 'Approve Technical Match', 'Approved', 'In Review', 'Waiting for Commercial Approval', 1, ?, 'Approval Ready', 'Migration verification decision', '[]', 'BOQ Item', '[]', 1, 'u1', 'Technical Manager', ?, ?)").run(id, reviewItemId, reviewVersion, requestId, requestFingerprint);

const withTempDatabase = async (callback) => {
  const directory = mkdtempSync(join(tmpdir(), "active-migration-chain-"));
  const path = join(directory, "verification.sqlite");
  const db = openDatabase(path);
  try {
    return await callback(db);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
};

test("actual active migration chain bootstraps a fresh database and enforces document, review, and panel guards", async () => {
  await withTempDatabase(async (db) => {
    const migrations = activeMigrations();
    applyThrough(db, migrations, migrations.length - 1);
    assertHealthy(db);

    // The object inventory is compared against the MANIFEST, not against a
    // remembered number. This assertion used to pin 314 tables, which is the
    // same literal-rot that left this suite red when 0012_military_havok landed a
    // new table: a correct migration reported a failure. Deriving the expectation
    // from the canonical inventory asserts the property that actually matters --
    // applying the journal-ordered chain produces EXACTLY the declared object
    // set, with nothing missing and nothing extra -- and it cannot go stale.
    const manifest = JSON.parse(readFileSync(join(ACTIVE_ROOT, "manifest.json"), "utf8"));
    const objectCount = (type) =>
      scalar(db, `SELECT count(*) AS count FROM sqlite_master WHERE type='${type}' AND name NOT LIKE 'sqlite_%'`);
    assert.equal(objectCount("table"), manifest.counts.businessTables, "the applied chain must produce exactly the manifest's business tables");
    assert.equal(objectCount("index"), manifest.counts.namedIndexes, "the applied chain must produce exactly the manifest's named indexes");
    assert.equal(objectCount("view"), manifest.counts.views, "the applied chain must produce exactly the manifest's views");
    assert.equal(
      scalar(db, "SELECT count(*) AS count FROM sqlite_master WHERE type='trigger'"),
      manifest.counts.triggers,
      "the applied chain must produce exactly the manifest's triggers",
    );
    assert.ok(tableColumns(db, "document_versions").has("effective_from"));
    assert.ok(tableColumns(db, "document_versions").has("effective_to"));
    assert.ok(tableColumns(db, "documents").has("document_family_id"));
    assert.equal(scalar(db, "SELECT count(*) AS count FROM document_families"), 0);
    assert.equal(scalar(db, "SELECT count(*) AS count FROM document_supersessions"), 0);

    insertProject(db);
    db.prepare("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d1', 'p1', 'source.pdf', 'u1')").run();
    insertDocumentVersion(db, { id: "v1", documentId: "d1", effectiveFrom: "2026-01-01" });
    db.prepare("UPDATE documents SET current_version_id='v1' WHERE id='d1'").run();
    db.prepare("INSERT INTO document_families (id, project_id, base_document_id, name) VALUES ('df1', 'p1', 'd1', 'source family')").run();
    insertDocumentVersion(db, { id: "v2", documentId: "d1", versionNumber: 2 });
    db.prepare("INSERT INTO document_supersessions (id, superseding_version_id, superseded_version_id, scope_type, supersession_type, created_by) VALUES ('ds1', 'v2', 'v1', 'FULL_DOCUMENT', 'ADDENDUM', 'u1')").run();
    assert.throws(() => db.prepare("INSERT INTO document_supersessions (id, superseding_version_id, superseded_version_id, scope_type, supersession_type, created_by) VALUES ('ds-invalid', 'v2', 'v1', 'INVALID_SCOPE', 'ADDENDUM', 'u1')").run(), /CHECK constraint failed/);

    insertReviewQueue(db);
    insertDecision(db, { id: "rd1", requestId: "req-1" });
    db.prepare("UPDATE review_queue_items SET version_number=2 WHERE id='rq1'").run();
    assert.throws(() => insertDecision(db, { id: "rd2", reviewVersion: 4, requestId: "req-cas" }), /REVIEW_VERSION_CAS_CONFLICT/);
    assert.throws(() => insertDecision(db, { id: "rd3", reviewVersion: 3, requestId: "req-1" }), /UNIQUE constraint failed: review_decisions.project_id, review_decisions.request_id/);
    db.prepare("INSERT INTO review_audit_log (id, project_id, review_item_id, action, reason, actor_user_id, actor_role, request_id, entity_version) VALUES ('ra1', 'p1', 'rq1', 'Approve Technical Match', 'Migration verification', 'u1', 'Technical Manager', 'req-1', 2)").run();
    assert.throws(() => db.prepare("UPDATE review_decisions SET outcome='Rejected' WHERE id='rd1'").run(), /REVIEW_DECISIONS_IMMUTABLE/);
    assert.throws(() => db.prepare("DELETE FROM review_decisions WHERE id='rd1'").run(), /REVIEW_DECISIONS_IMMUTABLE/);
    assert.throws(() => db.prepare("UPDATE review_audit_log SET reason='rewritten' WHERE id='ra1'").run(), /REVIEW_AUDIT_LOG_IMMUTABLE/);
    assert.throws(() => db.prepare("DELETE FROM review_audit_log WHERE id='ra1'").run(), /REVIEW_AUDIT_LOG_IMMUTABLE/);

    db.prepare("INSERT INTO fire_alarm_panel_sizing_snapshots (id, project_id, version_number, input_fingerprint, engine_version, status, input_json, calculation_json, dossier_json, reason, created_by) VALUES ('ps1', 'p1', 1, 'input-fp', 'engine-v1', 'Completed', '{}', '{}', '{}', 'Seeded panel snapshot', 'u1')").run();
    assert.throws(() => db.prepare("UPDATE fire_alarm_panel_sizing_snapshots SET reason='rewritten' WHERE id='ps1'").run(), /FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE/);
    assert.throws(() => db.prepare("DELETE FROM fire_alarm_panel_sizing_snapshots WHERE id='ps1'").run(), /FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE/);
    assertHealthy(db);
  });
});

test("the readiness probe reports the ACTIVE chain head as its migration version, never a legacy tag", async () => {
  const migrations = activeMigrations();
  const headTag = migrations[migrations.length - 1].tag;
  const { MIGRATION_VERSION } = await import("../app/domain/production-readiness.mjs");
  // The reported value must be the head of the chain that is actually applied.
  assert.equal(
    MIGRATION_VERSION,
    headTag,
    "the readiness probe must report the active chain head from the Drizzle journal",
  );
  // ...and that head must be a real, journaled file in the active chain, so the
  // reported value can never name something that does not exist or lives only in
  // the frozen legacy chain (which must never be replayed).
  //
  // This is the exact regression: the value used to be the legacy
  // "0014_task9_fire_alarm_library", which is absent from drizzle-active/ and
  // belongs to the frozen drizzle/ chain that the runbook forbids replaying.
  if (existsSync(join(ROOT, "drizzle", `${MIGRATION_VERSION}.sql`))) {
    assert.ok(
      existsSync(join(ACTIVE_ROOT, `${MIGRATION_VERSION}.sql`)),
      "a migration that exists only in the frozen legacy chain must never be reported as the applied version",
    );
  }
  assert.ok(
    existsSync(join(ACTIVE_ROOT, `${MIGRATION_VERSION}.sql`)),
    "the reported migration version must exist as a file in the active chain",
  );
});

test("actual active chain upgrades 0000-0002 without losing representative records", async () => {
  await withTempDatabase(async (db) => {
    const migrations = activeMigrations();
    applyThrough(db, migrations, 2);

    insertProject(db);
    db.prepare("INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('d-upgrade', 'p1', 'upgrade.pdf', 'u1')").run();
    insertLegacyDocumentVersion(db, { id: "v-upgrade", documentId: "d-upgrade" });
    db.prepare("UPDATE documents SET current_version_id='v-upgrade' WHERE id='d-upgrade'").run();
    insertReviewQueue(db, "rq-upgrade");
    db.prepare("INSERT INTO review_decisions (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state, entity_version, review_version, safety_state, reason, evidence, scope, conditions, approval_level, decided_by, decided_role, request_id, decided_at) VALUES ('rd-upgrade', 'rq-upgrade', 'p1', 'Approve Technical Match', 'Approved', 'In Review', 'Waiting for Commercial Approval', 1, 2, 'Approval Ready', 'Pre-0003 decision', '[]', 'BOQ Item', '[]', 1, 'u1', 'Technical Manager', 'legacy-request', '2026-01-01T00:00:00.000Z')").run();
    for (const migration of migrations.slice(3)) applyMigration(db, migration);
    assertHealthy(db);
    assert.equal(scalar(db, "SELECT name FROM projects WHERE id='p1'"), "Migration verification");
    assert.equal(scalar(db, "SELECT logical_name FROM documents WHERE id='d-upgrade'"), "upgrade.pdf");
    assert.equal(scalar(db, "SELECT current_version_id FROM documents WHERE id='d-upgrade'"), "v-upgrade");
    assert.equal(scalar(db, "SELECT effective_from FROM document_versions WHERE id='v-upgrade'"), null);
    assert.equal(scalar(db, "SELECT effective_to FROM document_versions WHERE id='v-upgrade'"), null);
    // 0005 backfills exactly one self-family per existing document and links it
    // in the same step. That is the intended upgrade behaviour: the upgrade
    // adds the new revision grouping, and it does not leave a real document
    // unlinked from its own family.
    assert.equal(scalar(db, "SELECT document_family_id FROM documents WHERE id='d-upgrade'"), "docfam_d-upgrade");
    assert.equal(scalar(db, "SELECT name FROM document_families WHERE id='docfam_d-upgrade'"), "upgrade.pdf");
    assert.equal(scalar(db, "SELECT project_id FROM document_families WHERE id='docfam_d-upgrade'"), "p1");
    assert.equal(scalar(db, "SELECT base_document_id FROM document_families WHERE id='docfam_d-upgrade'"), "d-upgrade");
    assert.equal(scalar(db, "SELECT request_id FROM review_decisions WHERE id='rd-upgrade'"), "legacy-request");
    assert.equal(scalar(db, "SELECT request_fingerprint FROM review_decisions WHERE id='rd-upgrade'"), "");
    assert.equal(scalar(db, "SELECT decided_at FROM review_decisions WHERE id='rd-upgrade'"), "2026-01-01T00:00:00.000Z");
    // The upgrade produced exactly one self-family, for the one pre-existing
    // document, and no supersession history was invented.
    assert.equal(scalar(db, "SELECT count(*) FROM document_families"), 1);
    assert.equal(scalar(db, "SELECT count(*) FROM document_supersessions"), 0);
  });
});
