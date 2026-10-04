// KN-SA-CORRECTION -- the governed stale-authority repair path.
//
// WHAT THIS FILE GUARDS. `knowledge_files.summary.sourceAuthority` is the gate
// that decides whether a document may mint canonical truth without a human. It
// was written once, at ingest, from a defective assessor that never received the
// document body, so every real manufacturer datasheet ingested under that defect
// stored "Unknown Source Authority" -- and there is no refresh path, because
// re-ingesting would duplicate the source under a new sha256.
//
// The repair is therefore the most trust-sensitive write in the system. A path
// that could set any file to any authority class on request would let a price
// list, a BOQ, or a competitor's own catalogue entry be promoted to manufacturer
// status with no more ceremony than an API call. These tests pin the four guards
// that prevent that:
//
//   1. only an allowlisted class is reachable;
//   2. only a stale Unknown is repairable, and a demotion to Unknown is always
//      allowed while a re-grade between manufacturer classes is not;
//   3. elevation requires a first-party signal that still exists on the stored
//      row -- a document number alone is never enough (KN-SA-5);
//   4. the write is human-attributed, reason-bearing, snapshotted, idempotent,
//      and cannot clobber a concurrent write.
//
// It also asserts the SCOPE: exactly one JSON field and one audit row change.
// A correction path that quietly touched extracted facts would be a different
// and much more dangerous tool than the one described.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assessSourceAuthorityReview,
  reviewSourceAuthority,
  MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH,
  SOURCE_AUTHORITY_REVIEW_EVENT_TYPE,
  SOURCE_AUTHORITY_REVIEW_STATUSES,
} from "../app/domain/knowledge-source-authority-review.mjs";
import {
  SOURCE_AUTHORITY_CLASSES,
  retainedFirstPartySignals,
} from "../app/domain/knowledge-source-authority.mjs";
import {
  DECLARED_BATCH1_SOURCE_AUTHORITY_CORRECTIONS,
  declaredDecisionGaps,
} from "../app/domain/knowledge-declared-decision-gaps.mjs";
import { HUMAN_ACTOR_SOURCE } from "../app/domain/human-authority.mjs";
import { asD1, createMigratedDatabase, HUMAN, testIds } from "./helpers/decision-packet-db.mjs";

const ORG = "org_decision_packets";
const UNKNOWN = SOURCE_AUTHORITY_CLASSES.UNKNOWN;
const MANUFACTURER = SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL;
const COMMERCIAL = SOURCE_AUTHORITY_CLASSES.MANUFACTURER_COMMERCIAL;

const summaryWith = (authorityClass, targetContext = undefined) =>
  JSON.stringify({
    filesProcessed: 1,
    productsLearned: 0,
    sourceAuthority: {
      authorityClass,
      evidence: authorityClass === UNKNOWN ? [] : ["ingest-time assessment"],
      assessedAt: "2026-06-01T00:00:00.000Z",
    },
    ...(targetContext ? { targetContext } : {}),
  });

/** A source file stored exactly as the ingest-time defect left it. */
const fresh = ({ authorityClass = UNKNOWN, fileName = "honeywell-350286-datasheet.pdf", targetContext } = {}) => {
  const raw = createMigratedDatabase();
  raw.prepare(
    `INSERT OR IGNORE INTO organizations (id,name,status,created_at) VALUES (?,?,'Active','2026-10-01 00:00:00')`,
  ).run(ORG, "Decision Packet Test Org");
  raw.prepare(
    `INSERT OR IGNORE INTO knowledge_files
       (id,organization_id,file_name,extension,mime_type,byte_size,sha256,object_key,detected_type,
        secondary_types,classification_confidence,classification_status,processing_status,
        extraction_version,summary,uploaded_by,uploaded_at,processed_at)
     VALUES ('knowledgeFile_sa_1',?,'${fileName}','pdf','application/pdf',2048,'sha_sa_1','key_sa_1',
             'Product Datasheet','[]',95,'Classified','Completed','v1',?,'test',
             '2026-10-01 00:00:00','2026-10-01 00:00:00')`,
  ).run(ORG, summaryWith(authorityClass, targetContext));
  return { raw, db: asD1(raw) };
};

