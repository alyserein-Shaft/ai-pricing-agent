// DOC-R2A.4.3 — ENGINEERING FACT FRESHNESS INVALIDATION
// Application-layer invalidation trigger when upstream extraction versions are superseded
// Only invalidates facts where ALL extraction-based provenances are superseded AND no authoritative non-extraction provenance exists

const EXTRACTION_PROVENANCE_SQL = `
  efp.extraction_version_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM boq_extraction_versions bev WHERE bev.id=efp.extraction_version_id)
    OR EXISTS (SELECT 1 FROM specification_extraction_versions sev WHERE sev.id=efp.extraction_version_id)
  )`;

export async function invalidateEngineeringFactsOnExtractionSuperseded(db, supersededExtractionIds) {
  if (!supersededExtractionIds?.length) return { invalidated: 0, checked: 0 };

  const ids = Array.isArray(supersededExtractionIds) ? supersededExtractionIds : [supersededExtractionIds];
  let invalidated = 0;
  let checked = 0;
  const placeholders = ids.map(() => '?').join(',');

  // A provenance row is extraction-dependent by lineage, not by a brittle
  // source-type string. Both BOQ and specification extraction IDs are valid
  // provenance authorities, including Source Fact rows.
  const affectedFactIds = await db.prepare(`
    SELECT DISTINCT efp.fact_id
    FROM engineering_fact_provenance efp
    WHERE efp.extraction_version_id IN (${placeholders})
      AND ${EXTRACTION_PROVENANCE_SQL}
  `).bind(...ids).all();

  if (!affectedFactIds?.results?.length) return { invalidated: 0, checked: 0 };

  for (const { fact_id } of affectedFactIds.results) {
    checked++;

    const currentExtractionProvs = await db.prepare(`
      SELECT COUNT(*) as cnt
      FROM engineering_fact_provenance efp
      WHERE efp.fact_id = ?
        AND ${EXTRACTION_PROVENANCE_SQL}
        AND (
          EXISTS (SELECT 1 FROM boq_extraction_versions bev WHERE bev.id=efp.extraction_version_id AND bev.superseded_at IS NULL)
          OR EXISTS (SELECT 1 FROM specification_extraction_versions sev WHERE sev.id=efp.extraction_version_id AND sev.superseded_at IS NULL)
        )
    `).bind(fact_id).first();

    const nonExtractionProvs = await db.prepare(`
      SELECT COUNT(*) as cnt
      FROM engineering_fact_provenance efp
      WHERE efp.fact_id = ?
        AND NOT (${EXTRACTION_PROVENANCE_SQL})
    `).bind(fact_id).first();

    const hasCurrentExtractionProv = Number(currentExtractionProvs?.cnt || 0) > 0;
    const hasNonExtractionProv = Number(nonExtractionProvs?.cnt || 0) > 0;

    if (!hasCurrentExtractionProv && !hasNonExtractionProv) {
      // 'Pending Review' is included, and deliberately so. A Source Fact is
      // created at 'Pending Review' and only becomes 'Active' when a human
      // confirms it. Both invalidators below previously filtered
      // `status = 'Active'` only, so superseding an extraction left every
      // not-yet-confirmed fact pointing at it completely untouched -- and the
      // confirmation path had no lineage check of its own, so the fact could
      // then be promoted to authoritative and flow into BOM and pricing. A
      // 'Pending Review' fact carries no recorded human decision yet (that is
      // what confirmation records), so superseding it erases no decision and no
      // audit trail; it only marks evidence that can no longer be trusted.
      // 'Rejected' and 'Superseded' rows are left alone: they are already
      // terminal and were never usable downstream.
      const result = await db.prepare(`
        UPDATE engineering_facts
        SET status = 'Superseded',
            superseded_by_id = NULL,
            change_reason = 'All source extractions superseded',
            changed_by = 'system:engineering-fact-freshness',
            effective_to = ?
        WHERE id = ? AND status IN ('Active', 'Pending Review')
      `).bind(new Date().toISOString(), fact_id).run();
      invalidated += Number(result?.meta?.changes ?? result?.changes ?? 0);
    }
  }

  return { invalidated, checked };
}

