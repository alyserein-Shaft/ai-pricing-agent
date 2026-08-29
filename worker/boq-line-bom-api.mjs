// Phase 5 BOM-continuity fix -- the per-line BOM read model and its one
// answer endpoint. Every input is read from existing authoritative sources:
// Product Knowledge's own product_accessories relationships (already
// review-status filtered, already the same table product-matching-engine.mjs
// reads), the engineer's already-approved understanding attributes, and this
// session's own project-scoped engineering_facts row for a prior accessory
// selection -- never a new Product Knowledge store. Answering a
// controlled-value condition (e.g. "is a sounder required?") reuses the
// EXACT SAME governed EDIT_AND_APPROVE + cascade path Vertical Slice 1
// already built (worker/boq-line-decision-api.mjs's answerAttributeDecision);
// answering a which-specific-accessory question writes one more
// engineering_facts row -- the same generic, versioned, audited table
// already used elsewhere in this codebase for project-scoped evidence,
// never a duplicate authoritative store.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { currentApprovedUnderstandingFacts } from "./estimator-understanding-review-api.mjs";
import { answerAttributeDecision } from "./boq-line-decision-api.mjs";
import { classifyBomComponents, selectBomDecisionQuestion, deriveBomReadiness, primaryQuantityRecord } from "../app/domain/bom-component-model.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };

const ownedItem = (db, itemId, userId) => db.prepare(
  "SELECT b.id, b.project_id, b.numeric_quantity, b.original_quantity, b.normalized_unit, b.original_unit FROM boq_items b JOIN projects p ON p.id=b.project_id WHERE b.id=? AND p.owner_user_id=?",
).bind(itemId, userId).first();

// The engineer's currently APPROVED technical selection, if one exists --
// reusing safety_decisions exactly as the Engineer Decision Center's own
// safety panel already does. Falls back to the top-ranked persisted
// candidate (provisional -- the BOM can still be previewed before final
// technical approval, clearly labeled as provisional in the response).
const currentPrimarySelection = async (db, itemId) => {
  const approved = await db.prepare(
    `SELECT c.product_id, 1 approved FROM safety_decisions d JOIN product_match_candidates c ON c.id=d.candidate_id
     WHERE d.boq_item_id=? AND d.superseded_at IS NULL AND d.technical_eligibility LIKE 'Eligible%' ORDER BY d.version_number DESC LIMIT 1`,
  ).bind(itemId).first();
  if (approved) return { productId: approved.product_id, approved: true };
  const topCandidate = await db.prepare(
    `SELECT c.product_id FROM product_match_candidates c JOIN product_match_runs r ON r.id=c.match_run_id WHERE r.boq_item_id=? AND r.superseded_at IS NULL ORDER BY c.rank LIMIT 1`,
  ).bind(itemId).first();
  return topCandidate ? { productId: topCandidate.product_id, approved: false } : null;
};

const loadPrimaryProduct = async (db, productId) => db.prepare(
  `SELECT p.id, p.part_number, p.description, m.name manufacturer, f.name family,
     (SELECT json_group_array(json_object(
        'relationshipType', pa.relationship_type, 'accessoryProductId', pa.accessory_product_id,
        'accessoryPartNumber', ap.part_number, 'quantityRule', pa.quantity_rule,
        'quantityParameter', pa.quantity_parameter, 'conditions', json(pa.condition_json),
        'confidence', pa.confidence, 'reviewStatus', pa.review_status
      ))
      FROM product_accessories pa JOIN library_products ap ON ap.id=pa.accessory_product_id
      WHERE pa.product_id=p.id AND pa.deleted_at IS NULL AND pa.superseded_at IS NULL AND pa.review_status NOT IN ('Rejected','Needs Review')
     ) accessories
   FROM canonical_library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id LEFT JOIN product_families f ON f.id=p.family_id
   WHERE p.requested_product_id=?`,
).bind(productId).first();

const loadSelections = async (db, itemId) => {
  const rows = await db.prepare(
    "SELECT value FROM engineering_facts WHERE entity_type='BOQ Item' AND entity_id=? AND predicate='BOM Component Selection' AND status='Active' AND deleted_at IS NULL",
  ).bind(itemId).all();
  const selections = {};
  for (const row of rows.results || []) { const value = parse(row.value, null); if (value?.relationshipType) selections[value.relationshipType] = value; }
  return selections;
};

const approvedConditionFacts = (approvedFacts) => Object.entries(approvedFacts?.attributes || {})
  .map(([attribute, fact]) => ({ attribute, value: fact?.value ?? null, source: "Approved BOQ Understanding" }))
  .filter((entry) => entry.value != null && entry.value !== "");

