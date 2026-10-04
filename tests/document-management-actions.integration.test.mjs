import assert from "node:assert/strict";
import test from "node:test";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleDocumentApi } from "../worker/document-api.mjs";

// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to hand-roll a ~40-table CREATE TABLE approximation of the
// schema. That approximation drifts: the governed document read/write paths
// (worker/document-api.mjs, worker/document-classification-authority.mjs,
// worker/engineering-fact-freshness.mjs) touch far more than the hand-written
// list, so as soon as a governed path grew a dependency -- DOC-R3's revision
// authority (`document_versions.effective_from/effective_to`,
// `documents.document_family_id`, `document_supersessions`) -- the fixture kept
// compiling and then failed at runtime with "no such table"/"no such column",
// proving nothing about the behaviour it claimed to cover. Appending columns
// to a hand-written list is how that drift happens, and it happens again on the
// next migration.
//
// The fixture below is therefore built by `activeChainDatabase()` -- the ACTUAL
// ordered drizzle-active chain read from the migration journal -- and wrapped in
// the shared D1-shaped `d1()` adapter. See tests/fixtures/active-chain-fixture.mjs.
// Consequences, both intended: a future migration cannot silently invalidate this
// file's fixtures, and every seed row must satisfy the REAL NOT NULL / FOREIGN
// KEY set, so the seeds are honest rows rather than optimistic ones. FK
// enforcement stays ON because the real chain leaves it on
// (drizzle-active/0002_governing_source_fk.sql): `organizations` is a real FK
// parent of `projects` and is seeded rather than skipped.
// :memory: only; no live data.

const fixture = () => {
  const raw = activeChainDatabase();

  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org-a','Organization A');

    INSERT INTO projects
      (id,name,owner_user_id,organization_id,archived_at)
    VALUES
      ('p1','Project 1','user-a','org-a',NULL);

    INSERT INTO documents
      (id,project_id,logical_name,document_type,current_version_id,created_by)
    VALUES
      ('doc-active','p1','Active.pdf','Drawing','ver-active','user-a'),
      ('doc-retry','p1','Retry.pdf','Drawing','ver-retry','user-a'),
      ('doc-delete','p1','Delete.pdf','Drawing','ver-delete','user-a');

    INSERT INTO document_versions
      (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,quarantine_status)
    VALUES
      ('ver-active','doc-active',1,'Active.pdf','active.pdf','pdf','application/pdf',100,'sha-active','p1/active','user-a','Clear'),
      ('ver-retry','doc-retry',1,'Retry.pdf','retry.pdf','pdf','application/pdf',100,'sha-retry','p1/retry','user-a','Clear'),
      ('ver-delete','doc-delete',1,'Delete.pdf','delete.pdf','pdf','application/pdf',100,'sha-delete','p1/delete','user-a','Clear');

    INSERT INTO document_processing_runs
      (id,document_version_id,stage,status,progress,attempt,max_attempts,processor_version)
    VALUES
      ('job-active','ver-active','Classification','Processing',50,0,3,'test'),
      ('job-retry','ver-retry','Classification','Failed',100,0,3,'test'),
      ('job-delete','ver-delete','Classification','Completed',100,0,3,'test');
  `);

  return {
    raw,
    env: {
      DB: d1(raw),
      FILES: {
        put: async () => {},
        get: async () => null,
        delete: async () => {},
      },
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "user-a",
      APP_ORGANIZATION_ID: "org-a",
    },
  };
};

const postAction = async (env, documentId, action, reason = "Lifecycle test") => {
  const response = await handleDocumentApi(
    new Request(
      `https://app.example/api/documents/${encodeURIComponent(documentId)}/${action}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    ),
    env,
    { waitUntil() {} },
  );

  return {
    response,
    body: await response.json(),
  };
};

const deleteDocument = async (env, documentId, reason = "Delete lifecycle test") => {
  const response = await handleDocumentApi(
    new Request(
      `https://app.example/api/documents/${encodeURIComponent(documentId)}`,
      {
        method: "DELETE",
        headers: { "x-audit-reason": reason },
      },
    ),
    env,
    { waitUntil() {} },
  );

  return {
    response,
    body: await response.json(),
  };
};