export async function checkEngineeringFactFreshness(db, factId) {
  const fact = await db.prepare('SELECT * FROM engineering_facts WHERE id = ?').bind(factId).first();
  if (!fact) return { freshness: 'Unknown', reason: 'Fact not found' };

  if (fact.status !== 'Active' || fact.superseded_by_id) {
    return { freshness: 'Superseded', reason: fact.status === 'Superseded' ? 'Explicitly superseded' : 'Not active' };
  }

  const extractionProvs = await db.prepare(`
    SELECT efp.source_type, efp.extraction_version_id, efp.source_id,
           bev.superseded_at as boq_extraction_superseded,
           sev.superseded_at as specification_extraction_superseded,
           bev.version_number as boq_extraction_version,
           sev.version_number as specification_extraction_version
    FROM engineering_fact_provenance efp
    LEFT JOIN boq_extraction_versions bev ON bev.id = efp.extraction_version_id
    LEFT JOIN specification_extraction_versions sev ON sev.id = efp.extraction_version_id
    WHERE efp.fact_id = ? AND ${EXTRACTION_PROVENANCE_SQL}
  `).bind(factId).all();

  const nonExtractionProvs = await db.prepare(`
    SELECT source_type, source_id
    FROM engineering_fact_provenance efp
    WHERE efp.fact_id = ? AND NOT (${EXTRACTION_PROVENANCE_SQL})
  `).bind(factId).all();

  const staleProvenances = [];
  const currentProvenances = [];

  for (const prov of extractionProvs.results || []) {
    const entry = {
      source_type: prov.source_type,
      source_id: prov.source_id,
      extraction_version_id: prov.extraction_version_id,
      extraction_version: prov.boq_extraction_version ?? prov.specification_extraction_version,
    };
    if (prov.boq_extraction_superseded || prov.specification_extraction_superseded) staleProvenances.push(entry);
    else currentProvenances.push(entry);
  }

  const hasCurrentExtractionProv = currentProvenances.length > 0;
  const hasNonExtractionProv = nonExtractionProvs.results.length > 0;
  let freshness;
  const reasons = [];

  if (!hasCurrentExtractionProv && !hasNonExtractionProv) {
    freshness = 'Stale';
    reasons.push('All extraction provenances superseded, no authoritative non-extraction provenance');
  } else if (!hasCurrentExtractionProv && hasNonExtractionProv) {
    freshness = 'Stale (but supported)';
    reasons.push('All extraction provenances superseded, but non-extraction authoritative provenance exists');
  } else if (hasCurrentExtractionProv) {
    freshness = 'Fresh';
  } else {
    freshness = 'Unknown';
  }

  return { freshness, reasons, staleProvenances, currentProvenances, nonExtractionProvenances: nonExtractionProvs.results || [] };
}

// ---------------------------------------------------------------------------
// DOC-R3 — EXACT dependency impact of a document supersession.
// ---------------------------------------------------------------------------

// The value-level twin of app/domain/effective-time-policy.mjs's
// `inForceWindowSql(alias)`, for a supersession supplied as values rather than
// reached through an alias. The two MUST agree: an absent start is open-past,
// an absent end is open-future, and a start strictly in the future is not yet
// in force. A day-granularity bound is read as the START of that day, matching
// `effectiveBoundInstant`, so a supersession dated today is in force today.
const isWindowInForce = (window, now = new Date()) => {
  const instant = (value) => {
    if (value == null || String(value).trim() === "") return null;
    const text = String(value).trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  };
  const from = instant(window?.effective_from);
  const to = instant(window?.effective_to);
  const at = now.getTime();
  return (from == null || from <= at) && (to == null || to > at);
};