const storedSummary = (raw, id = "knowledgeFile_sa_1") =>
  JSON.parse(raw.prepare("SELECT summary FROM knowledge_files WHERE id=?").get(id).summary);

const events = (raw) =>
  raw
    .prepare("SELECT event_type, details, actor_user_id FROM knowledge_file_events ORDER BY created_at, id")
    .all()
    .map((row) => ({ ...row, details: JSON.parse(row.details) }));

const provenance = (overrides = {}) => ({
  documentNumber: "350286",
  revision: "Rev D",
  retrievedFrom: "https://prod-edam.honeywell.com/content/dam/honeywell/..350286.pdf",
  verifiedByInspection: true,
  ...overrides,
});

const attempt = (overrides = {}) => ({
  organizationId: ORG,
  fileId: "knowledgeFile_sa_1",
  proposedAuthorityClass: MANUFACTURER,
  reason: "Opened the stored PDF; it is a first-party Honeywell product datasheet for IDP-PULL-DA.",
  humanActor: HUMAN,
  supportingProvenance: provenance(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// A. The happy path, and the exact scope of what it writes
// ---------------------------------------------------------------------------
test("KN-SA-CORRECTION/A a stale Unknown is corrected to manufacturer authority with a full before/after", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, { ...attempt(), idempotencyKey: "sa-1", newId, stamp });

  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED, result.status);
  assert.equal(result.changed, true);
  assert.equal(result.fileName, "honeywell-350286-datasheet.pdf");
  assert.equal(result.beforeAuthority.authorityClass, UNKNOWN);
  assert.equal(result.afterAuthority.authorityClass, MANUFACTURER);

  // The stored authority now carries its own correction provenance, so a later
  // reader can tell a human repair from an ingest assessment without diffing.
  const authority = storedSummary(raw).sourceAuthority;
  assert.equal(authority.authorityClass, MANUFACTURER);
  assert.equal(authority.correctedFromAuthorityClass, UNKNOWN);
  assert.equal(authority.correction.correctedBy, HUMAN.id);
  assert.equal(authority.correction.correctedByName, HUMAN.name);
  assert.equal(authority.correction.humanActorSource, HUMAN_ACTOR_SOURCE);
  assert.equal(authority.correction.reason, attempt().reason);
  assert.equal(authority.correction.supportingProvenance.documentNumber, "350286");
  assert.equal(authority.correction.supportingProvenance.verifiedByInspection, true);
  assert.ok(
    authority.correction.method.includes("document body was not retained"),
    "the correction must state the limit of its own evidence",
  );
  // The retained signals are what the elevation actually rested on.
  assert.ok(authority.evidence.length > 0);
  assert.ok(
    authority.evidence.some((signal) => /first-party|filename|url|retriev/i.test(signal)),
    "the evidence must name the retained first-party signal",
  );

  // The audit row is explicit, and it is attributed to the human.
  const audit = events(raw);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event_type, SOURCE_AUTHORITY_REVIEW_EVENT_TYPE);
  assert.equal(audit[0].actor_user_id, HUMAN.id);
  assert.equal(audit[0].details.packetKind, "source-authority");
  assert.equal(audit[0].details.previousAuthority.authorityClass, UNKNOWN);
  assert.equal(audit[0].details.correctedAuthority.authorityClass, MANUFACTURER);
  assert.equal(audit[0].details.sha256, "sha_sa_1", "the audit must pin the exact document bytes");
  assert.equal(audit[0].details.idempotencyKey, "sa-1");
  assert.ok(Array.isArray(audit[0].details.retainedFirstPartySignals));
});

