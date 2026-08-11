import {
  captureLegendGeometry,
  LEGEND_GEOMETRY_ENGINE_VERSION,
} from "../app/domain/drawing-legend-geometry-engine.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
const json = (b, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }),
  id = (p) => `${p}_${crypto.randomUUID()}`,
  parse = (v, f = null) => {
    try {
      return JSON.parse(v || "");
    } catch {
      return f;
    }
  },
  hash = async (v) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(v)),
        ),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
const owned = (db, d, u, o) =>
    db
      .prepare(
        "SELECT d.*,v.id version_id,v.object_key,v.sha256,p.id project_id FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? AND p.organization_id=? JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND d.deleted_at IS NULL",
      )
      .bind(u, o, d)
      .first();
const load = async (db, version) => {
  const [c, a] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM drawing_legend_geometry_candidates WHERE geometry_version_id=? ORDER BY source_page,source_row,id",
      )
      .bind(version.id)
      .all(),
    db
      .prepare(
        "SELECT * FROM drawing_legend_geometry_review_events WHERE geometry_version_id=? ORDER BY created_at DESC",
      )
      .bind(version.id)
      .all(),
  ]);
  return {
    version: { ...version, summary: parse(version.summary, {}) },
    candidates: (c.results || []).map((x) => ({
      ...x,
      symbol_cell_bbox: parse(x.symbol_cell_bbox),
      geometry: parse(x.geometry, []),
      original_geometry: parse(x.original_geometry, []),
    })),
    audit: (a.results || []).map((x) => ({
      ...x,
      previous_value: parse(x.previous_value),
      new_value: parse(x.new_value),
    })),
  };
};
const generate = async (request, env, document, user) => {
  const approved = await env.DB.prepare(
    "SELECT * FROM drawing_structure_approved_versions WHERE document_id=? AND superseded_at IS NULL AND status='Approved' ORDER BY version_number DESC LIMIT 1",
  )
    .bind(document.id)
    .first();
  if (!approved)
    return json(
      {
        error: {
          code: "APPROVED_STRUCTURE_REQUIRED",
          message: "Approved structural rows are required.",
        },
      },
      409,
    );
  const rows =
      (
        await env.DB.prepare(
          "SELECT * FROM drawing_structure_approved_rows WHERE approved_version_id=? ORDER BY source_page,source_row",
        )
          .bind(approved.id)
          .all()
      ).results || [],
    file = await env.FILES.get(document.object_key);
  if (!file)
    return json(
      {
        error: {
          code: "DRAWING_FILE_MISSING",
          message: "Drawing file is unavailable.",
        },
      },
      409,
    );
  const hydrated = rows.map((r) => ({
      ...r,
      source_snapshot: parse(r.source_snapshot, {}),
      bounding_box: parse(r.bounding_box),
    })),
    result = await captureLegendGeometry(
      new Uint8Array(await file.arrayBuffer()),
      hydrated,
    ),
    input = await hash({
      approved: approved.id,
      rows: rows.map((r) => [r.id, r.source_snapshot]),
    }),
    output = await hash(result),
    current = await env.DB.prepare(
      "SELECT * FROM drawing_legend_geometry_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
      .bind(document.id)
      .first();
  if (
    current?.input_fingerprint === input &&
    current?.output_fingerprint === output
  )
    return json({ ...(await load(env.DB, current)), idempotent: true });
  const vid = id("legendGeometry"),
    number = Number(current?.version_number || 0) + 1;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO drawing_legend_geometry_versions (id,project_id,document_id,approved_structure_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      vid,
      document.project_id,
      document.id,
      approved.id,
      number,
      input,
      output,
      LEGEND_GEOMETRY_ENGINE_VERSION,
      "Completed",
      JSON.stringify(result.summary),
      user.id,
    ),
    ...(current
      ? [
          env.DB.prepare(
            "UPDATE drawing_legend_geometry_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?",
          ).bind(current.id),
        ]
      : []),
  ]);
  const statements = [];
  for (const row of hydrated) {
    const matches = result.candidates.filter((c) => c.rowId === row.id);
    if (matches.length)
      for (const c of matches)
        statements.push(
          env.DB.prepare(
            "INSERT INTO drawing_legend_geometry_candidates (id,geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_id,symbol_cell_bbox,geometry,geometry_signature,detection_confidence,detection_method,alignment_status,review_status,original_geometry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).bind(
            id("geometryCandidate"),
            vid,
            row.id,
            c.sourcePage,
            c.sourceRow,
            c.symbolCellId,
            JSON.stringify(c.symbolCellBBox),
            JSON.stringify(c.geometry),
            c.geometrySignature,
            c.confidence,
            c.detectionMethod,
            c.alignmentStatus,
            "Needs Review",
            JSON.stringify(c.geometry),
          ),
        );
    else
      statements.push(
        env.DB.prepare(
          "INSERT INTO drawing_legend_geometry_candidates (id,geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_bbox,geometry,detection_confidence,detection_method,alignment_status,review_status,original_geometry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          id("geometryCandidate"),
          vid,
          row.id,
          row.source_page,
          String(row.source_row),
          JSON.stringify(parse(row.bounding_box, {})),
          "[]",
          0,
          "No native geometry wholly contained in symbol cell",
          "Symbol Geometry Missing",
          "Symbol Geometry Missing",
          "[]",
        ),
      );
  }
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
  return json(
    {
      ...(await load(
        env.DB,
        await env.DB.prepare(
          "SELECT * FROM drawing_legend_geometry_versions WHERE id=?",
        )
          .bind(vid)
          .first(),
      )),
      idempotent: false,
    },
    201,
  );
};
const review = async (request, env, user, candidateId, action) => {
  const row = await env.DB.prepare(
    "SELECT c.*,v.project_id,v.document_id FROM drawing_legend_geometry_candidates c JOIN drawing_legend_geometry_versions v ON v.id=c.geometry_version_id JOIN projects p ON p.id=v.project_id WHERE c.id=? AND p.owner_user_id=? AND p.organization_id=? AND v.superseded_at IS NULL",
  )
    .bind(candidateId, user.id, user.organizationId)
    .first();
  if (!row)
    return json(
      {
        error: {
          code: "GEOMETRY_CANDIDATE_NOT_FOUND",
          message: "Current geometry candidate not found.",
        },
      },
      404,
    );
  const body = await request.json().catch(() => ({})),
    reason = String(body.reason || "").trim();
  if (reason.length < 5)
    return json(
      {
        error: {
          code: "GEOMETRY_REVIEW_REASON_REQUIRED",
          message: "Provide reviewer reason.",
        },
      },
      422,
    );
  const previous = {
      geometry: parse(row.geometry, []),
      status: row.review_status,
      rowId: row.approved_row_id,
      reassignedRowId: row.reassigned_row_id,
    },
    next = structuredClone(previous);
  if (action === "confirm") {
    if (!next.geometry.length)
      return json(
        {
          error: {
            code: "GEOMETRY_MISSING",
            message: "Missing geometry cannot be approved.",
          },
        },
        409,
      );
    next.status = "Approved";
  } else if (action === "reject")
    next.status = next.geometry.length ? "Rejected" : "Symbol Geometry Missing";
  else if (action === "restore") {
    next.geometry = parse(row.original_geometry, []);
    next.status = next.geometry.length
      ? "Needs Review"
      : "Symbol Geometry Missing";
    next.reassignedRowId = null;
  } else if (action === "reassign") {
    const target = await env.DB.prepare(
      "SELECT id FROM drawing_structure_approved_rows WHERE id=?",
    )
      .bind(String(body.targetRowId || ""))
      .first();
    if (!target)
      return json(
        {
          error: {
            code: "APPROVED_ROW_REQUIRED",
            message: "Target must be an approved structural row.",
          },
        },
        422,
      );
    next.reassignedRowId = target.id;
    next.status = "Needs Review";
  } else if (action === "merge-fragments") {
    next.geometry = [{ kind: "Merged Path Group", fragments: next.geometry }];
    next.status = "Needs Review";
  } else if (action === "split-symbols") {
    if (next.geometry.length < 2)
      return json(
        {
          error: {
            code: "MULTIPLE_PATHS_REQUIRED",
            message: "At least two paths are required to split.",
          },
        },
        422,
      );
    next.geometry = next.geometry.map((g, i) => ({
      kind: "Split Symbol",
      ordinal: i + 1,
      paths: [g],
    }));
    next.status = "Needs Review";
  } else
    return json(
      {
        error: {
          code: "GEOMETRY_ACTION_UNKNOWN",
          message: "Unsupported geometry action.",
        },
      },
      404,
    );
  const requestId = request.headers.get("x-request-id") || id("request");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE drawing_legend_geometry_candidates SET geometry=?,review_status=?,reassigned_row_id=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=? WHERE id=?",
    ).bind(
      JSON.stringify(next.geometry),
      next.status,
      next.reassignedRowId,
      user.id,
      reason,
      row.id,
    ),
    env.DB.prepare(
      "INSERT INTO drawing_legend_geometry_review_events (id,project_id,document_id,geometry_version_id,candidate_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id("geometryReview"),
      row.project_id,
      row.document_id,
      row.geometry_version_id,
      row.id,
      action,
      JSON.stringify(previous),
      JSON.stringify(next),
      reason,
      user.id,
      requestId,
    ),
  ]);
  return json({ candidateId: row.id, status: next.status });
};
const publish = async (request, env, document, user) => {
  const current = await env.DB.prepare(
    "SELECT * FROM drawing_legend_geometry_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  )
    .bind(document.id)
    .first();
  if (!current)
    return json(
      {
        error: {
          code: "GEOMETRY_CAPTURE_REQUIRED",
          message: "Run geometry capture first.",
        },
      },
      409,
    );
  const body = await request.json().catch(() => ({})),
    reason = String(body.reason || "").trim();
  if (reason.length < 5)
    return json(
      {
        error: {
          code: "GEOMETRY_PUBLISH_REASON_REQUIRED",
          message: "Provide publication reason.",
        },
      },
      422,
    );
  const approved =
      (
        await env.DB.prepare(
          "SELECT * FROM drawing_legend_geometry_candidates WHERE geometry_version_id=? AND review_status='Approved' ORDER BY id",
        )
          .bind(current.id)
          .all()
      ).results || [],
    total = Number(
      (
        await env.DB.prepare(
          "SELECT count(distinct approved_row_id) n FROM drawing_legend_geometry_candidates WHERE geometry_version_id=?",
        )
          .bind(current.id)
          .first()
      )?.n || 0,
    ),
    input = await hash(
      approved.map((r) => [
        r.id,
        r.geometry,
        r.reassigned_row_id,
        r.reviewed_at,
      ]),
    ),
    output = await hash(
      approved.map((r) => [
        r.approved_row_id,
        r.geometry_signature,
        r.geometry,
      ]),
    ),
    prior = await env.DB.prepare(
      "SELECT * FROM drawing_legend_geometry_approved_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
      .bind(document.id)
      .first();
  if (
    prior?.input_fingerprint === input &&
    prior?.output_fingerprint === output
  )
    return json({
      approvedGeometryVersionId: prior.id,
      version: prior.version_number,
      approvedLinks: prior.approved_link_count,
      idempotent: true,
    });
  const aid = id("approvedGeometry"),
    number = Number(prior?.version_number || 0) + 1;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO drawing_legend_geometry_approved_versions (id,project_id,document_id,source_geometry_version_id,version_number,input_fingerprint,output_fingerprint,status,approved_link_count,missing_row_count,created_by,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      aid,
      document.project_id,
      document.id,
      current.id,
      number,
      input,
      output,
      "Approved",
      approved.length,
      total -
        new Set(approved.map((r) => r.reassigned_row_id || r.approved_row_id))
          .size,
      user.id,
      reason,
    ),
    ...(prior
      ? [
          env.DB.prepare(
            "UPDATE drawing_legend_geometry_approved_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?",
          ).bind(prior.id),
        ]
      : []),
  ]);
  for (const row of approved)
    await env.DB.prepare(
      "INSERT INTO drawing_legend_geometry_approved_links (id,approved_geometry_version_id,approved_row_id,candidate_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id("approvedGeometryLink"),
        aid,
        row.reassigned_row_id || row.approved_row_id,
        row.id,
        row.source_page,
        row.source_row,
        row.symbol_cell_bbox,
        row.geometry,
        row.geometry_signature,
        row.detection_confidence,
        row.reviewed_by,
        row.review_reason,
      )
      .run();
  return json(
    {
      approvedGeometryVersionId: aid,
      version: number,
      approvedLinks: approved.length,
      missingRows: total - approved.length,
      idempotent: false,
    },
    201,
  );
};
export const handleDrawingLegendGeometryApi = async (request, env) => {
  const url = new URL(request.url);
  if (
    !url.pathname.includes("legend-geometry") &&
    !url.pathname.includes("geometry-candidates")
  )
    return null;
  if (!env.DB || !env.FILES)
    return json(
      {
        error: {
          code: "GEOMETRY_UNAVAILABLE",
          message: "Geometry storage unavailable.",
        },
      },
      503,
    );
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const doc = url.pathname.match(
    /^\/api\/documents\/([^/]+)\/legend-geometry(?:\/(start|rerun|publish|approved))?$/,
  );
  if (doc) {
    const document = await owned(env.DB, decodeURIComponent(doc[1]), user.id, user.organizationId);
    if (!document)
      return json(
        { error: { code: "DRAWING_NOT_FOUND", message: "Drawing not found." } },
        404,
      );
    const op = doc[2];
    if (["start", "rerun"].includes(op) && request.method === "POST")
      return generate(request, env, document, user);
    if (op === "publish" && request.method === "POST")
      return publish(request, env, document, user);
    if (!op && request.method === "GET") {
      const v = await env.DB.prepare(
        "SELECT * FROM drawing_legend_geometry_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
      )
        .bind(document.id)
        .first();
      return v
        ? json(await load(env.DB, v))
        : json(
            {
              error: {
                code: "GEOMETRY_CAPTURE_REQUIRED",
                message: "Start geometry capture.",
              },
            },
            409,
          );
    }
    if (op === "approved" && request.method === "GET") {
      const v = await env.DB.prepare(
        "SELECT * FROM drawing_legend_geometry_approved_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
      )
        .bind(document.id)
        .first();
      if (!v)
        return json(
          {
            error: {
              code: "APPROVED_GEOMETRY_REQUIRED",
              message: "Publish reviewed geometry first.",
            },
          },
          409,
        );
      const links = await env.DB.prepare(
        "SELECT * FROM drawing_legend_geometry_approved_links WHERE approved_geometry_version_id=?",
      )
        .bind(v.id)
        .all();
      return json({
        version: v,
        links: (links.results || []).map((r) => ({
          ...r,
          geometry: parse(r.geometry, []),
          symbol_cell_bbox: parse(r.symbol_cell_bbox),
        })),
      });
    }
  }
  const c = url.pathname.match(
    /^\/api\/geometry-candidates\/([^/]+)\/(confirm|reject|reassign|split-symbols|merge-fragments|restore)$/,
  );
  if (c && request.method === "POST")
    return review(request, env, user, decodeURIComponent(c[1]), c[2]);
  return json(
    {
      error: {
        code: "GEOMETRY_API_NOT_FOUND",
        message: "Operation not found.",
      },
    },
    404,
  );
};
