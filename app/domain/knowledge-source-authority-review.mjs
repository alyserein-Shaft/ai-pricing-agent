// KN-SA-CORRECTION -- governed correction of a STALE stored source authority.
//
// THE DEFECT THIS REPAIRS. `knowledge_files.summary.sourceAuthority` is written
// exactly once, at ingest, by `assessKnowledgeSourceAuthority`. Before the
// `sample.text` defect in `knowledge-library-engine.mjs` was fixed, the assessor
// received `undefined` for the document body, so every real manufacturer
// datasheet ingested under that defect stored
// `authorityClass: "Unknown Source Authority"`. The assessor is now correct, but
// those rows are frozen: there is no refresh path, and re-ingesting would
// duplicate the source under a different `sha256`.
//
// WHY THIS IS NOT A BULK UPDATE. Direct-SQL-touching `summary` was the obvious
// move and it is exactly wrong. Authority is the gate that decides whether a
// document may mint canonical truth without a human, so "change this field" is a
// trust decision. It therefore goes through a narrow, audited, allowlisted,
// human-attributed operation with a before/after snapshot -- the same shape as
// every other governed decision in this codebase.
//
// THE FOUR GUARDS. Each one closes a specific way this path could be abused to
// launder trust:
//
//   1. ALLOWLISTED TARGETS. Only the three classes the assessor can emit are
//      reachable; there is no free-text authority field.
//   2. NO RE-CLASSIFICATION. Only `Unknown` may be corrected, and only downwards
//      to `Unknown`. Once a row holds a manufacturer class, this path refuses to
//      touch it: it is a stale-value repair, not a grading tool, and a tool that
//      can re-grade is a tool that can elevate a price list on request.
//   3. RETAINED FIRST-PARTY SIGNAL REQUIRED. The document body is gone, so an
//      elevation must show a first-party signal that still exists on the stored
//      row -- the original filename or the first-party retrieval URL recorded at
//      ingest, matched with the assessor's own matchers. A bare document number
//      is explicitly NOT sufficient (KN-SA-5 binds here too), which is what
//      stops a project number from becoming manufacturer authority.
//   4. HUMAN ATTRIBUTION + SUBSTANTIVE REASON + SNAPSHOT. The actor comes from
//      server configuration only (never a request field), the reason is
//      substantive, and both the previous and the corrected authority class are
//      written to `knowledge_file_events`.
//
// SCOPE DISCIPLINE. It writes `summary.sourceAuthority` and one audit row. It
// never touches `knowledge_facts`, never re-ingests, never rewrites
// `detected_type`, and is invoked per file -- there is no bulk mode, by design.

import {
  SOURCE_AUTHORITY_CLASSES,
  retainedFirstPartySignals,
  storedSourceAuthority,
} from "./knowledge-source-authority.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { isHumanDecisionActor, humanDecisionActorRefusal } from "./human-authority.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const parse = (value, fallback = {}) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const SOURCE_AUTHORITY_REVIEW_EVENT_TYPE = "Knowledge Source Authority Correction";

/**
 * Raising a document's authority class is the highest-consequence write in the
 * Knowledge library: it is the gate that decides whether that document's
 * extracted facts may mint canonical truth WITHOUT a human. The shared
 * `MIN_GOVERNED_REASON_LENGTH` of 5 is right for a routine review decision
 * ("matches datasheet") and wrong here, where it would accept "looks right" as
 * the authorisation to change it.
 *
 * This follows the existing precedent in `reason-governance.mjs`
 * (`MIN_SAFETY_OVERRIDE_REASON_LENGTH` for the one materially higher-risk action
 * that needed more than a length check), and is scoped the same way: it applies
 * ONLY to an elevation. A demotion lowers trust and leaves the base gate alone,
 * because requiring a long essay to say "this is not what I thought it was"
 * would only discourage the cautious call.
 */
export const MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH = 40;

const ALLOWED_TARGETS = Object.freeze(Object.values(SOURCE_AUTHORITY_CLASSES));
const MANUFACTURER_CLASSES = Object.freeze(
  ALLOWED_TARGETS.filter((value) => value !== SOURCE_AUTHORITY_CLASSES.UNKNOWN),
);