test("KN-SA-CORRECTION/A the correction changes the authority field and nothing else", async () => {
  const { raw, db } = fresh();
  const fileBefore = { ...raw.prepare("SELECT * FROM knowledge_files WHERE id='knowledgeFile_sa_1'").get() };
  // An extracted fact in the same file, which the path must not disturb.
  raw.prepare(
    `INSERT INTO knowledge_facts
       (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,
        attributes,confidence,review_status,source_location,created_at)
     VALUES ('fact_sa_1',?,'knowledgeFile_sa_1','Part Number','research:obs:pn','350286','350286',
             '{}',95,'Learned','{}','2026-10-01 00:00:00')`,
  ).run(ORG);
  const factBefore = { ...raw.prepare("SELECT * FROM knowledge_facts WHERE id='fact_sa_1'").get() };

  const { newId, stamp } = testIds();
  await reviewSourceAuthority(db, { ...attempt(), idempotencyKey: "sa-scope", newId, stamp });

  const fileAfter = raw.prepare("SELECT * FROM knowledge_files WHERE id='knowledgeFile_sa_1'").get();
  const changedColumns = Object.keys(fileAfter).filter(
    (column) => JSON.stringify(fileAfter[column]) !== JSON.stringify(fileBefore[column]),
  );
  assert.deepEqual(changedColumns, ["summary"], `unexpected columns changed: ${changedColumns.join(", ")}`);

  // The facts are byte-identical. In particular no fact is re-authorised: an
  // authority change must not retroactively make previously extracted evidence
  // promotable without a second human decision on each fact.
  assert.deepEqual(
    { ...raw.prepare("SELECT * FROM knowledge_facts WHERE id='fact_sa_1'").get() },
    factBefore,
    "a source-authority correction must never modify an extracted fact",
  );
  // And nothing in the summary other than sourceAuthority moved.
  const summary = storedSummary(raw);
  assert.equal(summary.filesProcessed, 1);
  assert.equal(summary.productsLearned, 0);
  assert.equal(summary.sourceAuthority.authorityClass, MANUFACTURER);
});

test("KN-SA-CORRECTION/A a correction for a file in another organization is not found", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, {
    ...attempt(),
    organizationId: "org_someone_else",
    newId,
    stamp,
  });
  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.SOURCE_NOT_FOUND);
  assert.equal(
    storedSummary(raw).sourceAuthority.authorityClass,
    UNKNOWN,
    "a cross-tenant request must not write",
  );
  assert.equal(events(raw).length, 0);
});

// ---------------------------------------------------------------------------
// B. Guard 1 -- the allowlist
// ---------------------------------------------------------------------------
test("KN-SA-CORRECTION/B only the assessor's own classes are reachable", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  // None of these is one of the three classes the assessor can emit, once
  // whitespace is normalised. A case variant is refused: matching authority
  // classes case-insensitively would make the class set effectively open.
  const refused = [
    "manufacturer",
    "Trusted",
    "",
    "First Party",
    "Manufacturer Commercial",
    "unknown source authority",
    "manufacturer technical document",
    "Technical Document",
  ];
  for (const proposedAuthorityClass of refused) {
    const result = await reviewSourceAuthority(db, {
      ...attempt({ proposedAuthorityClass }),
      idempotencyKey: `sa-allow-${proposedAuthorityClass}`,
      newId,
      stamp,
    });
    assert.equal(
      result.status,
      SOURCE_AUTHORITY_REVIEW_STATUSES.AUTHORITY_CLASS_NOT_ALLOWED,
      `"${proposedAuthorityClass}" must not be reachable`,
    );
    assert.ok(
      result.allowedTargets.includes(MANUFACTURER) && result.allowedTargets.includes(COMMERCIAL),
      "the refusal must publish the allowlist rather than just saying no",
    );
  }
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
  assert.equal(events(raw).length, 0, "no refused request may leave an audit row that looks like a decision");

  // Whitespace around a real class is normalised to that class rather than
  // refused. That is deliberate and is NOT a free-text field: the value is
  // trimmed and then matched exactly against the three-member allowlist, so a
  // padded class name is the same class, not a new one.
  const padded = await reviewSourceAuthority(db, {
    ...attempt({ proposedAuthorityClass: "  Manufacturer Technical Document  " }),
    idempotencyKey: "sa-padded",
    newId,
    stamp,
  });
  assert.equal(padded.status, SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED);
  assert.equal(padded.afterAuthority.authorityClass, MANUFACTURER, "normalised to the canonical spelling");
});

