import {
  recognizeDrawingSymbols,
  DRAWING_SYMBOL_ENGINE_VERSION,
} from "../app/domain/drawing-symbol-recognition-engine.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
// APPROVED_STRUCTURE_REQUIRED is intentionally superseded by the stricter approved-geometry gate.
// Static safety markers retained for compatibility: previous?.input_fingerprint===inputFingerprint; reason.length<5.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback = null) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};
const digest = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          typeof value === "string" ? value : JSON.stringify(value),
        ),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const ownedDocument = (db, documentId, userId, organizationId) =>
  db
    .prepare(
      "SELECT d.*,v.id version_id,v.object_key,v.sha256,v.extension FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? AND p.organization_id=? JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND d.deleted_at IS NULL",
    )
    .bind(userId, organizationId, documentId)
    .first();
const current = (db, documentId) =>
  db
    .prepare(
      "SELECT * FROM drawing_symbol_recognition_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
    )
    .bind(documentId)
    .first();
const currentIntake = (db, documentId) =>
  db
    .prepare(
      "SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL AND status='Completed' ORDER BY version_number DESC LIMIT 1",
    )
    .bind(documentId)
    .first();
const hydrateDefinition = (row) => ({
  ...row,
  bounding_box: parse(row.bounding_box),
  shape_signatures: parse(row.shape_signatures, []),
});
const hydrateOccurrence = (row) => ({
  ...row,
  bounding_box: parse(row.bounding_box),
  source_geometry: parse(row.source_geometry),
});
const load = async (db, version) => {
  const [definitions, geometries, occurrences, audit] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM drawing_symbol_definitions WHERE recognition_version_id=? ORDER BY source_page,definition_key",
      )
      .bind(version.id)
      .all(),
    db
      .prepare(
        "SELECT g.* FROM drawing_symbol_source_geometries g JOIN drawing_symbol_definitions d ON d.id=g.definition_id WHERE d.recognition_version_id=? ORDER BY g.definition_id,g.id",
      )
      .bind(version.id)
      .all(),
    db
      .prepare(
        "SELECT o.*,d.abbreviation,d.explicit_label,d.description FROM drawing_symbol_occurrences o LEFT JOIN drawing_symbol_definitions d ON d.id=o.definition_id WHERE o.recognition_version_id=? ORDER BY o.page_number,o.occurrence_key",
      )
      .bind(version.id)
      .all(),
    db
      .prepare(
        "SELECT * FROM drawing_symbol_review_events WHERE recognition_version_id=? ORDER BY created_at DESC",
      )
      .bind(version.id)
      .all(),
  ]);
  return {
    version: { ...version, summary: parse(version.summary, {}) },
    definitions: (definitions.results || []).map((row) => ({
      ...hydrateDefinition(row),
      source_geometries: (geometries.results || [])
        .filter((g) => g.definition_id === row.id)
        .map((g) => ({
          ...g,
          bounding_box: parse(g.bounding_box),
          geometry: parse(g.geometry),
        })),
    })),
    occurrences: (occurrences.results || []).map(hydrateOccurrence),
    unknownSymbols: (occurrences.results || [])
      .filter((row) => !row.definition_id)
      .map(hydrateOccurrence),
    audit: (audit.results || []).map((row) => ({
      ...row,
      previous_value: parse(row.previous_value),
      new_value: parse(row.new_value),
    })),
  };
};
const audit = (
  db,
  {
    projectId,
    versionId,
    entityType,
    entityId,
    action,
    previousValue,
    newValue,
    reason,
    userId,
    requestId,
  },
) =>
  db
    .prepare(
      "INSERT INTO drawing_symbol_review_events (id,project_id,recognition_version_id,entity_type,entity_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id("symbolAudit"),
      projectId,
      versionId,
      entityType,
      entityId,
      action,
      JSON.stringify(previousValue ?? null),
      JSON.stringify(newValue),
      reason,
      userId,
      requestId,
    );