export const SOURCE_AUTHORITY_REVIEW_STATUSES = Object.freeze({
  CORRECTED: "CORRECTED",
  ALREADY_AT_PROPOSED: "ALREADY_AT_PROPOSED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  SOURCE_NOT_FOUND: "SOURCE_NOT_FOUND",
  AUTHORITY_CLASS_NOT_ALLOWED: "AUTHORITY_CLASS_NOT_ALLOWED",
  AUTHORITY_ALREADY_CLASSIFIED: "AUTHORITY_ALREADY_CLASSIFIED",
  FIRST_PARTY_EVIDENCE_REQUIRED: "FIRST_PARTY_EVIDENCE_REQUIRED",
  SUPPORTING_PROVENANCE_REQUIRED: "SUPPORTING_PROVENANCE_REQUIRED",
  REASON_REQUIRED: "REASON_REQUIRED",
  ELEVATION_REASON_REQUIRED: "ELEVATION_REASON_REQUIRED",
  HUMAN_ACTOR_REQUIRED: "HUMAN_ACTOR_REQUIRED",
});

/**
 * Pure decision function: what WOULD happen, given a stored row and a request.
 * Exported so every guard is testable without a database, and so the route can
 * show the engineer the refusal reason before anything is written.
 */
export const assessSourceAuthorityReview = (input = {}) => {
  const file = input.file || {};
  const storedSummary = typeof file.summary === "string" ? file.summary : JSON.stringify(file.summary || {});
  const summary = parse(storedSummary);
  const stored = storedSourceAuthority({ summary });
  const currentClass = stored?.authorityClass || SOURCE_AUTHORITY_CLASSES.UNKNOWN;
  const targetClass = clean(input.proposedAuthorityClass);
  const reason = clean(input.reason);
  const provenance = input.supportingProvenance || {};
  const provenanceSignals = [
    clean(provenance.documentNumber) ? `document number ${clean(provenance.documentNumber)}` : "",
    clean(provenance.revision) ? `revision ${clean(provenance.revision)}` : "",
    clean(provenance.retrievedFrom) ? `retrieved from ${clean(provenance.retrievedFrom)}` : "",
  ].filter(Boolean);

  if (!isHumanDecisionActor(input.humanActor)) {
    // Checked FIRST, before the reason bar and before any read of the stored
    // authority. This is the write that decides whether a document may mint
    // canonical truth unattended, so the refusal has to be about authority
    // rather than about whatever else happens to be wrong with the request.
    return {
      allowed: false,
      changed: false,
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.HUMAN_ACTOR_REQUIRED,
      actorRefusal: humanDecisionActorRefusal(input.humanActor),
    };
  }
  if (reason.length < MIN_GOVERNED_REASON_LENGTH) {
    return { allowed: false, status: SOURCE_AUTHORITY_REVIEW_STATUSES.REASON_REQUIRED };
  }
  if (!ALLOWED_TARGETS.includes(targetClass)) {
    return {
      allowed: false,
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.AUTHORITY_CLASS_NOT_ALLOWED,
      allowedTargets: ALLOWED_TARGETS,
    };
  }
  if (!provenanceSignals.length) {
    return {
      allowed: false,
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.SUPPORTING_PROVENANCE_REQUIRED,
    };
  }

  if (currentClass === targetClass) {
    return {
      allowed: false,
      changed: false,
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.ALREADY_AT_PROPOSED,
      currentClass,
      targetClass,
    };
  }

  // Guard 2. Only a stale UNKNOWN may be REPAIRED, and a manufacturer-to-
  // manufacturer re-grade is refused outright. One case is deliberately exempt
  // because it lowers trust rather than raising it: a demotion to Unknown.
  // Gating that behind a stale value would leave a wrongly elevated source with
  // no way back down, which is the opposite of a conservative guard.
  //
  // The re-grade refusal is the case that matters. A tool that can re-grade is a
  // tool that can promote a price list to manufacturer technical status on
  // request, which is the whole reason this path exists in this shape rather
  // than as a bulk UPDATE.
  const isDemotion = targetClass === SOURCE_AUTHORITY_CLASSES.UNKNOWN;
  if (currentClass !== SOURCE_AUTHORITY_CLASSES.UNKNOWN && !isDemotion) {
    return {
      allowed: false,
      changed: false,
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.AUTHORITY_ALREADY_CLASSIFIED,
      currentClass,
      targetClass,
    };
  }
  if (MANUFACTURER_CLASSES.includes(targetClass)) {
    // Guard 3. Elevation requires retained first-party evidence. The document
    // body was never retained, so the filename and the recorded retrieval URL
    // are the whole of what can still be checked.
    //
    // Checked BEFORE the reason bar, so a request that is going to be refused
    // anyway fails on the reason that actually matters -- no first-party signal
    // survives at all -- rather than on a length rule the reviewer could satisfy
    // by writing more words about nothing.
    const retained = retainedFirstPartySignals({
      fileName: file.file_name,
      retrievalUrl: summary?.targetContext?.sourceUrl,
    });
    if (!retained.ok) {
      return {
        allowed: false,
        changed: false,
        status: SOURCE_AUTHORITY_REVIEW_STATUSES.FIRST_PARTY_EVIDENCE_REQUIRED,
        currentClass,
        targetClass,
        impliedAuthorityClass: retained.impliedAuthorityClass,
        retainedSignals: retained.signals,
      };
    }
    // The retained signals have to IMPLY the class being requested, not merely
    // be consistent with it. A first-party price list carries a first-party
    // signal; it does not carry a technical one, and this guard is what keeps
    // the commercial regression protection attached to the correction path.
    if (retained.impliedAuthorityClass !== targetClass) {
      return {
        allowed: false,
        changed: false,
        status: SOURCE_AUTHORITY_REVIEW_STATUSES.FIRST_PARTY_EVIDENCE_REQUIRED,
        currentClass,
        targetClass,
        impliedAuthorityClass: retained.impliedAuthorityClass,
        retainedSignals: retained.signals,
        refusals: retained.refusals,
      };
    }
    if (reason.length < MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH) {
      return {
        allowed: false,
        changed: false,
        status: SOURCE_AUTHORITY_REVIEW_STATUSES.ELEVATION_REASON_REQUIRED,
        minimumReasonLength: MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH,
        reasonLength: reason.length,
        currentClass,
        targetClass,
        retainedSignals: retained.signals,
      };
    }
    return {
      allowed: true,
      changed: true,
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED,
      currentClass,
      targetClass,
      retainedSignals: retained.signals,
      documentNumberCorroborates: retained.documentNumberCorroborates,
      impliedAuthorityClass: retained.impliedAuthorityClass,
    };
  }
  // Demotion to Unknown is always permitted: it only lowers trust.
  return {
    allowed: true,
    changed: true,
    status: SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED,
    currentClass,
    targetClass,
    impliedAuthorityClass: SOURCE_AUTHORITY_CLASSES.UNKNOWN,
    retainedSignals: ["demotion to Unknown Source Authority reduces trust and is always permitted"],
  };
};

