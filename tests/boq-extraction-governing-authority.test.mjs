/**
 * DOC-R3 authority convergence — `worker/boq-extraction-api.mjs`.
 *
 * `documents.current_version_id` was read here as "the version whose extraction
 * is current". It is not: it is the head pointer, the latest recorded upload. A
 * future-dated addendum becomes the head the instant it is uploaded, so the old
 * query let an unactivated addendum displace an in-force baseline -- DOC-R3
 * section 9, through this module's `currentExtraction`.
 *
 * The convergence, pinned here through the production routes rather than an
 * internal helper:
 *
 *   * SERVING (summary/status/items/evidence) follows the GOVERNING version.
 *   * PROCESSING (start idempotency, extraction numbering, parsing the uploaded
 *     bytes, superseding a previous run) is about the HEAD version.
 *   * Numbering is document-scoped over every attempted extraction, because the
 *     unique index is.
 *   * A new extraction supersedes previous runs OF THE SAME VERSION only, so
 *     extracting a pending revision can never blank the baseline's evidence.
 *
 * All fixtures run the real active chain with real CSV bytes through
 * `executeBoqExtraction`, because a hand-seeded `boq_extraction_versions` row
 * cannot prove the write path and the read path agree.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { executeBoqExtraction, handleBoqExtractionApi } from "../worker/boq-extraction-api.mjs";
import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";

const request = (path, { method = "GET", body } = {}) =>
  new Request(`https://app.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = { waitUntil: () => undefined };
const csvBytes = (text) => new TextEncoder().encode(text).buffer;
const CLEAN_CSV = "Item,Description,Unit,Quantity\n1,Addressable smoke detector,Each,50";
const dayFromNow = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * One document whose head is `headVersionId`, with per-version CSV bytes,
 * a Manually Confirmed BOQ classification per version, and explicit
 * supersession edges whose own windows match the superseding version's.
 */
const seedGovernedDocument = (fixture, { documentId, versions, headVersionId, supersessions = [] }) => {
  insertRow(fixture.raw, "classification_model_versions", {
    id: "cmv-gov",
    classifier_version: "manual-1",
    ruleset_version: "rules-1",
    prompt_version: "prompt-1",
    configuration: "{}",
  });
  insertRow(fixture.raw, "documents", {
    id: documentId,
    project_id: fixture.projectId,
    logical_name: `${documentId}.csv`,
    document_type: "BOQ",
    classification_source: "Manual/Unclassified",
    current_version_id: headVersionId,
    created_by: fixture.ownerUserId,
  });
  for (const [index, version] of versions.entries()) {
    insertRow(fixture.raw, "document_versions", {
      id: version.versionId,
      document_id: documentId,
      version_number: index + 1,
      original_filename: `${documentId}.csv`,
      stored_filename: `${version.versionId}.csv`,
      extension: "csv",
      mime_type: "text/csv",
      byte_size: 64,
      sha256: `sha-${version.versionId}`,
      object_key: `${fixture.projectId}/${version.versionId}.csv`,
      uploaded_by: fixture.ownerUserId,
      effective_from: version.effectiveFrom ?? null,
      effective_to: version.effectiveTo ?? null,
    });
    insertRow(fixture.raw, "document_classifications", {
      id: `c-${version.versionId}`,
      document_id: documentId,
      document_version_id: version.versionId,
      model_version_id: "cmv-gov",
      primary_type: "BOQ",
      secondary_types: "[]",
      confidence: 100,
      confidence_state: "High Confidence",
      status: "Manually Confirmed",
      method: "manual",
      downstream_route: "BOQ Extraction",
    });
    fixture.objects.set(`${fixture.projectId}/${version.versionId}.csv`, new TextEncoder().encode(version.csv ?? CLEAN_CSV));
  }
  for (const [index, link] of supersessions.entries()) {
    const superseding = versions.find((version) => version.versionId === link.supersedingVersionId);
    insertRow(fixture.raw, "document_supersessions", {
      id: `supersession-${documentId}-${index}`,
      superseding_version_id: link.supersedingVersionId,
      superseded_version_id: link.supersededVersionId,
      scope_type: "FULL_DOCUMENT",
      scope_id: null,
      supersession_type: "REVISION",
      effective_from: link.effectiveFrom !== undefined ? link.effectiveFrom : superseding?.effectiveFrom ?? null,
      effective_to: link.effectiveTo !== undefined ? link.effectiveTo : null,
      created_by: fixture.ownerUserId,
    });
  }
};

