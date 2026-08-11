import {
  segmentSymbolCell,
  SYMBOL_SEGMENTATION_ENGINE_VERSION,
} from "../app/domain/symbol-cell-segmentation-engine.mjs";
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
        "SELECT d.*,p.id project_id FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? AND p.organization_id=? WHERE d.id=? AND d.deleted_at IS NULL",
      )
      .bind(u, o, d)
      .first();
const load = async (db, v) => {
  const [c, e] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM drawing_symbol_cluster_candidates WHERE segmentation_version_id=? ORDER BY cluster_number",
      )
      .bind(v.id)
      .all(),
    db
      .prepare(
        "SELECT * FROM drawing_symbol_cluster_events WHERE segmentation_version_id=? ORDER BY created_at DESC",
      )
      .bind(v.id)
      .all(),
  ]);
  return {
    version: { ...v, summary: parse(v.summary, {}) },
    clusters: (c.results || []).map((r) => ({
      ...r,
      bounding_box: parse(r.bounding_box),
      fragments: parse(r.fragments, []),
      original_fragments: parse(r.original_fragments, []),
    })),
    audit: (e.results || []).map((r) => ({
      ...r,
      previous_value: parse(r.previous_value),
      new_value: parse(r.new_value),
    })),
  };
};
const generate = async (request, env, document, user) => {
  const source = await env.DB.prepare(
    "SELECT * FROM drawing_legend_geometry_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  )
    .bind(document.id)
    .first();
  if (!source)
    return json(
      {
        error: {
          code: "GEOMETRY_CAPTURE_REQUIRED",
          message: "Run bounded geometry capture first.",
        },
      },
      409,
    );
  const rows =
    (
      await env.DB.prepare(
        "SELECT * FROM drawing_legend_geometry_candidates WHERE geometry_version_id=? AND reviewed_by IS NOT NULL AND json_array_length(original_geometry)>0 ORDER BY id",
      )
        .bind(source.id)
        .all()
    ).results || [];
  if (!rows.length)
    return json(
      {
        error: {
          code: "REVIEWED_COMPLEX_CELL_REQUIRED",
          message: "No reviewed complex symbol cell is available.",
        },
      },
      409,
    );
  const outputs = [];
  for (const row of rows)
    outputs.push({
      row,
      result: await segmentSymbolCell({
        symbolCellBBox: parse(row.symbol_cell_bbox, {}),
        fragments: parse(row.original_geometry, []),
      }),
    });
  const input = await hash({
      source: source.id,
      rows: rows.map((r) => [r.id, r.original_geometry, r.reviewed_at]),
    }),
    output = await hash(outputs.map((o) => o.result)),
    current = await env.DB.prepare(
      "SELECT * FROM drawing_symbol_segmentation_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
      .bind(document.id)
      .first();
  if (
    current?.input_fingerprint === input &&
    current?.output_fingerprint === output
  )
    return json({ ...(await load(env.DB, current)), idempotent: true });
  const vid = id("symbolSegmentation"),
    number = Number(current?.version_number || 0) + 1,
    summary = {
      cellsProcessed: rows.length,
      clustersGenerated: outputs.reduce(
        (n, o) => n + o.result.summary.clusterCount,
        0,
      ),
      excludedFragments: outputs.reduce(
        (n, o) => n + o.result.summary.excludedFragmentCount,
        0,
      ),
      preExcludedClusters: outputs.reduce(
        (n, o) => n + o.result.summary.preExcludedClusterCount,
        0,
      ),
    };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO drawing_symbol_segmentation_versions (id,project_id,document_id,geometry_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      vid,
      document.project_id,
      document.id,
      source.id,
      number,
      input,
      output,
      SYMBOL_SEGMENTATION_ENGINE_VERSION,
      "Completed",
      JSON.stringify(summary),
      user.id,
    ),
    ...(current
      ? [
          env.DB.prepare(
            "UPDATE drawing_symbol_segmentation_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?",
          ).bind(current.id),
        ]
      : []),
  ]);
  const statements = [];
  for (const { row, result } of outputs)
    for (const c of result.clusters)
      statements.push(
        env.DB.prepare(
          "INSERT INTO drawing_symbol_cluster_candidates (id,segmentation_version_id,geometry_candidate_id,approved_row_id,cluster_number,bounding_box,fragments,original_fragments,fragment_count,geometry_signature,detection_basis,confidence,exclusion_reason,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          id("symbolCluster"),
          vid,
          row.id,
          row.approved_row_id,
          c.clusterNumber,
          JSON.stringify(c.boundingBox),
          JSON.stringify(c.fragments),
          JSON.stringify(c.fragments),
          c.fragmentCount,
          c.geometrySignature,
          c.detectionBasis,
          c.confidence,
          c.exclusionReason,
          c.exclusionReason ? "Excluded" : "Needs Review",
        ),
      );
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
  return json(
    {
      ...(await load(
        env.DB,
        await env.DB.prepare(
          "SELECT * FROM drawing_symbol_segmentation_versions WHERE id=?",
        )
          .bind(vid)
          .first(),
      )),
      idempotent: false,
      excludedGroups: outputs.flatMap((o) =>
        o.result.excluded.map((e) => e.reason),
      ),
    },
    201,
  );
};
const review = async (request, env, user, clusterId, action) => {
  const row = await env.DB.prepare(
    "SELECT c.*,v.project_id,v.document_id FROM drawing_symbol_cluster_candidates c JOIN drawing_symbol_segmentation_versions v ON v.id=c.segmentation_version_id JOIN projects p ON p.id=v.project_id WHERE c.id=? AND p.owner_user_id=? AND p.organization_id=? AND v.superseded_at IS NULL",
  )
    .bind(clusterId, user.id, user.organizationId)
    .first();
  if (!row)
    return json(
      {
        error: {
          code: "SYMBOL_CLUSTER_NOT_FOUND",
          message: "Current cluster not found.",
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
          code: "CLUSTER_REVIEW_REASON_REQUIRED",
          message: "Provide reviewer reason.",
        },
      },
      422,
    );
  const previous = {
      fragments: parse(row.fragments, []),
      status: row.review_status,
    },
    next = structuredClone(previous);
  if (action === "confirm") {
    if (row.exclusion_reason)
      return json(
        {
          error: {
            code: "EXCLUDED_CLUSTER_BLOCKED",
            message:
              "An excluded cluster cannot be confirmed without restoring and reviewing it.",
          },
        },
        409,
      );
    next.status = "Approved";
  } else if (action === "reject") next.status = "Rejected";
  else if (action === "restore") {
    next.fragments = parse(row.original_fragments, []);
    next.status = row.exclusion_reason ? "Excluded" : "Needs Review";
  } else if (action === "add-fragments") {
    const add = Array.isArray(body.fragments) ? body.fragments : [];
    next.fragments = [...next.fragments, ...add];
    next.status = "Needs Review";
  } else if (action === "remove-fragments") {
    const indexes = new Set((body.indexes || []).map(Number));
    next.fragments = next.fragments.filter((_, i) => !indexes.has(i));
    next.status = "Needs Review";
  } else if (action === "split-cluster") {
    const cut = Math.max(
      1,
      Math.min(
        next.fragments.length - 1,
        Number(body.at || Math.floor(next.fragments.length / 2)),
      ),
    );
    if (next.fragments.length < 2)
      return json(
        {
          error: {
            code: "CLUSTER_SPLIT_REQUIRES_FRAGMENTS",
            message: "Cluster has fewer than two fragments.",
          },
        },
        422,
      );
    next.fragments = next.fragments.slice(0, cut);
    next.status = "Needs Review";
  } else if (action === "merge-clusters") {
    const target = await env.DB.prepare(
      "SELECT * FROM drawing_symbol_cluster_candidates WHERE id=? AND segmentation_version_id=? AND approved_row_id=?",
    )
      .bind(
        String(body.targetClusterId || ""),
        row.segmentation_version_id,
        row.approved_row_id,
      )
      .first();
    if (!target)
      return json(
        {
          error: {
            code: "SAME_ROW_CLUSTER_REQUIRED",
            message: "Merge target must belong to the same approved row.",
          },
        },
        422,
      );
    next.fragments = [...next.fragments, ...parse(target.fragments, [])];
    next.status = "Needs Review";
  } else
    return json(
      {
        error: {
          code: "CLUSTER_ACTION_UNKNOWN",
          message: "Unsupported action.",
        },
      },
      404,
    );
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE drawing_symbol_cluster_candidates SET fragments=?,fragment_count=?,review_status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=? WHERE id=?",
    ).bind(
      JSON.stringify(next.fragments),
      next.fragments.length,
      next.status,
      user.id,
      reason,
      row.id,
    ),
    env.DB.prepare(
      "INSERT INTO drawing_symbol_cluster_events (id,project_id,document_id,segmentation_version_id,cluster_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id("clusterEvent"),
      row.project_id,
      row.document_id,
      row.segmentation_version_id,
      row.id,
      action,
      JSON.stringify(previous),
      JSON.stringify(next),
      reason,
      user.id,
      request.headers.get("x-request-id") || id("request"),
    ),
  ]);
  return json({
    clusterId: row.id,
    status: next.status,
    fragmentCount: next.fragments.length,
  });
};
const publish = async (request, env, document, user) => {
  const version = await env.DB.prepare(
    "SELECT * FROM drawing_symbol_segmentation_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  )
    .bind(document.id)
    .first();
  if (!version)
    return json(
      {
        error: {
          code: "SEGMENTATION_REQUIRED",
          message: "Run segmentation first.",
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
          code: "CLUSTER_PUBLISH_REASON_REQUIRED",
          message: "Provide publication reason.",
        },
      },
      422,
    );
  const rows =
      (
        await env.DB.prepare(
          "SELECT * FROM drawing_symbol_cluster_candidates WHERE segmentation_version_id=? AND review_status='Approved' ORDER BY id",
        )
          .bind(version.id)
          .all()
      ).results || [],
    source = await env.DB.prepare(
      "SELECT * FROM drawing_legend_geometry_versions WHERE id=?",
    )
      .bind(version.geometry_version_id)
      .first(),
    total = Number(
      (
        await env.DB.prepare(
          "SELECT approved_row_count n FROM drawing_structure_approved_versions WHERE id=?",
        )
          .bind(source.approved_structure_version_id)
          .first()
      )?.n || 0,
    ),
    input = await hash({
      approvedStructuralRowCount: total,
      clusters: rows.map((r) => [r.id, r.fragments, r.reviewed_at]),
    }),
    output = await hash(
      rows.map((r) => [r.approved_row_id, r.geometry_signature, r.fragments]),
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
      source.id,
      number,
      input,
      output,
      "Approved",
      rows.length,
      total - new Set(rows.map((r) => r.approved_row_id)).size,
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
  for (const r of rows)
    await env.DB.prepare(
      "INSERT INTO drawing_legend_geometry_approved_links (id,approved_geometry_version_id,approved_row_id,candidate_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) SELECT ?,?,?,?,g.source_page,g.source_row,g.symbol_cell_bbox,?,?,?,?,? FROM drawing_legend_geometry_candidates g WHERE g.id=?",
    )
      .bind(
        id("approvedGeometryLink"),
        aid,
        r.approved_row_id,
        r.id,
        r.fragments,
        r.geometry_signature,
        r.confidence,
        r.reviewed_by,
        r.review_reason,
        r.geometry_candidate_id,
      )
      .run();
  return json(
    {
      approvedGeometryVersionId: aid,
      version: number,
      approvedLinks: rows.length,
      missingRows: total - new Set(rows.map((r) => r.approved_row_id)).size,
      idempotent: false,
    },
    201,
  );
};
export const handleSymbolCellSegmentationApi = async (request, env) => {
  const url = new URL(request.url);
  if (
    !url.pathname.includes("symbol-segmentation") &&
    !url.pathname.includes("symbol-clusters")
  )
    return null;
  if (!env.DB)
    return json(
      {
        error: {
          code: "SEGMENTATION_UNAVAILABLE",
          message: "Segmentation storage unavailable.",
        },
      },
      503,
    );
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const d = url.pathname.match(
    /^\/api\/documents\/([^/]+)\/symbol-segmentation(?:\/(start|rerun|publish))?$/,
  );
  if (d) {
    const document = await owned(env.DB, decodeURIComponent(d[1]), user.id, user.organizationId);
    if (!document)
      return json(
        { error: { code: "DRAWING_NOT_FOUND", message: "Drawing not found." } },
        404,
      );
    if (["start", "rerun"].includes(d[2]) && request.method === "POST")
      return generate(request, env, document, user);
    if (d[2] === "publish" && request.method === "POST")
      return publish(request, env, document, user);
    if (!d[2] && request.method === "GET") {
      const v = await env.DB.prepare(
        "SELECT * FROM drawing_symbol_segmentation_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
      )
        .bind(document.id)
        .first();
      return v
        ? json(await load(env.DB, v))
        : json(
            {
              error: {
                code: "SEGMENTATION_REQUIRED",
                message: "Start segmentation.",
              },
            },
            409,
          );
    }
  }
  const c = url.pathname.match(
    /^\/api\/symbol-clusters\/([^/]+)\/(confirm|reject|add-fragments|remove-fragments|merge-clusters|split-cluster|restore)$/,
  );
  if (c && request.method === "POST")
    return review(request, env, user, decodeURIComponent(c[1]), c[2]);
  return json(
    {
      error: {
        code: "SEGMENTATION_API_NOT_FOUND",
        message: "Operation not found.",
      },
    },
    404,
  );
};
