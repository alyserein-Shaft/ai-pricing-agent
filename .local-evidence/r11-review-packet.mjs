// R11 engineer review packet — STRICTLY READ-ONLY.
// Opens live D1 with readOnly:true. Performs SELECT only. No mutation.
import { DatabaseSync } from "node:sqlite";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const db = new DatabaseSync(DB, { readOnly: true });

const rows = db
  .prepare(
    `
    SELECT
      b.id                AS boq_item_id,
      b.sequence          AS boq_sequence,
      b.item_number       AS item_number,
      b.source_location    AS source_location,
      b.description       AS description,
      b.numeric_quantity  AS quantity,
      b.normalized_unit   AS unit,
      b.original_unit     AS original_unit,
      b.system_value      AS system,
      b.category          AS category,
      b.subcategory       AS subcategory,
      b.review_status     AS boq_review_status,
      v.id                AS profile_id,
      v.version_number    AS profile_version,
      v.readiness_status  AS readiness_status,
      v.approved_for_matching,
      v.profile           AS profile_json,
      v.confidence_summary AS confidence_json,
      i.id                AS interpretation_id,
      i.status            AS understanding_status,
      i.validated_interpretation AS interpretation_json
    FROM requirement_profile_versions v
    JOIN boq_items b ON b.id = v.boq_item_id
    LEFT JOIN estimator_item_interpretations i
      ON i.boq_item_id = b.id
     AND i.version_number = (
          SELECT MAX(i2.version_number) FROM estimator_item_interpretations i2
          WHERE i2.boq_item_id = b.id)
    WHERE v.project_id = ? AND v.superseded_at IS NULL
    ORDER BY v.readiness_status, b.sequence, b.id
  `,
  )
  .all(P);

// Governed requirement evidence per profile.
const reqCount = new Map(
  db
    .prepare(
      `SELECT profile_version_id, COUNT(*) n FROM profile_requirement_applicability
        GROUP BY profile_version_id`,
    )
    .all()
    .map((r) => [r.profile_version_id, r.n]),
);

// Missing/conflict/clarification issues per profile.
const issues = new Map();
for (const r of db
  .prepare(`SELECT profile_version_id, issue_type, COUNT(*) n FROM profile_issues GROUP BY profile_version_id, issue_type`)
  .all()) {
  if (!issues.has(r.profile_version_id)) issues.set(r.profile_version_id, {});
  issues.get(r.profile_version_id)[r.issue_type] = r.n;
}

const out = rows.map((r) => {
  const prof = JSON.parse(r.profile_json || "{}");
  const interp = JSON.parse(r.interpretation_json || "null");
  const cls = interp?.productFamily ?? null;
  const conf = interp?.confidence ?? null;
  const iss = issues.get(r.profile_id) || {};
  const missingAttrs = (prof.missingInformation || []).map((m) =>
    typeof m === "string" ? m : (m.attribute ?? m.name ?? JSON.stringify(m)),
  );
  return {
    boq_item_id: r.boq_item_id,
    boq_sequence: r.boq_sequence,
    item_number: r.item_number,
    source_location: r.source_location,
    description: r.description,
    quantity: r.quantity,
    unit: r.unit,
    system: r.system,
    category: r.category,
    subcategory: r.subcategory,
    equipmentType: cls?.value ?? null,
    productFamily: cls?.value ?? null,
    classification_origin: cls?.origin ?? null,
    classification_confidence: cls?.confidence ?? null,
    profile_id: r.profile_id,
    profile_version: r.profile_version,
    readiness_status: r.readiness_status,
    approved_for_matching: r.approved_for_matching,
    interpretation_id: r.interpretation_id,
    understanding_status: r.understanding_status,
    missingAttributes: missingAttrs,
    conflicts: (prof.conflicts || []).length,
    reqEvidenceCount: reqCount.get(r.profile_id) ?? 0,
    consolidatedRequirements: (prof.consolidatedRequirements || []).length,
    issues: iss,
  };
});

console.log(JSON.stringify(out, null, 1));
