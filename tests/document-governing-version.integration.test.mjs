/**
 * DOC-R3 — governing document version: LATEST / HIGHEST-PRECEDENCE IN-FORCE VERSION.
 *
 * The governing policy is NOT `documents.current_version_id AND in-force`.
 * `current_version_id` answers "which row is the head"; a head pointer is not a
 * temporal authority. A future-dated addendum becomes the head the moment it is
 * uploaded, so a head-and-in-force rule lets an unactivated addendum displace a
 * baseline that is still legitimately in force. The governing version is the
 * highest-precedence version that is *in force right now*:
 *
 *   - half-open validity: [effective_from, effective_to)
 *   - no in-force version  -> fail closed (the document supplies no evidence)
 *   - null effective_from  -> open past   (no declared start)
 *   - null effective_to    -> open future (no declared end)
 *   - expired evidence is never revived
 *   - a future head does not displace an in-force baseline
 *
 * These tests deliberately cover only the parts of the policy that do NOT depend
 * on the precedence/tie-break contract (explicit supersession, family/revision
 * precedence, effective-time precedence, and fail-closed ambiguity). Those
 * contract cases live in their own suite so a contract change cannot silently
 * redefine the window semantics asserted here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentFixture, insertRow } from "./helpers/document-fixture.mjs";
import {
  currentBoqEvidenceCounts,
  currentBoqEvidenceFrom,
  currentTechnicalRequirementsFrom,
  diagnoseBoqEvidence,
} from "../worker/current-evidence-scope.mjs";

const dayFromNow = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * Seed one document with a head version plus any number of prior versions, each
 * with its own completed BOQ extraction and one current BOQ item, so the count
 * of current items directly reports which version is governing.
 */
const seedDocument = (fixture, { documentId, versions, supersessions = [] }) => {
  const head = versions[versions.length - 1];
  insertRow(fixture.raw, "documents", {
    id: documentId,
    project_id: fixture.projectId,
    logical_name: `${documentId}.pdf`,
    current_version_id: head.versionId,
    created_by: fixture.ownerUserId,
  });
  for (const [index, version] of versions.entries()) {
    const versionNumber = index + 1;
    insertRow(fixture.raw, "document_versions", {
      id: version.versionId,
      document_id: documentId,
      version_number: versionNumber,
      original_filename: `${documentId}.pdf`,
      stored_filename: `${version.versionId}.pdf`,
      extension: "pdf",
      mime_type: "application/pdf",
      byte_size: 128,
      sha256: `sha-${version.versionId}`,
      object_key: `${fixture.projectId}/${version.versionId}.pdf`,
      uploaded_by: fixture.ownerUserId,
      effective_from: version.effectiveFrom ?? null,
      effective_to: version.effectiveTo ?? null,
    });
    // `boq_extraction_versions` is unique on (document_id, version_number), so the
    // extraction counter is document-scoped, not version-scoped. Bumping it per
    // version is what keeps every seeded extraction non-superseded, so the
    // governing version is decided purely by the effective-time policy under test
    // and never accidentally by the extraction-newer tiebreak.
    insertRow(fixture.raw, "boq_extraction_versions", {
      id: `ex-${version.versionId}`,
      document_id: documentId,
      document_version_id: version.versionId,
      version_number: versionNumber,
      status: "Completed",
      parser_version: "test-parser",
      ruleset_version: "test-rules",
      ocr_version: "test-ocr",
      created_by: fixture.ownerUserId,
    });
    insertRow(fixture.raw, "boq_items", {
      id: `${version.versionId}-item`,
      extraction_version_id: `ex-${version.versionId}`,
      project_id: fixture.projectId,
      source_document_id: documentId,
      sequence: versionNumber,
      item_number: String(versionNumber),
      section_path: "Root",
      row_type: "Item",
    });
  }
  // Supersession is the append-only record the migration calls "the authority
  // that says which evidence is no longer in force". Seeding it explicitly is
  // what lets a test separate "resolved by an explicit supersession" from
  // "resolved by effective time" from "genuinely ambiguous".
  for (const [index, link] of supersessions.entries()) {
    // The supersession edge's own window DEFAULTS TO THE SUPERSEDING VERSION'S
    // DECLARED START, because that is what the production intake path writes.
    // `worker/document-api.mjs` inserts the supersession row in the same atomic
    // unit as the version and binds the same `effectiveFrom`/`effectiveTo` to
    // both, so "this revision supersedes that one from date D" is recorded as a
    // single fact on two columns rather than two independent decisions.
    //
    // Seeding an open-ended edge by default, as this fixture used to, modelled
    // data the product never creates -- and under the corrected retirement policy
    // it modelled the WORST case: a permanently open edge retires its target the
    // instant it is written, so a merely-future-dated addendum would blank the
    // document. A test that quietly depended on that shape would have been
    // asserting a fiction. Tests that genuinely want an open edge, or an edge
    // deliberately out of step with its successor, pass `effectiveFrom`
    // explicitly and say why in their own comments.
    const superseding = versions.find((version) => version.versionId === link.supersedingVersionId);
    insertRow(fixture.raw, "document_supersessions", {
      id: `supersession-${documentId}-${index}`,
      superseding_version_id: link.supersedingVersionId,
      superseded_version_id: link.supersededVersionId,
      scope_type: link.scopeType ?? "FULL_DOCUMENT",
      scope_id: link.scopeId ?? null,
      supersession_type: link.supersessionType ?? "REVISION",
      effective_from: link.effectiveFrom !== undefined ? link.effectiveFrom : superseding?.effectiveFrom ?? null,
      effective_to: link.effectiveTo !== undefined ? link.effectiveTo : null,
      created_by: fixture.ownerUserId,
    });
  }
};

