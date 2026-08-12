import {
  PROJECT_CONTEXT_PARSER_VERSION,
  extractProjectContextBytes,
} from "../app/domain/project-context-extractor.mjs";
import { requireMigratedTables } from "./schema-requirements.mjs";
import {
  applicationActor,
  resolveApplicationContext,
} from "./application-context.mjs";

const TABLES = [
  "project_context_extraction_versions",
  "project_context_facts",
  "project_context_review_events",
];

const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const projectRoute = pathname =>
  pathname.match(
    /^\/api\/projects\/([^/]+)\/project-context(?:\/(extract)|\/facts\/([^/]+)\/(approve|edit|reject))?$/,
  );

const resolveActor = async (request, env) => {
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) {
    return {
      error: json(
        {
          error: {
            code: resolved.error.code,
            message: resolved.error.message,
          },
        },
        resolved.error.status,
      ),
    };
  }
  return { actor: applicationActor(resolved.context) };
};

const ownedProject = (db, projectId, userId) =>
  db.prepare(
    "SELECT id,organization_id FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL",
  ).bind(projectId, userId).first();

const projectContextView = async (db, projectId) => {
  const extractions = await db.prepare(
    "SELECT e.*,d.logical_name,v.original_filename FROM project_context_extraction_versions e JOIN documents d ON d.id=e.document_id JOIN document_versions v ON v.id=e.document_version_id WHERE e.project_id=? AND e.superseded_at IS NULL ORDER BY e.created_at DESC,e.version_number DESC",
  ).bind(projectId).all();

  const facts = await db.prepare(
    "SELECT f.* FROM project_context_facts f JOIN project_context_extraction_versions e ON e.id=f.extraction_version_id WHERE f.project_id=? AND e.superseded_at IS NULL ORDER BY f.source_sheet,f.source_row,f.fact_key",
  ).bind(projectId).all();

  return {
    extractions: (extractions.results || []).map(row => ({
      ...row,
      summary: JSON.parse(row.summary_json || "{}"),
    })),
    facts: facts.results || [],
  };
};