// A supersession retires evidence over a declared scope. Which engineering facts
// that touches is a question about IDENTITY, not similarity, and the two are not
// interchangeable. Scope equality alone is not proof of dependency: two facts can
// come from the same document, the same extraction and the same section string
// and still be unrelated to the row that was replaced.
//
// The repository was audited for a deterministic path from each scope type to a
// fact's provenance. What provably exists, and what does not:
//
//   FULL_DOCUMENT   EXACT. A real foreign-key path:
//                   document_supersessions -> document_versions ->
//                   boq_extraction_versions / specification_extraction_versions ->
//                   engineering_fact_provenance.extraction_version_id -> fact_id.
//
//   BOQ_ROW         EXACT. For `source_type = 'Approved BOQ Extraction'` the
//                   provenance's `source_id` is a real `boq_items` primary key, so
//                   equality is identity. It must additionally be resolved within
//                   the SUPERSEDED version's lineage, because re-extraction mints
//                   fresh `boq_items` ids, so a bare id comparison would silently
//                   match nothing after a re-extraction.
//
//   SECTION         NOT EXACT. `provenance.section` is an unnormalized,
//                   human-facing display string copied from the extractor. Real
//                   values in one column mix a numeric code ("28 46 00") and a
//                   prose label ("SK/IDP BASES"). There is no normalization
//                   helper and no uniqueness guarantee.
//
//   CLAUSE          NOT EXACT. `provenance.clause` is a bare number ("5") that is
//                   unique only within one extraction version. Two documents both
//                   have a clause "5".
//
//   EVIDENCE_ENTITY  NOT REACHABLE. Drawing entities do have stable keys
//                   (`occurrence_key`, `definition_key`), but no drawing entity id
//                   is ever written into provenance, so the join is empty rather
//                   than approximate.
//
//   DRAWING_REGION  GEOMETRY-ONLY. `provenance.bounding_box` is never populated by
//                   any write in the repository, and box-overlap testing is
//                   tolerance-dependent and non-deterministic in any case.
//
// For the scopes with no exact identity the correct outcome is a REPORTED
// "impact unknown, requires review" -- never a silent no-op, and never a fuzzy
// match that would look like a success. Automatic invalidation is authorized for
// the exact scopes only.
export const SUPERSESSION_IMPACT_POLICY = Object.freeze({
  FULL_DOCUMENT: {
    resolution: "exact",
    reason: "Resolved through extraction-version lineage, a real foreign-key path from the superseded version to fact provenance.",
  },
  BOQ_ROW: {
    resolution: "exact",
    reason: "Resolved by boq_items primary key within the superseded version's extraction lineage.",
  },
  SECTION: {
    resolution: "unresolved-identity",
    reason: "No section identity reaches provenance: engineering_fact_provenance.section is an unnormalized human-facing display string, so matching it would be a fuzzy match. Requires review.",
  },
  CLAUSE: {
    resolution: "unresolved-identity",
    reason: "No clause identity reaches provenance: engineering_fact_provenance.clause is a bare number unique only within one extraction version, so matching it would be a fuzzy match. Requires review.",
  },
  EVIDENCE_ENTITY: {
    resolution: "unresolved-identity",
    reason: "No drawing entity identity reaches provenance: no drawing entity id is ever written into engineering_fact_provenance, so the join is empty rather than approximate. Requires review.",
  },
  DRAWING_REGION: {
    resolution: "geometry-only",
    reason: "Region impact would be geometric only: engineering_fact_provenance.bounding_box is never populated, and bounding-box overlap is tolerance-dependent rather than an identity. Requires review.",
  },
});

const UNKNOWN_SCOPE_REASON = "Unknown supersession scope type; no identity mapping is defined. Requires review.";

// Extraction versions belonging to a document version. This is the lineage leg of
// the FULL_DOCUMENT path and the lineage constraint for BOQ_ROW.
const EXTRACTIONS_OF_VERSION_SQL = `
  SELECT id FROM boq_extraction_versions WHERE document_version_id = ?
  UNION
  SELECT id FROM specification_extraction_versions WHERE document_version_id = ?`;

// A provenance row is extraction-dependent by lineage, not by a brittle
// source-type string. Both BOQ and specification extraction ids are valid
// provenance authorities, including Source Fact rows.
const EXTRACTION_LINEAGE_SQL = `
  efp.extraction_version_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM boq_extraction_versions bev WHERE bev.id = efp.extraction_version_id)
    OR EXISTS (SELECT 1 FROM specification_extraction_versions sev WHERE sev.id = efp.extraction_version_id)
  )`;

// A provenance that does NOT depend on any extraction: a datasheet, a calibration,
// a human inspection. Such a provenance survives an extraction supersession and
// can keep a fact supported.
const NON_EXTRACTION_PROVENANCE_SQL = `NOT (${EXTRACTION_LINEAGE_SQL})`;

/**
 * READ-ONLY. Resolve which facts a supersession's scope reaches, and whether that
 * resolution is exact enough to act on automatically. Never writes.
 */