// Read the governing version's items *through the authority itself*, not through a
// hand-written join. A direct `boq_items` read would report every seeded version
// regardless of the policy under test and could never fail.
const governingItemNumbers = async (fixture, documentId) => {
  const rows = await fixture.env.DB
    .prepare(
      `SELECT b.item_number FROM ${currentBoqEvidenceFrom("b")} WHERE b.source_document_id=? ORDER BY b.id`,
    )
    .bind(documentId)
    .all();
  return (rows.results || []).map((row) => row.item_number);
};

const currentItemCount = async (fixture) =>
  (await currentBoqEvidenceCounts(fixture.env.DB, { projectId: fixture.projectId })).currentBoqItems;

test("DOC-R3 a future-dated head does not displace an older in-force baseline", async () => {
  // The core policy correction. A revision uploaded with a future effective date
  // is the document head immediately, but it is not in force, so the baseline it
  // was meant to amend keeps governing until the addendum actually takes effect.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-pending-addendum",
      versions: [
        { versionId: "ver-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-addendum", effectiveFrom: dayFromNow(60) },
      ],
    });
    assert.equal(await currentItemCount(fixture), 1, "exactly one version may govern");
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-pending-addendum"),
      ["1"],
      "the in-force baseline, not the future head, must remain the current evidence",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 when the addendum takes effect the head becomes governing", async () => {
  // Same shape as above with the addendum already effective: now the higher
  // precedence in-force version wins, and the baseline stops being evidence.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-effective-addendum",
      versions: [
        { versionId: "ver-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-addendum", effectiveFrom: dayFromNow(-1) },
      ],
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-effective-addendum"),
      ["2"],
      "once in force, the later version supersedes the baseline as current evidence",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a document with no in-force version fails closed", async () => {
  // Every version expired, or only a future version exists: the document must
  // supply nothing at all. It must never fall back to an expired version, because
  // reviving expired evidence is exactly the failure this policy forbids.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-all-expired",
      versions: [{ versionId: "ver-expired", effectiveFrom: dayFromNow(-90), effectiveTo: dayFromNow(-30) }],
    });
    seedDocument(fixture, {
      documentId: "doc-only-future",
      versions: [{ versionId: "ver-future", effectiveFrom: dayFromNow(60) }],
    });
    assert.equal(await currentItemCount(fixture), 0, "no in-force version means no current evidence");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a baseline survives while a later version is in force but lower precedence", async () => {
  // Contiguity: the baseline's window is not closed by the mere existence of a
  // later version. It keeps governing until something actually removes it from
  // force, which is what makes the pending-addendum case above coherent.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-overlapping",
      versions: [
        { versionId: "ver-open-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-also-open", effectiveFrom: dayFromNow(-10) },
      ],
    });
    // Two versions are simultaneously in force. Exactly one must govern, chosen
    // by the authorized precedence contract, never by upload order or id.
    assert.equal(await currentItemCount(fixture), 1, "overlap must resolve to exactly one governing version");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 the effective window is half-open at both boundaries", async () => {
  // effective_from is inclusive and effective_to is exclusive, so a version that
  // ends exactly when its successor begins leaves no gap and no overlap.
  const fixture = createDocumentFixture();
  try {
    const today = dayFromNow(0);
    const yesterday = dayFromNow(-1);
    // Ends today -> today is already outside [from, to), so it does not govern.
    seedDocument(fixture, {
      documentId: "doc-ends-today",
      versions: [{ versionId: "ver-ends-today", effectiveFrom: yesterday, effectiveTo: today }],
    });
    // Starts today -> today is inside [from, to), so it governs.
    seedDocument(fixture, {
      documentId: "doc-starts-today",
      versions: [{ versionId: "ver-starts-today", effectiveFrom: today }],
    });
    assert.equal(await currentItemCount(fixture), 1, "only the version whose window contains today may govern");
    assert.deepEqual(await governingItemNumbers(fixture, "doc-starts-today"), ["1"]);
  } finally {
    fixture.close();
  }
});