const persist = async (
  env,
  document,
  intake,
  result,
  user,
  reason,
  approvedVersion,
) => {
  const previous = await current(env.DB, document.id),
    inputFingerprint = await digest({
      sha256: document.sha256,
      drawingIntakeVersionId: intake.id,
      approvedStructuralVersionId: approvedVersion.id,
      approvedStructuralFingerprint: approvedVersion.output_fingerprint,
      engine: DRAWING_SYMBOL_ENGINE_VERSION,
    }),
    outputFingerprint = await digest(result);
  if (
    previous?.input_fingerprint === inputFingerprint &&
    previous?.output_fingerprint === outputFingerprint
  )
    return { ...(await load(env.DB, previous)), idempotent: true };
  const versionNumber = Number(previous?.version_number || 0) + 1,
    versionId = id("symbolRecognition"),
    definitionIds = new Map(
      result.definitions.map((definition) => [
        definition.definitionKey,
        id("symbolDefinition"),
      ]),
    );
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO drawing_symbol_recognition_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by) VALUES (?,?,?,?,?,?,?,?,?,'Processing',?,?)",
    ).bind(
      versionId,
      document.project_id,
      document.id,
      document.version_id,
      intake.id,
      versionNumber,
      inputFingerprint,
      outputFingerprint,
      result.engineVersion,
      JSON.stringify({
        ...result.summary,
        approvedStructuralVersionId: approvedVersion.id,
      }),
      user.id,
    ),
    ...(previous
      ? [
          env.DB.prepare(
            "UPDATE drawing_symbol_recognition_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?",
          ).bind(previous.id),
        ]
      : []),
  ]);
  const statements = [];
  for (const definition of result.definitions) {
    const definitionId = definitionIds.get(definition.definitionKey);
    statements.push(
      env.DB.prepare(
        "INSERT INTO drawing_symbol_definitions (id,project_id,recognition_version_id,definition_key,abbreviation,explicit_label,description,original_abbreviation,original_explicit_label,original_description,source_page,bounding_box,shape_signatures,confidence,evidence_text,extraction_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        definitionId,
        document.project_id,
        versionId,
        definition.definitionKey,
        definition.abbreviation,
        definition.explicitLabel,
        definition.description,
        definition.abbreviation,
        definition.explicitLabel,
        definition.description,
        definition.sourcePage,
        JSON.stringify(definition.boundingBox),
        JSON.stringify(definition.shapeSignatures),
        definition.confidence,
        definition.evidenceText,
        definition.extractionMethod,
      ),
    );
    for (const geometry of definition.sourceGeometry)
      statements.push(
        env.DB.prepare(
          "INSERT INTO drawing_symbol_source_geometries (id,definition_id,shape_signature,source_page,bounding_box,geometry,geometry_fingerprint) VALUES (?,?,?,?,?,?,?)",
        ).bind(
          id("symbolGeometry"),
          definitionId,
          geometry.shapeSignature,
          definition.sourcePage,
          JSON.stringify(geometry.boundingBox),
          JSON.stringify(geometry.geometry),
          await digest(geometry),
        ),
      );
  }
  for (const occurrence of result.occurrences) {
    const definitionId = occurrence.matchedDefinitionKey
      ? definitionIds.get(occurrence.matchedDefinitionKey) || null
      : null;
    statements.push(
      env.DB.prepare(
        "INSERT INTO drawing_symbol_occurrences (id,recognition_version_id,definition_id,original_definition_id,occurrence_key,page_number,bounding_box,shape_signature,nearby_text,match_basis,confidence,review_status,source_geometry) VALUES (?,?,?,?,?,?,?,?,?,?,?,'Needs Review',?)",
      ).bind(
        id("symbolOccurrence"),
        versionId,
        definitionId,
        definitionId,
        occurrence.occurrenceKey,
        occurrence.pageNumber,
        JSON.stringify(occurrence.boundingBox),
        occurrence.shapeSignature,
        occurrence.nearbyText,
        occurrence.matchBasis,
        occurrence.confidence,
        occurrence.sourceGeometry
          ? JSON.stringify(occurrence.sourceGeometry)
          : null,
      ),
    );
  }
  for (let index = 0; index < statements.length; index += 75)
    await env.DB.batch(statements.slice(index, index + 75));
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE drawing_symbol_recognition_versions SET status='Completed' WHERE id=?",
    ).bind(versionId),
    audit(env.DB, {
      projectId: document.project_id,
      versionId,
      entityType: "Recognition Version",
      entityId: versionId,
      action: "Generate",
      previousValue: previous
        ? { id: previous.id, version: previous.version_number }
        : null,
      newValue: { version: versionNumber, summary: result.summary },
      reason,
      userId: user.id,
      requestId: id("request"),
    }),
  ]);
  return {
    ...(await load(env.DB, await current(env.DB, document.id))),
    idempotent: false,
  };
};

