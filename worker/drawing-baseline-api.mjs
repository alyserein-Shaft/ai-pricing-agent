// Drawing baseline confirm/read endpoints. Human confirmation only: the
// server resolves the eligible set itself from live heads; a client-supplied
// document list is never trusted.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import { resolveProjectAuthority } from "./project-authority.mjs";
import { eligibleBaselineSet, baselineStatus } from "../app/domain/drawing-baseline.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const currentDrawings = async (db, projectId) => {
  const rows = await db.prepare(
    "SELECT d.id, d.project_id, d.logical_name, d.current_version_id FROM documents d WHERE d.project_id=? AND d.document_type='Drawing' AND d.deleted_at IS NULL AND d.archived_at IS NULL",
  ).bind(projectId).all();
  return rows.results || [];
};

const currentIntakes = async (db, documentIds) => {
  const map = {};
  for (const documentId of documentIds) {
    const row = await db.prepare(
      "SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    ).bind(documentId).first();
    if (row) map[documentId] = row;
  }
  return map;
};

const liveBaseline = async (db, projectId) => {
  const docs = await currentDrawings(db, projectId);
  const intakes = await currentIntakes(db, docs.map((d) => d.id));
  const heads = Object.fromEntries(docs.map((d) => [d.id, d.current_version_id]));
  return { docs, ...eligibleBaselineSet({ documents: docs, intakesByDocument: intakes, heads }) };
};

export const handleDrawingBaselineApi = async (request, env) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/drawing-baseline(?:\/(confirm))?$/);
  if (!match) return null;
  if (!env.DB) return json({ error: { code: "BASELINE_STORE_UNAVAILABLE", message: "Drawing storage is unavailable." } }, 503);
  const projectId = decodeURIComponent(match[1]);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const authority = await resolveProjectAuthority(env.DB, { projectId, actor: user });
  if (!authority) return json({ error: { code: "BASELINE_NOT_AUTHORIZED", message: "No project authority." } }, 403);

  const confirmed = await env.DB.prepare(
    "SELECT * FROM drawing_baseline_confirmations WHERE project_id=? AND superseded_at IS NULL ORDER BY generation DESC LIMIT 1",
  ).bind(projectId).first().catch(() => null);

  if (request.method === "GET" && !match[2]) {
    const live = await liveBaseline(env.DB, projectId);
    if (!confirmed) return json({ state: "UNCONFIRMED", problems: live.problems, eligibleCount: live.members.length });
    const status = baselineStatus({ confirmed, currentFingerprint: live.fingerprint });
    return json({ ...status, problems: live.problems, eligibleCount: live.members.length });
  }

  if (request.method === "POST" && match[2] === "confirm") {
    // Governed human action: the canonical server-configured human identity.
    // Synthetic development identities (e.g. local-development-user) are
    // refused here by the shared mechanism, never recorded as decision-maker.
    const human = requireHumanActor(env);
    if (human.error) return json({ error: { code: human.error, message: human.message } }, 403);
    const actorId = human.actor.id;
    const actorName = human.actor.name;
    const live = await liveBaseline(env.DB, projectId);
    if (live.problems.length) {
      return json({ error: { code: "BASELINE_INELIGIBLE", message: "Not all current drawings have successful current intake.", problems: live.problems } }, 409);
    }
    // Idempotent only when the identical set was confirmed by the SAME human
    // actor. A different actor reconfirming the same set supersedes history
    // (gen-1 audit row preserved) rather than rewriting it.
    if (confirmed && confirmed.set_fingerprint === live.fingerprint && confirmed.confirmed_by === actorId) {
      return json({ runId: confirmed.id, generation: confirmed.generation, idempotent: true, state: "CONFIRMED", baseline: confirmed });
    }
    const timestamp = now();
    const prior = await env.DB.prepare(
      "SELECT MAX(generation) AS g FROM drawing_baseline_confirmations WHERE project_id=?",
    ).bind(projectId).first().catch(() => ({ g: 0 }));
    const generation = Number(prior?.g || 0) + 1;
    const runId = id("drawingBaseline");
    await env.DB.batch([
      env.DB.prepare("UPDATE drawing_baseline_confirmations SET superseded_at=? WHERE project_id=? AND superseded_at IS NULL").bind(timestamp, projectId),
      env.DB.prepare("INSERT INTO drawing_baseline_confirmations (id,project_id,generation,member_count,members_json,set_fingerprint,confirmed_by,confirmed_by_name,confirmed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(runId, projectId, generation, live.members.length, JSON.stringify(live.members), live.fingerprint, actorId, actorName, timestamp, timestamp),
    ]);
    const row = await env.DB.prepare("SELECT * FROM drawing_baseline_confirmations WHERE id=?").bind(runId).first();
    return json({ runId, generation, idempotent: false, state: "CONFIRMED", baseline: row }, 201);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Unsupported method." } }, 405);
};