test("KN-SA-CORRECTION/B the allowlist is exactly the classes the ingest assessor can emit", () => {
  // If the assessor gains a class, the correction path must gain it in the same
  // change. A hard-coded copy is asserted against the source of truth so the two
  // cannot drift apart silently.
  const emitted = Object.values(SOURCE_AUTHORITY_CLASSES);
  for (const value of emitted) {
    const result = assessSourceAuthorityReview({
      file: { file_name: "x.pdf", summary: summaryWith(UNKNOWN) },
      proposedAuthorityClass: value,
      reason: "A sufficiently long governed reason string for the test.",
      humanActor: HUMAN,
      supportingProvenance: provenance(),
    });
    if (value === UNKNOWN) {
      // Demotion to the class it already holds is "already at proposed", not a
      // rejection of the value itself.
      assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.ALREADY_AT_PROPOSED);
    } else {
      assert.notEqual(
        result.status,
        SOURCE_AUTHORITY_REVIEW_STATUSES.AUTHORITY_CLASS_NOT_ALLOWED,
        `${value} is emitted by the assessor and must be correctable`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// C. Guard 2 -- a repair path, not a grading tool
// ---------------------------------------------------------------------------
test("KN-SA-CORRECTION/C an already-classified source is never re-graded", async () => {
  // The class a price list was correctly given at ingest must not be promotable
  // to manufacturer status by this path. That single capability is the difference
  // between "repair a stale value" and "mint manufacturer authority on request".
  for (const [stored, proposed] of [
    [COMMERCIAL, MANUFACTURER],
    [MANUFACTURER, COMMERCIAL],
  ]) {
    const { raw, db } = fresh({ authorityClass: stored });
    const { newId, stamp } = testIds();
    const result = await reviewSourceAuthority(db, {
      ...attempt({ proposedAuthorityClass: proposed }),
      idempotencyKey: `sa-regrade-${stored}`,
      newId,
      stamp,
    });
    assert.equal(
      result.status,
      SOURCE_AUTHORITY_REVIEW_STATUSES.AUTHORITY_ALREADY_CLASSIFIED,
      `${stored} -> ${proposed} must be refused`,
    );
    assert.equal(result.currentClass, stored);
    assert.equal(result.targetClass, proposed);
    assert.equal(storedSummary(raw).sourceAuthority.authorityClass, stored, "the stored class is unchanged");
    assert.equal(events(raw).length, 0);
  }
});

test("KN-SA-CORRECTION/C demotion to Unknown is always permitted, because it only lowers trust", async () => {
  const { raw, db } = fresh({ authorityClass: MANUFACTURER });
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, {
    ...attempt({
      proposedAuthorityClass: UNKNOWN,
      reason: "On inspection this is a distributor datasheet, not a first-party manufacturer document.",
    }),
    // No first-party provenance is offered, and none is required: the request
    // removes trust rather than granting it.
    supportingProvenance: { documentNumber: "350286" },
    idempotencyKey: "sa-demote",
    newId,
    stamp,
  });
  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED);
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
  assert.equal(storedSummary(raw).sourceAuthority.correctedFromAuthorityClass, MANUFACTURER);
});

test("KN-SA-CORRECTION/C re-requesting the class the row already holds is reported as a no-op", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, {
    ...attempt({ proposedAuthorityClass: UNKNOWN }),
    idempotencyKey: "sa-noop",
    newId,
    stamp,
  });
  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.ALREADY_AT_PROPOSED);
  assert.equal(result.changed, false);
  assert.equal(events(raw).length, 0, "a no-op must not manufacture an audit row");
});