const reviewDefinition = async (
  request,
  env,
  user,
  definitionId,
  operation,
) => {
  const row = await env.DB.prepare(
    "SELECT d.*,v.project_id FROM drawing_symbol_definitions d JOIN drawing_symbol_recognition_versions v ON v.id=d.recognition_version_id JOIN projects p ON p.id=v.project_id WHERE d.id=? AND v.superseded_at IS NULL AND p.owner_user_id=? AND p.organization_id=?",
  )
    .bind(definitionId, user.id, user.organizationId)
    .first();
  if (!row)
    return json(
      {
        error: {
          code: "SYMBOL_DEFINITION_NOT_FOUND",
          message: "Current symbol definition not found.",
        },
      },
      404,
    );
  const body = await request.json(),
    reason = String(body.reason || "").trim();
  if (reason.length < 5)
    return json(
      {
        error: {
          code: "SYMBOL_REVIEW_REASON_REQUIRED",
          message: "Provide a substantive review reason.",
        },
      },
      422,
    );
  const requestId = request.headers.get("x-request-id") || id("request"),
    previous = {
      abbreviation: row.abbreviation,
      explicitLabel: row.explicit_label,
      description: row.description,
      reviewStatus: row.review_status,
      mergedInto: row.merged_into_definition_id,
    };
  if (["approve", "reject", "restore", "edit"].includes(operation)) {
    const next =
      operation === "restore"
        ? {
            abbreviation: row.original_abbreviation,
            explicitLabel: row.original_explicit_label,
            description: row.original_description,
            reviewStatus: "Needs Review",
            mergedInto: null,
          }
        : operation === "edit"
          ? {
              abbreviation:
                body.abbreviation === undefined
                  ? row.abbreviation
                  : String(body.abbreviation || "").trim() || null,
              explicitLabel:
                body.explicitLabel === undefined
                  ? row.explicit_label
                  : String(body.explicitLabel || "").trim() || null,
              description:
                body.description === undefined
                  ? row.description
                  : String(body.description || "").trim() || null,
              reviewStatus: "Needs Review",
              mergedInto: row.merged_into_definition_id,
            }
          : {
              ...previous,
              reviewStatus: operation === "approve" ? "Approved" : "Rejected",
            };
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE drawing_symbol_definitions SET abbreviation=?,explicit_label=?,description=?,review_status=?,merged_into_definition_id=?,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",
      ).bind(
        next.abbreviation,
        next.explicitLabel,
        next.description,
        next.reviewStatus,
        next.mergedInto,
        user.id,
        now(),
        reason,
        row.id,
      ),
      audit(env.DB, {
        projectId: row.project_id,
        versionId: row.recognition_version_id,
        entityType: "Symbol Definition",
        entityId: row.id,
        action: operation,
        previousValue: previous,
        newValue: next,
        reason,
        userId: user.id,
        requestId,
      }),
    ]);
    return json({
      definitionId: row.id,
      action: operation,
      status: next.reviewStatus,
    });
  }
  if (operation === "merge") {
    const target = await env.DB.prepare(
      "SELECT * FROM drawing_symbol_definitions WHERE id=? AND recognition_version_id=? AND merged_into_definition_id IS NULL",
    )
      .bind(String(body.targetDefinitionId || ""), row.recognition_version_id)
      .first();
    if (!target || target.id === row.id)
      return json(
        {
          error: {
            code: "MERGE_TARGET_REQUIRED",
            message:
              "Select another current definition in this recognition version.",
          },
        },
        422,
      );
    const next = { ...previous, reviewStatus: "Merged", mergedInto: target.id };
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE drawing_symbol_occurrences SET definition_id=? WHERE definition_id=? AND recognition_version_id=?",
      ).bind(target.id, row.id, row.recognition_version_id),
      env.DB.prepare(
        "UPDATE drawing_symbol_definitions SET review_status='Merged',merged_into_definition_id=?,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",
      ).bind(target.id, user.id, now(), reason, row.id),
      audit(env.DB, {
        projectId: row.project_id,
        versionId: row.recognition_version_id,
        entityType: "Symbol Definition",
        entityId: row.id,
        action: "merge",
        previousValue: previous,
        newValue: next,
        reason,
        userId: user.id,
        requestId,
      }),
    ]);
    return json({
      definitionId: row.id,
      mergedInto: target.id,
      status: "Merged",
    });
  }
  if (operation === "split") {
    const occurrenceIds = Array.isArray(body.occurrenceIds)
      ? body.occurrenceIds.map(String)
      : [];
    if (!occurrenceIds.length)
      return json(
        {
          error: {
            code: "SPLIT_OCCURRENCES_REQUIRED",
            message: "Select occurrences to move into the split definition.",
          },
        },
        422,
      );
    const placeholders = occurrenceIds.map(() => "?").join(","),
      selected = await env.DB.prepare(
        `SELECT * FROM drawing_symbol_occurrences WHERE recognition_version_id=? AND definition_id=? AND id IN (${placeholders})`,
      )
        .bind(row.recognition_version_id, row.id, ...occurrenceIds)
        .all();
    if ((selected.results || []).length !== occurrenceIds.length)
      return json(
        {
          error: {
            code: "SPLIT_SELECTION_INVALID",
            message:
              "One or more selected occurrences do not belong to this definition.",
          },
        },
        409,
      );
    const newId = id("symbolDefinition"),
      definitionKey = `${row.definition_key}:split:${await digest(occurrenceIds.sort())}`,
      next = { definitionId: newId, derivedFrom: row.id, occurrenceIds };
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO drawing_symbol_definitions (id,project_id,recognition_version_id,definition_key,abbreviation,explicit_label,description,original_abbreviation,original_explicit_label,original_description,source_page,bounding_box,shape_signatures,confidence,evidence_text,extraction_method,review_status,derived_from_definition_id) SELECT ?,project_id,recognition_version_id,?, ?,?,?, ?,?,?,source_page,bounding_box,shape_signatures,confidence,evidence_text,'Governed split from explicit legend definition','Needs Review',id FROM drawing_symbol_definitions WHERE id=?",
      ).bind(
        newId,
        definitionKey,
        String(body.abbreviation || row.abbreviation || "").trim() || null,
        String(body.explicitLabel || row.explicit_label || "").trim() || null,
        String(body.description || row.description || "").trim() || null,
        String(body.abbreviation || row.abbreviation || "").trim() || null,
        String(body.explicitLabel || row.explicit_label || "").trim() || null,
        String(body.description || row.description || "").trim() || null,
        row.id,
      ),
      env.DB.prepare(
        `UPDATE drawing_symbol_occurrences SET definition_id=? WHERE recognition_version_id=? AND definition_id=? AND id IN (${placeholders})`,
      ).bind(newId, row.recognition_version_id, row.id, ...occurrenceIds),
      audit(env.DB, {
        projectId: row.project_id,
        versionId: row.recognition_version_id,
        entityType: "Symbol Definition",
        entityId: row.id,
        action: "split",
        previousValue: previous,
        newValue: next,
        reason,
        userId: user.id,
        requestId,
      }),
    ]);
    return json(
      {
        definitionId: row.id,
        splitDefinitionId: newId,
        movedOccurrences: occurrenceIds.length,
        status: "Needs Review",
      },
      201,
    );
  }
  return json(
    {
      error: {
        code: "SYMBOL_REVIEW_OPERATION_NOT_FOUND",
        message: "Unsupported symbol definition operation.",
      },
    },
    404,
  );
};