export async function assessEngineeringFactImpact(db, supersession) {
  const scopeType = String(supersession?.scope_type ?? "");
  const scopeId = supersession?.scope_id ?? null;
  const supersededVersionId = supersession?.superseded_version_id ?? null;
  const policy = SUPERSESSION_IMPACT_POLICY[scopeType];

  if (!policy) {
    return {
      scopeType,
      scopeId,
      resolution: "unresolved-identity",
      automaticInvalidationAuthorized: false,
      requiresReview: true,
      affectedFactIds: [],
      reason: UNKNOWN_SCOPE_REASON,
    };
  }

  // Only the exact scopes resolve to facts. The other three are reported, and the
  // caller must not act on them.
  if (policy.resolution !== "exact") {
    return {
      scopeType,
      scopeId,
      resolution: policy.resolution,
      automaticInvalidationAuthorized: false,
      requiresReview: true,
      affectedFactIds: [],
      reason: policy.reason,
    };
  }

  if (!supersededVersionId) {
    return {
      scopeType,
      scopeId,
      resolution: "exact",
      automaticInvalidationAuthorized: false,
      requiresReview: true,
      affectedFactIds: [],
      reason: "Supersession names no superseded document version, so no lineage can be resolved. Requires review.",
    };
  }

  // A supersession record declares its OWN effective window, so it is itself
  // governed evidence about WHEN a retirement takes effect. Acting on a
  // future-dated addendum would retire the in-force baseline's engineering facts
  // today, contradicting the very DOC-R3 rule that the baseline keeps governing
  // until the addendum actually takes effect. This module previously ignored
  // the record's window entirely, which was invisible only because nothing in
  // production called it; wiring it exposed the defect immediately.
  //
  // The PERSISTED row is the authority when it exists. A caller that supplies a
  // supersession object without a row on disk still gets the window evaluated
  // from that object's own declared values, so the rule cannot be bypassed by
  // passing an object instead of a row -- the window semantics are identical.
  //
  // This is the same window as `inForceWindowSql`, expressed over values rather
  // than an alias: an absent start is open-past, an absent end is open-future,
  // and a start strictly in the future is not yet in force. Evaluated against
  // now, so once the addendum takes effect the retirement is authorized with no
  // backfill step and no separate scheduled job.
  const persisted = await db
    .prepare("SELECT effective_from, effective_to FROM document_supersessions WHERE id = ?")
    .bind(supersession.id)
    .first()
    .catch(() => null);
  const window = persisted || supersession;
  if (!isWindowInForce(window)) {
    return {
      scopeType,
      scopeId,
      resolution: "exact",
      automaticInvalidationAuthorized: false,
      requiresReview: false,
      affectedFactIds: [],
      notYetInForce: true,
      reason: `This supersession is not in force yet (effective from ${window?.effective_from ?? "unset"}, to ${window?.effective_to ?? "unset"}), so it has not retired anything. The in-force baseline keeps governing until it takes effect.`,
    };
  }

  const conditions = scopeType === "FULL_DOCUMENT"
    ? [EXTRACTION_LINEAGE_SQL, `efp.extraction_version_id IN (${EXTRACTIONS_OF_VERSION_SQL})`]
    // BOQ_ROW: identity is the boq_items primary key, constrained to the
    // superseded version's lineage so a re-extracted row with a new id cannot be
    // confused with the one that was actually replaced.
    : [
      "efp.source_type = 'Approved BOQ Extraction'",
      "efp.source_id = ?",
      EXTRACTION_LINEAGE_SQL,
      `efp.extraction_version_id IN (${EXTRACTIONS_OF_VERSION_SQL})`,
    ];

  const bindings = scopeType === "FULL_DOCUMENT"
    ? [supersededVersionId, supersededVersionId]
    : [String(scopeId ?? ""), supersededVersionId, supersededVersionId];

  const rows = await db
    .prepare(
      `SELECT DISTINCT efp.fact_id
         FROM engineering_fact_provenance efp
        WHERE ${conditions.map((condition) => `(${condition})`).join("\n          AND ")}
        ORDER BY efp.fact_id`,
    )
    .bind(...bindings)
    .all();

  return {
    scopeType,
    scopeId,
    resolution: "exact",
    automaticInvalidationAuthorized: true,
    requiresReview: false,
    affectedFactIds: (rows.results || []).map((row) => row.fact_id),
    reason: policy.reason,
  };
}

/**
 * Does the fact still have support that this supersession did NOT retire?
 *
 * Support is a DISJUNCTION, not a conjunction, which is the semantics the rest of
 * this module already implements and which a provenance set must keep: one
 * surviving authoritative source is enough. Treating provenances as jointly
 * required would silently discard engineering knowledge that is still evidenced.
 */
