export const CURRENT_BOQ_ITEM_TYPES = Object.freeze(["Item", "BOQ Item"]);
export const CURRENT_BOQ_EXTRACTION_STATUSES = Object.freeze(["Completed", "Needs Review"]);

// This is the single operational authority boundary for BOQ evidence. Consumers
// may add project, review, matching, or pricing predicates outside this query,
// but must not recreate a weaker definition of "current".
export const CURRENT_BOQ_EVIDENCE_SQL = `
  SELECT
    b.*,
    e.document_version_id AS evidence_document_version_id,
    e.version_number AS evidence_extraction_version,
    e.status AS evidence_extraction_status,
    scope_project.organization_id AS evidence_organization_id
  FROM boq_items b
  JOIN boq_extraction_versions e
    ON e.id=b.extraction_version_id
   AND e.document_id=b.source_document_id
   AND e.superseded_at IS NULL
   AND e.status IN ('Completed','Needs Review')
  JOIN documents d
    ON d.id=e.document_id
   AND d.project_id=b.project_id
   AND d.deleted_at IS NULL
   AND d.archived_at IS NULL
  JOIN document_versions dv
    ON dv.id=e.document_version_id
   AND dv.document_id=d.id
   AND d.current_version_id=dv.id
  JOIN projects scope_project
    ON scope_project.id=d.project_id
   AND scope_project.id=b.project_id
   AND scope_project.archived_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM boq_extraction_versions newer
    WHERE newer.document_id=e.document_id
      AND newer.document_version_id=e.document_version_id
      AND newer.superseded_at IS NULL
      AND newer.status IN ('Completed','Needs Review')
      AND (
        newer.version_number>e.version_number
        OR (newer.version_number=e.version_number AND newer.id>e.id)
      )
  )`;

export const currentBoqEvidenceFrom = (alias = "b") => `(${CURRENT_BOQ_EVIDENCE_SQL}) ${alias}`;
export const currentBoqItemPredicate = (alias = "b") => `${alias}.row_type IN ('Item','BOQ Item')`;

// ONE canonical eligible-population rule, shared by AI Understanding and the
// engineering contract so the two can never diverge: current BOQ item rows
// only, in a confirmed review family, with downstream authorization still in
// force. Consumers compose it inside ${currentBoqEvidenceFrom(...)} for the
// temporal currentness/lineage check; row_type/review/downstream eligibility
// lives here.
export const currentBoqEligibleForEngineeringPredicate = (alias = "b") =>
  `${currentBoqItemPredicate(alias)} AND ${alias}.review_status IN ('Approved','Accepted','Auto Verified') AND ${alias}.approved_for_downstream = 1`;

// Understanding governs the same population by the same rule -- literally the
// same predicate (alias-for-alias), never a narrower or weaker copy.
export const currentBoqEligibleForUnderstandingPredicate = (alias = "b") =>
  currentBoqEligibleForEngineeringPredicate(alias);

// This is the specification-side sibling of CURRENT_BOQ_EVIDENCE_SQL above, and
// it is deliberately built from the SAME clauses in the SAME order: current
// document version (d.current_version_id = dv.id), a non-superseded extraction
// in a Completed/Needs Review state, an undeleted and unarchived document and
// project, and no newer extraction of the same document version. Two authorities
// that cannot disagree are what makes it safe for a caller to ask "is this
// extraction still current?" without knowing which side of the project it came
// from -- a requirement and a BOQ item extracted from the same document version
// can never be judged current by different rules.
//
// It is added so Source Fact currentness can be answered by LINEAGE (does the
// fact's provenance still name a live extraction?) rather than by a
// `superseded_at IS NULL` approximation. Consumers may add their own project,
// review, or matching predicates outside this query, but must not recreate a
// weaker definition of "current".
//
// SCOPE NOTE. This mirrors the temporal authority ALREADY committed in
// CURRENT_BOQ_EVIDENCE_SQL. When the calendared effective-time layer
// (app/domain/effective-time-policy.mjs) is adopted repository-wide, this
// sibling must move to the same governed-document-version predicate in the SAME
// commit as CURRENT_BOQ_EVIDENCE_SQL, or the two sides would begin to disagree
// about which document version governs.
export const CURRENT_TECHNICAL_REQUIREMENT_SQL = `
  SELECT r.*
  FROM technical_requirements r
  JOIN specification_extraction_versions e
    ON e.id=r.extraction_version_id
   AND e.document_id=r.source_document_id
   AND e.superseded_at IS NULL
   AND e.status IN ('Completed','Needs Review')
  JOIN documents d
    ON d.id=e.document_id
   AND d.project_id=r.project_id
   AND d.deleted_at IS NULL
   AND d.archived_at IS NULL
  JOIN document_versions dv
    ON dv.id=e.document_version_id
   AND dv.document_id=d.id
   AND d.current_version_id=dv.id
  JOIN projects requirement_project
    ON requirement_project.id=d.project_id
   AND requirement_project.archived_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM specification_extraction_versions newer
    WHERE newer.document_id=e.document_id
      AND newer.document_version_id=e.document_version_id
      AND newer.superseded_at IS NULL
      AND newer.status IN ('Completed','Needs Review')
      AND (
        newer.version_number>e.version_number
        OR (newer.version_number=e.version_number AND newer.id>e.id)
      )
  )`;

