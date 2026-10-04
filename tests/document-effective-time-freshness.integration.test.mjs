/**
 * DOC-R3 — effective-time freshness for document evidence.
 *
 * DOC-R3A.1 gave `document_versions` a real effective window
 * (`effective_from`/`effective_to`) and recorded supersession as append-only rows.
 * But the single BOQ/specification "current evidence" boundary still answered
 * only "is this the document's head version?" (`documents.current_version_id`),
 * which DOC-R3 section 9 names as the defect:
 *
 *   1. No distinction between "latest uploaded" and "currently effective"
 *   2. Addendum with future effective date becomes "current" immediately
 *
 * So a future-dated addendum governed matching, pricing and review the moment it
 * was uploaded, before it was in force, and an expired version kept governing
 * after its window closed.
 *
 * These tests run against the REAL active migration chain, so a pass means the
 * shipped schema and the shipped query agree. They assert the fail-closed rule:
 * a version governs only while it is in force. They deliberately do NOT assert
 * fallback to a superseded baseline while a future-dated addendum is pending —
 * that is a separate, still-open governance decision (see REPORT), and picking
 * it here would silently invent policy.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";
import { diagnoseBoqEvidence, currentBoqEvidenceCounts } from "../worker/current-evidence-scope.mjs";

const dayFromNow = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * Seed one document with a single version, one completed BOQ extraction of that
 * version, and one current BOQ item. The document head points at the version, so
 * every assertion here is about effective time alone — nothing else varies.
 */
const seedVersionedDocument = (fixture, {
  documentId,
  versionId,
  effectiveFrom = null,
  effectiveTo = null,
  itemId = `${documentId}-item`,
} = {}) => {
  insertRow(fixture.raw, "documents", {
    id: documentId,
    project_id: fixture.projectId,
    logical_name: `${documentId}.pdf`,
    current_version_id: versionId,
    created_by: fixture.ownerUserId,
  });
  insertRow(fixture.raw, "document_versions", {
    id: versionId,
    document_id: documentId,
    version_number: 1,
    original_filename: `${documentId}.pdf`,
    stored_filename: `${versionId}.pdf`,
    extension: "pdf",
    mime_type: "application/pdf",
    byte_size: 128,
    sha256: `sha-${versionId}`,
    object_key: `${fixture.projectId}/${versionId}.pdf`,
    uploaded_by: fixture.ownerUserId,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
  });
  insertRow(fixture.raw, "boq_extraction_versions", {
    id: `ex-${versionId}`,
    document_id: documentId,
    document_version_id: versionId,
    version_number: 1,
    status: "Completed",
    parser_version: "test-parser",
    ruleset_version: "test-rules",
    ocr_version: "test-ocr",
    created_by: fixture.ownerUserId,
  });
  insertRow(fixture.raw, "boq_items", {
    id: itemId,
    extraction_version_id: `ex-${versionId}`,
    project_id: fixture.projectId,
    source_document_id: documentId,
    sequence: 1,
    item_number: "1",
    section_path: "Root",
    row_type: "Item",
  });
  return itemId;
};

const countCurrentItems = async (fixture) => (await currentBoqEvidenceCounts(fixture.env.DB, { projectId: fixture.projectId })).currentBoqItems;

test("DOC-R3 a version already in force is current evidence", async () => {
  const fixture = createDocumentFixture();
  try {
    seedVersionedDocument(fixture, { documentId: "doc-in-force", versionId: "ver-in-force", effectiveFrom: dayFromNow(-30) });
    assert.equal(await countCurrentItems(fixture), 1, "a version effective a month ago and never closed must govern");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a version with no declared effective time is current evidence", async () => {
  // The migration deliberately gives `effective_from` no default, because a
  // default would assert an effective time the uploader never declared. DOC-R3
  // section 9's resolution SQL treats an absent effective time as immediately
  // effective, and this test pins that so a future default cannot quietly change
  // which documents govern.
  const fixture = createDocumentFixture();
  try {
    seedVersionedDocument(fixture, { documentId: "doc-no-window", versionId: "ver-no-window" });
    assert.equal(await countCurrentItems(fixture), 1, "a version that declares no effective window governs immediately");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a version that is not yet in force is not current evidence", async () => {
  // The defect. A future-dated addendum is the document head the moment it is
  // uploaded, so every downstream consumer treated it as governing before its
  // effective date arrived.
  const fixture = createDocumentFixture();
  try {
    seedVersionedDocument(fixture, { documentId: "doc-future", versionId: "ver-future", effectiveFrom: dayFromNow(60) });
    assert.equal(await countCurrentItems(fixture), 0, "a version that is not yet in force must not supply current evidence");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a version whose effective window has closed is not current evidence", async () => {
  const fixture = createDocumentFixture();
  try {
    seedVersionedDocument(fixture, { documentId: "doc-expired", versionId: "ver-expired", effectiveFrom: dayFromNow(-90), effectiveTo: dayFromNow(-30) });
    assert.equal(await countCurrentItems(fixture), 0, "a version whose window closed must stop governing");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a full ISO-8601 effective instant is compared as an instant, not as text", async () => {
  // `effective_from` holds a bare `YYYY-MM-DD` for client-declared dates, but
  // restore re-issues content with a full ISO instant. A naive text comparison
  // against SQLite's `CURRENT_TIMESTAMP` is permanently wrong for the ISO form:
  // the `T` separator sorts after the space in `YYYY-MM-DD HH:MM:SS`, so an ISO
  // instant always looks like the future. This test restores the same instant
  // twice — once in the past, once in the future — so the assertion can only hold
  // if the comparison normalises the value.
  const fixture = createDocumentFixture();
  try {
    seedVersionedDocument(fixture, {
      documentId: "doc-iso-past",
      versionId: "ver-iso-past",
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(),
    });
    seedVersionedDocument(fixture, {
      documentId: "doc-iso-future",
      versionId: "ver-iso-future",
      effectiveFrom: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.equal(await countCurrentItems(fixture), 1, "only the ISO instant already in the past may govern");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an out-of-force version is reported as such rather than as a stale version", async () => {
  // `diagnoseBoqEvidence` is the operator-facing explanation for why a BOQ row is
  // not current. It already distinguishes "stale document version" (the head
  // moved on) from "superseded extraction"; an out-of-force version is a third,
  // different condition and must not be reported as either of those.
  const fixture = createDocumentFixture();
  const pending = seedVersionedDocument(fixture, { documentId: "doc-diagnose-pending", versionId: "ver-diagnose-pending", effectiveFrom: dayFromNow(30) });
  const expired = seedVersionedDocument(fixture, { documentId: "doc-diagnose-expired", versionId: "ver-diagnose-expired", effectiveFrom: dayFromNow(-90), effectiveTo: dayFromNow(-1) });
  try {
    const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: "org-a" });
    const byItem = new Map(rows.map((row) => [row.boqItemId, row.exclusionReason]));
    assert.equal(byItem.get(pending), "document version not yet in force");
    assert.equal(byItem.get(expired), "document version effective window closed");
  } finally {
    fixture.close();
  }
});