// ---------------------------------------------------------------------------
// D. Guard 3 -- elevation needs a first-party signal that still exists
// ---------------------------------------------------------------------------
test("KN-SA-CORRECTION/D a document number alone can never establish manufacturer authority", async () => {
  // This is the exact laundering vector KN-SA-5 exists to close. A project
  // number, a BOQ number, a quotation number and a price-list number are all
  // "document numbers", and all of them appear on rows whose stored authority is
  // Unknown purely because the assessor was blind.
  for (const documentNumber of ["PRJ-4417", "BOQ-2026-0112", "QUO-99881", "PL-2026-04", "350286"]) {
    const { raw, db } = fresh({
      // Deliberately NO first-party signal on the stored row: the filename is
      // neutral and no retrieval URL was recorded.
      fileName: `${documentNumber}.pdf`,
    });
    const { newId, stamp } = testIds();
    const result = await reviewSourceAuthority(db, {
      ...attempt({ supportingProvenance: { documentNumber, revision: "Rev A" } }),
      idempotencyKey: `sa-docnum-${documentNumber}`,
      newId,
      stamp,
    });
    assert.equal(
      result.status,
      SOURCE_AUTHORITY_REVIEW_STATUSES.FIRST_PARTY_EVIDENCE_REQUIRED,
      `${documentNumber} must not elevate authority on its own`,
    );
    assert.ok(result.retainedSignals, "the refusal must show what signals were checked and found absent");
    assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
  }
});

test("KN-SA-CORRECTION/D elevation is refused when a commercial first-party document is offered", async () => {
  // prod-edam.honeywell.com is the manufacturer's own domain, but a
  // first-party-hosted PRICE LIST is still commercial. Retained-signal presence
  // is necessary but not sufficient; the class it implies is what matters.
  const { raw, db } = fresh({
    fileName: "honeywell-price-list-2026.pdf",
    targetContext: { sourceUrl: "https://prod-edam.honeywell.com/pricelist/2026.pdf" },
  });
  const retained = retainedFirstPartySignals({
    fileName: "honeywell-price-list-2026.pdf",
    retrievalUrl: "https://prod-edam.honeywell.com/pricelist/2026.pdf",
  });
  // A first-party signal IS present -- and that is exactly the trap. The guard
  // that matters is the class the signal implies, not its mere existence.
  assert.equal(retained.ok, true, "the first-party signal is real");
  assert.equal(retained.commercialSignalPresent, true);
  assert.equal(
    retained.impliedAuthorityClass,
    COMMERCIAL,
    "a first-party price list implies commercial authority, not technical",
  );
  assert.equal(retained.refusals.length, 1, "the mismatch is explained, not just refused");

  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, { ...attempt(), idempotencyKey: "sa-pl", newId, stamp });
  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.FIRST_PARTY_EVIDENCE_REQUIRED);
  assert.equal(result.impliedAuthorityClass, COMMERCIAL, "the refusal states what the signals actually support");
  assert.equal(result.targetClass, MANUFACTURER);
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
  assert.equal(events(raw).length, 0);

  // Correcting it to the class the evidence DOES support is permitted: the
  // point is that the classification is derived, not requested.
  const honest = await reviewSourceAuthority(db, {
    ...attempt({ proposedAuthorityClass: COMMERCIAL }),
    idempotencyKey: "sa-pl-honest",
    newId,
    stamp,
  });
  assert.equal(honest.status, SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED);
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, COMMERCIAL);
});

test("KN-SA-CORRECTION/D a stored first-party retrieval URL is a sufficient retained signal", async () => {
  // The document body was never kept, so the ingest-time retrieval URL is one of
  // only two things that can still be checked. When it is present and technical,
  // elevation is allowed -- and the signal is recorded so the decision is
  // auditable rather than a bare assertion.
  const { raw, db } = fresh({
    fileName: "350286.pdf",
    targetContext: { sourceUrl: "https://prod-edam.honeywell.com/content/dam/honeywell/sps/siot/detectors/id-pull/350286.pdf" },
  });
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, { ...attempt(), idempotencyKey: "sa-url", newId, stamp });
  assert.equal(
    result.status,
    SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED,
    JSON.stringify(result.retainedFirstPartySignals),
  );
  assert.ok(result.retainedFirstPartySignals.some((signal) => /350286\.pdf/.test(signal)));
  // KN-SA-5 recorded rather than merely honoured: the authority object now says
  // the retained signals implied the class, so a later reader can see the
  // document number played no part in establishing it.
  assert.equal(
    storedSummary(raw).sourceAuthority.impliedByRetainedSignals,
    MANUFACTURER,
  );
  assert.equal(storedSummary(raw).sourceAuthority.documentNumberCorroborates, false);
});

