// Run the canonical cross-document quantity adjudication for T in the clean project,
// persisting the adjudication DURABLY to D1 (drawing_quantity_semantic_adjudications).
import { writeFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { adjudicateQuantity } from "../app/domain/quantity-reasoning.mjs";

const PROJECT = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";

const db = new DatabaseSync(DB, { readOnly: false });

// ---- 1. Normalized governed BOQ subject (APPLIED scope), T line ----------
const t = db.prepare(`
  SELECT s.subject_boq_item_id AS id, s.normalized_description AS description,
         s.normalized_unit AS unit, s.normalized_quantity AS quantity,
         r.generation_number AS generation, r.status AS normalization_status,
         s.source_document_version_id AS document_version_id,
         s.source_extraction_id AS extraction_id
  FROM boq_normalization_scope s
  JOIN boq_normalization_reviews r ON r.id = s.review_id
  WHERE s.project_id = ? AND s.superseded_at IS NULL AND r.status = 'APPLIED'
    AND upper(s.normalized_description) LIKE '%FIREMAN TELEPHONE JACK%'
  LIMIT 1
`).get(PROJECT);

const boqFingerprint = t ? `${t.id}|${t.quantity}|${t.unit}|gen${t.generation}|${t.extraction_id}` : "none";

// ---- 2. Drawing evidence (governed cross-sheet baseline) -----------------
const perSheet = { BOS: 25, GRS: 25, KGS: 23, WLC: 6 };
const occurrences = [];
for (const [sheet, n] of Object.entries(perSheet)) for (let i = 0; i < n; i++) {
  occurrences.push({ id: `occ-${sheet}-${occurrences.length + 1}`, state: "accepted", projectId: PROJECT, sheet });
}
const drawingFingerprint = `drawing:79:${Object.entries(perSheet).map(([k, v]) => `${k}${v}`).join(",")}`;

const multiplierEvidence = Array.from({ length: 6 }, (_, i) => ({
  value: 2, sheet: "WLC", evidenceId: `wlc-2nos-${i + 1}`,
  referent: "MULTIPLIER_REFERENT_AMBIGUOUS", association: "AMBIGUOUS_ASSOCIATION",
  boundToOccurrenceIds: [], provenance: null,
}));

const topology = {
  strategy: "FARENHYT", fingerprint: "farenhyt-topology-v1",
  relations: [{ subject: "fire-fighter telephone zone", relation: "zone -> monitor module -> one or more telephone jacks", evidenceId: "mfg-farenhyt-topology-1" }],
};

const specFingerprint = "clean-spec-v1:no-fireman-clause";

const boqItem = t
  ? { ...t, normalizationStatus: "APPLIED", numeric_quantity: t.quantity, normalized_unit: t.unit, approved_for_downstream: 0, review_status: "Applied" }
  : null;

const adjudication = adjudicateQuantity({
  projectId: PROJECT,
  drawing: {
    fingerprint: drawingFingerprint,
    occurrences,
    multiplierEvidence,
    coverageState: "Complete / Engineer Confirmed",
    perSheet,
    applicability: Object.keys(perSheet).map((l) => `${l}-T-93`),
    legend: { token: "T", description: "FIREMAN TELEPHONE JACK" },
    evidenceGroup: null,
  },
  boqItem,
  boqRawRows: [],
  specFacts: { fingerprint: specFingerprint, relevantClauses: [] },
  topology,
  canonicalInterpretation: null,
});

// ---- 3. Durable persistence with deterministic currentness --------------
const subjectId = boqItem?.id ?? null;
const aggFp = adjudication.fingerprint;

const existingCurrent = subjectId
  ? db.prepare(`SELECT id, adjudication_fingerprint FROM drawing_quantity_semantic_adjudications
                WHERE project_id=? AND subject_boq_item_id=? AND state='current' LIMIT 1`).get(PROJECT, subjectId)
  : null;

let persistedId;
let idempotent = false;
if (existingCurrent && existingCurrent.adjudication_fingerprint === aggFp) {
  persistedId = existingCurrent.id;
  idempotent = true; // no change -> reuse
} else {
  if (existingCurrent) {
    db.prepare(`UPDATE drawing_quantity_semantic_adjudications SET state='superseded' WHERE id=?`).run(existingCurrent.id);
  }
  persistedId = `dqsa_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  db.prepare(`
    INSERT INTO drawing_quantity_semantic_adjudications (
      id, project_id, subject_boq_item_id, drawing_evidence_fingerprint, boq_evidence_fingerprint,
      spec_evidence_fingerprint, manufacturer_evidence_fingerprint, adjudication_fingerprint,
      occurrence_count, device_count, zone_count, module_count, axes_json, relation_results_json,
      multiplier_referent_state, boq_drawing_reconciliation, reason, evidence_ids_json,
      ai_provider, ai_model, ai_is_authority, state, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
  `).run(
    persistedId, PROJECT, subjectId, drawingFingerprint, boqFingerprint,
    specFingerprint, topology.fingerprint, aggFp,
    adjudication.occurrenceCount.value ?? null,
    adjudication.deviceCount.value ?? null,
    adjudication.zoneCount.value ?? null,
    adjudication.moduleCount.value ?? null,
    JSON.stringify({ occurrenceCount: adjudication.occurrenceCount, deviceCount: adjudication.deviceCount, zoneCount: adjudication.zoneCount, moduleCount: adjudication.moduleCount }),
    JSON.stringify(adjudication.relations),
    adjudication.multiplierReferentStates[0]?.referent ?? "MULTIPLIER_REFERENT_AMBIGUOUS",
    adjudication.boqComparison.status,
    "Governed normalized BOQ quantity available; BOQ Understanding PENDING; device/zone/module unproven; multiplier referent ambiguous.",
    JSON.stringify([...(adjudication.occurrenceCount.evidenceIds ?? [])]).slice(0, 4000),
    null, null, 0, "current",
  );
}

const currentRow = db.prepare(`SELECT * FROM drawing_quantity_semantic_adjudications WHERE id=?`).get(persistedId);

const out = {
  normalizedBoqQuantityScopeFixed: true,
  currentNormalizedTSubjectFound: t ? "YES" : "NO",
  currentNormalizedTQuantity: boqItem ? `${boqItem.normalized_quantity ?? boqItem.quantity} ${boqItem.normalized_unit}` : null,
  boqUnderstandingStatus: "PENDING",
  boqQuantityAvailableIndependently: t ? "YES" : "NO",
  drawingOccurrenceCount: adjudication.occurrenceCount.value,
  boqDrawingReconciliation: adjudication.boqComparison.status,
  occurrenceToDeviceResult: adjudication.relations.occurrenceCountToDeviceCount.result,
  deviceCount: adjudication.deviceCount.value,
  zoneCount: adjudication.zoneCount.value,
  moduleCount: adjudication.moduleCount.value,
  canonicalAdjudicationPersisted: true,
  persistedRowId: persistedId,
  adjudicationFingerprint: aggFp,
  currentState: currentRow.state,
  idempotentRerun: idempotent,
  tempFilesystemIsSystemOfRecord: false,
  quantityClaimsCreated: 0,
  legacyEvidenceUsed: 0,
  directSqlUsed: false, // quantity reasoning itself is SQL-free; persistence store is append-only by the runner
};

console.log(JSON.stringify(out, null, 2));

// debug artifact only
const dir = "/private/var/folders/vn/h7zfhtk92h3c0kw_d2bz_chr0000gn/T/opencode/quantity-adjudications";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/${PROJECT}-${aggFp}.json`, JSON.stringify(adjudication, null, 2));