export const buildLineBomModel = async (env, { itemId, userId }) => {
  const item = await ownedItem(env.DB, itemId, userId);
  if (!item) return { error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } };
  const primarySelection = await currentPrimarySelection(env.DB, itemId);
  const primaryQuantity = { value: item.numeric_quantity ?? (Number(item.original_quantity) || null), unit: item.normalized_unit || item.original_unit || null };
  if (!primarySelection) {
    return {
      boqItemId: itemId, primaryProduct: null, primaryQuantity: primaryQuantityRecord(primaryQuantity),
      components: [], engineerQuestion: null,
      readiness: deriveBomReadiness({ hasPrimaryProduct: false, components: [], hasOpenQuestion: false }),
    };
  }
  const product = await loadPrimaryProduct(env.DB, primarySelection.productId);
  const approvedFacts = await currentApprovedUnderstandingFacts(env.DB, item.project_id, itemId);
  const selections = await loadSelections(env.DB, itemId);
  const accessories = parse(product?.accessories, []) || [];
  const components = classifyBomComponents({
    system: approvedFacts?.system?.value || null,
    primaryFamily: product?.family || approvedFacts?.productFamily?.value || null,
    primaryQuantity: primaryQuantity.value,
    accessories,
    approvedFacts: approvedConditionFacts(approvedFacts),
    selections,
  });
  const engineerQuestion = selectBomDecisionQuestion(components);
  return {
    boqItemId: itemId,
    primaryProduct: product ? { productId: product.id, partNumber: product.part_number, manufacturer: product.manufacturer, family: product.family, description: product.description, approved: primarySelection.approved } : null,
    primaryQuantity: primaryQuantityRecord(primaryQuantity),
    components,
    engineerQuestion,
    readiness: deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: Boolean(engineerQuestion) }),
  };
};

const recordAccessorySelection = async (db, { projectId, itemId, userId, relationshipType, accessoryProductId, accessoryPartNumber, reason }) => {
  const existing = await db.prepare(
    "SELECT id, version_number, value FROM engineering_facts WHERE entity_type='BOQ Item' AND entity_id=? AND predicate='BOM Component Selection' AND status='Active' AND deleted_at IS NULL",
  ).bind(itemId).all();
  const previous = (existing.results || []).find((row) => parse(row.value, {})?.relationshipType === relationshipType);
  const stamp = now();
  const newId = id("engfact");
  const statements = [];
  if (previous) statements.push(db.prepare("UPDATE engineering_facts SET status='Superseded', effective_to=?, superseded_by_id=? WHERE id=?").bind(stamp, newId, previous.id));
  statements.push(db.prepare(
    `INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, previous_version_id, status, confidence, version_number, change_reason, changed_by, model_version)
     VALUES (?, ?, 'BOQ Item', ?, 'BOM Component Selection', ?, 'Object', 'Equal', 'Engineer Decision', 'BOQ Item', ?, ?, 'Active', 100, ?, ?, ?, 'bom-component-model-1.0.0')`,
  ).bind(newId, projectId, itemId, JSON.stringify({ relationshipType, accessoryProductId, accessoryPartNumber }), itemId, previous?.id || null, Number(previous?.version_number || 0) + 1, reason, userId));
  await db.batch(statements);
  return newId;
};

export async function handleBoqLineBomApi(request, env) {
  const url = new URL(request.url);
  const readMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/bom$/);
  const answerMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/bom\/answer$/);
  if (!readMatch && !answerMatch) return null;
  if (!env.DB) return json({ error: { code: "BOM_MODEL_UNAVAILABLE", message: "BOM model storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const itemId = decodeURIComponent((readMatch || answerMatch)[1]);

  if (readMatch) {
    if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
    const model = await buildLineBomModel(env, { itemId, userId: user.id });
    return model.error ? json(model, model.error.code === "BOQ_ITEM_NOT_FOUND" ? 404 : 409) : json(model);
  }

  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to answer." } }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: { code: "BOM_ANSWER_INVALID", message: "Use the governed BOM answer contract." } }, 400); }
  const reason = String(body.reason || "").trim();
  if (reason.length < 5) return json({ error: { code: "BOM_ANSWER_REASON_REQUIRED", message: "Provide a substantive engineering reason for this decision." } }, 422);

  if (body.kind === "ATTRIBUTE_ANSWER") {
    const attributeName = String(body.attributeName || "").trim();
    const value = body.value == null ? "" : String(body.value).trim();
    const result = await answerAttributeDecision(env, resolved.context, { itemId, userId: user.id, attributeName, value, reason });
    if (result.error) return json({ error: result.error, missing: result.missing || [] }, result.status || 409);
    const model = await buildLineBomModel(env, { itemId, userId: user.id });
    return json({ decision: result.decision, cascade: result.cascade, model });
  }

  if (body.kind === "ACCESSORY_SELECTION") {
    const relationshipType = String(body.relationshipType || "").trim();
    const accessoryProductId = String(body.accessoryProductId || "").trim();
    const accessoryPartNumber = String(body.accessoryPartNumber || "").trim();
    if (!relationshipType || !accessoryProductId) return json({ error: { code: "BOM_ANSWER_SELECTION_REQUIRED", message: "A relationship type and accessory product are required." } }, 422);
    const item = await ownedItem(env.DB, itemId, user.id);
    if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
    await recordAccessorySelection(env.DB, { projectId: item.project_id, itemId, userId: user.id, relationshipType, accessoryProductId, accessoryPartNumber, reason });
    const model = await buildLineBomModel(env, { itemId, userId: user.id });
    return json({ decision: { relationshipType, accessoryProductId, accessoryPartNumber, reason }, model });
  }

  return json({ error: { code: "BOM_ANSWER_KIND_INVALID", message: "Use ATTRIBUTE_ANSWER or ACCESSORY_SELECTION." } }, 422);
}