test("document management lifecycle persists governed actions end to end", async () => {
  const { raw, env } = fixture();

  // Active processing is protected from destructive actions.
  {
    const { response, body } = await postAction(
      env,
      "doc-active",
      "archive",
      "Archive while active",
    );
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "DOCUMENT_PROCESSING_ACTIVE");
    assert.equal(
      raw.prepare("SELECT archived_at FROM documents WHERE id='doc-active'").get()
        .archived_at,
      null,
    );
  }

  {
    const { response, body } = await deleteDocument(
      env,
      "doc-active",
      "Delete while active",
    );
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "DOCUMENT_PROCESSING_ACTIVE");
    assert.equal(
      raw.prepare("SELECT deleted_at FROM documents WHERE id='doc-active'").get()
        .deleted_at,
      null,
    );
  }

  // Active job can be cancelled.
  {
    const { response, body } = await postAction(
      env,
      "doc-active",
      "cancel",
      "Cancel active processing",
    );
    assert.equal(response.status, 200, JSON.stringify(body));

    const job = raw
      .prepare(
        "SELECT status,cancel_requested FROM document_processing_runs WHERE id='job-active'",
      )
      .get();

    assert.equal(job.status, "Cancelled");
    assert.equal(job.cancel_requested, 1);

    const history = raw
      .prepare(
        "SELECT from_status,to_status,message FROM processing_history WHERE run_id='job-active' ORDER BY created_at DESC LIMIT 1",
      )
      .get();

    assert.equal(history.from_status, "Processing");
    assert.equal(history.to_status, "Cancelled");
    assert.equal(history.message, "Cancel active processing");
  }

  // Once terminal, archive is permitted and audited.
  {
    const { response, body } = await postAction(
      env,
      "doc-active",
      "archive",
      "Archive cancelled source",
    );
    assert.equal(response.status, 200, JSON.stringify(body));

    const document = raw
      .prepare("SELECT archived_at FROM documents WHERE id='doc-active'")
      .get();

    assert.ok(document.archived_at);

    const audit = raw
      .prepare(
        "SELECT action,reason FROM document_audit_events WHERE document_id='doc-active' AND action='Archive' ORDER BY created_at DESC LIMIT 1",
      )
      .get();

    assert.equal(audit.action, "Archive");
    assert.equal(audit.reason, "Archive cancelled source");
  }

  // Archived document can be restored.
  {
    const { response, body } = await postAction(
      env,
      "doc-active",
      "restore",
      "Restore archived source",
    );
    assert.equal(response.status, 200, JSON.stringify(body));

    const document = raw
      .prepare("SELECT archived_at FROM documents WHERE id='doc-active'")
      .get();

    assert.equal(document.archived_at, null);

    const audit = raw
      .prepare(
        "SELECT action,reason FROM document_audit_events WHERE document_id='doc-active' AND action='Restore' ORDER BY created_at DESC LIMIT 1",
      )
      .get();

    assert.equal(audit.action, "Restore");
    assert.equal(audit.reason, "Restore archived source");
  }

  // Failed processing can be retried and produces history.
  {
    const { response, body } = await postAction(
      env,
      "doc-retry",
      "retry",
      "Retry failed classification",
    );
    assert.equal(response.status, 200, JSON.stringify(body));

    const job = raw
      .prepare(
        "SELECT status,attempt,last_retry_at FROM document_processing_runs WHERE id='job-retry'",
      )
      .get();

    assert.equal(job.status, "Queued");
    assert.equal(job.attempt, 1);
    assert.ok(job.last_retry_at);

    const history = raw
      .prepare(
        "SELECT from_status,to_status,message FROM processing_history WHERE run_id='job-retry' ORDER BY created_at DESC LIMIT 1",
      )
      .get();

    assert.equal(history.from_status, "Failed");
    assert.equal(history.to_status, "Queued");
    assert.equal(history.message, "Retry failed classification");
  }

  // Terminal document can be soft-deleted and audited.
  {
    const { response, body } = await deleteDocument(
      env,
      "doc-delete",
      "Delete completed duplicate",
    );
    assert.equal(response.status, 200, JSON.stringify(body));

    const document = raw
      .prepare("SELECT deleted_at FROM documents WHERE id='doc-delete'")
      .get();

    assert.ok(document.deleted_at);

    const audit = raw
      .prepare(
        "SELECT action,reason FROM document_audit_events WHERE document_id='doc-delete' AND action='Delete' ORDER BY created_at DESC LIMIT 1",
      )
      .get();

    assert.equal(audit.action, "Delete");
    assert.equal(audit.reason, "Delete completed duplicate");
  }

  // Audited POST actions require a meaningful reason.
  {
    const { response, body } = await postAction(
      env,
      "doc-active",
      "archive",
      "",
    );
    assert.equal(response.status, 422);
    assert.equal(body.error.code, "REASON_REQUIRED");
  }

  raw.close();
});