async function currentSupportForFact(db, factId, retiredExtractionIds) {
  const retired = retiredExtractionIds.length
    ? `AND efp.extraction_version_id NOT IN (${retiredExtractionIds.map(() => "?").join(",")})`
    : "";

  const currentExtraction = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
         FROM engineering_fact_provenance efp
        WHERE efp.fact_id = ?
          AND ${EXTRACTION_LINEAGE_SQL}
          ${retired}
          AND NOT EXISTS (
            SELECT 1 FROM boq_extraction_versions bev
             WHERE bev.id = efp.extraction_version_id AND bev.superseded_at IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM specification_extraction_versions sev
             WHERE sev.id = efp.extraction_version_id AND sev.superseded_at IS NOT NULL)`,
    )
    .bind(factId, ...retiredExtractionIds)
    .all();

  const nonExtraction = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
         FROM engineering_fact_provenance efp
        WHERE efp.fact_id = ?
          AND ${NON_EXTRACTION_PROVENANCE_SQL}`,
    )
    .bind(factId)
    .all();

  return Number(currentExtraction?.results?.[0]?.cnt || 0) > 0
    || Number(nonExtraction?.results?.[0]?.cnt || 0) > 0;
}

// Rows changed by a write, tolerating both result shapes this code runs under.
// D1 reports `meta.changes`; `node:sqlite` reports a top-level `changes`; and a
// count that cannot be read must not be silently reported as zero changed,
// because that would make an invalidation look like it did nothing.
const changedRows = (result) => {
  const changes = result?.meta?.changes ?? result?.changes;
  return Number(changes ?? 0);
};

/**
 * Act on a supersession's dependency impact.
 *
 * What this may change, and what it must never change:
 *
 *   MAY    mark a fact no longer usable downstream, recording who, why and when.
 *          This is what stops unsupported knowledge from silently flowing into
 *          pricing and quotation. "Pending Review" is included for the reason
 *          given in invalidateEngineeringFactsOnExtractionSuperseded above: an
 *          unconfirmed fact carries no human decision, and leaving it pointing
 *          at retired evidence is how a stale fact becomes authoritative.
 *   NEVER  delete the fact, delete or rewrite its provenance, or set
 *          `superseded_by_id`. A dependency change does not imply a replacement
 *          fact exists, so linking a successor would assert something untrue. The
 *          history stays intact and re-derivable.
 *   NEVER  touch a recorded human decision. Approval is a historical fact about
 *          what someone decided and why; current usability is a separate
 *          question, and conflating them would either erase an audit trail or
 *          resurrect knowledge that is no longer supported. A 'Rejected' fact
 *          records such a decision and is therefore never modified here.
 *
 * A scope with no exact identity changes nothing at all.
 */
export async function invalidateEngineeringFactsForSupersession(db, supersession) {
  const impact = await assessEngineeringFactImpact(db, supersession);

  if (!impact.automaticInvalidationAuthorized) {
    return { ...impact, invalidated: 0, considered: 0, stillSupported: 0 };
  }

  const supersededVersionId = supersession.superseded_version_id;
  const retired = await db
    .prepare(EXTRACTIONS_OF_VERSION_SQL)
    .bind(supersededVersionId, supersededVersionId)
    .all();
  const retiredExtractionIds = (retired.results || []).map((row) => row.id);

  const retiredAt = new Date().toISOString();
  let invalidated = 0;
  let stillSupported = 0;

  for (const factId of impact.affectedFactIds) {
    if (await currentSupportForFact(db, factId, retiredExtractionIds)) {
      stillSupported += 1;
      continue;
    }
    const result = await db
      .prepare(
        `UPDATE engineering_facts
            SET status = 'Superseded',
                superseded_by_id = NULL,
                change_reason = ?,
                changed_by = 'system:engineering-fact-freshness',
                effective_to = ?
          WHERE id = ? AND status IN ('Active', 'Pending Review') AND deleted_at IS NULL`,
      )
      .bind(
        `Superseded by document supersession ${supersession.id} (${impact.scopeType}${impact.scopeId ? ` ${impact.scopeId}` : ""})`,
        retiredAt,
        factId,
      )
      .run();
    invalidated += changedRows(result);
  }

  return { ...impact, invalidated, considered: impact.affectedFactIds.length, stillSupported };
}