test("KN-SA-CORRECTION/D the retained-signal matcher is shared with the ingest assessor", async () => {
  // The correction path must not carry its own private idea of what "first party"
  // means. If the ingest assessor tightens its matchers, the correction path has
  // to tighten with them or the two would disagree about the same document.
  const ingest = await import("../app/domain/knowledge-source-authority.mjs");
  assert.equal(
    ingest.retainedFirstPartySignals,
    retainedFirstPartySignals,
    "the correction path imports the assessor's matcher, it does not reimplement it",
  );
  const signal = retainedFirstPartySignals({
    fileName: "honeywell-350286-datasheet.pdf",
    retrievalUrl: null,
  });
  assert.equal(signal.ok, true);
  // `350286` is a bare digit run, which the document-number pattern does not
  // treat as a document number -- the corroboration flag is a report, never a
  // qualification, and is asserted so that widening it cannot silently start
  // doing the work `ok` does.
  assert.equal(signal.documentNumberCorroborates, false);
  assert.equal(
    retainedFirstPartySignals({ fileName: "6500RSE_Manual_I56-4446-001_B.pdf", retrievalUrl: null })
      .documentNumberCorroborates,
    true,
    "I56-4446-001 is a document number, so it is reported as corroborating",
  );

  // Two independent retained signals are STRONGER evidence than one. Scoring
  // them as disqualifying each other would make the best-evidenced source in the
  // library the one this path could never repair.
  const both = retainedFirstPartySignals({
    fileName: "honeywell-350286-datasheet.pdf",
    retrievalUrl: "https://prod-edam.honeywell.com/content/dam/honeywell/350286.pdf",
  });
  assert.equal(both.ok, true);
  assert.equal(both.signals.length, 2, "both signals are reported");
});

// ---------------------------------------------------------------------------
// E. Guard 4 -- human attribution, reason, idempotency, concurrency
// ---------------------------------------------------------------------------
test("KN-SA-CORRECTION/E a correction with no human identity is refused before any read of authority", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  for (const humanActor of [undefined, null, {}, { id: "" }, { id: "   " }]) {
    const result = await reviewSourceAuthority(db, { ...attempt({ humanActor }), newId, stamp });
    assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.HUMAN_ACTOR_REQUIRED);
  }
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
  assert.equal(events(raw).length, 0);
});

test("KN-SA-CORRECTION/E a thin reason is refused", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  for (const reason of ["ok", "fix", "  "]) {
    const result = await reviewSourceAuthority(db, { ...attempt({ reason }), newId, stamp });
    assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.REASON_REQUIRED, `reason "${reason}"`);
  }
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
});

test("KN-SA-CORRECTION/E an ELEVATION demands a longer reason than a routine decision", async () => {
  // The base governed-reason gate is 5 characters, which is right for "matches
  // datasheet" and wrong for the write that decides whether a document may mint
  // canonical truth unattended. The elevation gets its own bar; a demotion does
  // not, because discouraging the cautious call is its own harm.
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  const thinButNotTrivial = "first party datasheet, prod-edam";
  const thin = await reviewSourceAuthority(db, {
    ...attempt({ reason: "looks right" }),
    newId,
    stamp,
  });
  assert.equal(thin.status, SOURCE_AUTHORITY_REVIEW_STATUSES.ELEVATION_REASON_REQUIRED);
  assert.equal(thin.minimumReasonLength, MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH);
  assert.equal(thin.reasonLength, "looks right".length, "the refusal reports the shortfall, not just 'too short'");
  // Longer than the base gate but shorter than the elevation bar is still
  // refused -- this is a distinct rule, not a restatement of the 5-character one.
  assert.ok(
    thinButNotTrivial.length > 5 && thinButNotTrivial.length < MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH,
    "the fixture must sit between the two thresholds",
  );
  const between = await reviewSourceAuthority(db, {
    ...attempt({ reason: thinButNotTrivial }),
    newId,
    stamp,
  });
  assert.equal(between.status, SOURCE_AUTHORITY_REVIEW_STATUSES.ELEVATION_REASON_REQUIRED);
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);

  // A demotion of the same class of reason is still accepted, and needs only the
  // base bar. It has to start from a classified row -- a row already at Unknown
  // has nothing to demote -- so this uses a second database.
  const classified = fresh({ authorityClass: MANUFACTURER });
  const demote = await reviewSourceAuthority(classified.db, {
    ...attempt({ proposedAuthorityClass: UNKNOWN, reason: "looks wrong" }),
    newId,
    stamp,
  });
  assert.equal(demote.status, SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED);
  assert.equal(
    storedSummary(classified.raw).sourceAuthority.authorityClass,
    UNKNOWN,
    "a wrongly elevated source must always have a way back down",
  );
});

