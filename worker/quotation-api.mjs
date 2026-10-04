import { authenticateLibraryActor } from "./library-auth.mjs";
import { buildClientQuotationModel } from "../app/domain/quotation-presenter.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });

const projectAccess = (db, projectId, actor) =>
  db.prepare(`
    SELECT p.id
    FROM projects p
    LEFT JOIN project_members pm
      ON pm.project_id=p.id
     AND pm.user_id=?
     AND pm.status='Active'
     AND pm.revoked_at IS NULL
    WHERE p.id=?
      AND p.organization_id=?
      AND (p.owner_user_id=? OR pm.id IS NOT NULL)
    LIMIT 1
  `).bind(
    actor.id,
    projectId,
    actor.organizationId,
    actor.id,
  ).first();

export async function handleQuotationApi(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/quotations\/([^/]+)$/,
  );

  if (!match) return null;

  if (request.method !== "GET") {
    return json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Quotation documents are read with GET.",
      },
    }, 405);
  }

  if (!env.DB) {
    return json({
      error: {
        code: "QUOTATION_STORAGE_UNAVAILABLE",
        message: "Quotation storage is unavailable.",
      },
    }, 503);
  }

  const auth = await authenticateLibraryActor(request, env);
  if (auth.error) return json({ error: auth.error }, auth.error.status);

  const actor = auth.actor;
  const projectId = decodeURIComponent(match[1]);
  const revisionId = decodeURIComponent(match[2]);

  const project = await projectAccess(env.DB, projectId, actor);

  if (!project) {
    return json({
      error: {
        code: "PROJECT_NOT_FOUND",
        message: "Project was not found or is not available to this account.",
      },
    }, 404);
  }

  const revision = await env.DB.prepare(`
    SELECT *
    FROM project_quotation_revisions
    WHERE id=?
      AND project_id=?
    LIMIT 1
  `).bind(
    revisionId,
    projectId,
  ).first();

  if (!revision) {
    return json({
      error: {
        code: "QUOTATION_REVISION_NOT_FOUND",
        message: "Quotation revision was not found.",
      },
    }, 404);
  }

  const lineRows = await env.DB.prepare(`
    SELECT *
    FROM project_quotation_lines
    WHERE quotation_revision_id=?
      AND project_id=?
    ORDER BY sequence,id
  `).bind(
    revision.id,
    projectId,
  ).all();

  try {
    const quotation = buildClientQuotationModel({
      revision,
      lines: lineRows.results || [],
    });

    return json({ quotation });
  } catch (error) {
    return json({
      error: {
        code: "QUOTATION_PRESENTATION_INVALID",
        message: "The stored quotation revision cannot be presented safely.",
        reason: String(error?.message || error),
      },
    }, 409);
  }
}