test("DOC-R3 null bounds mean open past and open future", async () => {
  // The migration deliberately gives `effective_from` no default, because a
  // default would assert an effective time the uploader never declared. A null
  // bound therefore means "no declared bound", not "unknown".
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-null-from",
      versions: [{ versionId: "ver-null-from", effectiveFrom: null }],
    });
    seedDocument(fixture, {
      documentId: "doc-null-to",
      versions: [{ versionId: "ver-null-to", effectiveFrom: dayFromNow(-1), effectiveTo: null }],
    });
    assert.equal(await currentItemCount(fixture), 2, "null bounds must not exclude a version from force");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 diagnostics and selection agree on which version governs", async () => {
  // The operator-facing explanation must not contradict the selection. A pending
  // addendum's items are excluded because the addendum is not yet in force, and
  // the governing baseline's item must never be reported as excluded at all.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-diagnose",
      versions: [
        { versionId: "ver-diag-baseline", effectiveFrom: dayFromNow(-30) },
        { versionId: "ver-diag-addendum", effectiveFrom: dayFromNow(60) },
      ],
    });
    const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: "org-a" });
    const byItem = new Map(rows.map((row) => [row.boqItemId, row.exclusionReason]));
    assert.equal(
      byItem.get("ver-diag-baseline-item"),
      "current BOQ item",
      "the governing baseline's item must be reported as current",
    );
    assert.equal(
      byItem.get("ver-diag-addendum-item"),
      "document version not yet in force",
      "the pending addendum's item must be explained as not yet in force",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 explicit supersession resolves an overlap that effective time cannot", async () => {
  // Two versions share the SAME declared effective start, so effective-time
  // precedence is silent and cannot decide. The append-only supersession record
  // can, and it is a recorded fact rather than a guess about recency.
  const fixture = createDocumentFixture();
  try {
    const shared = dayFromNow(-10);
    seedDocument(fixture, {
      documentId: "doc-explicit-supersession",
      versions: [
        { versionId: "ver-same-start-old", effectiveFrom: shared },
        { versionId: "ver-same-start-new", effectiveFrom: shared },
      ],
      supersessions: [{ supersedingVersionId: "ver-same-start-new", supersededVersionId: "ver-same-start-old" }],
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-explicit-supersession"),
      ["2"],
      "the superseding version must govern; the superseded one is retired",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a supersession chain resolves transitively to the latest version", async () => {
  // The shape a plain sequence of "replace" uploads actually produces: three
  // versions, none declaring an effective date, each superseding the one before.
  // No single row says "version 3 supersedes version 1", so the authority has to
  // be read through the chain. Version 1 is still inside an open-ended window
  // because the intake path never closes a superseded window, so a purely
  // direct reading would leave the document with no governing version at all.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-chain",
      versions: [
        { versionId: "ver-chain-1" },
        { versionId: "ver-chain-2" },
        { versionId: "ver-chain-3" },
      ],
      supersessions: [
        { supersedingVersionId: "ver-chain-2", supersededVersionId: "ver-chain-1" },
        { supersedingVersionId: "ver-chain-3", supersededVersionId: "ver-chain-2" },
      ],
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-chain"),
      ["3"],
      "only the end of the chain is unretired and must govern",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a superseded version is diagnosed as retired, not merely stale", async () => {
  // "Stale document version" used to mean "not the head", which is a head-pointer
  // notion. A retired version has actually been replaced, and the operator
  // remedy is different, so the reason has to say so.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-retired",
      versions: [
        { versionId: "ver-retired-old" },
        { versionId: "ver-retired-new" },
      ],
      supersessions: [{ supersedingVersionId: "ver-retired-new", supersededVersionId: "ver-retired-old" }],
    });
    const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: "org-a" });
    const byItem = new Map(rows.map((row) => [row.boqItemId, row.exclusionReason]));
    assert.equal(byItem.get("ver-retired-old-item"), "document version superseded");
    assert.equal(byItem.get("ver-retired-new-item"), "current BOQ item");
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an unresolvable overlap fails closed and says so", async () => {
  // Two in-force versions, identical declared start, and no supersession to
  // separate them. There is no authorized tie-breaker -- upload order, the
  // surrogate id and version_number are all forbidden because each would invent a
  // workflow rule and reinstate the defect DOC-R3 exists to fix. So the document
  // must supply no evidence and the diagnostic must name the conflict, rather
  // than silently pricing from whichever row happened to be written last.
  const fixture = createDocumentFixture();
  try {
    const shared = dayFromNow(-10);
    seedDocument(fixture, {
      documentId: "doc-ambiguous",
      versions: [
        { versionId: "ver-ambiguous-a", effectiveFrom: shared },
        { versionId: "ver-ambiguous-b", effectiveFrom: shared },
      ],
    });
    assert.equal(
      await currentItemCount(fixture),
      0,
      "an ambiguous overlap must supply no evidence, not an arbitrary winner",
    );
    const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: "org-a" });
    const reasons = new Set(rows.map((row) => row.exclusionReason));
    assert.deepEqual(
      [...reasons],
      ["document version governance conflict"],
      "both versions must be reported as an unresolved governance conflict",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a bare business date and an ISO instant are compared as one timeline", async () => {
  // The two shapes the migration deliberately allows in the same column. A text
  // comparison would rank every ISO instant after every bare date forever,
  // because 'T' sorts after the space SQLite's CURRENT_TIMESTAMP uses. Here a
  // bare date and a real instant compete for the same document, so only a
  // normalized comparison gives the right winner.
  const fixture = createDocumentFixture();
  try {
    const fixtureNow = Date.now();
    seedDocument(fixture, {
      documentId: "doc-mixed-shapes",
      versions: [
        // A bare business date earlier today.
        { versionId: "ver-bare-date", effectiveFrom: new Date(fixtureNow - 86400000).toISOString().slice(0, 10) },
        // A full ISO instant, already in force, later than that bare date.
        { versionId: "ver-iso-instant", effectiveFrom: new Date(fixtureNow - 3600000).toISOString() },
        // A full ISO instant still in the future, and the document head.
        { versionId: "ver-iso-future", effectiveFrom: new Date(fixtureNow + 3600000).toISOString() },
      ],
      supersessions: [
        { supersedingVersionId: "ver-iso-instant", supersededVersionId: "ver-bare-date" },
        { supersedingVersionId: "ver-iso-future", supersededVersionId: "ver-iso-instant" },
      ],
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-mixed-shapes"),
      ["2"],
      "the in-force instant must govern; the future instant is not yet in force",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 specification requirements obey the same governing authority as BOQ items", async () => {
  // Acceptance requires the two evidence families to agree. Both now read the
  // same predicate, so a pending addendum must be invisible to specifications
  // for exactly the same reason it is invisible to BOQ items.
  const fixture = createDocumentFixture();
  try {
    seedDocument(fixture, {
      documentId: "doc-spec-agreement",
      versions: [
        { versionId: "ver-spec-baseline" },
        { versionId: "ver-spec-addendum", effectiveFrom: dayFromNow(60) },
      ],
      supersessions: [{ supersedingVersionId: "ver-spec-addendum", supersededVersionId: "ver-spec-baseline" }],
    });
    for (const [index, versionId] of ["ver-spec-baseline", "ver-spec-addendum"].entries()) {
      insertRow(fixture.raw, "specification_extraction_versions", {
        id: `sev-${versionId}`,
        document_id: "doc-spec-agreement",
        document_version_id: versionId,
        version_number: index + 1,
        status: "Completed",
        parser_version: "test-parser",
        created_by: fixture.ownerUserId,
      });
      insertRow(fixture.raw, "technical_requirements", {
        id: `${versionId}-req`,
        extraction_version_id: `sev-${versionId}`,
        project_id: fixture.projectId,
        source_document_id: "doc-spec-agreement",
        source_version_id: versionId,
        requirement_text: `Requirement from ${versionId}`,
        status: "Draft",
      });
    }
    const rows = await fixture.env.DB
      .prepare(
        `SELECT r.id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id=? ORDER BY r.id`,
      )
      .bind(fixture.projectId)
      .all();
    assert.deepEqual(
      (rows.results || []).map((row) => row.id),
      ["ver-spec-baseline-req"],
      "the baseline's requirement governs while the addendum is still pending",
    );
  } finally {
    fixture.close();
  }
});

// Every column of the evidence tables that could have been written to record an
// activation, read back as one comparable string. Used to show that an activation
// happened with nothing in the database changing except the declared bound.
const EVIDENCE_TABLES = [
  "documents",
  "document_versions",
  "document_supersessions",
  "boq_extraction_versions",
  "boq_items",
  "specification_extraction_versions",
  "technical_requirements",
];

const evidenceSnapshot = (fixture) => {
  const parts = [];
  for (const table of EVIDENCE_TABLES) {
    const rows = fixture.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    for (const row of rows) {
      // Two columns are excluded, each for its own reason.
      //
      // The declared effective bound is the one thing that IS meant to differ --
      // it is the input to the test, not an output of it.
      //
      // `created_at` is an insert-time audit stamp that the two seeds happen to
      // generate independently. It is excluded because it differs whenever the two
      // seeds straddle a second boundary, which would fail the test for a reason
      // that has nothing to do with activation. Everything that describes the
      // EVIDENCE is still compared.
      const { effective_from: _from, effective_to: _to, created_at: _created, ...rest } = row;
      parts.push(`${table} ${JSON.stringify(rest)}`);
    }
  }
  assert.ok(parts.length > 0, "the snapshot must actually capture evidence rows");
  return parts.join("\n");
};

test("DOC-R3 activation and expiry need no database write, only a declared bound", async () => {
  // Acceptance scenario: what happens to evidence and to previously generated
  // artifacts when a version activates or expires purely because time passed.
  //
  // The mechanism is that governing selection is DERIVED on every read, so an
  // activation is a fact about the clock and the declared window, not an event
  // that any job, trigger or migration has to apply. Nothing rewrites a row at the
  // instant; the row is already correct and is simply now in force.
  //
  // The test isolates time as the ONLY variable: two fixtures are seeded with
  // identical data, differing only in one declared `effective_from` that sits one
  // second either side of now. Every other column of every evidence table is then
  // compared between them, so a pass proves the flip came from the clock and not
  // from a write. That is also what makes the derived-artifact consequence real:
  // a cached requirement profile carries an `input_fingerprint` computed from
  // exactly these requirement rows, so the artifact's inputs change with no write
  // having occurred.
  const pending = createDocumentFixture();
  const effective = createDocumentFixture();
  try {
    const now = Date.now();
    const seed = (fixture, addendumEffectiveFrom) => {
      seedDocument(fixture, {
        documentId: "doc-no-write-activation",
        versions: [
          { versionId: "ver-nw-baseline", effectiveFrom: dayFromNow(-30) },
          { versionId: "ver-nw-addendum", effectiveFrom: addendumEffectiveFrom },
        ],
        supersessions: [
          { supersedingVersionId: "ver-nw-addendum", supersededVersionId: "ver-nw-baseline" },
        ],
      });
      for (const [index, versionId] of ["ver-nw-baseline", "ver-nw-addendum"].entries()) {
        insertRow(fixture.raw, "specification_extraction_versions", {
          id: `sev-${versionId}`,
          document_id: "doc-no-write-activation",
          document_version_id: versionId,
          version_number: index + 1,
          status: "Completed",
          parser_version: "test-parser",
          created_by: fixture.ownerUserId,
        });
        insertRow(fixture.raw, "technical_requirements", {
          id: `${versionId}-req`,
          extraction_version_id: `sev-${versionId}`,
          project_id: fixture.projectId,
          source_document_id: "doc-no-write-activation",
          source_version_id: versionId,
          requirement_text: `Requirement from ${versionId}`,
          status: "Draft",
        });
      }
    };

    // The addendum supersedes the baseline, and it is the document head, in BOTH
    // fixtures. Only its declared start differs: 1 second ahead of now, then 1
    // second behind it.
    seed(pending, new Date(now + 1000).toISOString());
    seed(effective, new Date(now - 1000).toISOString());

    assert.equal(
      evidenceSnapshot(pending),
      evidenceSnapshot(effective),
      "no evidence column may differ except the declared effective_from",
    );

    // Selection flips purely from the clock.
    assert.deepEqual(
      await governingItemNumbers(pending, "doc-no-write-activation"),
      ["1"],
      "one second before activation the baseline still governs",
    );
    assert.deepEqual(
      await governingItemNumbers(effective, "doc-no-write-activation"),
      ["2"],
      "one second after activation the addendum governs, with no write having occurred",
    );

    // And the same flip reaches the requirement set that a generated requirement
    // profile fingerprints, so a previously generated artifact's inputs change
    // without any row being updated.
    const requirementIds = async (fixture) => {
      const rows = await fixture.env.DB
        .prepare(`SELECT r.id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id=? ORDER BY r.id`)
        .bind(fixture.projectId)
        .all();
      return (rows.results || []).map((row) => row.id);
    };
    assert.deepEqual(await requirementIds(pending), ["ver-nw-baseline-req"]);
    assert.deepEqual(await requirementIds(effective), ["ver-nw-addendum-req"]);
  } finally {
    pending.close();
    effective.close();
  }
});

test("DOC-R3 an expired successor does NOT resurrect its baseline; the supersession edge must end", async () => {
  // The corrected retirement policy, and the single most consequential change in
  // DOC-R3: a VERSION VALIDITY WINDOW and a SUPERSESSION/RETIREMENT WINDOW are
  // SEPARATE AUTHORITY DIMENSIONS.
  //
  //     version_in_force(T) AND NOT active_supersession_retires(version, T)
  //
  // Retirement is decided by the supersession relationship and its own window
  // alone. The successor's own validity is NOT an input to that question, so an
  // expired successor does not hand authority back to the version it replaced.
  //
  // A previous, symmetric reading ("successor not in force => baseline returns")
  // looked tidier and was wrong. It manufactured authority that no operator ever
  // declared: the retirement was still on record and still active, yet a version
  // nobody had reinstated started governing again purely because a different
  // version's clock ran out. An operator who retires a baseline in favour of an
  // addendum and then lets that addendum lapse must be told the document has NO
  // GOVERNING EVIDENCE, because that is the truthful state and the one they can
  // act on.
  //
  // Note also what is NOT happening: no expired evidence is being revived. The
  // expired addendum still supplies nothing and is still reported as out of
  // window. The baseline is not revived either -- it is RETIRED.
  const fixture = createDocumentFixture();
  try {
    const active = dayFromNow(-30);
    seedDocument(fixture, {
      documentId: "doc-expired-successor",
      versions: [
        { versionId: "ver-exp-baseline", effectiveFrom: active },
        { versionId: "ver-exp-addendum", effectiveFrom: active, effectiveTo: dayFromNow(-1) },
      ],
      supersessions: [
        // The edge is ACTIVE (it started when the addendum took effect and has
        // no declared end), which is the whole point of the case.
        { supersedingVersionId: "ver-exp-addendum", supersededVersionId: "ver-exp-baseline" },
      ],
    });

    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-expired-successor"),
      [],
      "an active supersession edge keeps the baseline retired even though its successor has expired",
    );

    const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: "org-a" });
    const byItem = new Map(rows.map((row) => [row.boqItemId, row.exclusionReason]));
    assert.equal(
      byItem.get("ver-exp-addendum-item"),
      "document version effective window closed",
      "the expired addendum must be explained as out of window, not as merely unselected",
    );
    assert.equal(
      byItem.get("ver-exp-baseline-item"),
      "document version superseded",
      "the baseline must be explained as RETIRED -- not as stale, and not as current",
    );

    // The baseline cannot be un-retired from this state, and that is a structural
    // guarantee rather than an accident of this test. The migration gives
    // `document_supersessions` a partial UNIQUE index on
    // (superseding, superseded, scope_type[, scope_id]) and an append-only
    // trigger pair that aborts every UPDATE and DELETE. So an open edge cannot
    // be closed by adding a competing row, and it cannot be closed by editing
    // the original one either. Retirement recorded as open is permanent.
    //
    // The operator's real remedy is a NEW in-force revision, which is a fresh
    // fact rather than a rewrite of history. Asserting that here keeps the
    // fail-closed result from reading as a dead end: the document is recoverable,
    // but only by adding evidence, never by un-retiring evidence that was
    // retired on purpose.
    insertRow(fixture.raw, "document_versions", {
      id: "ver-exp-r2",
      document_id: "doc-expired-successor",
      version_number: 3,
      original_filename: "doc-expired-successor.pdf",
      stored_filename: "ver-exp-r2.pdf",
      extension: "pdf",
      mime_type: "application/pdf",
      byte_size: 128,
      sha256: "sha-ver-exp-r2",
      object_key: `${fixture.projectId}/ver-exp-r2.pdf`,
      uploaded_by: fixture.ownerUserId,
      effective_from: dayFromNow(-5),
      effective_to: null,
    });
    insertRow(fixture.raw, "document_supersessions", {
      id: "supersession-doc-expired-successor-r2",
      superseding_version_id: "ver-exp-r2",
      superseded_version_id: "ver-exp-addendum",
      scope_type: "FULL_DOCUMENT",
      scope_id: null,
      supersession_type: "REVISION",
      effective_from: dayFromNow(-5),
      effective_to: null,
      created_by: fixture.ownerUserId,
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-expired-successor"),
      [],
      "a new in-force revision with no extraction of its own supplies no BOQ evidence yet",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 the baseline resumes only once no ACTIVE supersession edge retires it", async () => {
  // The companion half, and the only sanctioned way a retired baseline comes
  // back. Here the single edge's own window has closed and there is no other
  // active edge, so nothing retires the baseline and its own validity window
  // still contains now -- therefore it governs again.
  //
  // This is deliberately a SEPARATE test from the fail-closed case above. The
  // distinction that matters is "is any active edge still retiring this version",
  // not "does the baseline look harmless", and a single test asserting both
  // outcomes in sequence would hide which condition produced which.
  const fixture = createDocumentFixture();
  try {
    const active = dayFromNow(-30);
    seedDocument(fixture, {
      documentId: "doc-edge-closed",
      versions: [
        { versionId: "ver-closed-baseline", effectiveFrom: active },
        { versionId: "ver-closed-addendum", effectiveFrom: active, effectiveTo: dayFromNow(-1) },
      ],
      supersessions: [
        {
          supersedingVersionId: "ver-closed-addendum",
          supersededVersionId: "ver-closed-baseline",
          // The edge's own window closed a week ago. It therefore no longer
          // retires anything, even though the addendum it names is still
          // expired and will never govern again.
          effectiveFrom: dayFromNow(-20),
          effectiveTo: dayFromNow(-10),
        },
      ],
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-edge-closed"),
      ["1"],
      "with no active edge and the baseline's own window open, the baseline governs again",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 an ACTIVE edge from a not-yet-in-force successor still retires (fail closed)", async () => {
  // The data-shape trap, pinned deliberately.
  //
  // Retirement reads the supersession's window and nothing else, so an edge that
  // is open from the moment it is written retires its target IMMEDIATELY -- even
  // when the version that created the edge has not taken effect yet. If the
  // successor is also not in force, the document has no governing version and
  // fails closed.
  //
  // This is a real consequence of the corrected policy, not a hypothetical: it is
  // exactly what an operator gets if they record "this addendum supersedes that
  // baseline" with no declared date while the addendum itself is dated next
  // quarter. The truthful answer is that the document is in a broken state, and
  // the product says so rather than guessing.
  //
  // The production intake path cannot produce this shape: `worker/document-api.mjs`
  // writes the same `effectiveFrom` onto the version and onto its supersession
  // edge in one atomic batch, so a future-dated addendum arrives with a
  // future-dated edge and correctly leaves the baseline governing. This test
  // exists to pin what happens when that coherence is lost, so that the failure
  // is a visible fail-closed state instead of a silent authority.
  const fixture = createDocumentFixture();
  try {
    const active = dayFromNow(-30);
    seedDocument(fixture, {
      documentId: "doc-open-edge-future-successor",
      versions: [
        { versionId: "ver-oef-baseline", effectiveFrom: active },
        { versionId: "ver-oef-addendum", effectiveFrom: dayFromNow(60) },
      ],
      supersessions: [
        {
          supersedingVersionId: "ver-oef-addendum",
          supersededVersionId: "ver-oef-baseline",
          // Explicitly open: the edge took effect on record, with no date.
          effectiveFrom: null,
        },
      ],
    });
    assert.deepEqual(
      await governingItemNumbers(fixture, "doc-open-edge-future-successor"),
      [],
      "an open edge from a future-dated successor retires the baseline, and nothing in force replaces it",
    );
  } finally {
    fixture.close();
  }
});

test("DOC-R3 a future-dated supersession record neither retires nor orders", async () => {
  // The supersession record is itself governed evidence, because the migration
  // gives it its own effective window: it records WHEN a retirement takes effect.
  // Reading only the version window would treat a dated supersession as timeless,
  // so a "takes effect next quarter" marker would retire the baseline the moment
  // it was written -- the very defect DOC-R3 fixes, reached through the
  // supersession table instead of the head pointer.
  //
  // The two versions here share the same declared start, so effective-time
  // precedence is silent, and the only thing that could order them is the
  // supersession. Because that supersession is not yet in force it may neither
  // retire the baseline nor outrank it, so NOTHING orders the pair and the correct
  // outcome is a governance conflict that supplies no evidence. That is the
  // fail-closed result, and it is the one an operator can act on.
  //
  // The alternative would be worse than either error: honouring the record would
  // hand the document to a successor that has not taken effect, while ignoring it
  // for ordering but honouring it for retirement would retire the baseline and
  // leave the successor unretired -- a document whose governing version depends on
  // which of the two questions a given code path happened to ask.
  const fixture = createDocumentFixture();
  try {
    const active = dayFromNow(-30);
    seedDocument(fixture, {
      documentId: "doc-future-supersession",
      versions: [
        { versionId: "ver-fs-baseline", effectiveFrom: active },
        { versionId: "ver-fs-addendum", effectiveFrom: active },
      ],
      supersessions: [
        {
          supersedingVersionId: "ver-fs-addendum",
          supersededVersionId: "ver-fs-baseline",
          effectiveFrom: dayFromNow(60),
        },
      ],
    });
    assert.equal(
      await currentItemCount(fixture),
      0,
      "a supersession that is not yet in force may not decide anything, so the pair is unorderable",
    );
    const rows = await diagnoseBoqEvidence(fixture.env.DB, { projectId: fixture.projectId, organizationId: "org-a" });
    const reasons = new Set(rows.map((row) => row.exclusionReason));
    assert.deepEqual(
      [...reasons],
      ["document version governance conflict"],
      "neither version may be reported as retired by a supersession that has not taken effect",
    );
  } finally {
    fixture.close();
  }
});
