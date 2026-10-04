// DOC-R3A.1 runtime contract: a document upload must leave behind a complete,
// self-explaining revision authority.
//
// The prior runtime defects were all of the shape "the handler computed the right
// value and then did not persist it, or persisted it outside the atomic unit":
//   * a family id was assigned on every path and written on none, so no document
//     was ever grouped and the R4 reconciliation question was unanswerable;
//   * `addendum` was rejected by the controlled vocabulary before the branch that
//     implements it could run, so governed addenda were unreachable;
//   * the supersession row was written after `env.DB.batch` had already
//     committed, so a failure left a governing revision with no history;
//   * version restore copied a possibly-closed effective window onto the new
//     current version, so a restore could immediately produce a document that
//     was current but not in force.
//
// This suite runs against the real `drizzle-active` schema (see
// `helpers/document-fixture.mjs`), so the database constraints and the handler
// have to agree.
import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentFixture, postJson, postUpload } from "./helpers/document-fixture.mjs";

const uploadFirstVersion = async (fixture, overrides = {}) => {
  const result = await postUpload(fixture.env, fixture.projectId, overrides, {
    contents: "item,description,qty\n1,Detector,10\n",
    ...overrides.file,
  });
  assert.equal(result.response.status, 201, `first upload must succeed: ${JSON.stringify(result.body)}`);
  return result.body.document;
};

const supersessionsFor = (fixture, documentId) => fixture.raw.prepare(`
  SELECT s.superseding_version_id, s.superseded_version_id, s.scope_type, s.scope_id, s.supersession_type, s.created_by
  FROM document_supersessions s
  JOIN document_versions v ON v.id = s.superseding_version_id
  WHERE v.document_id = ?
  ORDER BY s.created_at, s.rowid
`).all(documentId).map((row) => ({ ...row }));

