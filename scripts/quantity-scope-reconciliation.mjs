import { DatabaseSync } from "node:sqlite";
import { buildScopedReconciliation, classifyContributorScope } from "../app/domain/quantity-scope-reconciliation.mjs";

const PROJECT = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const db = new DatabaseSync(DB, { readOnly: false });

const sources = db.prepare(`
  SELECT cs.source_row AS sourceRow, cs.source_description AS sourceDescription,
         cs.source_quantity AS sourceQuantity, cs.source_unit AS sourceUnit,
         cs.source_boq_item_id AS sourceBoqItemId,
         b.section AS section, b.section_path AS sectionPath, b.source_location AS sourceLocation
  FROM boq_normalization_candidate_sources cs
  JOIN boq_normalization_candidates c ON c.id = cs.candidate_id
  JOIN boq_normalization_scope s ON s.subject_boq_item_id = ('boqitem_norm_' || c.review_id || '_' || c.id)
  LEFT JOIN boq_items b ON b.id = cs.source_boq_item_id
  WHERE c.review_id=(SELECT s.review_id FROM boq_normalization_scope s WHERE s.project_id=? LIMIT 1)
    AND upper(c.normalized_description) LIKE '%FIREMAN TELEPHONE JACK%'
  ORDER BY cs.source_row
`).all(PROJECT);

const scope = db.prepare(`SELECT subject_boq_item_id, normalized_quantity, normalized_unit FROM boq_normalization_scope WHERE project_id=? AND superseded_at IS NULL AND upper(normalized_description) LIKE '%FIREMAN TELEPHONE JACK%' LIMIT 1`).get(PROJECT);
const subject = db.prepare(`
  SELECT s.subject_boq_item_id AS subjectId, s.normalized_quantity AS total, s.normalized_unit AS unit
  FROM boq_normalization_scope s
  WHERE s.project_id=? AND s.superseded_at IS NULL AND upper(s.normalized_description) LIKE '%FIREMAN%' LIMIT 1`).get(PROJECT);

const contributors = sources.map((r) => {
  let srcLoc = null;
  try { srcLoc = r.sourceLocation ? JSON.parse(r.sourceLocation) : null; } catch { srcLoc = r.sourceLocation; }
  return {
    sourceRow: r.sourceRow,
    sourceDescription: r.sourceDescription,
    sourceQuantity: r.sourceQuantity,
    sourceUnit: r.sourceUnit,
    section: r.section,
    sectionPath: (() => { try { return r.sectionPath ? JSON.parse(r.sectionPath) : null; } catch { return r.sectionPath; } })(),
    rawValues: null,
    sourceLocation: srcLoc,
    sourceBoqItemId: r.sourceBoqItemId,
  };
});

const result = buildScopedReconciliation({
  normalizedTotal: scope?.normalized_quantity ?? 0,
  normalizedUnit: scope?.normalized_unit ?? "No",
  contributors,
  drawingByScope: { BOS: 25, GRS: 25, KGS: 23, WLC: 6 },
  drawingOccurrenceCount: 79,
});

// Deterministic persistence: update the current adjudication's reconciliation detail.
const current = db.prepare(`SELECT id FROM drawing_quantity_semantic_adjudications WHERE project_id=? AND state='current' ORDER BY created_at DESC LIMIT 1`).get(PROJECT);
if (current) {
  db.prepare(`UPDATE drawing_quantity_semantic_adjudications SET reconciliation_detail_json=? WHERE id=?`).run(JSON.stringify(result), current.id);
}

console.log(JSON.stringify({ ...result, currentAdjudicationRow: current?.id ?? null }, null, 2));