export const persistProjectContextExtraction = async (
  db,
  {
    document,
    classificationId = null,
    result,
    userId,
    requestId = makeId("request"),
    stamp = now(),
  },
) => {
  await requireMigratedTables(db, TABLES);

  const fingerprint =
    `${document.sha256}:${PROJECT_CONTEXT_PARSER_VERSION}`;

  const duplicate = await db.prepare(
    "SELECT * FROM project_context_extraction_versions WHERE project_id=? AND document_version_id=? AND input_fingerprint=?",
  ).bind(
    document.project_id,
    document.current_version_id,
    fingerprint,
  ).first();

  if (duplicate) {
    return {
      extraction: duplicate,
      idempotent: true,
    };
  }

  const previous = await db.prepare(
    "SELECT * FROM project_context_extraction_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  ).bind(document.id).first();

  const versionNumber = Number(previous?.version_number || 0) + 1;
  const extractionId = makeId("projectcontextextraction");

  const statements = [
    db.prepare(
      "INSERT INTO project_context_extraction_versions (id,project_id,document_id,document_version_id,classification_id,version_number,source_checksum,parser_version,input_fingerprint,status,review_status,summary_json,created_by,completed_at) VALUES (?,?,?,?,?,?,?,?,?,'Completed','Needs Review',?,?,?)",
    ).bind(
      extractionId,
      document.project_id,
      document.id,
      document.current_version_id,
      classificationId,
      versionNumber,
      document.sha256,
      `${result.parser}:${result.parserVersion}`,
      fingerprint,
      JSON.stringify({
        ...result.summary,
        missingFields: result.missingFields,
        sourceSheet: result.sourceSheet,
      }),
      userId,
      stamp,
    ),
  ];

  for (const fact of result.facts) {
    statements.push(
      db.prepare(
        "INSERT INTO project_context_facts (id,extraction_version_id,project_id,document_id,document_version_id,fact_key,label,extracted_value,normalized_value,value_origin,confidence,source_sheet,source_row,source_cell,source_label_cell,requires_ai_interpretation,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        makeId("projectcontextfact"),
        extractionId,
        document.project_id,
        document.id,
        document.current_version_id,
        fact.key,
        fact.label,
        fact.value,
        fact.normalizedValue,
        fact.origin,
        fact.confidence,
        fact.source.sheet,
        fact.source.row,
        fact.source.cell,
        fact.source.labelCell,
        fact.requiresAiInterpretation ? 1 : 0,
        "Needs Review",
      ),
    );
  }

  statements.push(
    db.prepare(
      "INSERT INTO project_context_review_events (id,project_id,extraction_version_id,fact_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,NULL,'EXTRACT',NULL,?,?,?,?)",
    ).bind(
      makeId("projectcontextevent"),
      document.project_id,
      extractionId,
      JSON.stringify({
        factCount: result.facts.length,
        sourceSheet: result.sourceSheet,
        parserVersion: result.parserVersion,
      }),
      "Source-backed Project Context extraction",
      userId,
      requestId,
    ),
  );

  if (previous) {
    statements.push(
      db.prepare(
        "UPDATE project_context_extraction_versions SET superseded_at=? WHERE id=? AND superseded_at IS NULL",
      ).bind(stamp, previous.id),
    );
  }

  await db.batch(statements);

  return {
    extraction: await db.prepare(
      "SELECT * FROM project_context_extraction_versions WHERE id=?",
    ).bind(extractionId).first(),
    idempotent: false,
  };
};

export const reviewProjectContextFact = async (
  db,
  {
    projectId,
    factId,
    action,
    reviewedValue,
    reason,
    actorId,
    requestId,
    stamp = now(),
  },
) => {
  await requireMigratedTables(db, TABLES);

  const normalizedAction = String(action || "").toLowerCase();
  const normalizedReason = String(reason || "").replace(/\s+/g, " ").trim();
  const normalizedRequestId = String(requestId || "").trim();

  if (!["approve", "edit", "reject"].includes(normalizedAction)) {
    return json(
      {
        error: {
          code: "INVALID_REVIEW_ACTION",
          message: "Select approve, edit or reject.",
        },
      },
      422,
    );
  }

  if (normalizedReason.length < 10) {
    return json(
      {
        error: {
          code: "REVIEW_REASON_REQUIRED",
          message: "A substantive review reason is required.",
        },
      },
      422,
    );
  }

  if (!normalizedRequestId) {
    return json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A durable review request id is required.",
        },
      },
      422,
    );
  }

  const replay = await db.prepare(
    "SELECT * FROM project_context_review_events WHERE project_id=? AND request_id=?",
  ).bind(projectId, normalizedRequestId).first();

  if (replay) {
    if (replay.fact_id !== factId) {
      return json(
        {
          error: {
            code: "IDEMPOTENCY_KEY_CONFLICT",
            message: "This review request id belongs to another fact.",
          },
        },
        409,
      );
    }

    return json({
      fact: await db.prepare(
        "SELECT * FROM project_context_facts WHERE id=? AND project_id=?",
      ).bind(factId, projectId).first(),
      event: replay,
      idempotent: true,
    });
  }

  const fact = await db.prepare(
    "SELECT f.*,e.superseded_at FROM project_context_facts f JOIN project_context_extraction_versions e ON e.id=f.extraction_version_id WHERE f.id=? AND f.project_id=?",
  ).bind(factId, projectId).first();

  if (!fact) {
    return json(
      {
        error: {
          code: "PROJECT_CONTEXT_FACT_NOT_FOUND",
          message: "Project Context fact was not found.",
        },
      },
      404,
    );
  }

  if (fact.superseded_at) {
    return json(
      {
        error: {
          code: "PROJECT_CONTEXT_EXTRACTION_SUPERSEDED",
          message: "A fact from a superseded extraction cannot be reviewed.",
        },
      },
      409,
    );
  }

  const submittedValue =
    reviewedValue === undefined || reviewedValue === null
      ? null
      : String(reviewedValue).replace(/\s+/g, " ").trim();

  if (normalizedAction === "edit" && !submittedValue) {
    return json(
      {
        error: {
          code: "REVIEWED_VALUE_REQUIRED",
          message: "Enter the corrected value before saving the edit.",
        },
      },
      422,
    );
  }

  const nextStatus = {
    approve: "Approved",
    edit: "Edited",
    reject: "Rejected",
  }[normalizedAction];

  const effectiveValue =
    normalizedAction === "approve"
      ? fact.extracted_value
      : normalizedAction === "edit"
        ? submittedValue
        : null;

  const previousValue = JSON.stringify({
    reviewStatus: fact.review_status,
    reviewedValue: fact.reviewed_value,
    extractedValue: fact.extracted_value,
  });

  const newValue = JSON.stringify({
    reviewStatus: nextStatus,
    reviewedValue: effectiveValue,
    extractedValue: fact.extracted_value,
  });

  const eventId = makeId("projectcontextevent");

  try {
    await db.batch([
      db.prepare(
        "UPDATE project_context_facts SET review_status=?,reviewed_value=?,review_reason=?,reviewed_by=?,reviewed_at=? WHERE id=? AND project_id=?",
      ).bind(
        nextStatus,
        effectiveValue,
        normalizedReason,
        actorId,
        stamp,
        factId,
        projectId,
      ),
      db.prepare(
        "INSERT INTO project_context_review_events (id,project_id,extraction_version_id,fact_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        eventId,
        projectId,
        fact.extraction_version_id,
        factId,
        normalizedAction.toUpperCase(),
        previousValue,
        newValue,
        normalizedReason,
        actorId,
        normalizedRequestId,
      ),
    ]);
  } catch (error) {
    if (/UNIQUE constraint|constraint failed/i.test(String(error?.message || error))) {
      const existing = await db.prepare(
        "SELECT * FROM project_context_review_events WHERE project_id=? AND request_id=?",
      ).bind(projectId, normalizedRequestId).first();

      if (existing?.fact_id === factId) {
        return json({
          fact: await db.prepare(
            "SELECT * FROM project_context_facts WHERE id=? AND project_id=?",
          ).bind(factId, projectId).first(),
          event: existing,
          idempotent: true,
        });
      }

      return json(
        {
          error: {
            code: "IDEMPOTENCY_KEY_CONFLICT",
            message: "This review request id belongs to another fact.",
          },
        },
        409,
      );
    }
    throw error;
  }

  return json(
    {
      fact: await db.prepare(
        "SELECT * FROM project_context_facts WHERE id=? AND project_id=?",
      ).bind(factId, projectId).first(),
      event: await db.prepare(
        "SELECT * FROM project_context_review_events WHERE id=?",
      ).bind(eventId).first(),
      idempotent: false,
    },
    201,
  );
};