test("DOC-R3A.1 a first upload creates exactly one family and links the document to it", async () => {
  const fixture = createDocumentFixture();
  try {
    const document = await uploadFirstVersion(fixture);

    const families = fixture.raw.prepare(`
      SELECT id, project_id, base_document_id, name
      FROM document_families
      WHERE base_document_id = ?
    `).all(document.id).map((row) => ({ ...row }));

    assert.equal(families.length, 1, "a document must be anchored on exactly one revision family");
    assert.equal(families[0].project_id, fixture.projectId, "the family must belong to the document's own project");
    assert.equal(families[0].name, "Tender-BOQ.csv");

    const stored = fixture.raw.prepare("SELECT document_family_id FROM documents WHERE id=?").get(document.id);
    assert.equal(stored.document_family_id, families[0].id, "the family link must actually be persisted, not merely computed");
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 a new revision records why it replaced the previous version, atomically", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);

    const revision = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "new_version",
      targetDocumentId: first.id,
      revision: "B",
      issuePurpose: "Revision",
      reason: "Register issued revision B",
    }, { contents: "item,description,qty\n1,Detector,12\n" });

    assert.equal(revision.response.status, 201, JSON.stringify(revision.body));
    const second = revision.body.document;

    assert.equal(second.version_number, 2);
    assert.deepEqual(supersessionsFor(fixture, first.id), [{
      superseding_version_id: second.version_id,
      superseded_version_id: first.version_id,
      scope_type: "FULL_DOCUMENT",
      scope_id: null,
      supersession_type: "REVISION",
      created_by: fixture.ownerUserId,
    }], "a new version must supersede the whole previous issue and say so in history");

    const audit = fixture.raw.prepare(`
      SELECT action, reason, old_value, new_value
      FROM document_audit_events
      WHERE document_id = ? AND reason = 'Register issued revision B'
    `).get(first.id);
    assert.equal(audit.action, "Create New Version");
    assert.match(audit.old_value, /supersededVersionId/, "audit must name the version that was replaced");
    assert.equal(JSON.parse(audit.new_value).documentFamilyId, fixture.raw.prepare("SELECT document_family_id FROM documents WHERE id=?").get(first.id).document_family_id);
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 a governed addendum is reachable and records the scope it amends", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);

    const addendum = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "addendum",
      targetDocumentId: first.id,
      revision: "B",
      issuePurpose: "Addendum",
      supersessionScopeType: "BOQ_ROW",
      supersessionScopeId: "boq-item-1",
      supersessionType: "ADDENDUM",
      reason: "Amend the smoke detector quantity",
    }, { contents: "item,description,qty\n1,Detector,25\n" });

    assert.equal(addendum.response.status, 201, JSON.stringify(addendum.body));
    const added = addendum.body.document;

    assert.equal(added.version_number, 2);
    assert.deepEqual(supersessionsFor(fixture, first.id), [{
      superseding_version_id: added.version_id,
      superseded_version_id: first.version_id,
      scope_type: "BOQ_ROW",
      scope_id: "boq-item-1",
      supersession_type: "ADDENDUM",
      created_by: fixture.ownerUserId,
    }], "an addendum must amend only the scope it names, and must never claim the whole document");

    const familiesForAddendum = fixture.raw.prepare("SELECT id FROM document_families WHERE base_document_id=?").all(first.id);
    assert.equal(familiesForAddendum.length, 1, "an addendum must join the existing family, not start a new one");
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 an addendum that does not name what it supersedes is refused before anything is written", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);

    const missingScope = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "addendum",
      targetDocumentId: first.id,
      supersessionScopeType: "SECTION",
      reason: "Amend a section without naming it",
    }, { contents: "item,description,qty\n1,Detector,99\n" });

    assert.equal(missingScope.response.status, 422, JSON.stringify(missingScope.body));
    assert.equal(missingScope.body.error.code, "SUPERSESSION_SCOPE_REQUIRED");
    assert.match(missingScope.body.error.suggestedAction, /section/i, "the error must tell the operator what is missing");

    const overScoped = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "addendum",
      targetDocumentId: first.id,
      supersessionScopeType: "FULL_DOCUMENT",
      supersessionScopeId: "boq-item-1",
      reason: "Contradictory full-document scope with an id",
    }, { contents: "item,description,qty\n1,Detector,98\n" });

    assert.equal(overScoped.response.status, 422, JSON.stringify(overScoped.body));
    assert.equal(overScoped.body.error.code, "INVALID_SUPERSESSION_SCOPE");

    assert.equal(supersessionsFor(fixture, first.id).length, 0, "a refused addendum must leave no supersession history");
    assert.equal(
      fixture.raw.prepare("SELECT COUNT(*) AS count FROM document_versions WHERE document_id=?").get(first.id).count,
      1,
      "a refused addendum must not create a version",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 an unsupported supersession vocabulary is refused with the allowed values", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);

    const badScope = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "addendum",
      targetDocumentId: first.id,
      supersessionScopeType: "EVERYTHING",
      supersessionScopeId: "x",
      reason: "Invent a scope that does not exist",
    }, { contents: "item,description,qty\n1,Detector,97\n" });
    assert.equal(badScope.response.status, 422);
    assert.equal(badScope.body.error.code, "INVALID_SUPERSESSION_SCOPE");
    assert.match(badScope.body.error.message, /FULL_DOCUMENT/, "the message must name the controlled vocabulary");

    const badType = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "addendum",
      targetDocumentId: first.id,
      supersessionScopeType: "FULL_DOCUMENT",
      supersessionType: "REPLACED_EVERYTHING",
      reason: "Invent a supersession type that does not exist",
    }, { contents: "item,description,qty\n1,Detector,96\n" });
    assert.equal(badType.response.status, 422);
    assert.equal(badType.body.error.code, "INVALID_SUPERSESSION_TYPE");
    assert.match(badType.body.error.message, /ADDENDUM/);
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 a document uploaded before families existed is still grouped when it is revised", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);
    // Simulate pre-R3A.1 data: the family row and the link both disappear, which
    // is the exact state a database migrated from the older chain is in if the
    // backfill was skipped or a document was written by another writer.
    fixture.raw.prepare("UPDATE documents SET document_family_id=NULL WHERE id=?").run(first.id);
    fixture.raw.prepare("DELETE FROM document_families WHERE base_document_id=?").run(first.id);

    const revision = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "new_version",
      targetDocumentId: first.id,
      revision: "B",
      reason: "Revise a document that predates the family link",
    }, { contents: "item,description,qty\n1,Detector,11\n" });
    assert.equal(revision.response.status, 201, JSON.stringify(revision.body));

    const families = fixture.raw.prepare("SELECT id, project_id, base_document_id FROM document_families WHERE base_document_id=?").all(first.id);
    assert.equal(families.length, 1, "the revision must deterministically re-anchor a family rather than leave the document ungrouped");
    assert.equal(fixture.raw.prepare("SELECT document_family_id FROM documents WHERE id=?").get(first.id).document_family_id, families[0].id);
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 restoring a version re-opens the effective window instead of copying a closed one", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture, { effectiveFrom: "2024-01-01", effectiveTo: "2024-06-30" });
    const revision = await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "new_version",
      targetDocumentId: first.id,
      effectiveFrom: "2024-07-01",
      reason: "Issue the second period revision",
    }, { contents: "item,description,qty\n1,Detector,12\n" });
    assert.equal(revision.response.status, 201, JSON.stringify(revision.body));
    const second = revision.body.document;

    const restored = await postJson(
      fixture.env,
      `/api/documents/${first.id}/versions/${first.version_id}/restore`,
      { reason: "The second period revision was withdrawn" },
    );
    assert.equal(restored.response.status, 200, JSON.stringify(restored.body));

    const restoredVersion = fixture.raw.prepare("SELECT * FROM document_versions WHERE id=?").get(restored.body.document.version_id);
    assert.equal(restoredVersion.version_number, 3, "a restore is a new version, never a rewind of the pointer");
    assert.equal(restoredVersion.restored_from_version_id, first.version_id);
    assert.equal(restoredVersion.supersedes_version_id, second.version_id);
    assert.notEqual(restoredVersion.effective_from, "2024-01-01", "a restored version must not inherit the withdrawn revision's original start date");
    assert.notEqual(restoredVersion.effective_to, "2024-06-30", "a restored version must not inherit a closed window and be current but not in force");

    // The withdrawn rows keep their own history untouched.
    const source = fixture.raw.prepare("SELECT effective_from, effective_to FROM document_versions WHERE id=?").get(first.version_id);
    assert.equal(source.effective_from, "2024-01-01");
    assert.equal(source.effective_to, "2024-06-30");

    assert.deepEqual(supersessionsFor(fixture, first.id).at(-1), {
      superseding_version_id: restoredVersion.id,
      superseded_version_id: second.version_id,
      scope_type: "FULL_DOCUMENT",
      scope_id: null,
      supersession_type: "REVISION",
      created_by: fixture.ownerUserId,
    }, "a restore must say in history which version it displaced");
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 document history explains the revision chain instead of only listing versions", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);
    await postUpload(fixture.env, fixture.projectId, {
      duplicateAction: "addendum",
      targetDocumentId: first.id,
      supersessionScopeType: "FULL_DOCUMENT",
      reason: "Add a full-document addendum",
    }, { contents: "item,description,qty\n1,Detector,13\n" });

    const history = await postJson(fixture.env, `/api/documents/${first.id}/history`, null, "GET");
    assert.equal(history.response.status, 200, JSON.stringify(history.body));

    const links = history.body.supersessions ?? [];
    assert.equal(links.length, 1, "history must include the supersession link, not just the version rows");
    assert.equal(links[0].scope_type, "FULL_DOCUMENT");
    assert.equal(links[0].supersession_type, "ADDENDUM");
    assert.ok(links[0].superseded_version_id);
    assert.ok(links[0].superseding_version_id);
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 restoring a version re-derives downstream state instead of stranding a queued run", async () => {
  // Restore creates a `document_processing_runs` row in 'Queued' and writes
  // history claiming the version is "queued for downstream reprocessing", but it
  // never scheduled that work. The run stayed Queued forever and, worse, the
  // document's current `document_classifications` row kept pointing at the
  // withdrawn version -- so the governing version carried a classification
  // derived from content that was no longer in force.
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);
    const classifiedAfterUpload = fixture.raw.prepare("SELECT document_version_id FROM document_classifications WHERE document_id=? AND superseded_at IS NULL").get(first.id);
    assert.equal(classifiedAfterUpload.document_version_id, first.version_id, "the upload classification describes the version that was current");

    const restored = await postJson(
      fixture.env,
      `/api/documents/${first.id}/versions/${first.version_id}/restore`,
      { reason: "The later revision was withdrawn in error" },
    );
    assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
    const restoredVersionId = restored.body.document.version_id;

    const runs = fixture.raw.prepare("SELECT status, completed_at FROM document_processing_runs WHERE document_version_id=?").all(restoredVersionId);
    assert.equal(runs.length, 1, "a restore creates exactly one processing run for the new version");
    assert.notEqual(runs[0].status, "Queued", `the restored version's processing run must be driven, not left queued (status=${runs[0].status})`);

    const currentClassification = fixture.raw.prepare("SELECT document_version_id FROM document_classifications WHERE document_id=? AND superseded_at IS NULL").get(first.id);
    assert.equal(
      currentClassification.document_version_id,
      restoredVersionId,
      "the current classification must describe the restored governing version, not the withdrawn one",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3A.1 a supersession that cannot be written rolls the whole upload back", async () => {
  const fixture = createDocumentFixture();
  try {
    const first = await uploadFirstVersion(fixture);
    const objectsBefore = fixture.objects.size;

    // Force the in-batch supersession insert to fail by making the target column
    // unusable for a specific well-formed input. The handler must not leave a
    // committed current version behind.
    const before = fixture.raw.prepare("SELECT COUNT(*) AS count FROM document_versions").get().count;
    const original = fixture.raw.prepare;
    fixture.raw.prepare = function patchedPrepare(sql) {
      if (typeof sql === "string" && sql.includes("INSERT INTO document_supersessions")) {
        return {
          ...original.call(this, sql),
          run: async () => { throw new Error("simulated supersession write failure"); },
        };
      }
      return original.call(this, sql);
    };

    let failed = null;
    try {
      await postUpload(fixture.env, fixture.projectId, {
        duplicateAction: "new_version",
        targetDocumentId: first.id,
        reason: "Register a revision whose history cannot be written",
      }, { contents: "item,description,qty\n1,Detector,14\n" });
    } catch (error) {
      failed = error;
    } finally {
      fixture.raw.prepare = original;
    }

    assert.ok(failed, "a failing supersession write must surface as an error, not a silent success");
    assert.match(String(failed.message), /simulated supersession write failure/);

    assert.equal(
      fixture.raw.prepare("SELECT COUNT(*) AS count FROM document_versions").get().count,
      before,
      "no version may survive a failed supersession write",
    );
    assert.equal(
      fixture.raw.prepare("SELECT current_version_id FROM documents WHERE id=?").get(first.id).current_version_id,
      first.version_id,
      "the previous version must remain current",
    );
    assert.equal(fixture.objects.size, objectsBefore, "the stored object must be removed when the batch fails");
  } finally {
    fixture.close();
  }
});