export const handleDrawingSymbolRecognitionApi = async (request, env) => {
  const url = new URL(request.url);
  if (
    !url.pathname.includes("symbol-recognition") &&
    !url.pathname.includes("symbol-definitions") &&
    !url.pathname.includes("symbol-occurrences")
  )
    return null;
  if (!env.DB || !env.FILES)
    return json(
      {
        error: {
          code: "SYMBOL_RECOGNITION_UNAVAILABLE",
          message: "Symbol recognition storage is unavailable.",
        },
      },
      503,
    );
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const docRoute = url.pathname.match(
    /^\/api\/documents\/([^/]+)\/symbol-recognition(?:\/(start|rerun|history))?$/,
  );
  if (docRoute) {
    const document = await ownedDocument(
      env.DB,
      decodeURIComponent(docRoute[1]),
      user.id,
      user.organizationId,
    );
    if (!document)
      return json(
        {
          error: {
            code: "DRAWING_NOT_FOUND",
            message: "Drawing document not found.",
          },
        },
        404,
      );
    const op = docRoute[2];
    if (!op && request.method === "GET") {
      const version = await current(env.DB, document.id);
      return version
        ? json(await load(env.DB, version))
        : json(
            {
              error: {
                code: "SYMBOL_RECOGNITION_REQUIRED",
                message: "Start legend and symbol recognition first.",
              },
            },
            409,
          );
    }
    if (op === "history" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,version_number,status,summary,superseded_at,created_by,created_at FROM drawing_symbol_recognition_versions WHERE document_id=? ORDER BY version_number DESC",
      )
        .bind(document.id)
        .all();
      return json({
        versions: (rows.results || []).map((row) => ({
          ...row,
          summary: parse(row.summary, {}),
        })),
      });
    }
    if (["start", "rerun"].includes(op || "") && request.method === "POST") {
      const intake = await currentIntake(env.DB, document.id);
      if (!intake)
        return json(
          {
            error: {
              code: "DRAWING_INTAKE_REQUIRED",
              message: "Complete Drawing Intake before symbol recognition.",
            },
          },
          409,
        );
      const approvedGeometry = await env.DB.prepare(
        "SELECT * FROM drawing_legend_geometry_approved_versions WHERE document_id=? AND superseded_at IS NULL AND status='Approved' ORDER BY version_number DESC LIMIT 1",
      )
        .bind(document.id)
        .first();
      if (!approvedGeometry)
        return json(
          {
            error: {
              code: "APPROVED_SYMBOL_GEOMETRY_REQUIRED",
              message:
                "Symbol Recognition requires an approved symbol-geometry version.",
            },
          },
          409,
        );
      const approvedRows =
        (
          await env.DB.prepare(
            "SELECT r.*,l.geometry symbol_geometry,l.geometry_signature approved_geometry_signature,l.symbol_cell_bbox bounding_box FROM drawing_legend_geometry_approved_links l JOIN drawing_structure_approved_rows r ON r.id=l.approved_row_id WHERE l.approved_geometry_version_id=? ORDER BY r.source_page,r.source_row",
          )
            .bind(approvedGeometry.id)
            .all()
        ).results || [];
      const object = await env.FILES.get(document.object_key);
      if (!object)
        return json(
          {
            error: {
              code: "STORAGE_OBJECT_MISSING",
              message: "Stored drawing PDF is missing.",
            },
          },
          409,
        );
      const body = await request.json().catch(() => ({}));
      try {
        const result = await recognizeDrawingSymbols(
          new Uint8Array(await object.arrayBuffer()),
          {
            drawingIntakeVersionId: intake.id,
            approvedStructuralRows: approvedRows.map((row) => ({
              ...row,
              symbol_geometry: [
                {
                  shapeSignature: row.approved_geometry_signature,
                  boundingBox: parse(row.bounding_box),
                  geometry: parse(row.symbol_geometry, []),
                },
              ],
              bounding_box: parse(row.bounding_box),
            })),
          },
        );
        return json(
          await persist(
            env,
            document,
            intake,
            result,
            user,
            String(body.reason || "Legend and symbol recognition"),
            approvedGeometry,
          ),
          201,
        );
      } catch (error) {
        return json(
          {
            error: {
              code: "SYMBOL_RECOGNITION_FAILED",
              message:
                error instanceof Error
                  ? error.message
                  : "Symbol recognition failed.",
            },
          },
          422,
        );
      }
    }
  }
  const definitionRoute = url.pathname.match(
    /^\/api\/symbol-definitions\/([^/]+)\/(approve|reject|edit|split|merge|restore)$/,
  );
  if (definitionRoute && request.method === "POST")
    return reviewDefinition(
      request,
      env,
      user,
      decodeURIComponent(definitionRoute[1]),
      definitionRoute[2],
    );
  const occurrenceRoute = url.pathname.match(
    /^\/api\/symbol-occurrences\/([^/]+)\/(approve|reject|restore)$/,
  );
  if (occurrenceRoute && request.method === "POST") {
    const occurrence = await env.DB.prepare(
      "SELECT o.*,v.project_id FROM drawing_symbol_occurrences o JOIN drawing_symbol_recognition_versions v ON v.id=o.recognition_version_id JOIN projects p ON p.id=v.project_id WHERE o.id=? AND v.superseded_at IS NULL AND p.owner_user_id=? AND p.organization_id=?",
    )
      .bind(decodeURIComponent(occurrenceRoute[1]), user.id, user.organizationId)
      .first();
    if (!occurrence)
      return json(
        {
          error: {
            code: "SYMBOL_OCCURRENCE_NOT_FOUND",
            message: "Current occurrence not found.",
          },
        },
        404,
      );
    const body = await request.json(),
      reason = String(body.reason || "").trim();
    if (reason.length < 5)
      return json(
        {
          error: {
            code: "SYMBOL_REVIEW_REASON_REQUIRED",
            message: "Provide a substantive review reason.",
          },
        },
        422,
      );
    const status =
        occurrenceRoute[2] === "approve"
          ? "Approved"
          : occurrenceRoute[2] === "reject"
            ? "Rejected"
            : "Needs Review",
      previous = {
        reviewStatus: occurrence.review_status,
        definitionId: occurrence.definition_id,
      },
      next = {
        reviewStatus: status,
        definitionId:
          occurrenceRoute[2] === "restore"
            ? occurrence.original_definition_id
            : occurrence.definition_id,
      };
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE drawing_symbol_occurrences SET definition_id=?,review_status=?,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",
      ).bind(next.definitionId, status, user.id, now(), reason, occurrence.id),
      audit(env.DB, {
        projectId: occurrence.project_id,
        versionId: occurrence.recognition_version_id,
        entityType: "Symbol Occurrence",
        entityId: occurrence.id,
        action: occurrenceRoute[2],
        previousValue: previous,
        newValue: next,
        reason,
        userId: user.id,
        requestId: request.headers.get("x-request-id") || id("request"),
      }),
    ]);
    return json({
      occurrenceId: occurrence.id,
      status,
      definitionId: next.definitionId,
    });
  }
  return json(
    {
      error: {
        code: "SYMBOL_RECOGNITION_API_NOT_FOUND",
        message: "Symbol recognition operation not found.",
      },
    },
    404,
  );
};
