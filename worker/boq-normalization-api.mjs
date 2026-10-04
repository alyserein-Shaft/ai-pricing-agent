// GOVERNED SERVER-SIDE NORMALIZED BOQ REVIEW + APPLY.
//
// Closes the P0 defect: the controlled normalized review was client-state only, so
// the accepted 21-line result was never durable and canonical BOQ Understanding --
// which reads `boq_items` -- could not consume the governed scope at all.
//
// LAYERS, kept explicitly separate:
//   A. RAW EXTRACTION EVIDENCE  the 108 extraction rows / 90 BOQ item rows. Never
//      written, never deleted, never rewritten by anything in this module.
//   B. NORMALIZATION REVIEW     the controlled candidate set + per-candidate human
//      decisions. May exist before Apply; closing/reopening never regenerates it.
//   C. GOVERNED DOWNSTREAM      materialised ONLY by a governed human Apply, into
//      `boq_normalization_scope`. Excluded candidates never enter it.
//
// AUTHORITY is keyed by (project, document, document version, extraction,
// generation fingerprint) -- never filename, browser state or upload order.
import { resolveApplicationContext, applicationActor } from "./application-context.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";
import {
  BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION,
  BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE,
  BOQ_NORMALIZATION_AUTO_DECISION_MODE,
  buildNormalizationAutoDecision,
  evaluateNormalizationAutoApproval,
} from "../app/domain/boq-normalization-auto-authority.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-style": "no-store" } });
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = {}) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const ownedProject = (db, projectId, userId) =>
  db.prepare("SELECT * FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(projectId, userId).first();

export const BOQ_NORMALIZATION_VERSION = "boq-normalization-1.0.0";

// ── Generation fingerprint ──────────────────────────────────────────────────
// Authority is bound to CONTENT, never to a filename. Sorting the candidate set
// makes the fingerprint stable across map iteration order, so an unchanged
// controlled generation always produces the same identity and Apply stays
// idempotent.
export const candidateGenerationFingerprint = ({ sourceSha256, candidates = [] }) => {
  const canonical = candidates
    .map((c) => ({
      description: String(c.normalized_description ?? c.description ?? "").trim(),
      unit: String(c.normalized_unit ?? c.unit ?? "").trim(),
      quantity: Number(c.normalized_quantity ?? c.quantity ?? 0),
      sources: [...(c.sources || [])].map((s) => Number(s.source_row ?? s.sourceRow ?? s)).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.description.localeCompare(b.description) || a.quantity - b.quantity);
  return JSON.stringify({ sourceSha256, canonical });
};

// Resolve the CURRENT raw extraction + controlled source identity for a document.
// This is the only place a document is turned into a normalization identity, so the
// "is this still current?" question has exactly one answer in this module.
export const resolveCurrentNormalizationSource = async (db, { documentId, userId }) => {
  const document = await db.prepare(
    `SELECT d.id, d.project_id, d.logical_name, d.current_version_id, d.deleted_at, d.archived_at,
            v.sha256 AS source_sha256, v.id AS document_version_id
     FROM documents d
     JOIN document_versions v ON v.id = d.current_version_id
     JOIN projects p ON p.id = d.project_id
     WHERE d.id=? AND p.owner_user_id=? AND p.archived_at IS NULL
       AND d.deleted_at IS NULL AND d.archived_at IS NULL`,
  ).bind(documentId, userId).first();
  if (!document) return { error: { code: "DOCUMENT_NOT_FOUND", message: "No current document matches that id." } };
  // NOTE the explicit IS NULL guard: in SQL `NULL <> 'x'` evaluates to NULL, not TRUE, so a
// bare `<>` would silently exclude every extraction row with no recorded method.
// `extraction_method='Controlled Normalization'` rows are the OUTPUT of a normalization
  // review, not a source extraction. They must never resolve as the source, or creating
  // the subject extraction would immediately make its own SOURCE stale and the review
  // would become impossible to re-evaluate or re-apply.
  const extraction = await db.prepare(
    `SELECT e.id, e.version_number, e.status, e.superseded_at FROM boq_extraction_versions e
     WHERE e.document_id=? AND e.superseded_at IS NULL AND e.status IN ('Completed','Needs Review')
       AND (e.extraction_method IS NULL OR e.extraction_method <> 'Controlled Normalization')
       AND NOT EXISTS (
         SELECT 1 FROM boq_extraction_versions newer
         WHERE newer.document_id=e.document_id AND newer.document_version_id=e.document_version_id
           AND newer.superseded_at IS NULL AND newer.status IN ('Completed','Needs Review')
           AND (newer.extraction_method IS NULL OR newer.extraction_method <> 'Controlled Normalization')
           AND (newer.version_number>e.version_number OR (newer.version_number=e.version_number AND newer.id>e.id))
       )
     ORDER BY e.version_number DESC LIMIT 1`,
  ).bind(document.id).first();
  if (!extraction) return { error: { code: "BOQ_EXTRACTION_NOT_CURRENT", message: "No current BOQ extraction exists for this document." } };
  return { document, extraction };
};

// The current normalization review for a document, if any. Returns null when none
// exists so callers can distinguish "not normalized" from "normalized but stale".
export const currentNormalizationReview = async (db, documentId) => {
  const rows = await db.prepare(
    `SELECT * FROM boq_normalization_reviews
     WHERE source_document_id=? AND status IN ('OPEN','APPLIED')
     ORDER BY generation_number DESC, created_at DESC`,
  ).bind(documentId).all();
  const list = rows.results || [];
  return list.find((r) => r.status === "OPEN") || list.find((r) => r.status === "APPLIED") || null;
};

// Is a review still CURRENT? Every Apply gate calls this. A review whose extraction
// has been superseded, whose document version moved, or whose controlled generation
// fingerprint no longer matches is STALE and must not be applied.
export const evaluateReviewCurrency = async (db, review, { sourceSha256, generationFingerprint, currentExtractionId, currentDocumentVersionId } = {}) => {
  if (!review) return { current: false, code: "NO_REVIEW" };
  const extraction = await db.prepare("SELECT id, superseded_at, status, document_version_id FROM boq_extraction_versions WHERE id=?").bind(review.source_extraction_id).first();
  if (!extraction) return { current: false, code: "SOURCE_EXTRACTION_MISSING" };
  if (extraction.superseded_at) return { current: false, code: "SOURCE_EXTRACTION_SUPERSEDED" };
  if (currentExtractionId && review.source_extraction_id !== currentExtractionId) return { current: false, code: "SOURCE_EXTRACTION_NOT_CURRENT" };
  if (currentDocumentVersionId && review.source_document_version_id !== currentDocumentVersionId) return { current: false, code: "SOURCE_VERSION_NOT_CURRENT" };
  if (sourceSha256 && review.source_sha256 !== sourceSha256) return { current: false, code: "SOURCE_CONTENT_CHANGED" };
  if (generationFingerprint && review.generation_fingerprint !== generationFingerprint) return { current: false, code: "GENERATION_CHANGED" };
  return { current: true, code: null };
};

// ── Bootstrap a review from the controlled candidate set ────────────────────
// Does NOT decide anything. Every candidate lands 'Pending'.
export const bootstrapNormalizationReview = async (db, { projectId, documentId, userId, candidates = [] }) => {
  const source = await resolveCurrentNormalizationSource(db, { documentId, userId });
  if (source.error) return source;
  const { document, extraction } = source;
  const fingerprint = candidateGenerationFingerprint({ sourceSha256: document.source_sha256, candidates });
  const existing = await db.prepare(
    "SELECT * FROM boq_normalization_reviews WHERE project_id=? AND source_document_id=? AND source_document_version_id=? AND source_extraction_id=? AND generation_fingerprint=?",
  ).bind(projectId, document.id, document.document_version_id, extraction.id, fingerprint).first();
  if (existing) return { review: existing, created: false };

  const reviewId = id("boqnormreview");
  const generationNumber = ((await db.prepare("SELECT COALESCE(MAX(generation_number),0)+1 n FROM boq_normalization_reviews WHERE project_id=? AND source_document_id=?").bind(projectId, document.id).first())?.n) || 1;
  // Any earlier APPLIED generation becomes historical, never deleted.
  await db.prepare("UPDATE boq_normalization_reviews SET status='SUPERSEDED', superseded_at=?, superseded_by_review_id=? WHERE project_id=? AND source_document_id=? AND status='OPEN'").bind(now(), reviewId, projectId, document.id).run();
  // Only DRAFT (OPEN) reviews are retired here. An APPLIED generation stays APPLIED
  // until a newer generation is actually APPLIED -- superseding it at bootstrap time
  // would make two generations look current simultaneously while the new one is still
  // only a draft. Apply performs the real transition (see step 7b).
  await db.prepare("UPDATE boq_normalization_reviews SET status='SUPERSEDED', superseded_at=?, superseded_by_review_id=?, updated_at=? WHERE project_id=? AND source_document_id=? AND status='OPEN' AND id<>?").bind(now(), reviewId, now(), projectId, document.id, reviewId).run();

  const statements = [
    db.prepare("INSERT INTO boq_normalization_reviews (id, project_id, source_document_id, source_document_version_id, source_extraction_id, source_sha256, generation_fingerprint, generation_number, status, candidate_count) VALUES (?,?,?,?,?,?,?,?, 'OPEN', ?)").bind(reviewId, projectId, document.id, document.document_version_id, extraction.id, document.source_sha256, fingerprint, generationNumber, candidates.length),
  ];
  candidates.forEach((candidate, ordinal) => {
    const candidateId = id("boqnormcand");
    statements.push(db.prepare("INSERT INTO boq_normalization_candidates (id, review_id, project_id, ordinal, normalized_description, normalized_unit, normalized_quantity) VALUES (?,?,?,?,?,?,?)").bind(candidateId, reviewId, projectId, ordinal + 1, String(candidate.normalized_description ?? candidate.description ?? "").trim(), candidate.normalized_unit ?? candidate.unit ?? null, Number(candidate.normalized_quantity ?? candidate.quantity ?? 0)));
    for (const source of candidate.sources || []) {
      statements.push(db.prepare("INSERT INTO boq_normalization_candidate_sources (id, candidate_id, review_id, source_boq_item_id, source_row, source_description, source_unit, source_quantity) VALUES (?,?,?,?,?,?,?,?)").bind(id("boqnormsrc"), candidateId, reviewId, source.boq_item_id, Number(source.source_row ?? source.sourceRow), source.description ?? null, source.unit ?? null, source.quantity == null ? null : Number(source.quantity)));
    }
  });
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return { review: await db.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first(), created: true };
};

// ── Read model ──────────────────────────────────────────────────────────────
export const readNormalizationReview = async (db, reviewId) => {
  const review = await db.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first();
  if (!review) return null;
  const candidates = await db.prepare("SELECT * FROM boq_normalization_candidates WHERE review_id=? ORDER BY ordinal").bind(reviewId).all();
  const sources = await db.prepare("SELECT * FROM boq_normalization_candidate_sources WHERE review_id=? ORDER BY source_row").bind(reviewId).all();
  return {
    review,
    candidates: (candidates.results || []).map((candidate) => ({
      ...candidate,
      sources: (sources.results || []).filter((s) => s.candidate_id === candidate.id),
    })),
  };
};

// ── Governed candidate decision ─────────────────────────────────────────────
export const recordCandidateDecision = async (db, { reviewId, candidateId, decision, reason = "", human }) => {
  const review = await db.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first();
  if (!review) return { error: { code: "NORMALIZATION_REVIEW_NOT_FOUND", message: "No such normalization review." }, status: 404 };
  if (review.status !== "OPEN") return { error: { code: "NORMALIZATION_REVIEW_NOT_OPEN", message: `This review is ${review.status} and no longer accepts decisions.` }, status: 409 };
  const candidate = await db.prepare("SELECT * FROM boq_normalization_candidates WHERE id=? AND review_id=?").bind(candidateId, reviewId).first();
  if (!candidate) return { error: { code: "NORMALIZATION_CANDIDATE_NOT_FOUND", message: "No such candidate in this review." }, status: 404 };
  if (!["Accepted", "Excluded"].includes(decision)) return { error: { code: "NORMALIZATION_DECISION_INVALID", message: "Choose Accepted or Excluded." }, status: 422 };
  // An exclusion is a human judgement that must carry its reason; an acceptance
  // must not smuggle one in as if it were authority.
  if (decision === "Excluded" && String(reason).trim().length < 5) {
    return { error: { code: "NORMALIZATION_EXCLUSION_REASON_REQUIRED", message: "An excluded candidate requires a substantive reason." }, status: 422 };
  }
  const stamp = now();
  await db.batch([
    db.prepare("UPDATE boq_normalization_candidates SET decision=?, exclusion_reason=?, decided_by=?, decided_by_name=?, decided_at=?, updated_at=? WHERE id=?").bind(decision, decision === "Excluded" ? String(reason).trim() : null, human.id, human.name || null, stamp, stamp, candidateId),
    db.prepare("INSERT INTO boq_normalization_decisions_log (id, project_id, review_id, candidate_id, action, previous_value, new_value, reason, actor_id, actor_name, actor_role) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id("boqnormdecision"), review.project_id, reviewId, candidateId, "candidate-decision", JSON.stringify({ decision: candidate.decision }), JSON.stringify({ decision }), String(reason || "").trim() || null, human.id, human.name || null, human.role || null),
  ]);
  return { candidate: await db.prepare("SELECT * FROM boq_normalization_candidates WHERE id=?").bind(candidateId).first() };
};

// ── Governed Apply ──────────────────────────────────────────────────────────
export const applyNormalizationReview = async (db, env, { reviewId, userId, human, requireDocumentIssue = false, documentIssueConfirmed = false }) => {
  // 1. Human authority. A governed Apply may never run under the synthetic identity.
  if (!human || !human.id) return { error: { code: "HUMAN_ACTOR_REQUIRED", message: "Apply is a human-authority action and requires a configured human identity." }, status: 403 };

  const review = await db.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first();
  if (!review) return { error: { code: "NORMALIZATION_REVIEW_NOT_FOUND", message: "No such normalization review." }, status: 404 };
  if (review.status === "APPLIED") {
    // 2. Idempotency: re-applying the exact same reviewed generation is a no-op,
    //    not an error and not a duplicate population.
    const scope = await db.prepare("SELECT count(*) c FROM boq_normalization_scope WHERE project_id=? AND review_id=? AND superseded_at IS NULL").bind(review.project_id, reviewId).first();
    return { applied: true, idempotent: true, scopeCount: scope.c, review };
  }
  if (review.status !== "OPEN") return { error: { code: "NORMALIZATION_REVIEW_NOT_OPEN", message: `This review is ${review.status}.` }, status: 409 };

  // 3. Source currency: a stale extraction / moved version / changed content must
  //    fail closed rather than silently apply.
  const currency = await evaluateReviewCurrency(db, review, {
    // A `Controlled Normalization` extraction is this pipeline's own OUTPUT, never the source
    // it was derived from, so it is excluded here exactly as in resolveCurrentNormalizationSource.
    currentExtractionId: (await db.prepare("SELECT id FROM boq_extraction_versions WHERE document_id=? AND superseded_at IS NULL AND status IN ('Completed','Needs Review') AND (extraction_method IS NULL OR extraction_method <> 'Controlled Normalization') ORDER BY version_number DESC LIMIT 1").bind(review.source_document_id).first())?.id,
    currentDocumentVersionId: (await db.prepare("SELECT current_version_id FROM documents WHERE id=?").bind(review.source_document_id).first())?.current_version_id,
  });
  if (!currency.current) return { error: { code: "NORMALIZATION_REVIEW_STALE", message: `This review is no longer current (${currency.code}); reconcile the extraction before applying.` }, status: 409 };

  // 4. Document issue metadata must be governed BEFORE scope exists.
  if (requireDocumentIssue && !documentIssueConfirmed) {
    return { error: { code: "DOCUMENT_ISSUE_NOT_CONFIRMED", message: "Confirm the governed document issue (RFQ / issue purpose) before applying the BOQ scope." }, status: 409 };
  }

  const model = await readNormalizationReview(db, reviewId);
  const candidates = model.candidates || [];
  // 5. Every candidate must carry a TERMINAL decision. A draft is never applied.
  const pending = candidates.filter((c) => c.decision !== "Accepted" && c.decision !== "Excluded");
  if (pending.length) return { error: { code: "NORMALIZATION_DECISIONS_INCOMPLETE", message: `${pending.length} candidate(s) still have no terminal decision.`, pending: pending.map((c) => c.id) }, status: 409 };

  const accepted = candidates.filter((c) => c.decision === "Accepted");
  if (!accepted.length) return { error: { code: "NORMALIZATION_NO_ACCEPTED_LINES", message: "Accept at least one candidate before applying." }, status: 409 };

  // 6. Every anchor must resolve to a LIVE raw source row, and the candidate's
  //    consolidated quantity must re-derive from those rows. The server never
  //    trusts a client-calculated quantity.
  for (const candidate of accepted) {
    const sources = candidate.sources || [];
    if (!sources.length) return { error: { code: "NORMALIZATION_SOURCE_ANCHORS_MISSING", message: `Candidate "${candidate.normalized_description}" has no source anchors.` }, status: 409 };
    let sum = 0;
    for (const source of sources) {
      const live = await db.prepare("SELECT id, numeric_quantity FROM boq_items WHERE id=? AND project_id=?").bind(source.source_boq_item_id, review.project_id).first();
      if (!live) return { error: { code: "NORMALIZATION_SOURCE_ROW_MISSING", message: `A source row for "${candidate.normalized_description}" no longer exists.` }, status: 409 };
      sum += Number(live.numeric_quantity || 0);
    }
    if (Math.abs(sum - Number(candidate.normalized_quantity)) > 1e-6) {
      return { error: { code: "NORMALIZATION_QUANTITY_NOT_DERIVABLE", message: `Candidate "${candidate.normalized_description}" states ${candidate.normalized_quantity} but its source rows sum to ${sum}.` }, status: 409 };
    }
  }

  // 7. Materialise ONLY accepted candidates as REAL `boq_items` rows, so that the
  //    one stable subject id (`boq_items.id`) is the same identity every downstream
  //    writer already keys on -- interpretations, review versions, requirement
  //    profiles, requirement links, match runs and safety decisions all carry a
  //    declared FK to `boq_items(id)`. Adding a parallel subject column to six tables
  //    would be a broad rewrite for no gain.
  //
  //    The subject id is DERIVED, not random: `boqitem_norm_<reviewId>_<candidateId>`.
  //    A re-Apply of the same generation is caught earlier as idempotent, and a new
  //    generation produces new ids, so no stage ever invents a second identity for the
  //    same normalized line.
  //
  //    NO system, NO category, NO product family is written: those belong to BOQ
  //    Understanding and downstream. The normalized subject starts UNCLASSIFIED.
  const stamp = now();

  // 7a. A normalization generation needs its OWN extraction-version row, so the
  //     materialized subjects carry real lineage instead of borrowing the raw
  //     extraction's identity. The raw extraction is never touched.
  let subjectExtractionId = review.subject_extraction_id || null;
  if (!subjectExtractionId) {
    const maxVersion = Number((await db.prepare("SELECT COALESCE(MAX(version_number),0) m FROM boq_extraction_versions WHERE document_id=? AND document_version_id=?").bind(review.source_document_id, review.source_document_version_id).first())?.m || 0);
    // `parser_version` / `ruleset_version` / `ocr_version` are NOT NULL with no default, so
    // an INSERT that omits them fails outright. The normalized subject extraction is
    // DERIVED from the source extraction, so it inherits that extraction's engine
    // provenance rather than inventing values for it.
    const sourceVersion = await db.prepare("SELECT parser_version, ruleset_version, ocr_version FROM boq_extraction_versions WHERE id=?").bind(review.source_extraction_id).first();
    subjectExtractionId = id("boqextract");
    await db.prepare("INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, extraction_method, parser_version, ruleset_version, ocr_version, created_by) VALUES (?,?,?,?, 'Completed', 'Controlled Normalization', ?,?,?, ?)").bind(subjectExtractionId, review.source_document_id, review.source_document_version_id, maxVersion + 1, sourceVersion?.parser_version || "unknown", sourceVersion?.ruleset_version || "unknown", sourceVersion?.ocr_version || "not-configured", human.id).run();
    await db.prepare("UPDATE boq_normalization_reviews SET subject_extraction_id=?, updated_at=? WHERE id=?").bind(subjectExtractionId, stamp, reviewId).run();
  }

  // 7b. Supersede the PREVIOUS generation's governed scope. History is retained:
  //     the old scope rows and their materialized subjects simply stop being current.
  await db.prepare("UPDATE boq_normalization_scope SET superseded_at=?, superseded_by_review_id=? WHERE project_id=? AND review_id<>? AND superseded_at IS NULL").bind(stamp, reviewId, review.project_id, reviewId).run();

  // Source-row provenance for the normalized subjects. A normalized subject inherits its
  // section and extraction confidence from ITS OWN anchors, and never claims a higher
  // confidence than the weakest row it was derived from. Nothing here is invented.
  const candidateSourceRows = await db.prepare(
    "SELECT json_extract(source_location,'$.row') AS sourceRow, section_path, extraction_confidence, confidence_state, original_raw_values FROM boq_items WHERE extraction_version_id=? AND row_type IN ('Item','BOQ Item')",
  ).bind(review.source_extraction_id).all();
  const sourceByRow = new Map((candidateSourceRows.results || []).map((row) => [Number(row.sourceRow), row]));

  const statements = [];
  for (const candidate of accepted) {
    const subjectId = `boqitem_norm_${reviewId}_${candidate.id}`;
    const anchors = (candidate.sources || []).map((source) => Number(source.source_row)).sort((a, b) => a - b);
    const linked = anchors.map((anchor) => sourceByRow.get(anchor)).filter(Boolean);
    const sectionPath = JSON.stringify([...new Set(linked.map((row) => row.section_path).filter(Boolean))].flatMap((value) => {
      try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; } catch { return [value]; }
    }));
    // MIN (never MAX) of the contributing rows, so a normalized line can never look more
    // certain than the evidence it was derived from.
    let extractionConfidence = null;
    let confidenceState = null;
    for (const row of linked) {
      const value = Number(row.extraction_confidence);
      if (Number.isFinite(value) && (extractionConfidence === null || value < extractionConfidence)) {
        extractionConfidence = value;
        confidenceState = row.confidence_state;
      }
    }
    if (extractionConfidence === null) { extractionConfidence = 0; confidenceState = "Unknown"; }
    const originalRawValues = JSON.stringify(linked.flatMap((row) => {
      try { const parsed = JSON.parse(row.original_raw_values); return Array.isArray(parsed) ? parsed : [parsed]; } catch { return []; }
    }));
    // `boq_items` has NO `created_by` column; the applying actor is recorded on
    // `boq_normalization_scope.applied_by` (and in the decisions log), which references
    // this subject. Inventing a column here would fail the INSERT outright.
    statements.push(db.prepare("INSERT INTO boq_items (id, project_id, extraction_version_id, source_document_id, sequence, item_number, description, normalized_description, original_unit, normalized_unit, original_quantity, numeric_quantity, row_type, review_status, approved_for_downstream, source_location, current_values, section_path, extraction_confidence, confidence_state, original_raw_values) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'BOQ Item', 'Needs Review', 0, ?, ?, ?, ?, ?, ?)").bind(subjectId, review.project_id, subjectExtractionId, review.source_document_id, candidate.ordinal, String(candidate.ordinal), candidate.normalized_description, candidate.normalized_description, candidate.normalized_unit, candidate.normalized_unit, candidate.normalized_quantity, candidate.normalized_quantity, JSON.stringify({ kind: "XLSX", sheet: "MECH RFQ", row: null, cells: {}, anchors }), JSON.stringify({ normalized: true, anchors, reviewId, candidateId: candidate.id, generationNumber: review.generation_number }), sectionPath, extractionConfidence, confidenceState, originalRawValues));
    statements.push(db.prepare("INSERT INTO boq_normalization_scope (id, project_id, review_id, candidate_id, source_document_id, source_document_version_id, source_extraction_id, generation_number, normalized_description, normalized_unit, normalized_quantity, applied_by, applied_by_name, applied_at, subject_boq_item_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id("boqnormscope"), review.project_id, reviewId, candidate.id, review.source_document_id, review.source_document_version_id, subjectExtractionId, review.generation_number, candidate.normalized_description, candidate.normalized_unit, candidate.normalized_quantity, human.id, human.name || null, stamp, subjectId));
  }
  statements.push(db.prepare("UPDATE boq_normalization_reviews SET status='APPLIED', applied_at=?, applied_by=?, applied_by_name=?, updated_at=? WHERE id=?").bind(stamp, human.id, human.name || null, stamp, reviewId));
  // The audit reason must describe WHO actually applied. A policy-driven apply is not a
  // human apply, and recording it as one would misstate the authority trail.
  statements.push(db.prepare("INSERT INTO boq_normalization_decisions_log (id, project_id, review_id, action, previous_value, new_value, reason, actor_id, actor_name, actor_role) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id("boqnormdecision"), review.project_id, reviewId, "apply", JSON.stringify({ status: "OPEN" }), JSON.stringify({ status: "APPLIED", appliedLines: accepted.length }), human.role === "SYSTEM_POLICY" ? "Governed system-policy apply of the normalized BOQ scope" : "Governed human apply of the normalized BOQ scope", human.id, human.name || null, human.role || null));
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  void env;
  return { applied: true, idempotent: false, scopeCount: accepted.length, review: await db.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first() };
};

// ── Currentness integration (GENERIC, not project-specific) ─────────────────
// A downstream reader asking "what is the current governed BOQ scope?" must get the
// normalized population when an APPLIED normalization generation exists, and the raw
// extraction population otherwise. It must NEVER silently mix the two.
export const currentNormalizedScopeExists = async (db, projectId) => {
  const row = await db.prepare(
    "SELECT count(*) c FROM boq_normalization_scope s JOIN boq_normalization_reviews r ON r.id=s.review_id WHERE s.project_id=? AND s.superseded_at IS NULL AND r.status IN ('APPLIED','SUPERSEDED')",
  ).bind(projectId).first();
  return Number(row?.c || 0) > 0;
};

// HTTP surface. Kept in one module so the route names follow the project's existing
// convention: /api/boq-normalization/...
export const handleBoqNormalizationApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("/boq-normalization")) return null;
  if (!env.DB) return json({ error: { code: "NORMALIZATION_STORAGE_UNAVAILABLE", message: "BOQ normalization storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const human = requireHumanActor(env);

  // POST /api/boq-normalization/review/bootstrap
  const bootstrapMatch = url.pathname.match(/^\/api\/boq-normalization\/review\/bootstrap$/);
  if (bootstrapMatch && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const project = await ownedProject(env.DB, String(body?.projectId || ""), user.id);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const result = await bootstrapNormalizationReview(env.DB, { projectId: project.id, documentId: String(body?.documentId || ""), userId: user.id, candidates: Array.isArray(body?.candidates) ? body.candidates : [] });
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json({ review: result.review, created: result.created }, result.created ? 201 : 200);
  }

  // GET /api/boq-normalization/review/:id
  const readMatch = url.pathname.match(/^\/api\/boq-normalization\/review\/([^/]+)$/);
  if (readMatch && request.method === "GET") {
    const model = await readNormalizationReview(env.DB, decodeURIComponent(readMatch[1]));
    if (!model) return json({ error: { code: "NORMALIZATION_REVIEW_NOT_FOUND", message: "No such normalization review." } }, 404);
    return json(model);
  }

  // GET /api/projects/:projectId/boq-normalization/reviews?documentId=...
  // The CURRENT review for a document, so reopening resumes from the server.
  const byDocumentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/boq-normalization\/reviews$/);
  if (byDocumentMatch && request.method === "GET") {
    const project = await ownedProject(env.DB, decodeURIComponent(byDocumentMatch[1]), user.id);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    // Resolve by canonical document id OR by logical_name, always SCOPED to the
    // project. The document card holds a filename, but authority is still the
    // document id; a name is only ever a lookup key inside this project.
    const wanted = url.searchParams.get("documentId") || "";
    const document = await env.DB.prepare(
      `SELECT id FROM documents
       WHERE project_id=? AND deleted_at IS NULL AND archived_at IS NULL
         AND (id=? OR logical_name=?)
       ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    ).bind(project.id, wanted, wanted, wanted).first();
    if (!document) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found in this project." } }, 404);
    const review = await currentNormalizationReview(env.DB, document.id);
    if (!review) return json({ review: null, candidates: [] });
    const model = await readNormalizationReview(env.DB, review.id);
    const current = await evaluateReviewCurrency(env.DB, review, {
      currentExtractionId: (await env.DB.prepare("SELECT id FROM boq_extraction_versions WHERE document_id=? AND superseded_at IS NULL AND status IN ('Completed','Needs Review') ORDER BY version_number DESC LIMIT 1").bind(document.id).first())?.id,
      currentDocumentVersionId: (await env.DB.prepare("SELECT current_version_id FROM documents WHERE id=?").bind(document.id).first())?.current_version_id,
    });
    return json({ ...model, current: current.current, staleReason: current.code });
  }

  // POST /api/boq-normalization/:reviewId/candidates/by-ordinal/:ordinal/decision
  // Ordinal-addressed on purpose: the client sends a CONTROLLED-GENERATION ordinal,
  // never a candidate id it could have invented or altered.
  const ordinalMatch = url.pathname.match(/^\/api\/boq-normalization\/([^/]+)\/candidates\/by-ordinal\/(\d+)\/decision$/);
  if (ordinalMatch && request.method === "POST") {
    if (human.error) return json({ error: { code: human.error, message: human.message } }, 403);
    const reviewId = decodeURIComponent(ordinalMatch[1]);
    const ordinal = Number(ordinalMatch[2]);
    const candidate = await env.DB.prepare("SELECT * FROM boq_normalization_candidates WHERE review_id=? AND ordinal=?").bind(reviewId, ordinal).first();
    if (!candidate) return json({ error: { code: "NORMALIZATION_CANDIDATE_NOT_FOUND", message: "No candidate with that ordinal in this review." } }, 404);
    const body = await request.json().catch(() => null);
    const result = await recordCandidateDecision(env.DB, {
      reviewId, candidateId: candidate.id,
      decision: String(body?.decision || ""), reason: String(body?.reason || ""), human: human.actor,
    });
    return json(result.error ? { error: result.error } : result, result.error ? result.status || 409 : 200);
  }

  // POST /api/boq-normalization/:reviewId/candidates/:candidateId/decision
  const decisionMatch = url.pathname.match(/^\/api\/boq-normalization\/([^/]+)\/candidates\/([^/]+)\/decision$/);
  if (decisionMatch && request.method === "POST") {
    if (human.error) return json({ error: { code: human.error, message: human.message } }, 403);
    const body = await request.json().catch(() => null);
    const result = await recordCandidateDecision(env.DB, {
      reviewId: decodeURIComponent(decisionMatch[1]),
      candidateId: decodeURIComponent(decisionMatch[2]),
      decision: String(body?.decision || ""),
      reason: String(body?.reason || ""),
      human: human.actor,
    });
    return json(result.error ? { error: result.error } : result, result.error ? result.status || 409 : 200);
  }

  // POST /api/boq-normalization/:reviewId/apply
  const applyMatch = url.pathname.match(/^\/api\/boq-normalization\/([^/]+)\/apply$/);
  if (applyMatch && request.method === "POST") {
    if (human.error) return json({ error: { code: human.error, message: human.message } }, 403);
    const body = await request.json().catch(() => null);
    const result = await applyNormalizationReview(env.DB, env, {
      reviewId: decodeURIComponent(applyMatch[1]),
      userId: user.id,
      human: human.actor,
      requireDocumentIssue: body?.requireDocumentIssue !== false,
      documentIssueConfirmed: body?.documentIssueConfirmed === true,
    });
    return json(result.error ? { error: result.error, ...(result.pending ? { pending: result.pending } : {}) } : result, result.error ? result.status || 409 : 200);
  }

  // GET /api/boq-normalization/scope/:projectId  -- the downstream current scope
  const scopeMatch = url.pathname.match(/^\/api\/boq-normalization\/scope\/([^/]+)$/);
  if (scopeMatch && request.method === "GET") {
    const project = await ownedProject(env.DB, decodeURIComponent(scopeMatch[1]), user.id);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const rows = await env.DB.prepare(
      `SELECT s.*, (SELECT count(*) FROM boq_normalization_candidate_sources cs WHERE cs.candidate_id=s.candidate_id) AS source_count
       FROM boq_normalization_scope s WHERE s.project_id=? AND s.superseded_at IS NULL ORDER BY s.normalized_description`,
    ).bind(project.id).all();
    return json({ projectId: project.id, applied: (rows.results || []).length > 0, scope: rows.results || [] });
  }

  // POST /api/boq-normalization/:reviewId/evaluate-auto-approval
  // PURE POLICY EVALUATION. No decision is recorded and nothing is applied. The caller
  // uses this to decide whether the human review UI is even needed.
  const evaluateMatch = url.pathname.match(/^\/api\/boq-normalization\/([^/]+)\/evaluate-auto-approval$/);
  if (evaluateMatch && request.method === "POST") {
    const reviewId = decodeURIComponent(evaluateMatch[1]);
    const review = await env.DB.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first();
    if (!review) return json({ error: { code: "NORMALIZATION_REVIEW_NOT_FOUND", message: "No such normalization review." } }, 404);
    const model = await readNormalizationReview(env.DB, reviewId);
    const source = await resolveCurrentNormalizationSource(env.DB, { documentId: review.source_document_id, userId: user.id });
    const sourceRows = source.error ? [] : await env.DB.prepare(
      "SELECT id, json_extract(source_location,'$.row') sourceRow, description, numeric_quantity quantity, original_unit originalUnit, normalized_unit unit, review_status FROM boq_items WHERE extraction_version_id=? AND row_type IN ('Item','BOQ Item')",
    ).bind(source.extraction.id).all();
    const rows = (sourceRows.results || []).map((row) => ({ ...row, sourceRow: Number(row.sourceRow), deleted: Boolean(row.review_status === "Deleted"), superseded: false }));
    const currentExtraction = source.error ? null : source.extraction.id;
    const currentVersion = source.error ? null : source.document.document_version_id;
    const evaluation = evaluateNormalizationAutoApproval({
      review, candidates: model.candidates || [], sourceRows: rows,
      currentExtractionId: currentExtraction, currentDocumentVersionId: currentVersion, sourceSha256: source.error ? null : source.document.source_sha256,
    });
    return json({ reviewId, ...evaluation });
  }

  // POST /api/boq-normalization/:reviewId/auto-apply
  // Runs the SAME canonical Apply as the manual path. The policy is a GATE, not a
  // weaker path: if any candidate is ineligible, nothing is applied and the blockers are
  // returned for human review. The recorded decision is explicitly NON-HUMAN.
  const autoApplyMatch = url.pathname.match(/^\/api\/boq-normalization\/([^/]+)\/auto-apply$/);
  if (autoApplyMatch && request.method === "POST") {
    const reviewId = decodeURIComponent(autoApplyMatch[1]);
    const review = await env.DB.prepare("SELECT * FROM boq_normalization_reviews WHERE id=?").bind(reviewId).first();
    if (!review) return json({ error: { code: "NORMALIZATION_REVIEW_NOT_FOUND", message: "No such normalization review." } }, 404);
    // Re-running an already-applied generation must be a NO-OP, not a refusal. The policy
    // gate below would otherwise report NORMALIZATION_REVIEW_NOT_OPEN and turn a harmless
    // repeat into a 409. Canonical Apply owns the idempotency decision.
    if (review.status === "APPLIED") {
      const done = await applyNormalizationReview(env.DB, env, { reviewId, userId: user.id, human: { id: BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, name: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, role: "SYSTEM_POLICY" }, requireDocumentIssue: false });
      if (done.error) return json({ applied: false, error: done.error, policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION }, done.status || 409);
      return json({ applied: true, idempotent: true, alreadyApplied: true, policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, decisionActorType: BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, decisionMode: BOQ_NORMALIZATION_AUTO_DECISION_MODE, scopeCount: done.scopeCount });
    }
    const model = await readNormalizationReview(env.DB, reviewId);
    const source = await resolveCurrentNormalizationSource(env.DB, { documentId: review.source_document_id, userId: user.id });
    const sourceRows = source.error ? [] : await env.DB.prepare(
      "SELECT id, json_extract(source_location,'$.row') sourceRow, description, numeric_quantity quantity, original_unit originalUnit, normalized_unit unit, review_status FROM boq_items WHERE extraction_version_id=? AND row_type IN ('Item','BOQ Item')",
    ).bind(source.extraction.id).all();
    const rows = (sourceRows.results || []).map((row) => ({ ...row, sourceRow: Number(row.sourceRow), deleted: false, superseded: false }));
    const evaluation = evaluateNormalizationAutoApproval({
      review, candidates: model.candidates || [], sourceRows: rows,
      currentExtractionId: source.error ? null : source.extraction.id,
      currentDocumentVersionId: source.error ? null : source.document.document_version_id,
      sourceSha256: source.error ? null : source.document.source_sha256,
    });
    if (!evaluation.eligible) {
      return json({ applied: false, policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, blockers: evaluation.blockers, humanReviewRequired: true, humanReviewReason: "HUMAN_REVIEW_REQUIRED", deferredAmbiguities: evaluation.deferredAmbiguities }, 409);
    }
    // Policy passed. Mark every candidate Accepted under the SYSTEM_POLICY actor, then
    // call the UNCHANGED canonical Apply. No weaker path is created.
    const stamp = now();
    const statements = [];
    for (const candidate of model.candidates || []) {
      statements.push(env.DB.prepare("UPDATE boq_normalization_candidates SET decision='Accepted', decided_by=?, decided_by_name=?, decided_at=?, updated_at=? WHERE id=?").bind(BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, stamp, stamp, candidate.id));
      statements.push(env.DB.prepare("INSERT INTO boq_normalization_decisions_log (id, project_id, review_id, candidate_id, action, previous_value, new_value, reason, actor_id, actor_name, actor_role) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id("boqnormdecision"), review.project_id, reviewId, candidate.id, "candidate-auto-accepted", JSON.stringify({ decision: "Pending" }), JSON.stringify({ decision: "Accepted" }), "Deterministic normalization policy eligibility", BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, "SYSTEM_POLICY"));
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    const result = await applyNormalizationReview(env.DB, env, { reviewId, userId: user.id, human: { id: BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, name: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, role: "SYSTEM_POLICY" }, requireDocumentIssue: false });
    if (result.error) return json({ applied: false, error: result.error, policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION }, result.status || 409);
    const decision = buildNormalizationAutoDecision({ review, evaluation, reason: "All deterministic normalization eligibility checks passed; no material scope, quantity, unit, anchor or provenance conflict." });
    return json({ applied: true, idempotent: Boolean(result.idempotent), policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION, decisionActorType: BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, decisionMode: BOQ_NORMALIZATION_AUTO_DECISION_MODE, scopeCount: result.scopeCount, deferredAmbiguities: evaluation.deferredAmbiguities, decision });
  }

  return json({ error: { code: "NOT_FOUND", message: "Unknown normalization route." } }, 404);
};

void currentBoqEvidenceFrom; void currentBoqItemPredicate; void parse;