test("restoring a previous document version creates a new governed current version without mutating history", async () => {
  const { raw, env } = fixture();

  // Make doc-active represent a real two-version history:
  // v1 = historical source we want to restore
  // v2 = current source before restore
  raw.exec(`
    UPDATE document_versions
    SET
      version_number=2,
      revision='B',
      issue_date='2026-08-01',
      issue_purpose='Addendum',
      transmittal='TR-002'
    WHERE id='ver-active';

    INSERT INTO document_versions (
      id,document_id,version_number,original_filename,stored_filename,
      extension,mime_type,byte_size,sha256,object_key,revision,
      issue_date,issue_purpose,transmittal,source,uploaded_by,
      supersedes_version_id,restored_from_version_id,quarantine_status
    ) VALUES (
      'ver-active-old','doc-active',1,'Active-Rev-A.pdf','active-rev-a.pdf',
      'pdf','application/pdf',90,'sha-active-old','p1/active-old','A',
      '2026-07-01','Tender','TR-001','User Upload','user-a',
      NULL,NULL,'Clear'
    );

    UPDATE document_versions
    SET supersedes_version_id='ver-active-old'
    WHERE id='ver-active';

    UPDATE document_processing_runs
    SET status='Completed', progress=100
    WHERE id='job-active';
  `);

  const originalOld = raw
    .prepare(`
      SELECT *
      FROM document_versions
      WHERE id='ver-active-old'
    `)
    .get();

  // Restore schedules downstream reprocessing, so the detached work is captured
  // and awaited: otherwise the assertions below race the classification run.
  const detached = [];
  const response = await handleDocumentApi(
    new Request(
      "https://app.example/api/documents/doc-active/versions/ver-active-old/restore",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "restore-version-test",
        },
        body: JSON.stringify({
          reason: "Restore approved historical revision",
        }),
      },
    ),
    env,
    { waitUntil(promise) { detached.push(Promise.resolve(promise).catch(() => undefined)); } },
  );
  await Promise.all(detached);

  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));

  const document = raw
    .prepare(`
      SELECT current_version_id,archived_at,deleted_at
      FROM documents
      WHERE id='doc-active'
    `)
    .get();

  assert.ok(document.current_version_id);
  assert.notEqual(document.current_version_id, "ver-active");
  assert.notEqual(document.current_version_id, "ver-active-old");
  assert.equal(document.archived_at, null);
  assert.equal(document.deleted_at, null);

  const restored = raw
    .prepare(`
      SELECT *
      FROM document_versions
      WHERE id=?
    `)
    .get(document.current_version_id);

  assert.equal(restored.document_id, "doc-active");
  assert.equal(restored.version_number, 3);
  assert.equal(restored.original_filename, "Active-Rev-A.pdf");
  assert.equal(restored.sha256, "sha-active-old");
  assert.equal(restored.object_key, "p1/active-old");
  assert.equal(restored.revision, "A");
  assert.equal(restored.issue_date, "2026-07-01");
  assert.equal(restored.issue_purpose, "Tender");
  assert.equal(restored.transmittal, "TR-001");
  assert.equal(restored.source, "Version Restore");
  assert.equal(restored.supersedes_version_id, "ver-active");
  assert.equal(restored.restored_from_version_id, "ver-active-old");
  assert.equal(restored.uploaded_by, "user-a");

  // Historical source remains immutable.
  const oldAfterRestore = raw
    .prepare(`
      SELECT *
      FROM document_versions
      WHERE id='ver-active-old'
    `)
    .get();

  assert.deepEqual(oldAfterRestore, originalOld);

  // Current pre-restore version also remains preserved.
  const previousCurrent = raw
    .prepare(`
      SELECT id,version_number,revision,supersedes_version_id
      FROM document_versions
      WHERE id='ver-active'
    `)
    .get();

  assert.equal(previousCurrent.id, "ver-active");
  assert.equal(previousCurrent.version_number, 2);
  assert.equal(previousCurrent.revision, "B");
  assert.equal(
    previousCurrent.supersedes_version_id,
    "ver-active-old",
  );

  // Restore must create a fresh governed processing run, and then actually drive
  // it. The run used to be left at 'Intake'/'Queued' forever: restore wrote
  // history claiming the version was "queued for downstream reprocessing" but
  // never scheduled that work, so the governing version kept the classification
  // derived from the withdrawn one.
  const restoreJob = raw
    .prepare(`
      SELECT *
      FROM document_processing_runs
      WHERE document_version_id=?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(document.current_version_id);

  assert.ok(restoreJob);
  assert.equal(restoreJob.processor_version, "document-intake-v1");
  assert.notEqual(
    restoreJob.status,
    "Queued",
    "the restored version's processing run must be driven, not stranded in Queued",
  );
  assert.notEqual(
    restoreJob.stage,
    "Intake",
    "a restore that schedules reprocessing must advance the run past Intake",
  );

  // The restore's own history entry. This is selected by its message rather than
  // as the latest row, because the reprocessing the restore schedules appends
  // further history to the same run -- the transition below must still be the one
  // the restore recorded, not whichever transition ran last.
  const history = raw
    .prepare(`
      SELECT from_status,to_status,progress,actor,message
      FROM processing_history
      WHERE run_id=?
        AND message='Restored version queued for downstream reprocessing.'
    `)
    .get(restoreJob.id);

  assert.ok(history, "the restore must record its own processing transition");
  assert.equal(history.from_status, "Uploaded");
  assert.equal(history.to_status, "Queued");
  assert.equal(history.progress, 1);
  assert.equal(history.actor, "user-a");

  const audit = raw
    .prepare(`
      SELECT action,reason,request_id,version_id,old_value,new_value
      FROM document_audit_events
      WHERE document_id='doc-active'
        AND action='Restore Previous Version'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get();

  assert.ok(audit);
  assert.equal(audit.version_id, document.current_version_id);
  assert.equal(audit.reason, "Restore approved historical revision");
  assert.equal(audit.request_id, "restore-version-test");

  const oldValue = JSON.parse(audit.old_value);
  const newValue = JSON.parse(audit.new_value);

  assert.equal(oldValue.currentVersionId, "ver-active");
  assert.equal(oldValue.versionNumber, 2);
  assert.equal(newValue.currentVersionId, document.current_version_id);
  assert.equal(newValue.versionNumber, 3);
  assert.equal(newValue.restoredFromVersionId, "ver-active-old");

  raw.close();
});

