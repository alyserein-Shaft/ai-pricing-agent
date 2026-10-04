import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { currentBoqEvidenceFrom } from "./current-evidence-scope.mjs";
// Stage 9 (2026-09-01): DRAWING -> REQUIREMENT -> KNOWLEDGE HANDOFF, Section 5.
//
// Drawing quantity (Stage 6A) and BOQ quantity are two separate evidence
// sources -- neither may silently overwrite the other. When a discrepancy is
// meaningful, the engineer makes ONE compact decision here: Use BOQ Qty,
// Use Drawing Qty, or Enter Reviewed Qty. That decision -- never either raw
// number by itself -- becomes the quantity downstream BOM/Costing/Quotation
// actually consumes (see currentSelectedQuantity, exported for those read
// sites). boq_items.numeric_quantity itself is never mutated by this file.
//
// Append-only, like drawing_quantity_evidence_coverage: a new decision
// INSERTs a new row; the latest row per boq_item_id is current.
//
// DRAW-QTY-1 (2026-09-27): "Use Drawing Qty" NO LONGER PROMOTES A COUNT.
// This file previously set selectedQuantity = approvedOccurrenceCount and
// persisted it into boq_quantity_source_decisions.selected_quantity, which is
// the single number BOM, Costing, Pricing, Quotation, Export, panel sizing
// and the pre-sales agent all read back through currentSelectedQuantity.
// That was a quantity-contract defect: an approved occurrence is a recognised
// legend ROW, not an installed device. On the reviewed WLC T-93 sheet the
// governed surface holds 27 approved occurrences while the sheet's own text
// layer prints 36 count cells totalling 248 devices.
//
// The authority already existed elsewhere in this repository and was being
// violated here -- drawing-evidence-authority-policy.mjs states a drawing
// count is "discrepancy evidence only, not authoritative", and
// drawing-quantity-evidence-engine.mjs states its own number is "never how
// many devices exist in the project". The gate below enforces that policy
// rather than inventing a new one.
//
// The engineer-facing capability is not lost. "Use Drawing Qty" is refused;
// "Enter Reviewed Qty" already provides the governed path for a quantity an
// engineer establishes from a drawing review, with a mandatory reason, a
// decider, and an append-only audit row.
import { computeApprovedQuantityEvidence, compareDrawingEvidenceToBoq } from "../app/domain/drawing-quantity-evidence-engine.mjs";
import { evaluateDrawingQuantityRequest } from "../app/domain/drawing-printed-quantity-contract.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { resolveProjectAuthority } from "./project-authority.mjs";
import { currentSymbolRecognitionVersion } from "./drawing-symbol-recognition-api.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = null) => { try { return JSON.parse(value || ""); } catch { return fallback; } };

// EVIDENCE-CURRENCY-1: the quantity-decision write gate reads through current
// evidence, not the raw table. A decision recorded against a superseded,
// retired, or deleted item's row would never be read (every consumer resolves
// through current items) -- worse, the GET would display its raw quantity as
// live. Non-current items 404 here, the same boundary pricing uses.
//
// AUTHORIZATION IS NOT OWNERSHIP. This helper previously joined
// `projects.owner_user_id=?` and so answered two different questions with one
// predicate: "is this item current?" and "may this actor decide?". They are not
// the same. Project ownership is one *source* of project authority, not the
// definition of it: `resolveProjectAuthority` also resolves an active
// `project_members` role and, for a server-configured single-user application
// actor, an explicit Administrator role. The owner-only join silently refused a
// correctly-authorized administrator with `BOQ_ITEM_NOT_FOUND` -- a 404 that
// claims the item does not exist, for an item that plainly does.
//
// That is the same defect class `worker/project-authority.mjs` already records:
// a second, narrower authority copy that disagrees with the shared one. The
// fix is not to loosen this predicate but to stop duplicating authority here:
// currency stays local, authorization goes through the single canonical
// resolver. The item is therefore resolved WITHOUT an owner join, and the
// handler refuses separately (and truthfully, with 403) when the actor has no
// project authority at all.
const currentItem = (db, itemId) =>
  db.prepare(`SELECT b.* FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=?`).bind(itemId).first();

// rowid, not created_at -- see drawing-quantity-evidence-api.mjs's identical
// reasoning: CURRENT_TIMESTAMP only has 1-second resolution.
export const currentQuantityDecision = (db, boqItemId) =>
  db.prepare("SELECT * FROM boq_quantity_source_decisions WHERE boq_item_id=? ORDER BY rowid DESC LIMIT 1").bind(boqItemId).first();