/**
 * Apply the correction. Writes the source-authority field inside the governed
 * summary representation and one audit event. Nothing else.
 */
export const reviewSourceAuthority = async (
  db,
  {
    organizationId,
    fileId,
    proposedAuthorityClass,
    reason,
    humanActor,
    supportingProvenance,
    idempotencyKey = null,
    newId,
    stamp = () => new Date().toISOString(),
  } = {},
) => {
  const org = clean(organizationId);
  const id = clean(fileId);
  if (!org || !id) {
    return { status: SOURCE_AUTHORITY_REVIEW_STATUSES.SOURCE_NOT_FOUND };
  }
  const file = await db
    .prepare(
      "SELECT id, file_name, detected_type, summary, sha256 FROM knowledge_files WHERE id=? AND organization_id=? LIMIT 1",
    )
    .bind(id, org)
    .first();
  if (!file) {
    return { status: SOURCE_AUTHORITY_REVIEW_STATUSES.SOURCE_NOT_FOUND, fileId: id };
  }

  const key = clean(idempotencyKey);
  if (key) {
    const prior = await db
      .prepare(
        "SELECT id FROM knowledge_file_events WHERE organization_id=? AND event_type=? AND json_extract(details,'$.idempotencyKey')=? LIMIT 1",
      )
      .bind(org, SOURCE_AUTHORITY_REVIEW_EVENT_TYPE, key)
      .first();
    if (prior) {
      return {
        status: SOURCE_AUTHORITY_REVIEW_STATUSES.IDEMPOTENT_REPLAY,
        fileId: id,
        idempotent: true,
        eventId: prior.id,
      };
    }
  }

  const assessment = assessSourceAuthorityReview({
    file,
    proposedAuthorityClass,
    reason,
    humanActor,
    supportingProvenance,
  });
  if (!assessment.allowed) {
    return {
      ...assessment,
      fileId: id,
      fileName: file.file_name,
      detectedType: file.detected_type,
    };
  }

  const rawSummary = typeof file.summary === "string" ? file.summary : JSON.stringify(file.summary || {});
  const summary = parse(rawSummary);
  const before = storedSourceAuthority({ summary }) || {
    authorityClass: SOURCE_AUTHORITY_CLASSES.UNKNOWN,
    evidence: [],
  };
  const assessedAt = stamp();
  const nextSummary = {
    ...summary,
    sourceAuthority: {
      authorityClass: assessment.targetClass,
      evidence: assessment.retainedSignals,
      // KN-SA-5, recorded rather than merely honoured: the document number was
      // corroboration and is persisted as such, so a later reader can see that
      // it played no part in establishing the class.
      ...(assessment.documentNumberCorroborates === undefined
        ? {}
        : { documentNumberCorroborates: assessment.documentNumberCorroborates }),
      ...(assessment.retainedSignals.length && assessment.impliedAuthorityClass
        ? { impliedByRetainedSignals: assessment.impliedAuthorityClass }
        : {}),
      assessedAt,
      // Explicit provenance for the correction itself, so a later reader can
      // tell an ingest-time assessment from a human repair without diffing.
      correctedFromAuthorityClass: before.authorityClass || null,
      correction: {
        correctedBy: clean(humanActor?.id),
        correctedByName: clean(humanActor?.name),
        correctedAt: assessedAt,
        humanActorSource: clean(humanActor?.source),
        reason: clean(reason),
        supportingProvenance: {
          documentNumber: clean(supportingProvenance?.documentNumber) || null,
          revision: clean(supportingProvenance?.revision) || null,
          retrievedFrom: clean(supportingProvenance?.retrievedFrom) || null,
          verifiedByInspection: supportingProvenance?.verifiedByInspection === true,
        },
        method: "governed correction path (KN-SA-CORRECTION): document body was not retained, so the correction rests on retained first-party signals plus human inspection",
      },
    },
  };

  const eventId = newId("knowledgeEvent");
  const details = {
    packetKind: "source-authority",
    sourceFileId: id,
    fileName: file.file_name,
    detectedType: file.detected_type,
    sha256: file.sha256,
    previousAuthority: before,
    correctedAuthority: nextSummary.sourceAuthority,
    retainedFirstPartySignals: assessment.retainedSignals,
    reason: clean(reason),
    decidedBy: clean(humanActor?.id),
    decidedByName: clean(humanActor?.name),
    humanActorSource: clean(humanActor?.source),
    ...(key ? { idempotencyKey: key } : {}),
  };

  // Optimistic concurrency on the exact stored summary string: if anything else
  // wrote to this row between the read and this write, the UPDATE matches
  // nothing and the correction is refused rather than clobbering that change.
  const update = db
    .prepare("UPDATE knowledge_files SET summary=? WHERE id=? AND organization_id=? AND summary=?")
    .bind(JSON.stringify(nextSummary), id, org, rawSummary);
  const audit = db
    .prepare(
      "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
    )
    .bind(eventId, org, id, SOURCE_AUTHORITY_REVIEW_EVENT_TYPE, JSON.stringify(details), clean(humanActor?.id));

  const applied = await update.run();
  const changed = Number(applied?.meta?.changes ?? 0);
  if (changed !== 1) {
    return {
      status: SOURCE_AUTHORITY_REVIEW_STATUSES.IDEMPOTENT_REPLAY,
      fileId: id,
      idempotent: true,
      concurrentModification: true,
    };
  }
  await audit.run();
  return {
    status: SOURCE_AUTHORITY_REVIEW_STATUSES.CORRECTED,
    changed: true,
    fileId: id,
    fileName: file.file_name,
    eventId,
    beforeAuthority: before,
    afterAuthority: nextSummary.sourceAuthority,
    retainedFirstPartySignals: assessment.retainedSignals,
  };
};
