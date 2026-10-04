import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { currentSymbolRecognitionVersion } from "./drawing-symbol-recognition-api.mjs";
import { loadCrossSheetGovernedQuantityEvidence, CROSS_SHEET_EVIDENCE_MODE } from "./drawing-cross-sheet-quantity-evidence-loader.mjs";
import { SAME_DOCUMENT_EVIDENCE_MODE } from "../app/domain/drawing-cross-sheet-quantity-evidence.mjs";
// Stage 6A (2026-08-31): APPROVED DRAWING QUANTITY EVIDENCE INFRASTRUCTURE.
// Quantity evidence is always computed LIVE from the current authoritative
// occurrence review state -- never cached or persisted as a number -- so a
// review action (approve/reject/reassign) is reflected on the very next
// read with no separate recalculation step. Only coverage state (an
// explicit engineer judgement, never inferred) is persisted, append-only.
import {
  computeApprovedQuantityEvidence,
  compareDrawingEvidenceToBoq,
  COVERAGE_STATES,
  DEFAULT_COVERAGE_STATE,
} from "../app/domain/drawing-quantity-evidence-engine.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { resolveProjectAuthority } from "./project-authority.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = null) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};
// AUTHORIZATION IS NOT OWNERSHIP. This previously gated on
// `projects.owner_user_id = ?`, which refuses a correctly-authorized
// server-configured administrator and reports it as a MISSING DRAWING --
// indistinguishable from the drawing not existing. Project ownership is one
// source of project authority, not its definition: `resolveProjectAuthority`
// also resolves an active `project_members` role and an explicit
// server-configured Administrator.
//
// The document is still resolved through current, non-deleted project state and
// the organization scope is still enforced; only the actor check is corrected to
// the single canonical resolver, exactly as `quantity-source-decision-api.mjs`
// now does. Refusal is separate and truthful (403), never a misleading 404.
const visibleDocument = (db, documentId, organizationId) =>
  db
    .prepare(
      "SELECT d.*,p.id project_id FROM documents d JOIN projects p ON p.id=d.project_id AND p.organization_id=? WHERE d.id=? AND d.deleted_at IS NULL",
    )
    .bind(organizationId, documentId)
    .first();
// The same "latest non-superseded" version-safety pattern used throughout
// this codebase's other governed drawing tables -- a superseded recognition
// version is never a valid source of current quantity evidence.
const currentRecognitionVersion = (db, documentId) => currentSymbolRecognitionVersion(db, documentId);
// rowid (not created_at, which is CURRENT_TIMESTAMP-based and only has
// 1-second resolution -- two coverage decisions made within the same
// second would otherwise tie) strictly increases with insertion order on
// a real SQLite/D1 rowid table, so it is the only reliable "most recent"
// ordering for this append-only table.
const currentCoverage = (db, recognitionVersionId) =>
  db
    .prepare(
      "SELECT * FROM drawing_quantity_evidence_coverage WHERE recognition_version_id=? ORDER BY rowid DESC LIMIT 1",
    )
    .bind(recognitionVersionId)
    .first();
const loadEvidence = async (db, document, version) => {
  const [definitions, occurrences, coverage] = await Promise.all([
    db
      .prepare("SELECT * FROM drawing_symbol_definitions WHERE recognition_version_id=?")
      .bind(version.id)
      .all(),
    db
      .prepare("SELECT * FROM drawing_symbol_occurrences WHERE recognition_version_id=?")
      .bind(version.id)
      .all(),
    currentCoverage(db, version.id),
  ]);
  const evidence = computeApprovedQuantityEvidence({
    occurrences: (occurrences.results || []).map((row) => ({
      id: row.id,
      pageNumber: row.page_number,
      boundingBox: parse(row.bounding_box),
      matchedDefinitionKey: row.definition_id,
      matchType: row.match_basis?.startsWith("Approximate") ? "Approximate" : row.shape_signature?.startsWith("text:") ? "Text Tag" : "Exact",
      confidence: row.confidence,
      reviewStatus: row.review_status,
      scoreComponents: parse(row.score_components),
    })),
    // definition_id (a real drawing_symbol_definitions.id) is the join key
    // in storage; the domain engine groups by its own definitionKey concept,
    // so definitions are hydrated with definitionKey=id for this call site.
    definitions: (definitions.results || []).map((row) => ({
      definitionKey: row.id,
      abbreviation: row.abbreviation,
      description: row.description,
    })),
    recognitionVersionId: version.id,
    documentId: document.id,
  });
  return {
    ...evidence,
    coverageState: coverage?.coverage_state || DEFAULT_COVERAGE_STATE,
    coverageSetBy: coverage?.set_by || null,
    coverageSetAt: coverage?.created_at || null,
    coverageReason: coverage?.reason || null,
    sourceDocument: { id: document.id, logicalName: document.logical_name },
  };
};

export const handleDrawingQuantityEvidenceApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("drawing-quantity-evidence")) return null;
  if (!env.DB)
    return json({ error: { code: "QUANTITY_EVIDENCE_UNAVAILABLE", message: "Quantity evidence storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const docRoute = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-quantity-evidence(?:\/(coverage|compare))?$/);
  if (!docRoute) return null;
  const document = await visibleDocument(env.DB, decodeURIComponent(docRoute[1]), user.organizationId);
  if (!document) return json({ error: { code: "DRAWING_NOT_FOUND", message: "Drawing document not found." } }, 404);
  const authority = await resolveProjectAuthority(env.DB, { projectId: document.project_id, actor: user });
  if (!authority) {
    return json({
      error: {
        code: "DRAWING_QUANTITY_EVIDENCE_NOT_AUTHORIZED",
        message: "The configured actor has no authority on this project, so no drawing quantity evidence can be read or recorded.",
      },
    }, 403);
  }
  const op = docRoute[2];

  // TWO GOVERNED INPUT MODES, chosen deterministically.
  //
  // 1. SAME-DOCUMENT RECOGNITION (unchanged, still first): a current recognition
  //    version for THIS document. Definition, recognition and occurrences all
  //    live on one sheet.
  // 2. CROSS_SHEET GOVERNED OCCURRENCE EVIDENCE (added): no recognition version
  //    exists for this document, but a human-governed chain does -- a governed
  //    legend definition here, governed cross-sheet applicability, governed
  //    target drawing numbers, exact occurrence provenance and measured
  //    coverage. Mode 2 is a FALLBACK, never a bypass: it is used only when
  //    mode 1 is absent, and it fails closed on every eligibility condition.
  const version = await currentRecognitionVersion(env.DB, document.id);
  if (!version) {
    if (op && request.method !== "GET") {
      // Coverage recording and BOQ comparison stay bound to a recognition
      // version; cross-sheet mode is a READ surface until that mapping exists.
      return json({ error: { code: "SYMBOL_RECOGNITION_REQUIRED", message: "This operation requires a same-document symbol recognition version." } }, 409);
    }
    const crossSheet = await loadCrossSheetGovernedQuantityEvidence(env.DB, { projectId: document.project_id, legendDocumentId: document.id });
    if (!crossSheet.ok) {
      return json({
        error: {
          code: "SYMBOL_RECOGNITION_REQUIRED",
          message: "Complete symbol recognition before requesting quantity evidence.",
          crossSheetEvidence: { evidenceMode: CROSS_SHEET_EVIDENCE_MODE, failedConditions: crossSheet.failedConditions },
        },
      }, 409);
    }
    return json({
      ...crossSheet.handoff,
      sourceDocument: { id: document.id, logicalName: document.logical_name },
      coverageState: null,
      coverageSetBy: null,
      coverageSetAt: null,
      coverageReason: "Cross-sheet governed occurrence evidence; per-sheet measured coverage is reported in `coverage`.",
      modeResolution: { selected: CROSS_SHEET_EVIDENCE_MODE, sameDocumentRecognitionAvailable: false, preservedAlternative: SAME_DOCUMENT_EVIDENCE_MODE },
    });
  }
  if (!op && request.method === "GET") {
    const evidence = await loadEvidence(env.DB, document, version);
    return json({ ...evidence, evidenceMode: SAME_DOCUMENT_EVIDENCE_MODE, modeResolution: { selected: SAME_DOCUMENT_EVIDENCE_MODE, crossSheetFallbackAvailable: true } });
  }
  if (op === "coverage" && request.method === "POST") {
    const body = await request.json(),
      coverageState = String(body.coverageState || ""),
      reason = String(body.reason || "").trim();
    if (!COVERAGE_STATES.includes(coverageState))
      return json(
        { error: { code: "COVERAGE_STATE_INVALID", message: `coverageState must be one of: ${COVERAGE_STATES.join(", ")}.` } },
        422,
      );
    if (reason.length < MIN_GOVERNED_REASON_LENGTH)
      return json({ error: { code: "COVERAGE_REASON_REQUIRED", message: "Provide a substantive coverage reason." } }, 422);
    await env.DB.prepare(
      "INSERT INTO drawing_quantity_evidence_coverage (id,project_id,recognition_version_id,coverage_state,reason,set_by) VALUES (?,?,?,?,?,?)",
    )
      .bind(id("evidenceCoverage"), document.project_id, version.id, coverageState, reason, user.id)
      .run();
    return json(await loadEvidence(env.DB, document, version));
  }
  if (op === "compare" && request.method === "GET") {
    const definitionKey = url.searchParams.get("definitionKey"),
      boqItemId = url.searchParams.get("boqItemId");
    if (!definitionKey || !boqItemId)
      return json({ error: { code: "COMPARISON_PARAMETERS_REQUIRED", message: "definitionKey and boqItemId are required." } }, 422);
    const evidence = await loadEvidence(env.DB, document, version),
      evidenceGroup = evidence.groups.find((group) => group.definitionKey === definitionKey);
    if (!evidenceGroup)
      return json({ error: { code: "EVIDENCE_GROUP_NOT_FOUND", message: "No approved evidence group for this legend identity." } }, 404);
    // Only a BOQ item from the SAME project is eligible -- there is no
    // direct FK between boq_items and a drawing recognition version, so
    // project_id is the real, existing scoping key used here.
    const boqItem = await env.DB.prepare("SELECT * FROM boq_items WHERE id=? AND project_id=?")
      .bind(boqItemId, document.project_id)
      .first();
    if (!boqItem) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found in this project." } }, 404);
    const review = await env.DB.prepare(
      "SELECT * FROM estimator_understanding_review_versions WHERE boq_item_id=? ORDER BY version_number DESC LIMIT 1",
    )
      .bind(boqItemId)
      .first();
    const comparison = compareDrawingEvidenceToBoq({
      evidenceGroup,
      boqItem,
      canonicalInterpretation: review ? parse(review.canonical_interpretation, {}) : null,
      reviewStatus: review?.review_status || null,
      coverageState: evidence.coverageState,
    });
    return json({ evidenceGroup, boqItem: { id: boqItem.id, numeric_quantity: boqItem.numeric_quantity }, comparison });
  }
  return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
};
