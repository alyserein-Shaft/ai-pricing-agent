import {
  BOQ_UNDERSTANDING_PROMPT_VERSION,
  BOQ_UNDERSTANDING_SCHEMA_VERSION,
  interpretationConfigFingerprint,
  interpretationInputFingerprint,
  interpretBoqItem,
  prepareBoqUnderstandingInput,
} from "../app/domain/boq-understanding-engine.mjs";
import { resolveApplicationContext } from "./application-context.mjs";
import { createConfiguredBoqUnderstandingProvider } from "./boq-understanding-provider.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const projectAccess = (db, projectId, context) => db.prepare(`SELECT p.id FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL WHERE p.id=? AND p.organization_id=? AND (p.owner_user_id=? OR m.id IS NOT NULL)`).bind(context.userId, projectId, context.organizationId, context.userId).first();
const parse = (value, fallback = null) => { try { return value == null ? fallback : (typeof value === "string" ? JSON.parse(value) : value); } catch { return fallback; } };

export async function runUnderstandingBatch(rows, { provider, existing = async () => null, save = async () => {}, confirmedSpecifications = {} } = {}) {
  const metadata = provider?.metadata || { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" };
  const configFingerprint = interpretationConfigFingerprint(metadata);
  const summary = { total: rows.length, processed: 0, successful: 0, review: 0, failed: 0, unavailable: 0, reused: 0 };
  const items = [];
  for (const row of rows) {
    const input = prepareBoqUnderstandingInput(row, confirmedSpecifications[row.boqItemId || row.id] || []);
    const inputFingerprint = interpretationInputFingerprint(input);
    const prior = await existing(input.boqItemId, inputFingerprint, configFingerprint);
    if (prior) {
      summary.processed += 1; summary.reused += 1;
      if (prior.status === "COMPLETED") summary.successful += 1;
      else if (prior.status === "NEEDS_REVIEW") summary.review += 1;
      else if (prior.status === "AI_UNAVAILABLE") summary.unavailable += 1;
      else summary.failed += 1;
      items.push({ ...prior, reused: true });
      continue;
    }
    const result = await interpretBoqItem(input, { provider });
    const record = { boqItemId: input.boqItemId, inputFingerprint, configFingerprint, metadata, ...result };
    await save(record);
    summary.processed += 1;
    if (result.status === "COMPLETED") summary.successful += 1;
    else if (result.status === "NEEDS_REVIEW") summary.review += 1;
    else if (result.status === "AI_UNAVAILABLE") summary.unavailable += 1;
    else summary.failed += 1;
    items.push(record);
  }
  return { summary, items };
}

const activeRows = async (db, projectId, itemId = null) => {
  const result = await db.prepare(`SELECT b.id boqItemId,b.description,b.numeric_quantity numericQuantity,b.original_quantity originalQuantity,b.normalized_unit normalizedUnit,b.original_unit originalUnit,b.system_value system,b.category,b.subcategory,b.manufacturer,b.model,b.part_number partNumber,b.current_values currentValues,b.source_location sourceLocation
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.project_id=? AND ${currentBoqItemPredicate("b")} ${itemId ? "AND b.id=?" : ""} ORDER BY b.sequence,b.id`).bind(...(itemId ? [projectId, itemId] : [projectId])).all();
  return (result.results || []).map((row) => ({ ...row, currentValues: parse(row.currentValues, {}), sourceLocation: parse(row.sourceLocation, null) }));
};

const confirmedSpecifications = async (db, projectId) => {
  const result = await db.prepare(`SELECT l.boq_item_id boqItemId,r.id,r.normalized_requirement normalizedRequirement,r.source_location sourceLocation
    FROM boq_requirement_links l JOIN technical_requirements r ON r.id=l.requirement_id
    WHERE l.project_id=? AND l.status='Confirmed' AND r.approved_for_downstream=1 AND r.review_status='Approved'`).bind(projectId).all();
  return (result.results || []).reduce((map, row) => { (map[row.boqItemId] ||= []).push({ id: row.id, normalizedRequirement: row.normalizedRequirement, sourceLocation: parse(row.sourceLocation, null) }); return map; }, {});
};

const listLatest = async (db, projectId) => {
  const result = await db.prepare(`SELECT i.* FROM estimator_item_interpretations i WHERE i.project_id=? AND i.version_number=(SELECT MAX(i2.version_number) FROM estimator_item_interpretations i2 WHERE i2.boq_item_id=i.boq_item_id) ORDER BY i.created_at,i.id`).bind(projectId).all();
  return (result.results || []).map((row) => ({ id: row.id, runId: row.run_id, boqItemId: row.boq_item_id, version: row.version_number, status: row.status, interpretation: parse(row.validated_interpretation), error: row.error_code ? { code: row.error_code, message: row.error_message } : null, inputFingerprint: row.input_fingerprint, provider: row.provider, model: row.model, modelVersion: row.model_version, promptVersion: row.prompt_version, schemaVersion: row.schema_version, createdAt: row.created_at }));
};

async function executeRun(env, context, projectId, rows) {
  const provider = createConfiguredBoqUnderstandingProvider(env);
  const metadata = provider?.metadata || { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" };
  const configFingerprint = interpretationConfigFingerprint(metadata);
  const runId = id("understandingrun");
  await env.DB.prepare(`INSERT INTO estimator_understanding_runs(id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,total_items,requested_by) VALUES(?,?,?,?,?,?,?,?,?,'PROCESSING',?,?)`).bind(runId, projectId, context.organizationId, metadata.provider, metadata.model, metadata.modelVersion, BOQ_UNDERSTANDING_PROMPT_VERSION, BOQ_UNDERSTANDING_SCHEMA_VERSION, configFingerprint, rows.length, context.userId).run();
  const specs = await confirmedSpecifications(env.DB, projectId);
  const outcome = await runUnderstandingBatch(rows, {
    provider,
    confirmedSpecifications: specs,
    existing: async (boqItemId, inputFingerprint, fingerprint) => {
      const row = await env.DB.prepare(`SELECT status,validated_interpretation interpretation,error_code errorCode,error_message errorMessage FROM estimator_item_interpretations WHERE boq_item_id=? AND input_fingerprint=? AND config_fingerprint=?`).bind(boqItemId, inputFingerprint, fingerprint).first();
      return row ? { boqItemId, status: row.status, interpretation: parse(row.interpretation), error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null } : null;
    },
    save: async (record) => {
      const prior = await env.DB.prepare(`SELECT COALESCE(MAX(version_number),0) version FROM estimator_item_interpretations WHERE boq_item_id=?`).bind(record.boqItemId).first();
      await env.DB.prepare(`INSERT INTO estimator_item_interpretations(id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,raw_response,validated_interpretation,error_code,error_message,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id("understanding"), runId, projectId, record.boqItemId, Number(prior?.version || 0) + 1, record.inputFingerprint, record.configFingerprint, metadata.provider, metadata.model, metadata.modelVersion, BOQ_UNDERSTANDING_PROMPT_VERSION, BOQ_UNDERSTANDING_SCHEMA_VERSION, record.status, record.raw ? JSON.stringify(record.raw) : null, record.interpretation ? JSON.stringify(record.interpretation) : null, record.error?.code || null, record.error?.message || null, context.userId).run();
    },
  });
  const runStatus = !provider ? "AI_UNAVAILABLE" : outcome.summary.failed === rows.length ? "FAILED" : "COMPLETED";
  await env.DB.prepare(`UPDATE estimator_understanding_runs SET status=?,processed_items=?,successful_items=?,review_items=?,failed_items=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(runStatus, outcome.summary.processed, outcome.summary.successful, outcome.summary.review, outcome.summary.failed + outcome.summary.unavailable, runId).run();
  return { runId, status: runStatus, ...outcome };
}

export const handleEstimatorUnderstandingApi = async (request, env) => {
  const pathname = new URL(request.url).pathname;
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/estimator-understanding(?:\/run)?$/);
  const retryMatch = pathname.match(/^\/api\/boq-items\/([^/]+)\/estimator-understanding\/retry$/);
  if (!projectMatch && !retryMatch) return null;
  if (!env.DB) return json({ error: { code: "ESTIMATOR_UNDERSTANDING_UNAVAILABLE", message: "BOQ understanding storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    if (!(await projectAccess(env.DB, projectId, resolved.context))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    if (request.method === "GET" && !pathname.endsWith("/run")) return json({ projectId, items: await listLatest(env.DB, projectId) });
    if (request.method !== "POST" || !pathname.endsWith("/run")) return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST /run." } }, 405);
    return json(await executeRun(env, resolved.context, projectId, await activeRows(env.DB, projectId)), 200);
  }
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to retry an item." } }, 405);
  const itemId = decodeURIComponent(retryMatch[1]);
  const item = await env.DB.prepare(`SELECT b.project_id projectId FROM ${currentBoqEvidenceFrom("b")} WHERE b.id=? AND ${currentBoqItemPredicate("b")}`).bind(itemId).first();
  if (!item || !(await projectAccess(env.DB, item.projectId, resolved.context))) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
  return json(await executeRun(env, resolved.context, item.projectId, await activeRows(env.DB, item.projectId, itemId)));
};
