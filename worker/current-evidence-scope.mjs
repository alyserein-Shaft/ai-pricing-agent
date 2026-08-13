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
