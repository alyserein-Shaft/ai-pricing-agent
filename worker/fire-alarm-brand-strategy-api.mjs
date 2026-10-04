// Fire Alarm Brand Strategy read/resolve API (read-only + pure resolve).
//
// No persistence: this route runs the governed company-policy engine
// (app/domain/fire-alarm-brand-strategy.mjs) against engineer-confirmed inputs
// and returns the decision. Recording a strategy decision, if ever needed, is
// a separate governed slice. Reads project evidence pointers (ecosystem basis,
// demand snapshot) so the UI can prefill inputs, but never infers inputs.
import {
  resolveFireAlarmBrandStrategy,
  IN_HOUSE_FIRE_ALARM_POLICY,
  BRAND_STRATEGY_VERSION,
} from "../app/domain/fire-alarm-brand-strategy.mjs";
import { resolveApplicationContext } from "./application-context.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function handleFireAlarmBrandStrategyApi(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/fire-alarm\/brand-strategy(?:\/(resolve))?$/);
  if (!match) return null;
  if (!env.DB) return json({ error: { code: "BRAND_STRATEGY_UNAVAILABLE", message: "Brand strategy storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const projectId = decodeURIComponent(match[1]);

  if (request.method === "GET") {
    // Evidence pointers only: ecosystem basis, demand snapshot presence, and
    // the policy itself. The UI prefills engineer-confirmed inputs from these.
    const project = await env.DB.prepare(
      "SELECT id, name FROM projects WHERE id=? AND archived_at IS NULL",
    ).bind(projectId).first();
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    let ecosystem = null;
    try {
      const row = await env.DB.prepare(
        "SELECT new_value FROM engineering_knowledge_decisions WHERE project_id=? AND entity_type=? ORDER BY decided_at DESC LIMIT 1",
      ).bind(projectId, "Project Fire Alarm Ecosystem").first();
      ecosystem = row ? JSON.parse(row.new_value) : null;
    } catch { ecosystem = null; }
    let demand = null;
    try {
      demand = await env.DB.prepare(
        "SELECT status, calculation_json FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1",
      ).bind(projectId).first();
    } catch { demand = null; }
    return json({
      policyVersion: BRAND_STRATEGY_VERSION,
      policyId: IN_HOUSE_FIRE_ALARM_POLICY.policyId,
      project: { id: project.id, name: project.name },
      evidence: { ecosystem, demandSnapshot: demand ? { status: demand.status } : null },
    });
  }

  if (request.method === "POST" && match[2] === "resolve") {
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    try {
      const decision = resolveFireAlarmBrandStrategy(body);
      return json({ decision, persisted: false });
    } catch (error) {
      return json({ error: { code: error.code || "BRAND_STRATEGY_INPUT_INVALID", message: error.message } }, 422);
    }
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST /resolve." } }, 405);
}
