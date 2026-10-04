/**
 * CURRENT-BOQ-AUTHORITY consolidation -- DB trigger parity (migration 0018).
 *
 * The `estimator_understanding_review_current_evidence_guard` trigger must never
 * enforce a different definition of "current" from the DOC-R3 application
 * authority (`worker/current-evidence-scope.mjs`). It keeps only the checks a
 * SQLite trigger can truthfully enforce (live documents, Item rows, claimed
 * extraction identity, non-superseded Completed/Needs-Review extraction,
 * latest extraction per version, same-fingerprint supersession) and defers
 * version *currency* (in-force windows, transitive supersession, conflict) to
 * the application layer.
 *
 * Each version-governance case therefore asserts BOTH halves:
 *   1. what the trigger does (accept/reject the review insert), and
 *   2. what the canonical selector says (`currentBoqEvidenceFrom` /
 *      `diagnoseBoqEvidence`).
 * A trigger that rejects a canonical-current record, or whose verdict
 * contradicts the canonical diagnosis on version grounds, fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";
import { currentBoqEvidenceFrom, diagnoseBoqEvidence } from "../worker/current-evidence-scope.mjs";

const dayFromNow = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

// Explicit identity triple: the fixture creates the organization/project rows
// for exactly these ids (it returns ownerUserId but not organizationId).
const OWNER = "user-guard";
const ORG = "org-guard";
const PROJECT = "p-guard";

const newFixture = () => createDocumentFixture({ ownerUserId: OWNER, organizationId: ORG, projectId: PROJECT });

const seedVersion = (fixture, documentId, { versionId, versionNumber, head = false, effectiveFrom = null, effectiveTo = null, extractionStatus = "Completed", extractionVersion = null, supersededAt = null, versionRow = true, tag = "" }) => {
  if (head) {
    fixture.raw.prepare("UPDATE documents SET current_version_id=? WHERE id=?").run(versionId, documentId);
  }
  // versionRow:false seeds a second extraction (rerun/superseded) against the
  // SAME document version without violating the version uniqueness.
  if (versionRow) {
  insertRow(fixture.raw, "document_versions", {
    id: versionId,
    document_id: documentId,
    version_number: versionNumber,
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
  }
  const extractionId = `ex-${versionId}-${extractionVersion ?? versionNumber}${tag}`;
  insertRow(fixture.raw, "boq_extraction_versions", {
    id: extractionId,
    document_id: documentId,
    document_version_id: versionId,
    version_number: extractionVersion ?? versionNumber,
    status: extractionStatus,
    superseded_at: supersededAt,
    parser_version: "test-parser",
    ruleset_version: "test-rules",
    ocr_version: "test-ocr",
    created_by: fixture.ownerUserId,
  });
  const itemId = `${versionId}-item${tag}`;
  insertRow(fixture.raw, "boq_items", {
    id: itemId,
    extraction_version_id: extractionId,
    project_id: fixture.projectId,
    source_document_id: documentId,
    sequence: versionNumber,
    item_number: String(versionNumber),
    section_path: "Root",
    row_type: "Item",
  });
  insertRow(fixture.raw, "estimator_understanding_runs", {
    id: `run-${versionId}${tag}`,
    project_id: fixture.projectId,
    organization_id: ORG,
    provider: "test",
    model: "test",
    model_version: "1",
    prompt_version: "1",
    schema_version: "1",
    config_fingerprint: "cfg",
    status: "COMPLETED",
    requested_by: fixture.ownerUserId,
  });
  const fingerprint = `fp-${versionId}${tag}`;
  insertRow(fixture.raw, "estimator_item_interpretations", {
    id: `interp-${versionId}${tag}`,
    run_id: `run-${versionId}${tag}`,
    project_id: fixture.projectId,
    boq_item_id: itemId,
    version_number: 1,
    input_fingerprint: fingerprint,
    config_fingerprint: "cfg",
    provider: "test",
    model: "test",
    model_version: "1",
    prompt_version: "1",
    schema_version: "1",
    status: "COMPLETED",
    created_by: fixture.ownerUserId,
  });
  return { itemId, extractionId, fingerprint, extractionVersion: extractionVersion ?? versionNumber };
};

const seedDocument = (fixture, documentId, versions, { headVersionId = null } = {}) => {
  insertRow(fixture.raw, "documents", {
    id: documentId,
    project_id: fixture.projectId,
    logical_name: `${documentId}.pdf`,
    current_version_id: headVersionId,
    created_by: fixture.ownerUserId,
  });
  return versions.map((version, index) => seedVersion(fixture, documentId, { ...version, versionNumber: index + 1 }));
};

const seedSupersession = (fixture, documentId, index, { supersedingVersionId, supersededVersionId, effectiveFrom = null, effectiveTo = null }) => {
  insertRow(fixture.raw, "document_supersessions", {
    id: `supersession-${documentId}-${index}`,
    superseding_version_id: supersedingVersionId,
    superseded_version_id: supersededVersionId,
    scope_type: "FULL_DOCUMENT",
    scope_id: null,
    supersession_type: "REVISION",
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    created_by: fixture.ownerUserId,
  });
};

const tryReview = (fixture, { itemId, fingerprint, sourceVersionId, sourceExtractionVersion, reviewId, tag = "" }) => {
  try {
    fixture.raw.prepare(`INSERT INTO estimator_understanding_review_versions
      (id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,reviewed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      reviewId, fixture.projectId, itemId, `interp-${sourceVersionId}${tag}`, 1,
      "APPROVED", "{}", fingerprint, sourceVersionId, sourceExtractionVersion, fixture.ownerUserId,
    );
    return true;
  } catch (error) {
    assert.match(String(error?.message || error), /understanding review evidence is stale/, "rejections must come from the evidence guard, not a schema accident");
    return false;
  }
};

const canonicalItemIds = async (fixture, documentId) => {
  const rows = await fixture.env.DB.prepare(
    `SELECT b.id FROM ${currentBoqEvidenceFrom("b")} WHERE b.source_document_id=? ORDER BY b.id`,
  ).bind(documentId).all();
  return (rows.results || []).map((row) => row.id);
};

const diagnosisFor = async (fixture, itemId) => {
  const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: ORG });
  return (rows || []).find((row) => row.boqItemId === itemId)?.exclusionReason || null;
};

test("future head does not displace the governing baseline at the trigger", async () => {
  const fixture = newFixture();
  try {
    const [v1] = seedDocument(fixture, "doc-future-head", [
      { versionId: "fh-v1" },
      { versionId: "fh-v2", effectiveFrom: dayFromNow(30) },
    ], { headVersionId: "fh-v2" });
    // Trigger admits the baseline review (the DOC-R3 defect was a rejection here).
    assert.equal(
      tryReview(fixture, { itemId: v1.itemId, fingerprint: v1.fingerprint, sourceVersionId: "fh-v1", sourceExtractionVersion: v1.extractionVersion, reviewId: "rev-fh-1" }),
      true,
      "the trigger must admit a review of governing-baseline evidence",
    );
    // Canonical agrees: v1 governs, the future head supplies nothing.
    assert.deepEqual(await canonicalItemIds(fixture, "doc-future-head"), [v1.itemId]);
  } finally {
    fixture.close();
  }
});

test("retired baseline defers to the application layer: trigger admits, canonical excludes", async () => {
  const fixture = newFixture();
  try {
    const [v1, v2] = seedDocument(fixture, "doc-retired", [
      { versionId: "ret-v1" },
      { versionId: "ret-v2" },
    ], { headVersionId: "ret-v2" });
    seedSupersession(fixture, "doc-retired", 0, { supersedingVersionId: "ret-v2", supersededVersionId: "ret-v1" });
    // The trigger cannot judge version currency, so it admits; the application
    // authority is what excludes. A trigger rejection here would be a SECOND,
    // divergent definition of "current".
    assert.equal(
      tryReview(fixture, { itemId: v1.itemId, fingerprint: v1.fingerprint, sourceVersionId: "ret-v1", sourceExtractionVersion: v1.extractionVersion, reviewId: "rev-ret-1" }),
      true,
      "the trigger must not reject on version grounds it cannot govern",
    );
    assert.deepEqual(await canonicalItemIds(fixture, "doc-retired"), [v2.itemId]);
    assert.equal(await diagnosisFor(fixture, v1.itemId), "document version superseded");
  } finally {
    fixture.close();
  }
});

test("a review citing a FAILED rerun extraction is rejected by the trigger", async () => {
  const fixture = newFixture();
  try {
    insertRow(fixture.raw, "documents", {
      id: "doc-failed", project_id: fixture.projectId, logical_name: "doc-failed.pdf",
      current_version_id: "fail-v1", created_by: fixture.ownerUserId,
    });
    const good = seedVersion(fixture, "doc-failed", { versionId: "fail-v1", versionNumber: 1, extractionVersion: 1 });
    const bad = seedVersion(fixture, "doc-failed", { versionId: "fail-v1", versionNumber: 1, extractionVersion: 2, extractionStatus: "Failed", versionRow: false, tag: "-rerun" });
    assert.equal(
      tryReview(fixture, { itemId: good.itemId, fingerprint: good.fingerprint, sourceVersionId: "fail-v1", sourceExtractionVersion: good.extractionVersion, reviewId: "rev-fail-good" }),
      true,
      "the completed extraction remains reviewable",
    );
    assert.equal(
      tryReview(fixture, { itemId: bad.itemId, fingerprint: bad.fingerprint, sourceVersionId: "fail-v1", sourceExtractionVersion: bad.extractionVersion, reviewId: "rev-fail-bad", tag: "-rerun" }),
      false,
      "the trigger must reject a review citing a failed extraction",
    );
    assert.deepEqual(await canonicalItemIds(fixture, "doc-failed"), [good.itemId]);
  } finally {
    fixture.close();
  }
});

test("a review citing a superseded extraction is rejected by the trigger", async () => {
  const fixture = newFixture();
  try {
    insertRow(fixture.raw, "documents", {
      id: "doc-superseded-ex", project_id: fixture.projectId, logical_name: "doc-superseded-ex.pdf",
      current_version_id: "se-v1", created_by: fixture.ownerUserId,
    });
    const old = seedVersion(fixture, "doc-superseded-ex", { versionId: "se-v1", versionNumber: 1, extractionVersion: 1, supersededAt: "2026-01-02T00:00:00.000Z" });
    const current = seedVersion(fixture, "doc-superseded-ex", { versionId: "se-v1", versionNumber: 1, extractionVersion: 2, versionRow: false, tag: "-rerun" });
    assert.equal(
      tryReview(fixture, { itemId: old.itemId, fingerprint: old.fingerprint, sourceVersionId: "se-v1", sourceExtractionVersion: old.extractionVersion, reviewId: "rev-se-old" }),
      false,
      "the trigger must reject a review citing a superseded extraction",
    );
    assert.equal(
      tryReview(fixture, { itemId: current.itemId, fingerprint: current.fingerprint, sourceVersionId: "se-v1", sourceExtractionVersion: current.extractionVersion, reviewId: "rev-se-current", tag: "-rerun" }),
      true,
      "the current extraction remains reviewable",
    );
  } finally {
    fixture.close();
  }
});

test("expired version with no governing successor: trigger admits, canonical fails closed", async () => {
  const fixture = newFixture();
  try {
    const [v1] = seedDocument(fixture, "doc-expired", [
      { versionId: "exp-v1", effectiveTo: dayFromNow(-1) },
    ], { headVersionId: "exp-v1" });
    // Version expiry is application-layer currency the trigger cannot express,
    // so the trigger admits the well-formed insert...
    assert.equal(
      tryReview(fixture, { itemId: v1.itemId, fingerprint: v1.fingerprint, sourceVersionId: "exp-v1", sourceExtractionVersion: v1.extractionVersion, reviewId: "rev-exp-1" }),
      true,
      "the trigger must not invent expiry authority it does not hold",
    );
    // ...while the canonical selector supplies no evidence at all.
    assert.deepEqual(await canonicalItemIds(fixture, "doc-expired"), []);
    assert.equal(await diagnosisFor(fixture, v1.itemId), "document version effective window closed");
  } finally {
    fixture.close();
  }
});

test("transitive supersession retires through the chain at the canonical layer only", async () => {
  const fixture = newFixture();
  try {
    const [v1, , v3] = seedDocument(fixture, "doc-chain", [
      { versionId: "ch-v1" },
      { versionId: "ch-v2" },
      { versionId: "ch-v3" },
    ], { headVersionId: "ch-v3" });
    seedSupersession(fixture, "doc-chain", 0, { supersedingVersionId: "ch-v2", supersededVersionId: "ch-v1" });
    seedSupersession(fixture, "doc-chain", 1, { supersedingVersionId: "ch-v3", supersededVersionId: "ch-v2" });
    assert.equal(
      tryReview(fixture, { itemId: v1.itemId, fingerprint: v1.fingerprint, sourceVersionId: "ch-v1", sourceExtractionVersion: v1.extractionVersion, reviewId: "rev-ch-1" }),
      true,
      "transitive retirement is application authority, not trigger authority",
    );
    assert.deepEqual(await canonicalItemIds(fixture, "doc-chain"), [v3.itemId]);
  } finally {
    fixture.close();
  }
});
