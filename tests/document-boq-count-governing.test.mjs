/**
 * CURRENT-BOQ-AUTHORITY consolidation -- Documents display truth.
 *
 * The document list's "current BOQ" badge/counts must describe the SAME
 * evidence population downstream workers consider current
 * (`currentBoqEvidenceFrom`), not the head pointer's population. Each case
 * seeds versions whose head population and governing population DIFFER IN
 * SIZE, so the count alone proves which authority the display follows, and
 * cross-checks the displayed count against the canonical selector.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentFixture, insertRow, postJson } from "./helpers/document-fixture.mjs";
import { currentBoqEvidenceFrom } from "../worker/current-evidence-scope.mjs";

const OWNER = "user-docdisplay";
const ORG = "org-docdisplay";
const PROJECT = "p-docdisplay";
const newFixture = () => createDocumentFixture({ ownerUserId: OWNER, organizationId: ORG, projectId: PROJECT });
const dayFromNow = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

let sequence = 0;
const seedDoc = (fixture, documentId, { headVersionId }) => {
  insertRow(fixture.raw, "documents", {
    id: documentId, project_id: PROJECT, logical_name: `${documentId}.pdf`,
    current_version_id: headVersionId, created_by: OWNER,
  });
};

const seedVersion = (fixture, documentId, { versionId, versionNumber, effectiveFrom = null, effectiveTo = null }) => {
  insertRow(fixture.raw, "document_versions", {
    id: versionId, document_id: documentId, version_number: versionNumber,
    original_filename: `${documentId}.pdf`, stored_filename: `${versionId}.pdf`,
    extension: "pdf", mime_type: "application/pdf", byte_size: 128,
    sha256: `sha-${versionId}`, object_key: `${PROJECT}/${versionId}.pdf`,
    uploaded_by: OWNER, effective_from: effectiveFrom, effective_to: effectiveTo,
  });
};

const seedExtractionWithItems = (fixture, documentId, versionId, { extractionId, versionNumber, status = "Completed", itemCount, supersededAt = null }) => {
  insertRow(fixture.raw, "boq_extraction_versions", {
    id: extractionId, document_id: documentId, document_version_id: versionId,
    version_number: versionNumber, status, superseded_at: supersededAt,
    parser_version: "p", ruleset_version: "r", ocr_version: "o", created_by: OWNER,
  });
  for (let index = 0; index < itemCount; index += 1) {
    sequence += 1;
    insertRow(fixture.raw, "boq_items", {
      id: `${extractionId}-item-${index}`, extraction_version_id: extractionId,
      project_id: PROJECT, source_document_id: documentId, sequence,
      item_number: `${extractionId}-${index}`, section_path: "Root", row_type: "Item",
    });
  }
};

const seedSupersession = (fixture, documentId, index, { supersedingVersionId, supersededVersionId }) => {
  insertRow(fixture.raw, "document_supersessions", {
    id: `sup-${documentId}-${index}`, superseding_version_id: supersedingVersionId,
    superseded_version_id: supersededVersionId, scope_type: "FULL_DOCUMENT",
    scope_id: null, supersession_type: "REVISION",
    effective_from: null, effective_to: null, created_by: OWNER,
  });
};

const displayedCount = async (fixture, documentId) => {
  const { response, body } = await postJson(fixture.env, `/api/projects/${PROJECT}/documents`, null, "GET");
  assert.equal(response.status, 200);
  const row = (body.documents || []).find((entry) => entry.id === documentId);
  assert.ok(row, `document ${documentId} must be listed`);
  return row.boq_item_count;
};

const canonicalCount = async (fixture, documentId) => {
  const rows = await fixture.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${currentBoqEvidenceFrom("b")} WHERE b.source_document_id=?`,
  ).bind(documentId).all();
  return Number((rows.results || [])[0]?.count || 0);
};

const expectAgreement = async (fixture, documentId, expected) => {
  assert.equal(await displayedCount(fixture, documentId), expected, "display must show the governing population");
  assert.equal(await canonicalCount(fixture, documentId), expected, "canonical selector must agree with the display");
};

test("head on a future version: display shows the governing baseline", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-future", { headVersionId: "fu-v2" });
    seedVersion(fixture, "doc-future", { versionId: "fu-v1", versionNumber: 1 });
    seedVersion(fixture, "doc-future", { versionId: "fu-v2", versionNumber: 2, effectiveFrom: dayFromNow(30) });
    seedExtractionWithItems(fixture, "doc-future", "fu-v1", { extractionId: "ex-fu-v1", versionNumber: 1, itemCount: 2 });
    seedExtractionWithItems(fixture, "doc-future", "fu-v2", { extractionId: "ex-fu-v2", versionNumber: 2, itemCount: 1 });
    await expectAgreement(fixture, "doc-future", 2);
  } finally {
    fixture.close();
  }
});

test("failed head extraction: display shows the governing baseline", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-failed", { headVersionId: "fa-v1" });
    seedVersion(fixture, "doc-failed", { versionId: "fa-v1", versionNumber: 1 });
    seedExtractionWithItems(fixture, "doc-failed", "fa-v1", { extractionId: "ex-fa-ok", versionNumber: 1, itemCount: 2 });
    seedExtractionWithItems(fixture, "doc-failed", "fa-v1", { extractionId: "ex-fa-bad", versionNumber: 2, status: "Failed", itemCount: 5 });
    await expectAgreement(fixture, "doc-failed", 2);
  } finally {
    fixture.close();
  }
});

test("retired baseline: display shows the successor", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-retired", { headVersionId: "rt-v2" });
    seedVersion(fixture, "doc-retired", { versionId: "rt-v1", versionNumber: 1 });
    seedVersion(fixture, "doc-retired", { versionId: "rt-v2", versionNumber: 2 });
    seedExtractionWithItems(fixture, "doc-retired", "rt-v1", { extractionId: "ex-rt-v1", versionNumber: 1, itemCount: 2 });
    seedExtractionWithItems(fixture, "doc-retired", "rt-v2", { extractionId: "ex-rt-v2", versionNumber: 2, itemCount: 3 });
    seedSupersession(fixture, "doc-retired", 0, { supersedingVersionId: "rt-v2", supersededVersionId: "rt-v1" });
    await expectAgreement(fixture, "doc-retired", 3);
  } finally {
    fixture.close();
  }
});

test("governing-version conflict: display fails closed at zero", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-conflict", { headVersionId: "cx-v2" });
    seedVersion(fixture, "doc-conflict", { versionId: "cx-v1", versionNumber: 1 });
    seedVersion(fixture, "doc-conflict", { versionId: "cx-v2", versionNumber: 2 });
    seedExtractionWithItems(fixture, "doc-conflict", "cx-v1", { extractionId: "ex-cx-v1", versionNumber: 1, itemCount: 1 });
    seedExtractionWithItems(fixture, "doc-conflict", "cx-v2", { extractionId: "ex-cx-v2", versionNumber: 2, itemCount: 1 });
    await expectAgreement(fixture, "doc-conflict", 0);
  } finally {
    fixture.close();
  }
});