const summaryStatus = async (env, documentId) => {
  const response = await handleBoqExtractionApi(request(`/api/documents/${documentId}/boq-extraction/summary`), env, ctx);
  return { status: response.status, body: await response.json() };
};

test("DOC-R3 the served extraction follows the GOVERNING version, not the head", async () => {
  const fixture = createDocumentFixture();
  try {
    seedGovernedDocument(fixture, {
      documentId: "doc-gov",
      headVersionId: "ver-gov-addendum",
      versions: [
        { versionId: "ver-gov-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-gov-addendum", effectiveFrom: dayFromNow(30) },
      ],
      supersessions: [{ supersedingVersionId: "ver-gov-addendum", supersededVersionId: "ver-gov-baseline" }],
    });

    // The baseline governs and is extracted first (as the head at the time);
    // then the pending addendum is uploaded and becomes the head with no
    // extraction of its own. Pointing the head at the baseline for the run is
    // not a cheat: it reproduces the production sequence "baseline uploaded,
    // extracted, then addendum uploaded".
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-gov-baseline' WHERE id='doc-gov'").run();
    await executeBoqExtraction(fixture.env, { documentId: "doc-gov", userId: fixture.ownerUserId });
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-gov-addendum' WHERE id='doc-gov'").run();

    const before = await summaryStatus(fixture.env, "doc-gov");
    assert.equal(before.status, 200, "the governing baseline's extraction is served even though the head differs");
    assert.equal(before.body.extraction.document_version_id, "ver-gov-baseline");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 extracting a pending head does not supersede the governing extraction", async () => {
  const fixture = createDocumentFixture();
  try {
    seedGovernedDocument(fixture, {
      documentId: "doc-pending",
      headVersionId: "ver-pending-addendum",
      versions: [
        { versionId: "ver-pending-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-pending-addendum", effectiveFrom: dayFromNow(30) },
      ],
      supersessions: [{ supersedingVersionId: "ver-pending-addendum", supersededVersionId: "ver-pending-baseline" }],
    });

    // Extract the baseline first by making it the head, then move the head
    // forward to the pending addendum -- the only honest way to give each
    // version its own extraction through the production path.
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-pending-baseline' WHERE id='doc-pending'").run();
    const baselineRun = await executeBoqExtraction(fixture.env, { documentId: "doc-pending", userId: fixture.ownerUserId });
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-pending-addendum' WHERE id='doc-pending'").run();
    const addendumRun = await executeBoqExtraction(fixture.env, { documentId: "doc-pending", userId: fixture.ownerUserId });

    // The old code superseded `previous` -- the governing extraction -- here,
    // blanking the baseline's evidence the moment the pending revision was
    // parsed. The supersede is same-version now, so the baseline survives.
    const baselineRow = fixture.raw.prepare("SELECT superseded_at FROM boq_extraction_versions WHERE id=?").get(baselineRun.extractionId);
    assert.equal(baselineRow.superseded_at, null, "extracting a pending head must not retire the governing extraction");
    assert.notEqual(addendumRun.extractionId, baselineRun.extractionId);

    // And the served evidence is still the baseline's until the addendum takes
    // effect: the head's extraction exists but does not govern yet.
    const served = await summaryStatus(fixture.env, "doc-pending");
    assert.equal(served.status, 200);
    assert.equal(served.body.extraction.document_version_id, "ver-pending-baseline");
    assert.equal(served.body.extraction.id, baselineRun.extractionId);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 start idempotency is head-scoped, so a pending head still queues work", async () => {
  const fixture = createDocumentFixture();
  try {
    seedGovernedDocument(fixture, {
      documentId: "doc-start",
      headVersionId: "ver-start-addendum",
      versions: [
        { versionId: "ver-start-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-start-addendum", effectiveFrom: dayFromNow(30) },
      ],
      supersessions: [{ supersedingVersionId: "ver-start-addendum", supersededVersionId: "ver-start-baseline" }],
    });
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-start-baseline' WHERE id='doc-start'").run();
    await executeBoqExtraction(fixture.env, { documentId: "doc-start", userId: fixture.ownerUserId });
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-start-addendum' WHERE id='doc-start'").run();

    // The governing baseline IS extracted. Under the old head-based check this
    // "start" would have reported idempotent and the uploaded addendum would
    // never have been queued. The check is head-scoped now, so work queues.
    const response = await handleBoqExtractionApi(
      request("/api/documents/doc-start/boq-extraction/start", { method: "POST" }),
      fixture.env,
      ctx,
    );
    assert.equal(response.status, 202, "an unextracted head must queue extraction even while governing evidence exists");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a retry after a failure consumes a new number instead of colliding", async () => {
  const fixture = createDocumentFixture();
  try {
    seedGovernedDocument(fixture, {
      documentId: "doc-retry",
      headVersionId: "ver-retry-v1",
      versions: [{ versionId: "ver-retry-v1", effectiveFrom: dayFromNow(-30) }],
    });
    // A failed attempt keeps its row -- and its number.
    insertRow(fixture.raw, "boq_extraction_versions", {
      id: "ex-retry-failed",
      document_id: "doc-retry",
      document_version_id: "ver-retry-v1",
      classification_id: "c-ver-retry-v1",
      processing_run_id: null,
      version_number: 1,
      status: "Failed",
      parser_version: "v1",
      ruleset_version: "v1",
      ocr_version: "v1",
      created_by: fixture.ownerUserId,
    });

    // The old numbering derived the next number from the current *evidence*,
    // which excludes failed runs, so this retry reused number 1 and died on the
    // UNIQUE(document_id, version_number) index. Numbering is document-scoped now.
    const run = await executeBoqExtraction(fixture.env, { documentId: "doc-retry", userId: fixture.ownerUserId });
    const row = fixture.raw.prepare("SELECT version_number, status FROM boq_extraction_versions WHERE id=?").get(run.extractionId);
    assert.equal(row.version_number, 2);
    assert.ok(["Completed", "Needs Review"].includes(row.status));

    const served = await summaryStatus(fixture.env, "doc-retry");
    assert.equal(served.status, 200);
    assert.equal(served.body.extraction.id, run.extractionId, "the failed run is never served as evidence");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a re-run supersedes same-version predecessors and the newest governs", async () => {
  const fixture = createDocumentFixture();
  try {
    seedGovernedDocument(fixture, {
      documentId: "doc-rerun",
      headVersionId: "ver-rerun-v1",
      versions: [{ versionId: "ver-rerun-v1", effectiveFrom: dayFromNow(-30) }],
    });
    const first = await executeBoqExtraction(fixture.env, { documentId: "doc-rerun", userId: fixture.ownerUserId });
    const second = await executeBoqExtraction(fixture.env, { documentId: "doc-rerun", userId: fixture.ownerUserId });

    assert.notEqual(second.extractionId, first.extractionId);
    const firstRow = fixture.raw.prepare("SELECT superseded_at FROM boq_extraction_versions WHERE id=?").get(first.extractionId);
    assert.ok(firstRow.superseded_at, "a same-version re-run retires its predecessor");
    const served = await summaryStatus(fixture.env, "doc-rerun");
    assert.equal(served.body.extraction.id, second.extractionId);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an expired successor with an active edge serves 409, not the retired baseline", async () => {
  const fixture = createDocumentFixture();
  try {
    seedGovernedDocument(fixture, {
      documentId: "doc-expired",
      headVersionId: "ver-expired-addendum",
      versions: [
        { versionId: "ver-expired-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-expired-addendum", effectiveFrom: dayFromNow(-30), effectiveTo: dayFromNow(-1) },
      ],
      supersessions: [{ supersedingVersionId: "ver-expired-addendum", supersededVersionId: "ver-expired-baseline" }],
    });
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-expired-baseline' WHERE id='doc-expired'").run();
    await executeBoqExtraction(fixture.env, { documentId: "doc-expired", userId: fixture.ownerUserId });
    fixture.raw.prepare("UPDATE documents SET current_version_id='ver-expired-addendum' WHERE id='doc-expired'").run();

    // The baseline HAS an extraction, but it is retired by an active edge whose
    // successor has expired. Serving it would resurrect retired evidence; the
    // truthful answer is that no extraction governs this document right now.
    const served = await summaryStatus(fixture.env, "doc-expired");
    assert.equal(served.status, 409);
    assert.equal(served.body.error.code, "BOQ_EXTRACTION_REQUIRED");
  } finally {
    fixture.close();
  }
});
