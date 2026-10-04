// GOLDEN-6C2 -- preliminary Fire Alarm sizing API.
//
// A governed, immutable, versioned artifact for PRELIMINARY SYSTEM DEMAND. It is
// deliberately a separate route from worker/fire-alarm-panel-sizing-api.mjs, which
// owns FINAL product-specific panel sizing and requires an approved exact panel
// product. Nothing here creates, relaxes or reads a final-sizing snapshot.
//
// Currency convention (shared with 0004): the current snapshot is the highest
// `version_number`, never the newest `created_at`.

import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { canApproveTechnicalSafety, resolveProjectAuthority } from "./project-authority.mjs";
import {
  createFireAlarmPreliminarySizingSnapshot,
  currentPreliminarySizingSnapshot,
  preliminarySizingSnapshotInput,
  preliminarySizingFailure,
  FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION,
} from "../app/domain/fire-alarm-preliminary-sizing-snapshot.mjs";
// H1 -- the governed point-demand producer was unreachable in production, so
// the writer's required `dependencies.demand` could never be supplied. This
// bridge assembles the inventory from the pipeline's own governed data (current
// BOQ items, approved understanding, and the SLC classification the
// requirement engine already persists) and hands it to the existing producer.
// It does not re-implement the producer and does not invent demand.
import { produceProjectPreliminaryPointDemand } from "../app/domain/project-point-demand-bridge.mjs";
import { currentApprovedUnderstandingFacts } from "./estimator-understanding-review-api.mjs";
import { currentSelectedQuantity } from "./quantity-source-decision-api.mjs";
import { currentRequirementProfile } from "./requirement-profile-currency.mjs";

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

const CURRENT_PRELIMINARY_SIZING_SQL =
  "SELECT * FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1";

const ALL_PRELIMINARY_SIZING_SQL =
  "SELECT * FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC";

const id = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

// Same authority resolution the final-sizing route uses: project authority is
// resolved through the governed helper, never inferred from a membership row.
const loadProject = async (db, projectId, user) => {
  const authority = await resolveProjectAuthority(db, { projectId, actor: user });
  if (!authority) return null;
  const project = await db.prepare("SELECT * FROM projects WHERE id=? AND organization_id=? AND archived_at IS NULL")
    .bind(projectId, user.organizationId).first();
  return project ? { ...project, project_role: authority.role } : null;
};

const snapshotPayload = (payload) => payload && ({
  id: payload.id,
  projectId: payload.projectId,
  version: payload.version,
  versionCount: payload.versionCount,
  current: payload.current,
  status: payload.status,
  inputFingerprint: payload.inputFingerprint,
  engineVersion: payload.engineVersion,
  calculation: payload.calculation,
  dossier: payload.dossier,
  input: payload.input,
  reason: payload.reason,
  createdBy: payload.createdBy,
  createdAt: payload.createdAt,
});

const errorResponse = (error) => {
  if (error instanceof preliminarySizingFailure) {
    return json({
      error: {
        code: error.code,
        message: error.message.replace(`${error.code}: `, ""),
        ...(error.details ? { details: error.details } : {}),
      },
    }, error.status);
  }
  return json({ error: { code: "PRELIMINARY_SIZING_INTERNAL_ERROR", message: "Preliminary sizing failed unexpectedly." } }, 500);
};