test("KN-SA-CORRECTION/E a missing-evidence refusal outranks a thin reason", async () => {
  // Ordering matters for what the reviewer is told. "Your reason is too short"
  // is unhelpful advice when the real problem is that no first-party signal
  // survives on the row at all.
  const { db } = fresh({ fileName: "PRJ-4417.pdf" });
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(db, {
    ...attempt({ reason: "looks right", supportingProvenance: { documentNumber: "PRJ-4417" } }),
    newId,
    stamp,
  });
  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.FIRST_PARTY_EVIDENCE_REQUIRED);
});

test("KN-SA-CORRECTION/E provenance is required, so a bare 'it is a datasheet' is not a correction", async () => {
  const { raw, db } = fresh();
  const { newId, stamp } = testIds();
  for (const supportingProvenance of [undefined, null, {}, { verifiedByInspection: true }]) {
    const result = await reviewSourceAuthority(db, { ...attempt({ supportingProvenance }), newId, stamp });
    assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.SUPPORTING_PROVENANCE_REQUIRED);
  }
  assert.equal(storedSummary(raw).sourceAuthority.authorityClass, UNKNOWN);
});

test("KN-SA-CORRECTION/E replaying the same correction writes nothing a second time", async () => {
  const { raw, db } = fresh();
  const first = testIds();
  const done = await reviewSourceAuthority(db, { ...attempt(), idempotencyKey: "sa-replay", ...first });
  assert.equal(done.status, SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED);
  const summaryAfterFirst = JSON.stringify(storedSummary(raw));

  const replay = await reviewSourceAuthority(db, { ...attempt(), idempotencyKey: "sa-replay", ...testIds() });
  assert.equal(replay.status, SOURCE_AUTHORITY_REVIEW_STATUSES.IDEMPOTENT_REPLAY);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.eventId, done.eventId, "the replay points at the original audit row");
  assert.equal(
    JSON.stringify(storedSummary(raw)),
    summaryAfterFirst,
    "a replay must not re-stamp assessedAt, which would make every retry look like a new assessment",
  );
  assert.equal(events(raw).length, 1, "a replay must not append a second audit row");
});

test("KN-SA-CORRECTION/E a concurrent write to the same file is not clobbered", async () => {
  const { raw, db } = fresh();
  // Simulate another governed writer touching `summary` between this path's read
  // and its write. The optimistic-concurrency guard must refuse rather than
  // overwrite that change, and must say so distinctly from an idempotent replay
  // -- a clobber is a lost update, which is a different incident.
  //
  // The interception has to wrap `bind()` as well as `prepare()`: the real code
  // path is `db.prepare(sql).bind(...).run()`, so wrapping only `prepare` yields
  // an object whose `run` is never the one under test, and the guard silently
  // goes unexercised.
  const wrap = (statement) => ({
    ...statement,
    bind: (...args) => wrap(statement.bind(...args)),
    run: async () => {
      const summary = JSON.parse(
        raw.prepare("SELECT summary FROM knowledge_files WHERE id='knowledgeFile_sa_1'").get().summary,
      );
      summary.detectedBy = "another-writer";
      raw
        .prepare("UPDATE knowledge_files SET summary=? WHERE id='knowledgeFile_sa_1'")
        .run(JSON.stringify(summary));
      return statement.run();
    },
  });
  const intercepted = {
    prepare: (sql) => {
      const prepared = db.prepare(sql);
      return sql.startsWith("UPDATE knowledge_files") ? wrap(prepared) : prepared;
    },
  };
  const { newId, stamp } = testIds();
  const result = await reviewSourceAuthority(intercepted, { ...attempt(), idempotencyKey: "sa-race", newId, stamp });
  assert.equal(result.status, SOURCE_AUTHORITY_REVIEW_STATUSES.IDEMPOTENT_REPLAY);
  assert.equal(result.concurrentModification, true, "a lost update must be reported as such");
  const summary = storedSummary(raw);
  assert.equal(summary.detectedBy, "another-writer", "the other writer's change survives");
  assert.equal(summary.sourceAuthority.authorityClass, UNKNOWN, "and no correction was applied over it");
  assert.equal(events(raw).length, 0, "a refused write must not leave an audit row claiming a correction");
});

