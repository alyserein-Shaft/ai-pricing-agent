// Phase 5 workflow-continuity fix -- previously an engineer approving or
// editing a BOQ item's AI understanding had no automatic path to the
// requirement-profile and product-matching recalculation that depends on it;
// two separate manual endpoints (requirement-profile/recalculate,
// matching/recalculate) had to be triggered by hand, with no cascade between
// them. This module is the single place that sequence is orchestrated so an
// engineer never has to know these are separate engines. Each stage's own
// engine already guards its own idempotency (an unchanged input_fingerprint
// short-circuits to a no-op); this orchestrator adds no idempotency of its
// own, it only guarantees the SEQUENCE runs and is recorded once per attempt.
// There is no cycle here to guard against beyond calling each stage at most
// once per invocation -- this is a straight-line pipeline, not a graph.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";

// Dynamic imports (not static top-level ones) deliberately -- product-matching-api.mjs
// itself imports from estimator-understanding-review-api.mjs (currentApprovedUnderstandingFacts),
// and this module is imported BY estimator-understanding-review-api.mjs to trigger the
// cascade after an approval. A static import here would create a circular module
// graph; resolving these lazily, only inside the function body below, avoids it
// without changing what either module actually does.
const loadEngines = async () => {
  const [{ executeRequirementProfile }, { executeProductMatching }] = await Promise.all([
    import("./technical-requirement-api.mjs"),
    import("./product-matching-api.mjs"),
  ]);
  return { executeRequirementProfile, executeProductMatching };
};

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const persistCascadeEvent = async (env, { runId, projectId, itemId, userId, status, trigger, steps }) => {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, 'Downstream Recalculation Cascade', NULL, ?, ?, ?)",
    ).bind(id("audit"), projectId, userId, JSON.stringify({ boqItemId: itemId, status, steps }), trigger, runId).run();
  } catch {
    // Best-effort audit trail only -- the cascade's own result (already
    // returned to the caller, or already recorded per-step below) is never
    // gated on this succeeding.
  }
};

// The one place "approve/edit an understanding fact" turns into "requirement
// profile, then product matching, both current" without the caller (an HTTP
// handler reacting to an approval, or the explicit Resync action below)
// needing to know the individual engine calls. Failure-safe: a failure at
// either stage is recorded with which stage failed and re-thrown, never
// silently swallowed, so a caller (or the explicit Resync retry path) can
// see exactly what still needs to happen.
export const cascadeUnderstandingApproval = async (env, { projectId, itemId, userId, trigger = "Understanding Approval" }) => {
  const { executeRequirementProfile, executeProductMatching } = await loadEngines();
  const runId = id("cascade");
  const steps = [];
  const record = async (stage, fn) => {
    const startedAt = now();
    try {
      await fn();
      steps.push({ stage, status: "Completed", startedAt, completedAt: now() });
    } catch (error) {
      steps.push({ stage, status: "Failed", startedAt, completedAt: now(), error: error?.message || String(error) });
      throw error;
    }
  };
  try {
    await record("Requirement Profile", () => executeRequirementProfile(env, { itemId, userId }));
    await record("Product Matching", () => executeProductMatching(env, { itemId, user: { id: userId } }));
  } catch (error) {
    await persistCascadeEvent(env, { runId, projectId, itemId, userId, status: "Failed", trigger, steps });
    return { runId, status: "Failed", steps, error: error?.message || String(error) };
  }
  await persistCascadeEvent(env, { runId, projectId, itemId, userId, status: "Completed", trigger, steps });
  return { runId, status: "Completed", steps };
};

const ownedItem = (db, itemId, userId) => db.prepare(
  "SELECT b.id, b.project_id FROM boq_items b JOIN projects p ON p.id=b.project_id WHERE b.id=? AND p.owner_user_id=?",
).bind(itemId, userId).first();

// The single explicit Resync recovery action: if the automatic cascade above
// never ran (a background waitUntil that failed silently, an older approval
// recorded before this existed) or failed, an engineer or administrator can
// force the same sequence to run again, synchronously, and see the result
// immediately rather than trusting a background job.
export async function handlePipelineOrchestrationApi(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/resync$/);
  if (!match) return null;
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to resync." } }, 405);
  if (!env.DB) return json({ error: { code: "PIPELINE_ORCHESTRATION_UNAVAILABLE", message: "Pipeline storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const item = await ownedItem(env.DB, decodeURIComponent(match[1]), user.id);
  if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
  const result = await cascadeUnderstandingApproval(env, { projectId: item.project_id, itemId: item.id, userId: user.id, trigger: "Manual Resync" });
  return json(result, result.status === "Failed" ? 502 : 200);
}
