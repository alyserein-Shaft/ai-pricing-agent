import { requireMigratedTables } from "./schema-requirements.mjs";
import {
  authenticateLibraryActor,
  requireLibraryCapability,
} from "./library-auth.mjs";
import {
  validateDocumentBytes,
  sha256Hex,
} from "../app/domain/document-management.mjs";
import {
  extractKnowledgeFromBytes,
  KNOWLEDGE_EXTRACTION_VERSION,
} from "../app/domain/knowledge-library-engine.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const stamp = () => new Date().toISOString();
const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

const KNOWLEDGE_LIBRARY_SCHEMA_TABLES = ["knowledge_files", "knowledge_facts", "knowledge_product_links", "knowledge_file_events"];
let initialized = false;
const ensure = async (db) => { if (!initialized) { await requireMigratedTables(db, KNOWLEDGE_LIBRARY_SCHEMA_TABLES); initialized = true; } };

const organization = async (db, userId) => {
  const rows = await db
    .prepare(
      "SELECT o.id,o.name FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL AND o.status='Active' ORDER BY m.granted_at LIMIT 2",
    )
    .bind(userId)
    .all();
  return rows.results?.length === 1 ? rows.results[0] : null;
};

const executeChunks = async (db, statements, size = 75) => {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
};

const removePartialKnowledgeFile = async (db, fileId) => {
  await db.batch([
    db
      .prepare(
        "DELETE FROM knowledge_product_links WHERE knowledge_fact_id IN (SELECT id FROM knowledge_facts WHERE knowledge_file_id=?)",
      )
      .bind(fileId),
    db
      .prepare("DELETE FROM knowledge_file_events WHERE knowledge_file_id=?")
      .bind(fileId),
    db
      .prepare("DELETE FROM knowledge_facts WHERE knowledge_file_id=?")
      .bind(fileId),
    db.prepare("DELETE FROM knowledge_files WHERE id=?").bind(fileId),
  ]);
};

export async function handleKnowledgeLibraryApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/knowledge")) return null;
  if (!env.DB)
    return json(
      {
        error: {
          code: "KNOWLEDGE_STORAGE_UNAVAILABLE",
          message: "Knowledge Library storage is unavailable.",
        },
      },
      503,
    );

  const auth = await authenticateLibraryActor(request, env);
  if (auth.error) return json({ error: auth.error }, auth.error.status);
  const actor = auth.actor;
  const org = await organization(env.DB, actor.id);
  if (!org)
    return json(
      {
        error: {
          code: "ACTIVE_ORGANIZATION_REQUIRED",
          message:
            "Select one active organization before using the Knowledge Library.",
        },
      },
      409,
    );
  await ensure(env.DB);

  if (url.pathname === "/api/knowledge/files" && request.method === "POST") {
    const denied = requireLibraryCapability(actor, "analyze");
    if (denied) return json({ error: denied }, denied.status);
    if (!env.FILES)
      return json(
        {
          error: {
            code: "KNOWLEDGE_FILE_STORAGE_UNAVAILABLE",
            message: "Knowledge file storage is unavailable.",
          },
        },
        503,
      );

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return json(
        { error: { code: "FILE_REQUIRED", message: "Choose a knowledge file." } },
        400,
      );

    const bytes = new Uint8Array(await file.arrayBuffer());
    let valid;
    try {
      valid = validateDocumentBytes({
        fileName: file.name,
        mimeType: file.type,
        bytes,
      });
    } catch (error) {
      return json(
        {
          error: {
            code: error.code || "INVALID_FILE",
            message: error.message,
          },
        },
        422,
      );
    }

    const checksum = await sha256Hex(bytes);
    const duplicate = await env.DB
      .prepare(
        "SELECT id,file_name,detected_type,processing_status,summary,uploaded_at FROM knowledge_files WHERE organization_id=? AND sha256=?",
      )
      .bind(org.id, checksum)
      .first();
    if (duplicate)
      return json(
        {
          duplicate: true,
          message:
            "This exact file is already in the Knowledge Library. No duplicate learning was created.",
          existing: { ...duplicate, summary: parse(duplicate.summary, {}) },
        },
        409,
      );

    const fileId = uid("knowledgeFile");
    const objectKey = `knowledge/${org.id}/${fileId}/${valid.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await env.FILES.put(objectKey, bytes, {
      httpMetadata: { contentType: valid.mimeType },
      customMetadata: {
        organizationId: org.id,
        sha256: checksum,
        uploadedBy: actor.id,
      },
    });

    let learned;
    try {
      learned = extractKnowledgeFromBytes(bytes, {
        fileName: valid.originalFilename,
        extension: valid.extension,
        mimeType: valid.mimeType,
      });
    } catch (error) {
      await env.FILES.delete(objectKey);
      return json(
        {
          error: {
            code: "KNOWLEDGE_EXTRACTION_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "The file could not be read.",
          },
        },
        422,
      );
    }

    const manual = learned.classification.manualReviewRequired
      ? "Needs Review"
      : "Classified";
    const processedAt = stamp();
    const insertFile = env.DB
      .prepare(
        "INSERT INTO knowledge_files (id,organization_id,file_name,extension,mime_type,byte_size,sha256,object_key,detected_type,secondary_types,classification_confidence,classification_status,processing_status,extraction_method,extraction_version,summary,uploaded_by,processed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        fileId,
        org.id,
        valid.originalFilename,
        valid.extension,
        valid.mimeType,
        valid.byteSize,
        checksum,
        objectKey,
        learned.classification.primaryType,
        JSON.stringify(learned.classification.secondaryTypes),
        learned.classification.confidence,
        manual,
        "Completed",
        learned.sample.extractionMethod,
        KNOWLEDGE_EXTRACTION_VERSION,
        JSON.stringify(learned.summary),
        actor.id,
        processedAt,
      );
    const factStatements = [];
    const linkStatements = [];
    for (const fact of learned.facts) {
      factStatements.push(
        env.DB
          .prepare(
            "INSERT OR IGNORE INTO knowledge_facts (id,organization_id,knowledge_file_id,fact_type,fact_key,original_value,normalized_value,attributes,confidence,review_status,source_location) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            uid("knowledgeFact"),
            org.id,
            fileId,
            fact.factType,
            fact.factKey,
            fact.originalValue,
            fact.normalizedValue,
            JSON.stringify(fact.attributes),
            fact.confidence,
            fact.confidence < 60 ? "Needs Review" : "Learned",
            JSON.stringify(fact.sourceLocation),
          ),
      );
      if (fact.factType === "Part Number") {
        linkStatements.push(
          env.DB
            .prepare(
              "INSERT OR IGNORE INTO knowledge_product_links (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information) SELECT ?,?,f.id,?,p.id,CASE WHEN p.id IS NULL THEN 'New Product Candidate' ELSE 'Existing Product — Additive Learning Only' END,'{}' FROM knowledge_facts f LEFT JOIN library_products p ON p.normalized_part_number=? WHERE f.knowledge_file_id=? AND f.fact_type=? AND f.fact_key=? AND f.normalized_value=? LIMIT 1",
            )
            .bind(
              uid("knowledgeLink"),
              org.id,
              fact.originalValue,
              fact.normalizedValue.replaceAll(" ", ""),
              fileId,
              fact.factType,
              fact.factKey,
              fact.normalizedValue,
            ),
        );
      }
    }
    const insertEvent = env.DB
      .prepare(
        "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        uid("knowledgeEvent"),
        org.id,
        fileId,
        "Uploaded and Learned",
        JSON.stringify({
          classification: learned.classification.primaryType,
          confidence: learned.classification.confidence,
          summary: learned.summary,
        }),
        actor.id,
      );

    try {
      await env.DB.batch([insertFile]);
      await executeChunks(env.DB, factStatements);
      await executeChunks(env.DB, linkStatements);
      await env.DB.batch([insertEvent]);
    } catch (error) {
      await removePartialKnowledgeFile(env.DB, fileId);
      await env.FILES.delete(objectKey);
      throw error;
    }

    return json(
      {
        file: {
          id: fileId,
          fileName: valid.originalFilename,
          type: learned.classification.primaryType,
          confidence: learned.classification.confidence,
          status: manual,
          checksum,
        },
        summary: learned.summary,
        requiresReview: learned.classification.manualReviewRequired,
      },
      201,
    );
  }

  if (url.pathname === "/api/knowledge/files" && request.method === "GET") {
    const section = url.searchParams.get("section") || "";
    const q = (url.searchParams.get("q") || "").trim();
    const rows = await env.DB
      .prepare(
        "SELECT * FROM knowledge_files WHERE organization_id=? AND (?='' OR detected_type=?) AND (?='' OR file_name LIKE ? OR detected_type LIKE ?) ORDER BY uploaded_at DESC LIMIT 250",
      )
      .bind(org.id, section, section, q, `%${q}%`, `%${q}%`)
      .all();
    return json({
      organization: org,
      files: (rows.results || []).map((row) => ({
        ...row,
        secondary_types: parse(row.secondary_types, []),
        summary: parse(row.summary, {}),
      })),
    });
  }

  if (url.pathname === "/api/knowledge/search" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const type = url.searchParams.get("type") || "";
    if (q.length < 2) return json({ results: [] });
    const rows = await env.DB
      .prepare(
        "SELECT f.*,k.file_name,k.detected_type FROM knowledge_facts f JOIN knowledge_files k ON k.id=f.knowledge_file_id WHERE f.organization_id=? AND (?='' OR f.fact_type=?) AND (f.normalized_value LIKE ? OR k.file_name LIKE ?) ORDER BY f.confidence DESC,k.uploaded_at DESC LIMIT 200",
      )
      .bind(org.id, type, type, `%${q}%`, `%${q}%`)
      .all();
    return json({
      query: q,
      results: (rows.results || []).map((row) => ({
        ...row,
        attributes: parse(row.attributes, {}),
        source_location: parse(row.source_location, {}),
      })),
    });
  }

  if (url.pathname === "/api/knowledge/review-queue" && request.method === "GET") {
    const denied = requireLibraryCapability(actor, "review");
    if (denied) return json({ error: denied }, denied.status);
    const q = (url.searchParams.get("q") || "").trim();
    const [files, facts] = await Promise.all([
      env.DB
        .prepare(
          "SELECT id,'File' item_kind,file_name title,detected_type item_type,classification_confidence confidence,classification_status review_status,processing_status,summary source_details,uploaded_at created_at FROM knowledge_files WHERE organization_id=? AND classification_status='Needs Review' AND (?='' OR file_name LIKE ? OR detected_type LIKE ?) ORDER BY uploaded_at DESC LIMIT 150",
        )
        .bind(org.id, q, `%${q}%`, `%${q}%`)
        .all(),
      env.DB
        .prepare(
          "SELECT f.id,'Fact' item_kind,f.original_value title,f.fact_type item_type,f.confidence,f.review_status,k.file_name source_file,f.source_location source_details,f.created_at FROM knowledge_facts f JOIN knowledge_files k ON k.id=f.knowledge_file_id WHERE f.organization_id=? AND f.review_status='Needs Review' AND (?='' OR f.original_value LIKE ? OR f.fact_type LIKE ? OR k.file_name LIKE ?) ORDER BY f.created_at DESC LIMIT 250",
        )
        .bind(org.id, q, `%${q}%`, `%${q}%`, `%${q}%`)
        .all(),
    ]);
    return json({
      organization: org,
      items: [...(files.results || []), ...(facts.results || [])].map((item) => ({
        ...item,
        source_details: parse(item.source_details, {}),
      })),
    });
  }

  const reviewMatch = url.pathname.match(/^\/api\/knowledge\/review\/(file|fact)\/([^/]+)$/);
  if (reviewMatch && request.method === "POST") {
    const denied = requireLibraryCapability(actor, "review");
    if (denied) return json({ error: denied }, denied.status);
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "").toLowerCase();
    const reason = String(payload.reason || "").trim();
    if (!['confirm', 'reject'].includes(action))
      return json({ error: { code: "KNOWLEDGE_REVIEW_ACTION_INVALID", message: "Choose Confirm or Reject." } }, 422);
    if (reason.length < 5)
      return json({ error: { code: "KNOWLEDGE_REVIEW_REASON_REQUIRED", message: "Provide a clear review reason." } }, 422);
    const kind = reviewMatch[1];
    const itemId = decodeURIComponent(reviewMatch[2]);
    const item = kind === "file"
      ? await env.DB.prepare("SELECT id,classification_status review_status,detected_type,summary FROM knowledge_files WHERE id=? AND organization_id=?").bind(itemId, org.id).first()
      : await env.DB.prepare("SELECT id,knowledge_file_id,review_status,fact_type,original_value FROM knowledge_facts WHERE id=? AND organization_id=?").bind(itemId, org.id).first();
    if (!item)
      return json({ error: { code: "KNOWLEDGE_REVIEW_ITEM_NOT_FOUND", message: "This review item is unavailable." } }, 404);
    if (item.review_status !== "Needs Review")
      return json({ error: { code: "KNOWLEDGE_REVIEW_ALREADY_DECIDED", message: "This item has already been reviewed." } }, 409);
    const nextStatus = action === "confirm" ? "Reviewed" : "Rejected";
    const fileId = kind === "file" ? item.id : item.knowledge_file_id;
    const details = {
      itemKind: kind === "file" ? "File Classification" : "Knowledge Fact",
      itemId,
      action: action === "confirm" ? "Confirmed" : "Rejected",
      previousStatus: item.review_status,
      newStatus: nextStatus,
      reason,
      actorPermission: actor.permission,
    };
    const update = kind === "file"
      ? env.DB.prepare("UPDATE knowledge_files SET classification_status=? WHERE id=? AND organization_id=? AND classification_status='Needs Review'").bind(nextStatus, itemId, org.id)
      : env.DB.prepare("UPDATE knowledge_facts SET review_status=? WHERE id=? AND organization_id=? AND review_status='Needs Review'").bind(nextStatus, itemId, org.id);
    await env.DB.batch([
      update,
      env.DB.prepare("INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)")
        .bind(uid("knowledgeEvent"), org.id, fileId, "Knowledge Review Decision", JSON.stringify(details), actor.id),
    ]);
    return json({ itemId, kind, status: nextStatus, action: details.action, actor: { id: actor.id, permission: actor.permission } });
  }

  if (url.pathname === "/api/knowledge/summary" && request.method === "GET") {
    const row = await env.DB
      .prepare(
        "SELECT (SELECT COUNT(*) FROM knowledge_files WHERE organization_id=?) files_processed,(SELECT COUNT(DISTINCT normalized_value) FROM knowledge_facts WHERE organization_id=? AND fact_type='Part Number') products_learned,(SELECT COUNT(DISTINCT normalized_value) FROM knowledge_facts WHERE organization_id=? AND fact_type='Manufacturer') manufacturers,(SELECT COUNT(*) FROM knowledge_facts WHERE organization_id=? AND fact_type='Price') prices_discovered,(SELECT COUNT(*) FROM knowledge_facts WHERE organization_id=? AND fact_type='Certification') certifications,(SELECT COUNT(*) FROM knowledge_facts WHERE organization_id=? AND fact_type='Standard') standards,((SELECT COUNT(*) FROM knowledge_files WHERE organization_id=? AND classification_status='Needs Review')+(SELECT COUNT(*) FROM knowledge_facts WHERE organization_id=? AND review_status='Needs Review')) needs_review",
      )
      .bind(org.id, org.id, org.id, org.id, org.id, org.id, org.id, org.id)
      .first();
    return json({ organization: org, summary: row || {} });
  }

  return json(
    {
      error: {
        code: "KNOWLEDGE_API_NOT_FOUND",
        message: "Knowledge Library operation not found.",
      },
    },
    404,
  );
}
