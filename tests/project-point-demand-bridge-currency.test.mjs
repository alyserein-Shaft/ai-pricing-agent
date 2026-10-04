/**
 * CURRENT-BOQ-AUTHORITY consolidation -- point-demand bridge currency.
 *
 * `buildProjectPointDemandInventory` must select its population through the
 * canonical shared predicates (`currentBoqEvidenceFrom` /
 * `currentBoqItemPredicate`), so the demand inventory can never contain rows
 * the rest of the pipeline considers non-current. Unlike the SQL-shape test in
 * `project-point-demand-bridge.test.mjs`, these cases run the REAL query
 * against the REAL active chain and assert on the returned population.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectPointDemandInventory } from "../app/domain/project-point-demand-bridge.mjs";
import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";
import { currentBoqEvidenceFrom } from "../worker/current-evidence-scope.mjs";

const OWNER = "user-bridge";
const ORG = "org-bridge";
const PROJECT = "p-bridge";
const newFixture = () => createDocumentFixture({ ownerUserId: OWNER, organizationId: ORG, projectId: PROJECT });

const seedDoc = (fixture, documentId, { headVersionId = null } = {}) => {
  insertRow(fixture.raw, "documents", {
    id: documentId, project_id: PROJECT, logical_name: `${documentId}.pdf`,
    current_version_id: headVersionId, created_by: OWNER,
  });
};

const seedVersion = (fixture, documentId, { versionId, versionNumber, effectiveFrom = null, effectiveTo = null, versionRow = true }) => {
  if (versionRow) {
    insertRow(fixture.raw, "document_versions", {
      id: versionId, document_id: documentId, version_number: versionNumber,
      original_filename: `${documentId}.pdf`, stored_filename: `${versionId}.pdf`,
      extension: "pdf", mime_type: "application/pdf", byte_size: 128,
      sha256: `sha-${versionId}`, object_key: `${PROJECT}/${versionId}.pdf`,
      uploaded_by: OWNER, effective_from: effectiveFrom, effective_to: effectiveTo,
    });
  }
};

const seedExtraction = (fixture, documentId, versionId, { extractionId, versionNumber, status = "Completed", supersededAt = null }) => {
  insertRow(fixture.raw, "boq_extraction_versions", {
    id: extractionId, document_id: documentId, document_version_id: versionId,
    version_number: versionNumber, status, superseded_at: supersededAt,
    parser_version: "p", ruleset_version: "r", ocr_version: "o", created_by: OWNER,
  });
};

let seedSequence = 0;
const seedItem = (fixture, { itemId, extractionId, documentId, rowType = "Item", approved = 1 }) => {
  seedSequence += 1;
  insertRow(fixture.raw, "boq_items", {
    id: itemId, extraction_version_id: extractionId, project_id: PROJECT,
    source_document_id: documentId, sequence: seedSequence, item_number: itemId,
    section_path: "Root", row_type: rowType, approved_for_downstream: approved,
    review_status: approved ? "Approved" : "Needs Review",
  });
};

const inventoryIds = async (fixture) => {
  const { items } = await buildProjectPointDemandInventory({
    db: fixture.env.DB,
    projectId: PROJECT,
    loadCurrentProfile: async () => null,
    loadApprovedUnderstanding: async () => null,
    currentSelectedQuantity: async () => ({ value: 10, source: "BOQ", status: "VALID" }),
  });
  return items.map((entry) => entry.itemId).sort();
};

const canonicalIds = async (fixture) => {
  const rows = await fixture.env.DB.prepare(
    `SELECT b.id FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=? AND b.approved_for_downstream=1 ORDER BY b.id`,
  ).bind(PROJECT).all();
  return (rows.results || []).map((row) => row.id).sort();
};

test("bridge population equals the canonical current-approved population", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-ok", { headVersionId: "ok-v1" });
    seedVersion(fixture, "doc-ok", { versionId: "ok-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-ok", "ok-v1", { extractionId: "ex-ok", versionNumber: 1 });
    seedItem(fixture, { itemId: "item-ok", extractionId: "ex-ok", documentId: "doc-ok" });
    assert.deepEqual(await inventoryIds(fixture), ["item-ok"]);
    assert.deepEqual(await inventoryIds(fixture), await canonicalIds(fixture));
  } finally {
    fixture.close();
  }
});

test("superseded extraction rows never enter demand", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-sup", { headVersionId: "sup-v1" });
    seedVersion(fixture, "doc-sup", { versionId: "sup-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-sup", "sup-v1", { extractionId: "ex-sup-old", versionNumber: 1, supersededAt: "2026-01-02T00:00:00.000Z" });
    seedExtraction(fixture, "doc-sup", "sup-v1", { extractionId: "ex-sup-new", versionNumber: 2 });
    seedItem(fixture, { itemId: "item-sup-old", extractionId: "ex-sup-old", documentId: "doc-sup" });
    seedItem(fixture, { itemId: "item-sup-new", extractionId: "ex-sup-new", documentId: "doc-sup" });
    assert.deepEqual(await inventoryIds(fixture), ["item-sup-new"]);
  } finally {
    fixture.close();
  }
});

test("retired document-version rows never enter demand", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-ret", { headVersionId: "ret-v2" });
    seedVersion(fixture, "doc-ret", { versionId: "ret-v1", versionNumber: 1 });
    seedVersion(fixture, "doc-ret", { versionId: "ret-v2", versionNumber: 2 });
    seedExtraction(fixture, "doc-ret", "ret-v1", { extractionId: "ex-ret-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-ret", "ret-v2", { extractionId: "ex-ret-v2", versionNumber: 2 });
    seedItem(fixture, { itemId: "item-ret-v1", extractionId: "ex-ret-v1", documentId: "doc-ret" });
    seedItem(fixture, { itemId: "item-ret-v2", extractionId: "ex-ret-v2", documentId: "doc-ret" });
    insertRow(fixture.raw, "document_supersessions", {
      id: "sup-ret-0", superseding_version_id: "ret-v2", superseded_version_id: "ret-v1",
      scope_type: "FULL_DOCUMENT", scope_id: null, supersession_type: "REVISION",
      effective_from: null, effective_to: null, created_by: OWNER,
    });
    assert.deepEqual(await inventoryIds(fixture), ["item-ret-v2"]);
  } finally {
    fixture.close();
  }
});

test("failed rerun populations never enter demand", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-fail", { headVersionId: "fail-v1" });
    seedVersion(fixture, "doc-fail", { versionId: "fail-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-fail", "fail-v1", { extractionId: "ex-fail-ok", versionNumber: 1 });
    seedExtraction(fixture, "doc-fail", "fail-v1", { extractionId: "ex-fail-bad", versionNumber: 2, status: "Failed" });
    seedItem(fixture, { itemId: "item-fail-ok", extractionId: "ex-fail-ok", documentId: "doc-fail" });
    seedItem(fixture, { itemId: "item-fail-bad", extractionId: "ex-fail-bad", documentId: "doc-fail" });
    assert.deepEqual(await inventoryIds(fixture), ["item-fail-ok"]);
  } finally {
    fixture.close();
  }
});

test("structural rows never enter demand, even when approved", async () => {
  const fixture = newFixture();
  try {
    seedDoc(fixture, "doc-struct", { headVersionId: "st-v1" });
    seedVersion(fixture, "doc-struct", { versionId: "st-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-struct", "st-v1", { extractionId: "ex-st", versionNumber: 1 });
    seedItem(fixture, { itemId: "item-st-ok", extractionId: "ex-st", documentId: "doc-struct" });
    for (const [rowType, itemId] of [["Section", "row-section"], ["Subsection Header", "row-subsection"], ["Subtotal", "row-subtotal"], ["Note", "row-note"], ["Header", "row-header"]]) {
      seedItem(fixture, { itemId, extractionId: "ex-st", documentId: "doc-struct", rowType });
    }
    assert.deepEqual(await inventoryIds(fixture), ["item-st-ok"]);
  } finally {
    fixture.close();
  }
});

test("governing-version conflict yields no population for the conflicted document", async () => {
  const fixture = newFixture();
  try {
    // Two in-force versions with no precedence between them: genuinely
    // unordered, so the document supplies no evidence (fail closed).
    seedDoc(fixture, "doc-conflict", { headVersionId: "cf-v2" });
    seedVersion(fixture, "doc-conflict", { versionId: "cf-v1", versionNumber: 1 });
    seedVersion(fixture, "doc-conflict", { versionId: "cf-v2", versionNumber: 2 });
    seedExtraction(fixture, "doc-conflict", "cf-v1", { extractionId: "ex-cf-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-conflict", "cf-v2", { extractionId: "ex-cf-v2", versionNumber: 2 });
    seedItem(fixture, { itemId: "item-cf-v1", extractionId: "ex-cf-v1", documentId: "doc-conflict" });
    seedItem(fixture, { itemId: "item-cf-v2", extractionId: "ex-cf-v2", documentId: "doc-conflict" });
    seedDoc(fixture, "doc-clean", { headVersionId: "clean-v1" });
    seedVersion(fixture, "doc-clean", { versionId: "clean-v1", versionNumber: 1 });
    seedExtraction(fixture, "doc-clean", "clean-v1", { extractionId: "ex-clean", versionNumber: 1 });
    seedItem(fixture, { itemId: "item-clean", extractionId: "ex-clean", documentId: "doc-clean" });
    // The conflicted document contributes nothing; the clean one still does.
    // Nothing is guessed for the conflicted pair.
    assert.deepEqual(await inventoryIds(fixture), ["item-clean"]);
  } finally {
    fixture.close();
  }
});