export const currentTechnicalRequirementsFrom = (alias = "r") => `(${CURRENT_TECHNICAL_REQUIREMENT_SQL}) ${alias}`;

/**
 * THE single governed document-version predicate.
 *
 * This is the clause both CURRENT_BOQ_EVIDENCE_SQL (above) and
 * CURRENT_TECHNICAL_REQUIREMENT_SQL already apply inline:
 *
 *     dv.document_id = d.id AND d.current_version_id = dv.id
 *
 * It was named by docs/DOC-R3-current-version-id-authority-audit.md and asserted
 * by tests/current-version-id-authority.test.mjs, but was never actually
 * exported, so every other consumer had to re-derive it -- and several derived
 * it wrongly or omitted it entirely (a library ingest route accepted an
 * arbitrary document version id). It is exported here so there is exactly ONE
 * governing predicate rather than a second one.
 *
 * Use this wherever a document version must be proven to be the governing
 * version of its document. A version that fails this is stale evidence and must
 * fail closed.
 */
export const documentVersionGoverningPredicate = (versionAlias = "dv", documentAlias = "d") =>
  `${versionAlias}.document_id = ${documentAlias}.id AND ${documentAlias}.current_version_id = ${versionAlias}.id`;

export async function currentBoqEvidenceCounts(db, { projectId, organizationId = null } = {}) {
  const organization = organizationId ? " AND b.evidence_organization_id=?" : "";
  const values = organizationId ? [projectId, organizationId] : [projectId];
  const row = await db.prepare(`SELECT
      COUNT(*) currentExtractedRows,
      SUM(CASE WHEN ${currentBoqItemPredicate("b")} THEN 1 ELSE 0 END) currentBoqItems,
      SUM(CASE WHEN NOT (${currentBoqItemPredicate("b")}) THEN 1 ELSE 0 END) structuralRows,
      SUM(CASE WHEN ${currentBoqItemPredicate("b")} AND b.review_status IN ('Approved','Accepted') AND b.approved_for_downstream=1 THEN 1 ELSE 0 END) extractionConfirmed,
      SUM(CASE WHEN ${currentBoqItemPredicate("b")} AND (b.review_status NOT IN ('Approved','Accepted') OR b.approved_for_downstream=0) THEN 1 ELSE 0 END) extractionNeedsReview
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.project_id=?${organization}`).bind(...values).first();
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

export async function diagnoseBoqEvidence(db, { projectId, organizationId = null } = {}) {
  const rows = await db.prepare(`SELECT b.id boqItemId,b.row_type rowType,
      CASE
        WHEN d.id IS NULL THEN 'unauthorized project/document'
        WHEN p.organization_id<>? THEN 'unauthorized project/document'
        WHEN d.deleted_at IS NOT NULL OR d.archived_at IS NOT NULL THEN 'deleted document'
        WHEN d.current_version_id<>e.document_version_id THEN 'stale document version'
        WHEN e.superseded_at IS NOT NULL THEN 'superseded extraction'
        WHEN e.status NOT IN ('Completed','Needs Review') THEN 'non-current extraction'
        WHEN EXISTS (SELECT 1 FROM boq_extraction_versions newer WHERE newer.document_id=e.document_id AND newer.document_version_id=e.document_version_id AND newer.superseded_at IS NULL AND newer.status IN ('Completed','Needs Review') AND (newer.version_number>e.version_number OR (newer.version_number=e.version_number AND newer.id>e.id))) THEN 'non-current extraction'
        WHEN b.row_type NOT IN ('Item','BOQ Item') THEN 'structural row'
        ELSE 'current BOQ item'
      END exclusionReason
    FROM boq_items b
    LEFT JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.document_id=b.source_document_id
    LEFT JOIN documents d ON d.id=e.document_id AND d.project_id=b.project_id
    LEFT JOIN projects p ON p.id=b.project_id
    WHERE b.project_id=? ORDER BY b.id`).bind(organizationId || "", projectId).all();
  return rows.results || [];
}

// ── GOVERNED DOWNSTREAM SCOPE SELECTOR (additive; the raw reader is untouched) ──
//
// `currentBoqEvidenceFrom` semantically means RAW / CURRENT EXTRACTION EVIDENCE and is
// load-bearing for the raw review, so it is deliberately left as it was. This is the
// clearly-named downstream selector the normalized-scope work needs.
//
// GENERIC INVARIANT (never project-specific):
//   IF an APPLIED current normalization generation exists -> ONLY governed subjects
//   ELSE -> the explicitly permitted pre-normalization scope (raw current extraction)
// The two populations are NEVER mixed in one downstream set.
export const currentGovernedBoqScopeFrom = (alias = "b") => `
  SELECT b.*,
         e.document_version_id AS evidence_document_version_id,
         e.version_number AS evidence_extraction_version,
         e.status AS evidence_extraction_status,
         scope_project.organization_id AS evidence_organization_id
  FROM boq_items b
  JOIN boq_extraction_versions e
    ON e.id=b.extraction_version_id
   AND e.document_id=b.source_document_id
   AND e.superseded_at IS NULL
   AND e.status IN ('Completed','Needs Review')
  JOIN documents d
    ON d.id=e.document_id
   AND d.project_id=b.project_id
   AND d.deleted_at IS NULL
   AND d.archived_at IS NULL
  JOIN document_versions dv
    ON dv.id=e.document_version_id
   AND dv.document_id=d.id
   AND d.current_version_id=dv.id
  JOIN projects scope_project
    ON scope_project.id=d.project_id
   AND scope_project.id=b.project_id
   AND scope_project.archived_at IS NULL
  WHERE b.id IN (
    SELECT s.subject_boq_item_id
    FROM boq_normalization_scope s
    JOIN boq_normalization_reviews r ON r.id=s.review_id
    WHERE s.project_id=scope_project.id
      AND s.superseded_at IS NULL
      AND r.status='APPLIED'
      AND NOT EXISTS (
        SELECT 1 FROM boq_normalization_scope n2
        JOIN boq_normalization_reviews r2 ON r2.id=n2.review_id
        WHERE n2.project_id=s.project_id
          AND n2.superseded_at IS NULL
          AND r2.status='APPLIED'
          AND r2.generation_number>r.generation_number
      )
  )`;

export const governedBoqScopeExists = async (db, projectId) => {
  const row = await db.prepare(
    `SELECT count(*) c FROM boq_normalization_scope s
     JOIN boq_normalization_reviews r ON r.id=s.review_id
     WHERE s.project_id=? AND s.superseded_at IS NULL AND r.status='APPLIED'
       AND NOT EXISTS (
         SELECT 1 FROM boq_normalization_scope n2
         JOIN boq_normalization_reviews r2 ON r2.id=n2.review_id
         WHERE n2.project_id=s.project_id AND n2.superseded_at IS NULL
           AND r2.status='APPLIED' AND r2.generation_number>r.generation_number
       )`,
  ).bind(projectId).first();
  return Number(row?.c || 0) > 0;
};

export const currentDownstreamBoqScopeFrom = async (db, projectId, alias = "b") => {
  if (await governedBoqScopeExists(db, projectId)) return currentGovernedBoqScopeFrom(alias);
  return currentBoqEvidenceFrom(alias);
};
