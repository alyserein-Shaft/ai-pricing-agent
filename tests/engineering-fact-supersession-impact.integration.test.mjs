/**
 * DOC-R3 — EXACT engineering-fact impact of a document supersession.
 *
 * A dependency change must be resolved only where an EXACT, deterministic
 * identity exists between the supersession scope and the fact's provenance.
 * Scope equality alone is not proof of dependency, and no fuzzy or geometric
 * matching is permitted.
 *
 * The repository was audited for such identities. What provably exists:
 *
 *   FULL_DOCUMENT    exact, via extraction-version lineage
 *                    (document_supersessions -> document_versions ->
 *                     boq_extraction_versions/specification_extraction_versions
 *                     -> engineering_fact_provenance.extraction_version_id).
 *   BOQ_ROW          exact, because provenance.source_id holds a real
 *                    boq_items primary key for that source type. The row must be
 *                    resolved through the SUPERSEDED version's lineage, since
 *                    re-extraction mints new boq_items ids.
 *   SECTION          NO exact identity. provenance.section is an unnormalized
 *   CLAUSE           human-facing display string (real values mix "28 46 00"
 *                    and "SK/IDP BASES"), and provenance.clause is a bare
 *                    number unique only within one extraction version.
 *   EVIDENCE_ENTITY  NO reachable identity. No drawing entity id is ever written
 *                    into provenance, so the join is empty, not approximate.
 *   DRAWING_REGION   geometry-only. provenance.bounding_box is never populated.
 *
 * For the scopes with no exact identity the correct outcome is a REPORTED
 * "impact unknown, requires review" -- never a silent no-op and never a fuzzy
 * match. Automatic invalidation for those scopes is not authorized.
 *
 * These tests also pin the history guarantees: a dependency change must not
 * delete or rewrite a fact, must not set superseded_by_id, and must not erase a
 * recorded approval. Current support is evaluated separately from the fact's
 * history, and a fact that keeps a current authoritative source must stay usable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";
import {
  assessEngineeringFactImpact,
  invalidateEngineeringFactsForSupersession,
} from "../worker/engineering-fact-freshness.mjs";

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// A document with one in-force version and a completed BOQ extraction holding
// two distinct items, so a scope can be shown to hit exactly one of them.
const seedDocument = (fixture, documentId, versionId, itemIds) => {
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
  });
  insertRow(fixture.raw, "boq_extraction_versions", {
    id: `bev-${versionId}`,
    document_id: documentId,
    document_version_id: versionId,
    version_number: 1,
    status: "Completed",
    parser_version: "test-parser",
    created_by: fixture.ownerUserId,
  });
  for (const [index, itemId] of itemIds.entries()) {
    insertRow(fixture.raw, "boq_items", {
      id: itemId,
      extraction_version_id: `bev-${versionId}`,
      project_id: fixture.projectId,
      source_document_id: documentId,
      sequence: index + 1,
      item_number: String(index + 1),
      section_path: index === 0 ? "28 46 00" : "SK/IDP BASES",
      row_type: "Item",
    });
  }
};

// A fact provenanced from a BOQ extraction, exactly as
// worker/engineering-knowledge-api.mjs writes it.
const seedFactFromBoqItem = (fixture, { factId, itemId, extractionVersionId, section = null, clause = null }) => {
  insertRow(fixture.raw, "engineering_facts", {
    id: factId,
    project_id: fixture.projectId,
    entity_type: "BOQ Item",
    entity_id: itemId,
    predicate: "requires",
    value: "detector",
    data_type: "text",
    operator: "=",
    fact_type: "Engineering Fact",
    scope_type: "BOQ Item",
    scope_id: itemId,
    status: "Active",
    confidence: 90,
    model_version: "test-model",
  });
  insertRow(fixture.raw, "engineering_fact_provenance", {
    id: `prov-${factId}`,
    fact_id: factId,
    source_type: "Approved BOQ Extraction",
    source_id: itemId,
    document_id: fixture.documentId,
    document_version_id: fixture.versionId,
    extraction_version_id: extractionVersionId,
    section,
    clause,
    original_text: "requires detector",
    extraction_method: "test",
    confidence: 90,
  });
};

const readFact = async (fixture, factId) =>
  fixture.env.DB.prepare("SELECT * FROM engineering_facts WHERE id=?").bind(factId).first();

const seedBase = (fixture) => {
  fixture.documentId = "doc-facts";
  fixture.versionId = "ver-facts-1";
  seedDocument(fixture, fixture.documentId, fixture.versionId, ["boq-a", "boq-b"]);
  seedFactFromBoqItem(fixture, {
    factId: "fact-a",
    itemId: "boq-a",
    extractionVersionId: `bev-${fixture.versionId}`,
    section: "28 46 00",
    clause: "5",
  });
  seedFactFromBoqItem(fixture, {
    factId: "fact-b",
    itemId: "boq-b",
    extractionVersionId: `bev-${fixture.versionId}`,
    section: "SK/IDP BASES",
    clause: "5",
  });
};

const supersession = (over = {}) => ({
  id: "supersession-1",
  superseding_version_id: "ver-facts-2",
  superseded_version_id: "ver-facts-1",
  scope_type: "FULL_DOCUMENT",
  scope_id: null,
  supersession_type: "REVISION",
  effective_from: day(0),
  effective_to: null,
  ...over,
});

test("DOC-R3 a full-document supersession resolves to exact provenance lineage", async () => {
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(fixture.env.DB, supersession());
    assert.equal(impact.resolution, "exact", "full-document lineage is a real foreign-key path");
    assert.equal(impact.automaticInvalidationAuthorized, true);
    assert.deepEqual(impact.affectedFactIds.sort(), ["fact-a", "fact-b"]);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a BOQ_ROW supersession hits exactly that item and nothing else", async () => {
  // Scope equality is not proof of dependency, and neither is document
  // membership: both facts come from the same document and the same extraction.
  // Only the named row's provenance may be reported.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(
      fixture.env.DB,
      supersession({ scope_type: "BOQ_ROW", scope_id: "boq-a" }),
    );
    assert.equal(impact.resolution, "exact");
    assert.deepEqual(impact.affectedFactIds, ["fact-a"], "only the named BOQ row's fact may be affected");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a BOQ_ROW supersession naming an unrelated row affects no fact", async () => {
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(
      fixture.env.DB,
      supersession({ scope_type: "BOQ_ROW", scope_id: "boq-nonexistent" }),
    );
    assert.equal(impact.resolution, "exact");
    assert.deepEqual(impact.affectedFactIds, [], "an unmatched exact scope must not widen to the document");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a SECTION supersession is reported unresolved rather than fuzzy-matched", async () => {
  // fact-a really does carry section "28 46 00", so a naive string comparison
  // would "succeed" here. That is exactly the fuzzy match that is forbidden:
  // the value is an unnormalized human-facing label, not an identity.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(
      fixture.env.DB,
      supersession({ scope_type: "SECTION", scope_id: "28 46 00" }),
    );
    assert.equal(impact.resolution, "unresolved-identity");
    assert.equal(impact.automaticInvalidationAuthorized, false);
    assert.equal(impact.requiresReview, true);
    assert.deepEqual(impact.affectedFactIds, [], "no fact may be auto-affected by a fuzzy section match");
    assert.match(impact.reason, /section/i);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a CLAUSE supersession is reported unresolved rather than fuzzy-matched", async () => {
  // Both facts carry clause "5", so a bare equality match would hit both. A bare
  // clause number is unique only inside one extraction version, so this is not
  // an identity.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(
      fixture.env.DB,
      supersession({ scope_type: "CLAUSE", scope_id: "5" }),
    );
    assert.equal(impact.resolution, "unresolved-identity");
    assert.equal(impact.automaticInvalidationAuthorized, false);
    assert.deepEqual(impact.affectedFactIds, []);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an EVIDENCE_ENTITY supersession is reported as having no reachable identity", async () => {
  // Drawing entities have stable keys, but no drawing entity id is ever written
  // into engineering_fact_provenance, so the join is empty rather than fuzzy.
  // Reporting that honestly is required; claiming a clean result would hide a
  // gap in the lineage model.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(
      fixture.env.DB,
      supersession({ scope_type: "EVIDENCE_ENTITY", scope_id: "symbol-occurrence-1" }),
    );
    assert.equal(impact.automaticInvalidationAuthorized, false);
    assert.equal(impact.requiresReview, true);
    assert.deepEqual(impact.affectedFactIds, []);
    assert.match(impact.reason, /provenance|identity/i);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a DRAWING_REGION supersession is never automatic", async () => {
  // Geometry alone. Bounding-box overlap is tolerance-dependent and
  // non-deterministic, and provenance.bounding_box is never populated.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const impact = await assessEngineeringFactImpact(
      fixture.env.DB,
      supersession({ scope_type: "DRAWING_REGION", scope_id: "region-7" }),
    );
    assert.equal(impact.resolution, "geometry-only");
    assert.equal(impact.automaticInvalidationAuthorized, false);
    assert.equal(impact.requiresReview, true);
    assert.deepEqual(impact.affectedFactIds, []);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 invalidation preserves history and never links a successor", async () => {
  // The dependency change may change CURRENT USABILITY only. It must not delete
  // the fact, must not set superseded_by_id, and must record who and why.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const result = await invalidateEngineeringFactsForSupersession(fixture.env.DB, supersession());
    assert.equal(result.invalidated, 2, "both facts lose all support when the document is superseded");

    for (const factId of ["fact-a", "fact-b"]) {
      const fact = await readFact(fixture, factId);
      assert.ok(fact, "the fact row must survive the dependency change");
      assert.equal(fact.status, "Superseded");
      assert.equal(fact.superseded_by_id, null, "a dependency change must not invent a successor link");
      assert.equal(fact.changed_by, "system:engineering-fact-freshness");
      assert.match(fact.change_reason, /supersed/i);
      assert.ok(fact.effective_to, "the usability window must be closed explicitly");
    }
    const provenance = await fixture.env.DB
      .prepare("SELECT COUNT(*) AS n FROM engineering_fact_provenance")
      .first();
    assert.equal(Number(provenance.n), 2, "provenance history must be preserved in full");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a fact still supported by a current authoritative source stays usable", async () => {
  // Support is a disjunction, not a conjunction: one surviving authoritative
  // provenance is enough. A fact that keeps a current source must NOT be marked
  // unusable, because losing it would silently remove engineering knowledge that
  // is still evidenced.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    // A second, non-extraction provenance (a datasheet) that is untouched by the
    // document supersession and therefore still current.
    insertRow(fixture.raw, "engineering_fact_provenance", {
      id: "prov-datasheet",
      fact_id: "fact-a",
      source_type: "Manufacturer Official Datasheet",
      source_id: "lib-product-1",
      original_text: "detector",
      extraction_method: "manual",
      confidence: 95,
    });

    const result = await invalidateEngineeringFactsForSupersession(fixture.env.DB, supersession());
    assert.equal(result.invalidated, 1, "only the fact with no surviving support may lose usability");

    const supported = await readFact(fixture, "fact-a");
    assert.equal(supported.status, "Active", "a currently supported fact must remain usable");
    assert.equal(supported.superseded_by_id, null);

    const unsupported = await readFact(fixture, "fact-b");
    assert.equal(unsupported.status, "Superseded", "a fact with no support left must not flow downstream");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an unresolved scope never changes any fact", async () => {
  // The read-only assessment and the mutating path must agree: if the scope has
  // no exact identity, nothing may be written, not even a status change.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    const result = await invalidateEngineeringFactsForSupersession(
      fixture.env.DB,
      supersession({ scope_type: "SECTION", scope_id: "28 46 00" }),
    );
    assert.equal(result.invalidated, 0);
    assert.equal(result.requiresReview, true);
    for (const factId of ["fact-a", "fact-b"]) {
      assert.equal((await readFact(fixture, factId)).status, "Active");
    }
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a previously approved decision is preserved through invalidation", async () => {
  // Historical approval is not current usability. Invalidating usability must not
  // erase the recorded human decision, its actor, its reason or its timestamp.
  const fixture = createDocumentFixture();
  try {
    seedBase(fixture);
    insertRow(fixture.raw, "engineering_knowledge_decisions", {
      id: "decision-1",
      project_id: fixture.projectId,
      entity_type: "BOQ Item",
      entity_id: "boq-a",
      action: "Accept",
      reason: "Reviewed against the approved submittal",
      evidence: "submittal-1",
      scope_type: "BOQ Item",
      scope_id: "boq-a",
      decided_by: "engineer-1",
      decided_role: "Engineer",
      decided_at: "2026-01-15T09:00:00.000Z",
    });
    await invalidateEngineeringFactsForSupersession(fixture.env.DB, supersession());
    const decision = await fixture.env.DB
      .prepare("SELECT * FROM engineering_knowledge_decisions WHERE id=?")
      .bind("decision-1")
      .first();
    assert.ok(decision, "the approval record must survive");
    assert.equal(decision.decided_by, "engineer-1");
    assert.equal(decision.decided_at, "2026-01-15T09:00:00.000Z");
    assert.equal(decision.reason, "Reviewed against the approved submittal");
  } finally {
    fixture.close();
  }
});
