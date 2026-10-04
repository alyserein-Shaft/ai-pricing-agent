import assert from "node:assert/strict";
import test from "node:test";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleDocumentApi } from "../worker/document-api.mjs";

// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to hand-roll a ~45-table CREATE TABLE approximation of the
// schema. The intake path under test (worker/document-api.mjs) writes well past
// that list -- and, as DOC-R3 revision authority landed, the approximation was
// missing real constraints the real chain enforces (for example
// `UNIQUE(document_id, version_number)` and the date-shape CHECKs on
// `document_versions.effective_from/effective_to`). A hand-written list is how
// that drift happens, and it happens again on the next migration.
//
// The fixture below is therefore built by `activeChainDatabase()` -- the ACTUAL
// ordered drizzle-active chain read from the migration journal -- and wrapped in
// the shared D1-shaped `d1()` adapter. See tests/fixtures/active-chain-fixture.mjs.
// FK enforcement stays ON because the real chain leaves it on
// (drizzle-active/0002_governing_source_fk.sql), so `organizations` is seeded as
// the real FK parent of `projects`. :memory: only; no live data.

const fixture = () => {
  const raw = activeChainDatabase();

  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org-a','Organization A');

    INSERT INTO projects
      (id,name,owner_user_id,organization_id)
    VALUES
      ('p1','Duplicate Test','user-a','org-a');
  `);

  const objects = new Map();

  const FILES = {
    async put(key, bytes) {
      objects.set(key, new Uint8Array(bytes));
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        body: bytes,
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };

  return {
    raw,
    objects,
    env: {
      DB: d1(raw),
      FILES,
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "user-a",
      APP_ORGANIZATION_ID: "org-a",
    },
  };
};

const upload = async (
  env,
  {
    contents,
    fileName = "Tender-BOQ.csv",
    duplicateAction = "",
    targetDocumentId = "",
    revision = "",
    issueDate = "",
    issuePurpose = "",
    transmittal = "",
    reason = "Document intake integration test",
  },
) => {
  const form = new FormData();
  form.set(
    "file",
    new File([contents], fileName, {
      type: "text/csv",
    }),
  );
  form.set("projectName", "Duplicate Test");
  form.set("documentType", "Auto Detection");

  if (duplicateAction) form.set("duplicateAction", duplicateAction);
  if (targetDocumentId) form.set("targetDocumentId", targetDocumentId);
  if (revision) form.set("revision", revision);
  if (issueDate) form.set("issueDate", issueDate);
  if (issuePurpose) form.set("issuePurpose", issuePurpose);
  if (transmittal) form.set("transmittal", transmittal);
  form.set("reason", reason);

  const detached = [];

  const response = await handleDocumentApi(
    new Request("https://app.example/api/projects/p1/documents", {
      method: "POST",
      body: form,
    }),
    env,
    {
      waitUntil(promise) {
        // Classification is a separate concern in this test. Suppress detached
        // rejection while preserving the real upload/versioning API path.
        detached.push(Promise.resolve(promise).catch(() => undefined));
      },
    },
  );

  return {
    response,
    body: await response.json(),
    detached,
  };
};

test("document intake duplicate and revision contract is authoritative end to end", async () => {
  const { raw, env } = fixture();

  // ----------------------------------------------------------
  // v1: ordinary persisted upload
  // ----------------------------------------------------------
  const first = await upload(env, {
    contents: "item,description,qty\n1,Smoke detector,10\n",
    revision: "A",
    issueDate: "2026-08-01",
    issuePurpose: "Tender",
    transmittal: "TR-001",
  });

  assert.equal(first.response.status, 201, JSON.stringify(first.body));

  const documentId = first.body.document.id;
  const firstVersionId = first.body.document.version_id;
  const firstSha = first.body.document.sha256;

  assert.ok(documentId);
  assert.ok(firstVersionId);
  assert.ok(firstSha);

  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM document_versions WHERE document_id=?",
    ).get(documentId).count,
    1,
  );

  // ----------------------------------------------------------
  // Exact same bytes: checksum must be the authoritative basis.
  // No second version may be created.
  // ----------------------------------------------------------
  const exact = await upload(env, {
    contents: "item,description,qty\n1,Smoke detector,10\n",
    revision: "A",
  });

  assert.equal(exact.response.status, 409, JSON.stringify(exact.body));
  assert.equal(exact.body.duplicate, true);
  assert.equal(exact.body.existing.document_id, documentId);
  assert.equal(exact.body.existing.version_id, firstVersionId);
  assert.equal(exact.body.existing.sha256, firstSha);
  assert.equal(exact.body.existing.duplicate_basis, "Checksum");

  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM document_versions WHERE document_id=?",
    ).get(documentId).count,
    1,
    "exact duplicate must not create another version",
  );

  // ----------------------------------------------------------
  // Same filename, different bytes: must still identify the
  // existing authoritative document/version, but never claim
  // checksum equality.
  // ----------------------------------------------------------
  const changed = await upload(env, {
    contents: "item,description,qty\n1,Smoke detector,12\n",
    revision: "B",
  });

  assert.equal(changed.response.status, 409, JSON.stringify(changed.body));
  assert.equal(changed.body.duplicate, true);
  assert.equal(changed.body.existing.document_id, documentId);
  assert.equal(changed.body.existing.version_id, firstVersionId);
  assert.notEqual(changed.body.existing.sha256, undefined);
  assert.notEqual(changed.body.existing.duplicate_basis, "Checksum");
  assert.ok(
    ["Filename", "Filename and Size", "Revision"].includes(
      changed.body.existing.duplicate_basis,
    ),
    `unexpected duplicate basis: ${changed.body.existing.duplicate_basis}`,
  );

  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM document_versions WHERE document_id=?",
    ).get(documentId).count,
    1,
  );

  // ----------------------------------------------------------
  // Explicit governed new-version registration.
  // ----------------------------------------------------------
  const versioned = await upload(env, {
    contents: "item,description,qty\n1,Smoke detector,12\n",
    duplicateAction: "new_version",
    targetDocumentId: documentId,
    revision: "B",
    issueDate: "2026-08-15",
    issuePurpose: "Addendum",
    transmittal: "TR-002",
    reason: "Register issued revision B",
  });

  assert.equal(versioned.response.status, 201, JSON.stringify(versioned.body));
  assert.equal(versioned.body.document.id, documentId);
  assert.equal(versioned.body.document.version_number, 2);

  const versions = raw.prepare(`
    SELECT
      id,
      document_id,
      version_number,
      original_filename,
      sha256,
      revision,
      issue_date,
      issue_purpose,
      transmittal,
      supersedes_version_id
    FROM document_versions
    WHERE document_id=?
    ORDER BY version_number
  `).all(documentId);

  assert.equal(versions.length, 2);

  const v1 = versions[0];
  const v2 = versions[1];

  assert.equal(v1.id, firstVersionId);
  assert.equal(v1.version_number, 1);
  assert.equal(v1.revision, "A");
  assert.equal(v1.issue_date, "2026-08-01");
  assert.equal(v1.issue_purpose, "Tender");
  assert.equal(v1.transmittal, "TR-001");
  assert.equal(v1.supersedes_version_id, null);

  assert.notEqual(v2.id, v1.id);
  assert.equal(v2.document_id, documentId);
  assert.equal(v2.version_number, 2);
  assert.equal(v2.original_filename, "Tender-BOQ.csv");
  assert.notEqual(v2.sha256, v1.sha256);
  assert.equal(v2.revision, "B");
  assert.equal(v2.issue_date, "2026-08-15");
  assert.equal(v2.issue_purpose, "Addendum");
  assert.equal(v2.transmittal, "TR-002");
  assert.equal(v2.supersedes_version_id, v1.id);

  const current = raw.prepare(
    "SELECT current_version_id,logical_name FROM documents WHERE id=?",
  ).get(documentId);

  assert.equal(current.current_version_id, v2.id);
  assert.equal(current.logical_name, "Tender-BOQ.csv");

  const audit = raw.prepare(`
    SELECT action,reason,version_id
    FROM document_audit_events
    WHERE document_id=?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `).get(documentId);

  assert.equal(audit.action, "Create New Version");
  assert.equal(audit.reason, "Register issued revision B");
  assert.equal(audit.version_id, v2.id);

  raw.close();
});