// The single read site downstream consumers (BOM, Costing, Quotation) call
// instead of boq_items.numeric_quantity directly. Falls back to the
// original BOQ-extracted quantity when no decision has ever been made --
// zero behavior change for every item this stage does not concern.
export const currentSelectedQuantity = async (db, boqItem) => {
  const decision = await currentQuantityDecision(db, boqItem.id);
  if (decision) {
    if (decision.source === "Drawing") {
      if (!boqItem.source_document_id) {
        return { value: null, source: "Drawing", status: "STALE", decisionId: decision.id, recognitionVersionId: decision.recognition_version_id || null, currentRecognitionVersionId: null, boqQuantity: decision.boq_quantity == null ? null : Number(decision.boq_quantity), drawingQuantity: decision.drawing_quantity == null ? null : Number(decision.drawing_quantity) };
      }
      const current = await currentSymbolRecognitionVersion(db, boqItem.source_document_id);
      if (!current || current.id !== decision.recognition_version_id) {
        return { value: null, source: "Drawing", status: "STALE", decisionId: decision.id, recognitionVersionId: decision.recognition_version_id || null, currentRecognitionVersionId: current?.id || null, boqQuantity: decision.boq_quantity == null ? null : Number(decision.boq_quantity), drawingQuantity: decision.drawing_quantity == null ? null : Number(decision.drawing_quantity) };
      }
    }
    return { value: decision.selected_quantity, source: decision.source, status: "VALID", decisionId: decision.id, recognitionVersionId: decision.recognition_version_id || null, boqQuantity: decision.boq_quantity == null ? null : Number(decision.boq_quantity), drawingQuantity: decision.drawing_quantity == null ? null : Number(decision.drawing_quantity) };
  }
  const fallback = boqItem.numeric_quantity != null ? Number(boqItem.numeric_quantity) : Number(boqItem.original_quantity) || null;
  return { value: Number.isFinite(fallback) ? fallback : null, source: "BOQ", status: Number.isFinite(fallback) ? "VALID" : "UNKNOWN", decisionId: null };
};

const currentRecognitionVersion = (db, documentId) => currentSymbolRecognitionVersion(db, documentId);

const liveDrawingComparison = async (db, item, documentId, definitionKey) => {
  if (!documentId || !definitionKey) return null;
  const version = await currentRecognitionVersion(db, documentId);
  if (!version) return null;
  const [definitions, occurrences, coverage] = await Promise.all([
    db.prepare("SELECT * FROM drawing_symbol_definitions WHERE recognition_version_id=?").bind(version.id).all(),
    db.prepare("SELECT * FROM drawing_symbol_occurrences WHERE recognition_version_id=?").bind(version.id).all(),
    db.prepare("SELECT * FROM drawing_quantity_evidence_coverage WHERE recognition_version_id=? ORDER BY rowid DESC LIMIT 1").bind(version.id).first(),
  ]);
  const evidence = computeApprovedQuantityEvidence({
    occurrences: (occurrences.results || []).map((row) => ({ id: row.id, pageNumber: row.page_number, matchedDefinitionKey: row.definition_id, reviewStatus: row.review_status, confidence: row.confidence })),
    definitions: (definitions.results || []).map((row) => ({ definitionKey: row.id, abbreviation: row.abbreviation, description: row.description })),
    recognitionVersionId: version.id, documentId,
  });
  const evidenceGroup = evidence.groups.find((group) => group.definitionKey === definitionKey);
  if (!evidenceGroup) return null;
  const review = await db.prepare("SELECT * FROM estimator_understanding_review_versions WHERE boq_item_id=? ORDER BY version_number DESC LIMIT 1").bind(item.id).first();
  const comparison = compareDrawingEvidenceToBoq({
    evidenceGroup, boqItem: item,
    canonicalInterpretation: review ? parse(review.canonical_interpretation, {}) : null,
    reviewStatus: review?.review_status || null,
    coverageState: coverage?.coverage_state,
  });
  return { evidenceGroup, comparison, recognitionVersionId: version.id };
};

// DRAW-QTY-1: the governed PRINTED-quantity rows for a document.
//
// This is a refusal, not a stub. A governed printed-quantity extraction does
// not exist for any drawing in this product, and the evidence says so
// directly: the only structurally parsed drawing in the reviewed project is
// the T-00 legend, while the WLC T-93 riser -- the sheet that prints 36
// "N Nos" cells totalling 248 devices -- has no drawing_structure_versions
// row at all. The printed counts therefore survive nowhere in governed state.
//
// Returning [] here makes evaluateDrawingQuantityRequest fail closed with
// PRINTED_COUNT_MISSING, which is the honest result. It is deliberately NOT
// derived from occurrence counts, and it is deliberately NOT papered over with
// a guessed tag-to-count association: only 12 of the 36 printed count cells
// have exactly one tag within 20pt, so no geometric rule available from the
// text layer can establish the pairing safely.
//
// When a governed printed-quantity source is built, it plugs in here and the
// gate below opens on its own.
export const governedPrintedQuantityRows = async () => [];

export const handleQuantitySourceDecisionApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("quantity-source-decision")) return null;
  if (!env.DB) return json({ error: { code: "QUANTITY_DECISION_UNAVAILABLE", message: "Quantity decision storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const match = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/quantity-source-decision$/);
  if (!match) return null;
  const item = await currentItem(env.DB, decodeURIComponent(match[1]));
  if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
  // Authorize through the single canonical project-authority resolver (owner OR
  // active member OR explicit server-configured Administrator), never through a
  // second ownership predicate local to this handler.
  const authority = await resolveProjectAuthority(env.DB, { projectId: item.project_id, actor: user });
  if (!authority) {
    return json({
      error: {
        code: "QUANTITY_DECISION_NOT_AUTHORIZED",
        message: "The configured actor has no authority on this project, so no quantity-source decision can be recorded.",
      },
    }, 403);
  }

  if (request.method === "GET") {
    const documentId = url.searchParams.get("documentId");
    const definitionKey = url.searchParams.get("definitionKey");
    const [current, history, live] = await Promise.all([
      currentQuantityDecision(env.DB, item.id),
      env.DB.prepare("SELECT * FROM boq_quantity_source_decisions WHERE boq_item_id=? ORDER BY rowid DESC").bind(item.id).all(),
      liveDrawingComparison(env.DB, item, documentId, definitionKey),
    ]);
    return json({
      boqItemId: item.id,
      boqQuantity: item.numeric_quantity != null ? Number(item.numeric_quantity) : null,
      drawingComparison: live?.comparison || null,
      current: current || null,
      history: history.results || [],
    });
  }

  if (request.method === "POST") {
    const body = await request.json();
    const source = String(body.source || "");
    const reason = String(body.reason || "").trim();
    if (!["BOQ", "Drawing", "Reviewed"].includes(source)) return json({ error: { code: "QUANTITY_SOURCE_INVALID", message: "source must be one of: BOQ, Drawing, Reviewed." } }, 422);
    if (reason.length < MIN_GOVERNED_REASON_LENGTH) return json({ error: { code: "QUANTITY_DECISION_REASON_REQUIRED", message: "Provide a substantive engineering reason." } }, 422);
    const boqQuantity = item.numeric_quantity != null ? Number(item.numeric_quantity) : null;
    let selectedQuantity = null; let drawingQuantity = null; let recognitionVersionId = null;
    if (source === "BOQ") {
      if (!Number.isFinite(boqQuantity)) return json({ error: { code: "BOQ_QUANTITY_UNAVAILABLE", message: "This BOQ item has no numeric quantity to select." } }, 422);
      selectedQuantity = boqQuantity;
    } else if (source === "Drawing") {
      const live = await liveDrawingComparison(env.DB, item, String(body.documentId || ""), String(body.definitionKey || ""));
      if (!live || !live.comparison.comparable) return json({ error: { code: "DRAWING_EVIDENCE_NOT_GOVERNED", message: "No governed, comparable drawing quantity evidence exists for this BOQ item." } }, 409);
      // DRAW-QTY-1: an approved occurrence count is a recognition metric, not
      // a device quantity. A device quantity may only come from a printed
      // count that traces to a source row, with its composition resolved and
      // its document governing. Fail closed with the named blockers; never
      // fall back to live.evidenceGroup.approvedOccurrenceCount.
      const printed = evaluateDrawingQuantityRequest({ rows: await governedPrintedQuantityRows(String(body.documentId || "")) });
      if (!printed.ok) return json({
        error: {
          code: "DRAWING_PRINTED_QUANTITY_REQUIRED",
          message: "Drawing device quantity requires a governed printed drawing count. An approved occurrence count is a recognition metric -- one recognised legend row is not one installed device -- so it cannot be selected as a quantity. Use Enter Reviewed Qty with the drawing review as your reason.",
          blockers: printed.blockers,
          approvedOccurrenceCount: live.evidenceGroup.approvedOccurrenceCount,
          approvedOccurrenceCountIsDeviceQuantity: false,
        },
      }, 409);
      selectedQuantity = printed.quantity;
      drawingQuantity = printed.quantity;
      recognitionVersionId = live.recognitionVersionId;
    } else {
      const entered = Number(body.selectedQuantity);
      if (!Number.isFinite(entered) || entered < 0) return json({ error: { code: "REVIEWED_QUANTITY_INVALID", message: "Enter a valid non-negative reviewed quantity." } }, 422);
      selectedQuantity = entered;
      // DRAW-QTY-1: an engineer-entered quantity is the engineer's own number
      // and is persisted as such. This branch previously also wrote the
      // approved occurrence count into drawing_quantity -- a real number in a
      // column named for a drawing device quantity, carrying a recognition
      // metric. It stays null: the recognition count is not this column's
      // subject, and it remains available on the evidence surface where it is
      // correctly labelled. Only the recognition version that the decision was
      // made against is retained, as review provenance.
      const live = await liveDrawingComparison(env.DB, item, String(body.documentId || ""), String(body.definitionKey || ""));
      if (live) recognitionVersionId = live.recognitionVersionId;
    }
    const decisionId = id("quantityDecision");
    await env.DB.prepare(
      "INSERT INTO boq_quantity_source_decisions (id,project_id,boq_item_id,source,selected_quantity,boq_quantity,drawing_quantity,recognition_version_id,definition_key,reason,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(decisionId, item.project_id, item.id, source, selectedQuantity, boqQuantity, drawingQuantity, recognitionVersionId, body.definitionKey || null, reason, user.id).run();
    return json({ decision: await currentQuantityDecision(env.DB, item.id) }, 201);
  }
  return json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
};
