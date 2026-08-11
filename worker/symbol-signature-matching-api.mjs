import {
  normalizeGeometry,
  compareNormalized,
  SYMBOL_SIGNATURE_ENGINE_VERSION,
} from "../app/domain/symbol-signature-normalization-engine.mjs";
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
        "SELECT * FROM drawing_symbol_occurrence_match_candidates WHERE signature_version_id=? ORDER BY page_number,id",
      )
      .bind(v.id)
      .all(),
    db
      .prepare(
        "SELECT * FROM drawing_symbol_occurrence_match_events WHERE signature_version_id=? ORDER BY created_at DESC",
      )
      .bind(v.id)
      .all(),
  ]);
  return {
    version: {
      ...v,
      summary: parse(v.summary, {}),
      approved_normalized_signature: parse(v.approved_normalized_signature, {}),
    },
    candidates: (c.results || []).map((r) => ({
      ...r,
      bounding_box: parse(r.bounding_box),
      coordinates: parse(r.coordinates),
      geometry_differences: parse(r.geometry_differences, []),
      normalized_signature: parse(r.normalized_signature, {}),
    })),
    audit: (e.results || []).map((r) => ({
      ...r,
      previous_value: parse(r.previous_value),
      new_value: parse(r.new_value),
    })),
  };
};
const generate = async (request, env, document, user) => {
  const approved = await env.DB.prepare(
    "SELECT * FROM drawing_legend_geometry_approved_versions WHERE id=? AND document_id=? AND superseded_at IS NULL",
  )
    .bind("approvedGeometry_860071a3-c3af-42b6-a6b6-f1f9c38f9cbc", document.id)
    .first();
  if (!approved)
    return json(
      {
        error: {
          code: "CONTROLLED_APPROVED_GEOMETRY_REQUIRED",
          message: "The controlled approved geometry version is not current.",
        },
      },
      409,
    );
  const links =
    (
      await env.DB.prepare(
        "SELECT * FROM drawing_legend_geometry_approved_links WHERE approved_geometry_version_id=? ORDER BY id",
      )
        .bind(approved.id)
        .all()
    ).results || [];
  if (links.length !== 1)
    return json(
      {
        error: {
          code: "SINGLE_APPROVED_SYMBOL_REQUIRED",
          message: "Exactly one approved symbol is required.",
        },
      },
      409,
    );
  const recognition = await env.DB.prepare(
      "SELECT * FROM drawing_symbol_recognition_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
      .bind(document.id)
      .first(),
    occurrences =
      (
        await env.DB.prepare(
          "SELECT * FROM drawing_symbol_occurrences WHERE recognition_version_id=? AND definition_id IS NULL ORDER BY id",
        )
          .bind(recognition.id)
          .all()
      ).results || [];
  if (occurrences.length !== 62)
    return json(
      {
        error: {
          code: "CONTROLLED_UNKNOWN_SET_CHANGED",
          message: "Expected the controlled set of 62 unknown occurrences.",
        },
      },
      409,
    );
  const link = links[0],
    approvedGeometry = parse(link.geometry, []),
    approvedNormalized = await normalizeGeometry(
      approvedGeometry,
      link.geometry_signature,
    ),
    evaluations = [];
  for (const row of occurrences) {
    const raw = parse(row.source_geometry, {}),
      normalized = await normalizeGeometry(raw, row.shape_signature),
      comparison = compareNormalized(approvedNormalized, normalized);
    evaluations.push({ row, normalized, comparison });
  }
  const eligible = evaluations.filter((e) => e.comparison.eligible),
    summary = {
      occurrencesEvaluated: evaluations.length,
      candidatesGenerated: eligible.length,
      topologyRejected: evaluations.filter((e) =>
        e.comparison.geometryDifferences.some((v) =>
          /topology|Filled|Hole|component/i.test(v),
        ),
      ).length,
      ratioRejected: evaluations.filter((e) =>
        e.comparison.geometryDifferences.some((v) => /ratio/i.test(v)),
      ).length,
    },
    input = await hash({
      engine: SYMBOL_SIGNATURE_ENGINE_VERSION,
      approved: approved.id,
      link: link.geometry_signature,
      occurrences: occurrences.map((r) => [
        r.id,
        r.shape_signature,
        r.source_geometry,
      ]),
    }),
    output = await hash({
      summary,
      candidates: eligible.map((e) => [
        e.row.id,
        e.comparison,
        e.normalized.normalizedSignature,
      ]),
    }),
    current = await env.DB.prepare(
      "SELECT * FROM drawing_symbol_signature_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
      .bind(document.id)
      .first();
  if (
    current?.input_fingerprint === input &&
    current?.output_fingerprint === output
  )
    return json({ ...(await load(env.DB, current)), idempotent: true });
  const vid = id("symbolSignature"),
    number = Number(current?.version_number || 0) + 1;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO drawing_symbol_signature_versions (id,project_id,document_id,approved_geometry_version_id,symbol_recognition_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,approved_normalized_signature,approved_raw_signature,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      vid,
      document.project_id,
      document.id,
      approved.id,
      recognition.id,
      number,
      input,
      output,
      SYMBOL_SIGNATURE_ENGINE_VERSION,
      "Completed",
      JSON.stringify(summary),
      JSON.stringify(approvedNormalized),
      link.geometry_signature,
      user.id,
    ),
    ...(current
      ? [
          env.DB.prepare(
            "UPDATE drawing_symbol_signature_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?",
          ).bind(current.id),
        ]
      : []),
  ]);
  for (const e of eligible)
    await env.DB.prepare(
      "INSERT INTO drawing_symbol_occurrence_match_candidates (id,signature_version_id,approved_geometry_link_id,occurrence_id,page_number,bounding_box,coordinates,similarity_score,matching_basis,geometry_differences,confidence,review_status,normalized_signature,raw_signature) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id("occurrenceMatch"),
        vid,
        link.id,
        e.row.id,
        e.row.page_number,
        e.row.bounding_box,
        JSON.stringify(parse(e.row.bounding_box, {})),
        e.comparison.similarityScore,
        e.comparison.matchingBasis,
        JSON.stringify(e.comparison.geometryDifferences),
        e.comparison.confidence,
        "Needs Review",
        JSON.stringify(e.normalized),
        e.row.shape_signature,
      )
      .run();
  return json(
    {
      ...(await load(
        env.DB,
        await env.DB.prepare(
          "SELECT * FROM drawing_symbol_signature_versions WHERE id=?",
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
    "SELECT c.*,v.project_id,v.document_id FROM drawing_symbol_occurrence_match_candidates c JOIN drawing_symbol_signature_versions v ON v.id=c.signature_version_id JOIN projects p ON p.id=v.project_id WHERE c.id=? AND p.owner_user_id=? AND p.organization_id=? AND v.superseded_at IS NULL",
  )
    .bind(candidateId, user.id, user.organizationId)
    .first();
  if (!row)
    return json(
      {
        error: {
          code: "OCCURRENCE_CANDIDATE_NOT_FOUND",
          message: "Current candidate not found.",
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
          code: "OCCURRENCE_REVIEW_REASON_REQUIRED",
          message: "Provide reviewer reason.",
        },
      },
      422,
    );
  const previous = { status: row.review_status },
    next = {
      status:
        action === "confirm"
          ? "Confirmed"
          : action === "reject"
            ? "Rejected"
            : "Needs Review",
    };
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE drawing_symbol_occurrence_match_candidates SET review_status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=? WHERE id=?",
    ).bind(next.status, user.id, reason, row.id),
    env.DB.prepare(
      "INSERT INTO drawing_symbol_occurrence_match_events (id,project_id,document_id,signature_version_id,candidate_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id("occurrenceMatchEvent"),
      row.project_id,
      row.document_id,
      row.signature_version_id,
      row.id,
      action,
      JSON.stringify(previous),
      JSON.stringify(next),
      reason,
      user.id,
      request.headers.get("x-request-id") || id("request"),
    ),
  ]);
  return json({ candidateId: row.id, status: next.status });
};
export const handleSymbolSignatureMatchingApi = async (request, env) => {
  const url = new URL(request.url);
  if (
    !url.pathname.includes("symbol-signature-matching") &&
    !url.pathname.includes("occurrence-match-candidates")
  )
    return null;
  if (!env.DB)
    return json(
      {
        error: {
          code: "SIGNATURE_MATCHING_UNAVAILABLE",
          message: "Signature storage unavailable.",
        },
      },
      503,
    );
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const d = url.pathname.match(
    /^\/api\/documents\/([^/]+)\/symbol-signature-matching(?:\/(start|rerun))?$/,
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
    if (!d[2] && request.method === "GET") {
      const v = await env.DB.prepare(
        "SELECT * FROM drawing_symbol_signature_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
      )
        .bind(document.id)
        .first();
      return v
        ? json(await load(env.DB, v))
        : json(
            {
              error: {
                code: "SIGNATURE_MATCHING_REQUIRED",
                message: "Start controlled signature matching.",
              },
            },
            409,
          );
    }
  }
  const c = url.pathname.match(
    /^\/api\/occurrence-match-candidates\/([^/]+)\/(confirm|reject|restore)$/,
  );
  if (c && request.method === "POST")
    return review(request, env, user, decodeURIComponent(c[1]), c[2]);
  return json(
    {
      error: {
        code: "SIGNATURE_API_NOT_FOUND",
        message: "Operation not found.",
      },
    },
    404,
  );
};