// ---------------------------------------------------------------------------
// F. The declared Batch-1 corrections are exactly the ones this path allows
// ---------------------------------------------------------------------------
test("KN-SA-CORRECTION/F the declared Batch-1 corrections pass this path's own assessment", async () => {
  const declared = DECLARED_BATCH1_SOURCE_AUTHORITY_CORRECTIONS;
  assert.ok(declared.length > 0, "Batch 1 proved files stale; dropping them would hide the finding");
  for (const correction of declared) {
    assert.ok(correction.fileNamePattern, "a declared correction must name the exact stored filename");
    assert.ok(correction.documentNumber, "and the document number it was inspected under");
    assert.ok(correction.revision, "and the revision, so a later reader can detect a superseded edition");
    assert.ok(correction.retrievalChannel, "and the channel it was retrieved from");
    assert.ok(
      correction.reason.length >= MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH,
      `${correction.fileNamePattern} must justify the elevation at the elevation bar`,
    );
    assert.ok(
      Object.values(SOURCE_AUTHORITY_CLASSES).includes(correction.proposedAuthorityClass),
      `${correction.fileNamePattern} proposes a class outside the allowlist`,
    );
    assert.equal(
      correction.expectedCurrentAuthorityClass,
      UNKNOWN,
      `${correction.fileNamePattern} is a stale-Unknown repair; anything else is a re-grade`,
    );

    // The assessment is re-derived from the declared inputs rather than trusted,
    // so a declaration cannot assert an outcome the guards would refuse.
    const result = assessSourceAuthorityReview({
      file: {
        file_name: correction.fileNamePattern,
        summary: summaryWith(UNKNOWN, { sourceUrl: correction.retrievalChannel }),
      },
      proposedAuthorityClass: correction.proposedAuthorityClass,
      reason: correction.reason,
      humanActor: HUMAN,
      supportingProvenance: {
        documentNumber: correction.documentNumber,
        revision: correction.revision,
        retrievedFrom: correction.retrievalChannel,
        verifiedByInspection: true,
      },
    });
    assert.equal(
      result.allowed,
      true,
      `${correction.fileNamePattern} is declared correctable but the guards refuse it: ${result.status}`,
    );
    assert.ok(
      result.retainedSignals.length > 0,
      "an elevation must record the retained signal it rested on",
    );
  }
});

test("KN-SA-CORRECTION/F the declared corrections are a subset of Batch 1's gaps, not new findings", () => {
  // Scope discipline: this path is invoked per proven-stale file, never as a
  // sweep. The declared list therefore has to stay short enough that a human
  // inspected each one; a list that grew to cover every Unknown row would have
  // become a bulk update by another name.
  const declared = DECLARED_BATCH1_SOURCE_AUTHORITY_CORRECTIONS;
  assert.ok(
    declared.length <= 3,
    `${declared.length} declared corrections is no longer a per-file inspection`,
  );
  const unique = new Set(declared.map((correction) => correction.fileNamePattern));
  assert.equal(unique.size, declared.length, "each file appears once");
  // And they must not overlap the declared evidence gaps, which are a different
  // kind of finding: a gap says the document was silent, not that it was misfiled.
  const gapKeys = new Set(declaredDecisionGaps().map((gap) => `${gap.partNumber}::${gap.category}`));
  for (const correction of declared) {
    assert.ok(
      !gapKeys.has(`${correction.partNumber}::${correction.category}`),
      `${correction.fileNamePattern} is a source-authority repair, not an evidence gap`,
    );
  }
});