test("version restore fails closed without a substantive audit reason", async () => {
  const { raw, env } = fixture();

  const response = await handleDocumentApi(
    new Request(
      "https://app.example/api/documents/doc-active/versions/ver-active/restore",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "" }),
      },
    ),
    env,
    { waitUntil() {} },
  );

  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "REASON_REQUIRED");

  assert.equal(
    raw.prepare(`
      SELECT COUNT(*) AS count
      FROM document_versions
      WHERE document_id='doc-active'
    `).get().count,
    1,
  );

  raw.close();
});

test("download and preview return governed source bytes with correct headers", async () => {
  const { raw, env } = fixture();

  const sourceBytes = new TextEncoder().encode("document-source");

  env.FILES.get = async (key) => {
    assert.equal(key, "p1/active");

    return {
      body: sourceBytes,
      writeHttpMetadata(headers) {
        headers.set("x-storage-metadata", "present");
      },
    };
  };

  // Download
  {
    const response = await handleDocumentApi(
      new Request("https://app.example/api/documents/doc-active/download"),
      env,
      { waitUntil() {} },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-length"), "100");
    assert.equal(response.headers.get("etag"), "sha-active");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      response.headers.get("content-disposition") || "",
      /^attachment;/,
    );

    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes], [...sourceBytes]);
  }

  // Preview
  {
    const response = await handleDocumentApi(
      new Request("https://app.example/api/documents/doc-active/preview"),
      env,
      { waitUntil() {} },
    );

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-disposition") || "",
      /^inline;/,
    );
  }

  raw.close();
});