export async function handleFireAlarmPreliminarySizingApi(request, env) {
  try {
    const url = new URL(request.url);
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/fire-alarm\/preliminary-sizing(?:\/(current|history))?$/);
    // No match means "not my route": the router chain must continue, exactly as
    // every other handler in this worker does.
    if (!projectMatch) return null;
    if (!env.DB) return json({ error: { code: "PRELIMINARY_SIZING_UNAVAILABLE", message: "Preliminary-sizing storage is unavailable." } }, 503);
    const resolved = await resolveApplicationContext(request, env);
    if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
    const user = applicationActor(resolved.context);
    const projectId = decodeURIComponent(projectMatch[1]);
    const project = await loadProject(env.DB, projectId, user);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    // Recording governed system demand is a technical-authority act, the same
    // bar the final-sizing route applies. Reading is open to project members.
    if (request.method === "POST" && !canApproveTechnicalSafety(project.project_role)) {
      return json({ error: { code: "PRELIMINARY_SIZING_TECHNICAL_AUTHORITY_REQUIRED", message: "Current technical approval authority is required to record preliminary Fire Alarm sizing." } }, 403);
    }

    // ---- READ: current governed preliminary demand -----------------------------
    if (request.method === "GET" && (projectMatch[2] === "current" || !projectMatch[2])) {
      const row = await env.DB.prepare(CURRENT_PRELIMINARY_SIZING_SQL).bind(projectId).first();
      const snapshot = currentPreliminarySizingSnapshot(row ? [row] : []);
      if (!snapshot) {
        return json({ error: { code: "PRELIMINARY_SIZING_REQUIRED", message: "No governed preliminary Fire Alarm sizing snapshot exists for this project." } }, 404);
      }
      return json({ snapshot: snapshotPayload(snapshot), ecosystemInput: preliminarySizingSnapshotInput(snapshot) });
    }

    // ---- READ: full version history (history is never rewritten) --------------
    if (request.method === "GET" && projectMatch[2] === "history") {
      const rows = await env.DB.prepare(ALL_PRELIMINARY_SIZING_SQL).bind(projectId).all();
      return json({ snapshots: (rows?.results || []).map((row) => snapshotPayload(currentPreliminarySizingSnapshot([row]))) });
    }

    // ---- WRITE: record a governed preliminary demand result -------------------
    if (request.method === "POST") {
      const body = await request.json();
      const command = {
        ...body,
        projectId,
        createdBy: user.id,
      };
      // H8 -- the writer's contract is `({ command, dependencies })` where
      // `dependencies.demand` is the governed output of
      // `aggregatePreliminaryPointDemand`. The handler previously passed only
      // `{ command }`, so every POST failed with
      // PRELIMINARY_SIZING_CALCULATION_MALFORMED (422). The demand is now
      // produced here from governed data, not supplied by the caller: a client
      // cannot inject its own point demand.
      const demand = await produceProjectPreliminaryPointDemand({
        db: env.DB,
        projectId,
        loadCurrentProfile: (database, itemId) => currentRequirementProfile(database, itemId),
        loadApprovedUnderstanding: (database, project, itemId) => currentApprovedUnderstandingFacts(database, project, itemId),
        currentSelectedQuantity: (database, item) => currentSelectedQuantity(database, item),
      });
      const snapshot = await createFireAlarmPreliminarySizingSnapshot({ command, dependencies: { demand } });

      // Idempotency: the same governed evidence must not manufacture a new
      // version. Identity is the recomputed input fingerprint, matching 0004.
      const existing = await env.DB
        .prepare("SELECT * FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id=? AND input_fingerprint=? ORDER BY version_number DESC LIMIT 1")
        .bind(projectId, snapshot.inputFingerprint).first();
      if (existing) {
        const current = currentPreliminarySizingSnapshot([existing]);
        return json({ status: current.status, snapshot: snapshotPayload(current), idempotent: true }, 200);
      }

      const snapshotId = id("presizing");
      const stamp = new Date().toISOString();
      const c = snapshot.calculation;
      await env.DB.prepare(`
        INSERT INTO fire_alarm_preliminary_sizing_snapshots
          (id,project_id,version_number,input_fingerprint,engine_version,status,input_json,calculation_json,dossier_json,reason,created_by,created_at)
        VALUES (?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id=?),
                ?,?,?,?,?,?,?,?,?)
      `).bind(
        snapshotId, projectId, projectId,
        snapshot.inputFingerprint, snapshot.engineVersion, snapshot.status,
        JSON.stringify(snapshot.input), JSON.stringify(c), JSON.stringify(snapshot.dossier || {}),
        // reason/actor are governed inputs of the command, never a header value.
        snapshot.input?.command?.reason ?? null, user.id, stamp,
      ).run();

      // Read back by its OWN id: re-reading MAX(version_number) could describe a
      // different snapshot if another writer committed in between.
      const persisted = await env.DB.prepare("SELECT * FROM fire_alarm_preliminary_sizing_snapshots WHERE id=?").bind(snapshotId).first();
      if (!persisted) {
        return json({ error: { code: "PRELIMINARY_SIZING_SNAPSHOT_READBACK_FAILED", message: "The persisted preliminary-sizing snapshot could not be read back by its own id." } }, 500);
      }
      const current = currentPreliminarySizingSnapshot([persisted]);
      return json({ status: current.status, snapshot: snapshotPayload(current), idempotent: false }, 201);
    }

    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);
  } catch (error) {
    return errorResponse(error);
  }
}

export const PRELIMINARY_SIZING_API_ROUTE = "/api/projects/:projectId/fire-alarm/preliminary-sizing";
export const PRELIMINARY_SIZING_ENGINE_VERSION = FIRE_ALARM_PRELIMINARY_SIZING_ENGINE_VERSION;