export const executeProjectContextExtraction = async (
  env,
  { documentId, userId },
) => {
  await requireMigratedTables(env.DB, TABLES);

  const document = await env.DB.prepare(
    "SELECT d.id,d.project_id,d.current_version_id,v.original_filename,v.extension,v.mime_type,v.sha256,v.object_key FROM documents d JOIN projects p ON p.id=d.project_id JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND p.owner_user_id=? AND d.deleted_at IS NULL",
  ).bind(documentId, userId).first();

  if (!document) {
    throw Object.assign(
      new Error("Project Context document was not found."),
      { code: "DOCUMENT_NOT_FOUND" },
    );
  }

  if (String(document.extension).toLowerCase() !== "xlsx") {
    throw Object.assign(
      new Error("Project Context extraction currently supports XLSX."),
      { code: "PROJECT_CONTEXT_FORMAT_UNSUPPORTED" },
    );
  }

  const classification = await env.DB.prepare(
    "SELECT id,primary_type,manual_review_required FROM document_classifications WHERE document_id=? AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1",
  ).bind(document.id).first();

  if (
    !classification ||
    classification.primary_type !== "Project Context" ||
    Number(classification.manual_review_required) === 1
  ) {
    throw Object.assign(
      new Error("Project Context classification must be confirmed before extraction."),
      { code: "PROJECT_CONTEXT_CLASSIFICATION_REQUIRED" },
    );
  }

  const object = await env.FILES.get(document.object_key);
  if (!object) {
    throw Object.assign(
      new Error("Stored Project Context document is unavailable."),
      { code: "STORAGE_OBJECT_MISSING" },
    );
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  const result = extractProjectContextBytes(bytes, {
    extension: document.extension,
    fileName: document.original_filename,
    projectId: document.project_id,
    documentId: document.id,
    documentVersionId: document.current_version_id,
  });

  return persistProjectContextExtraction(env.DB, {
    document,
    classificationId: classification.id,
    result,
    userId,
  });
};

export const handleProjectContextApi = async (request, env) => {
  const route = projectRoute(new URL(request.url).pathname);
  if (!route) return null;

  if (!env.DB || !env.FILES) {
    return json(
      {
        error: {
          code: "PROJECT_CONTEXT_UNAVAILABLE",
          message: "Project Context storage is unavailable.",
        },
      },
      503,
    );
  }

  try {
    await requireMigratedTables(env.DB, TABLES);
  } catch (error) {
    return json(
      {
        error: {
          code: error.code || "DATABASE_SCHEMA_MISSING",
          message: error.message,
        },
      },
      503,
    );
  }

  const auth = await resolveActor(request, env);
  if (auth.error) return auth.error;

  const projectId = decodeURIComponent(route[1]);
  const project = await ownedProject(
    env.DB,
    projectId,
    auth.actor.id,
  );

  if (!project) {
    return json(
      {
        error: {
          code: "PROJECT_NOT_FOUND",
          message: "Project was not found or is unavailable.",
        },
      },
      404,
    );
  }

  if (request.method === "GET" && !route[2]) {
    return json(await projectContextView(env.DB, projectId));
  }

  if (
    request.method === "POST" &&
    route[3] &&
    route[4]
  ) {
    const factId = decodeURIComponent(route[3]);
    const body = await request.json().catch(() => ({}));
    const requestId =
      request.headers.get("x-idempotency-key") ||
      request.headers.get("x-request-id") ||
      String(body.idempotencyKey || "").trim();

    return reviewProjectContextFact(env.DB, {
      projectId,
      factId,
      action: route[4],
      reviewedValue: body.reviewedValue,
      reason: body.reason,
      actorId: auth.actor.id,
      requestId,
    });
  }

  if (request.method === "POST" && route[2] === "extract") {
    const body = await request.json().catch(() => ({}));
    const documentId = String(body.documentId || "").trim();

    if (!documentId) {
      return json(
        {
          error: {
            code: "DOCUMENT_ID_REQUIRED",
            message: "Select a Project Context document to extract.",
          },
        },
        422,
      );
    }

    const document = await env.DB.prepare(
      "SELECT d.id FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND d.project_id=? AND p.owner_user_id=? AND d.deleted_at IS NULL",
    ).bind(documentId, projectId, auth.actor.id).first();

    if (!document) {
      return json(
        {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Project Context document was not found in this project.",
          },
        },
        404,
      );
    }

    try {
      const result = await executeProjectContextExtraction(env, {
        documentId,
        userId: auth.actor.id,
      });

      return json(
        {
          ...result,
          projectContext: await projectContextView(
            env.DB,
            projectId,
          ),
        },
        result.idempotent ? 200 : 201,
      );
    } catch (error) {
      const status = {
        DOCUMENT_NOT_FOUND: 404,
        PROJECT_CONTEXT_FORMAT_UNSUPPORTED: 422,
        PROJECT_CONTEXT_CLASSIFICATION_REQUIRED: 409,
        STORAGE_OBJECT_MISSING: 409,
        PROJECT_CONTEXT_SHEET_NOT_FOUND: 422,
      }[error.code] || 500;

      return json(
        {
          error: {
            code: error.code || "PROJECT_CONTEXT_EXTRACTION_FAILED",
            message: error.message,
          },
        },
        status,
      );
    }
  }

  return json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "This Project Context operation is not supported.",
      },
    },
    405,
  );
};