test("download fails closed when the source object is missing", async () => {
  const { raw, env } = fixture();

  env.FILES.get = async () => null;

  const response = await handleDocumentApi(
    new Request("https://app.example/api/documents/doc-active/download"),
    env,
    { waitUntil() {} },
  );

  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error.code, "STORAGE_OBJECT_MISSING");

  raw.close();
});

// Targeted Document Classification Authority Fix, item 2/7: PATCH
// /api/documents/:id used to also accept documentType and write it (plus
// classification_source='Manual Override') straight onto documents,
// entirely bypassing document_classifications -- a second, ungoverned
// classification-authority path. No real frontend caller ever sent
// documentType here; it's now ignored outright. This test proves a
// documentType field in the request body changes nothing about the
// document's classification state, even though the rest of the metadata
// update still applies.
test("metadata update persists governed document metadata but ignores documentType -- classification stays untouched", async () => {
  const { raw, env } = fixture();

  const before = raw
    .prepare("SELECT document_type, classification_source FROM documents WHERE id='doc-active'")
    .get();

  const response = await handleDocumentApi(
    new Request("https://app.example/api/documents/doc-active", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-request-id": "metadata-update-test",
      },
      body: JSON.stringify({
        logicalName: "Approved Drawing A",
        notes: "Reviewed against tender addendum.",
        tags: ["Tender", "Approved"],
        documentType: "Technical Specification",
        reason: "Corrected document classification after review",
      }),
    }),
    env,
    { waitUntil() {} },
  );

  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));

  const document = raw
    .prepare(`
      SELECT
        logical_name,
        notes,
        tags,
        document_type,
        classification_source
      FROM documents
      WHERE id='doc-active'
    `)
    .get();

  assert.equal(document.logical_name, "Approved Drawing A");
  assert.equal(document.notes, "Reviewed against tender addendum.");
  assert.deepEqual(JSON.parse(document.tags), ["Tender", "Approved"]);
  // The documentType in the request body must have no effect -- classification
  // stays exactly what it was before this metadata-only request.
  assert.equal(document.document_type, before.document_type);
  assert.equal(document.classification_source, before.classification_source);
  assert.notEqual(document.document_type, "Technical Specification");

  const audit = raw
    .prepare(`
      SELECT action,reason,request_id,old_value,new_value
      FROM document_audit_events
      WHERE document_id='doc-active'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get();

  assert.equal(audit.action, "Rename");
  assert.equal(
    audit.reason,
    "Corrected document classification after review",
  );
  assert.equal(audit.request_id, "metadata-update-test");

  const oldValue = JSON.parse(audit.old_value);
  const newValue = JSON.parse(audit.new_value);

  assert.equal(oldValue.logicalName, "Active.pdf");
  assert.equal(newValue.logicalName, "Approved Drawing A");
  // The audit payload no longer carries a documentType field at all -- this
  // endpoint has nothing to do with classification any more.
  assert.equal("documentType" in oldValue, false);
  assert.equal("documentType" in newValue, false);

  raw.close();
});

test("metadata validation rejects invalid controlled values", async () => {
  const { raw, env } = fixture();

  const response = await handleDocumentApi(
    new Request("https://app.example/api/documents/doc-active", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logicalName: "",
        tags: "not-an-array",
        documentType: "Invented Type",
      }),
    }),
    env,
    { waitUntil() {} },
  );

  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "INVALID_METADATA");

  raw.close();
});

test("deleted documents cannot be downloaded or edited as current evidence", async () => {
  const { raw, env } = fixture();

  raw.exec(`
    UPDATE documents
    SET deleted_at='2026-08-30T10:00:00.000Z'
    WHERE id='doc-active';
  `);

  {
    const response = await handleDocumentApi(
      new Request("https://app.example/api/documents/doc-active/download"),
      env,
      { waitUntil() {} },
    );

    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "DOCUMENT_NOT_FOUND");
  }

  {
    const response = await handleDocumentApi(
      new Request("https://app.example/api/documents/doc-active", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logicalName: "Should not update",
        }),
      }),
      env,
      { waitUntil() {} },
    );

    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "DOCUMENT_NOT_FOUND");
  }

  raw.close();
});
