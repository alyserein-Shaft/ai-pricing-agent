import { runCandidateComparison } from './drawing-candidate-comparison.mjs';
// GENERAL DRAWING EXTRACTION -- persistence + governed review workflow
// (WORKSTREAM 5/6). Reuses the exact review/audit convention every other
// drawing review surface in this codebase already uses (drawing_symbol_*,
// drawing_structure_*): a row per proposal carrying review_status/
// reviewed_by/reviewed_at/review_reason, plus a companion *_review_events
// audit table with actor/reason/old-value/new-value/timestamp per action.
//
// This does NOT create approved engineering objects and is never read by
// Product Matching or Pricing -- it exists so a General Drawing Extraction
// proposal and its review trail survive a page reload.
import { linkVisualEvidence } from "../app/domain/drawing-visual-evidence.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { buildGeneralDrawingExtractionProposals } from "../app/domain/drawing-general-extraction-engine.mjs";
import { buildGeneralExtractionOverlayItems } from "../app/domain/drawing-general-extraction-view-model.mjs";
import { buildDrawingIntelligenceProposals, buildDrawingIntelligenceOverlayItems } from "../app/domain/drawing-intelligence-view-model.mjs";
import { buildLegendDefinitionProposals } from "../app/domain/drawing-legend-notes-intelligence.mjs";
import { buildAiVisualUnderstandingProposals, validateVisualUnderstanding } from "../app/domain/drawing-visual-understanding-contract.mjs";
import { runVisualUnderstanding, visualUnderstandingProviderReadiness } from "./drawing-visual-understanding-provider.mjs";

const AI_VISUAL_UNDERSTANDING_VERSION = "drawing-visual-understanding-1.0.0";
const MAX_VISUAL_ANALYSIS_IMAGES = 8;
const MAX_IMAGE_BASE64_LENGTH = 6_000_000; // ~4.5MB decoded; generous for a single page crop/overview, small enough to reject an obviously wrong payload before ever reaching the model call.

const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const EXTRACTION_ENGINE_VERSION = "drawing-general-extraction-engine-1.1.0";
const INTELLIGENCE_ENGINE_VERSION = "drawing-intelligence-view-model-1.0.0";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const ownedDocument = (db, documentId, userId, organizationId) =>
  db
    .prepare(
      "SELECT d.*,v.id version_id,v.object_key,v.sha256,v.extension FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? AND p.organization_id=? JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND d.deleted_at IS NULL",
    )
    .bind(userId, organizationId, documentId)
    .first();

const currentIntakeVersion = (db, documentId) =>
  db.prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(documentId).first();

const hydratedAssetsAndPages = async (db, intakeVersionId) => {
  const [pages, assets] = await Promise.all([
    db.prepare("SELECT * FROM drawing_pages WHERE intake_version_id=? ORDER BY page_number").bind(intakeVersionId).all(),
    db.prepare("SELECT * FROM drawing_assets WHERE intake_version_id=? ORDER BY page_id,asset_type").bind(intakeVersionId).all(),
  ]);
  return {
    pages: pages.results || [],
    assets: (assets.results || []).map((row) => ({ ...row, bounding_box: parse(row.bounding_box) })),
  };
};

// Drawing-type-specific intelligence (Legend/Notes, Riser/Schematic,
// Layout, Cause & Effect, Detail) needs a few extra pieces of already-
// persisted context beyond assets/pages: the sheet's own classification
// and metadata (to classify its drawing type), its legend entries (Legend/
// Notes reuses these rather than re-extracting), and a registry of every
// OTHER Drawing document's own drawing_number in this project (for
// WORKSTREAM 7's exact cross-sheet target resolution).
const intelligenceContext = async (db, document, intakeVersion) => {
  const [classifications, metadata, legends, legendEntries] = await Promise.all([
    db.prepare("SELECT classification_type,confidence FROM drawing_document_classifications WHERE intake_version_id=?").bind(intakeVersion.id).all(),
    db.prepare("SELECT * FROM drawing_metadata WHERE intake_version_id=?").bind(intakeVersion.id).first(),
    db.prepare("SELECT l.id,p.page_number,l.confidence FROM drawing_legends l JOIN drawing_pages p ON p.id=l.page_id AND p.intake_version_id=l.intake_version_id WHERE l.intake_version_id=? ORDER BY p.page_number,l.id").bind(intakeVersion.id).all(),
    db.prepare("SELECT e.*,l.page_id,p.page_number,l.confidence AS legend_confidence FROM drawing_legend_entries e JOIN drawing_legends l ON l.id=e.legend_id JOIN drawing_pages p ON p.id=l.page_id AND p.intake_version_id=l.intake_version_id WHERE l.intake_version_id=? ORDER BY p.page_number,l.id,e.sequence,e.id").bind(intakeVersion.id).all(),
  ]);
  const entriesByLegend = new Map();
  for (const entry of legendEntries.results || []) {
    const entries = entriesByLegend.get(entry.legend_id) || [];
    entries.push(entry);
    entriesByLegend.set(entry.legend_id, entries);
  }
  const legendGroups = (legends.results || []).map((legend) => ({
    legendId: legend.id,
    pageNumber: Number(legend.page_number),
    confidence: legend.confidence ?? null,
    entries: entriesByLegend.get(legend.id) || [],
  }));
  const registryRows = await db
    .prepare(
      "SELECT d.id doc_id, dm.drawing_number FROM documents d JOIN drawing_intake_versions iv ON iv.document_id=d.id AND iv.superseded_at IS NULL JOIN drawing_metadata dm ON dm.intake_version_id=iv.id WHERE d.project_id=? AND d.deleted_at IS NULL AND dm.drawing_number IS NOT NULL",
    )
    .bind(document.project_id)
    .all();
  const documentRegistry = (registryRows.results || []).map((row) => ({ id: row.doc_id, drawingNumber: row.drawing_number }));
  return {
    classifications: (classifications.results || []).map((row) => ({ type: row.classification_type, confidence: row.confidence })),
    sourceDocument: { id: document.id, drawingNumber: metadata?.drawing_number ?? null, sheetName: metadata?.sheet_name ?? null },
    revision: metadata?.revision ?? null,
    legendGroups,
    documentRegistry,
  };
};

const hydrateProposal = (row) => ({
  id: row.id,
  visualRunId: row.visual_run_id ?? null,
  supersededAt: row.superseded_at ?? null,
  historyWarning: row.history_warning ?? null,
  documentId: row.document_id,
  intakeVersionId: row.intake_version_id,
  pageNumber: row.page_number,
  proposalKey: row.proposal_key,
  proposalType: row.proposal_type,
  rawLabel: row.raw_label,
  normalizedValue: parse(row.normalized_value, row.normalized_value),
  boundingBox: parse(row.bounding_box),
  confidence: row.confidence,
  authorityRole: row.authority_role,
  governedStatus: row.governed_status,
  hardReviewReasons: parse(row.hard_review_reasons, []),
  evidence: parse(row.evidence, {}),
  sourceReferences: parse(row.source_references, []),
  extractionMethod: row.extraction_method,
  extractionVersion: row.extraction_version,
  reviewStatus: row.review_status,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
  reviewReason: row.review_reason,
  correctedValue: parse(row.corrected_value, null),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Recomputes proposals via the (deterministic) engine and upserts them by
// their stable proposal_key -- reruns against the SAME intake version never
// create duplicate rows. A row's engineer review_status is only reset to
// the freshly computed governed_status when the row is new; an existing,
// already-reviewed row keeps its human review_status untouched (a rerun of
// a deterministic extraction over unchanged source evidence should not
// silently discard an engineer's prior decision), but its governed_status/
// authority/reasons ARE refreshed so the system's own reference computation
// stays current.
// Shared upsert: writes/updates a set of {item, extractionVersion} proposal
// items into drawing_extraction_proposals, keyed by proposal_key (item.id).
// An existing row's review_status (and every human review decision it
// implies) is NEVER touched by this path -- only a genuinely NEW proposal
// key gets the freshly computed governedStatus as its starting
// review_status; re-syncing an already-reviewed proposal only refreshes its
// evidence fields. Both the deterministic engines' sync AND the AI visual
// understanding route below call this SAME function, so there is exactly
// one persistence path for every proposal, deterministic or AI-sourced.
const persistProposalItems = async (env, document, intakeVersion, items, { sourceDocument = {}, revision = null } = {}) => {
  const existing = await env.DB.prepare("SELECT id,proposal_key,review_status FROM drawing_extraction_proposals WHERE intake_version_id=?").bind(intakeVersion.id).all();
  const existingByKey = new Map((existing.results || []).map((row) => [row.proposal_key, row]));

  const statements = [];
  for (const { item, extractionVersion } of items) {
    const found = existingByKey.get(item.id);
    const rowId = found?.id || id("drawingExtractionProposal");
    const reviewStatus = found ? found.review_status : item.governedStatus;
    // Provenance that is constant per SHEET (drawing type, drawing number,
    // sheet name, revision) is folded into the persisted evidence blob
    // here rather than added as new columns -- the existing schema stays
    // untouched (additive evolution, no migration), and every row remains
    // fully self-contained for a page reload / API consumer that only
    // reads this one table.
    const evidence = {
      ...(item.evidence || {}),
      drawingType: item.drawingType ?? null,
      sourceDrawingNumber: item.sourceDrawingNumber ?? sourceDocument.drawingNumber ?? null,
      sourceSheet: item.sourceSheet ?? sourceDocument.sheetName ?? null,
      sourceRevision: item.sourceRevision ?? revision ?? null,
    };
    const normalizedValue = item.evidence?.normalizedValue ?? item.evidence?.normalizedLabel ?? null;
    statements.push(
      env.DB.prepare(
        found
          ? `UPDATE drawing_extraction_proposals SET page_number=?,proposal_type=?,raw_label=?,normalized_value=?,bounding_box=?,confidence=?,authority_role=?,governed_status=?,hard_review_reasons=?,evidence=?,source_references=?,extraction_method=?,extraction_version=?,updated_at=? WHERE id=?`
          : `INSERT INTO drawing_extraction_proposals (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,normalized_value,bounding_box,confidence,authority_role,governed_status,hard_review_reasons,evidence,source_references,extraction_method,extraction_version,review_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        ...(found
          ? [
              item.pageNumber,
              item.semanticType,
              item.evidence?.rawLabel ?? item.label,
              normalizedValue === null || normalizedValue === undefined ? null : JSON.stringify(normalizedValue),
              JSON.stringify(item.boundingBox),
              item.confidence,
              item.authorityRole,
              item.governedStatus,
              JSON.stringify(item.hardReviewReasons || []),
              JSON.stringify(evidence),
              JSON.stringify(item.sourceEntity?.sourceReferences || []),
              item.extractionMethod,
              extractionVersion,
              now(),
              rowId,
            ]
          : [
              rowId,
              document.project_id,
              document.id,
              intakeVersion.id,
              item.pageNumber,
              item.id,
              item.semanticType,
              item.evidence?.rawLabel ?? item.label,
              normalizedValue === null || normalizedValue === undefined ? null : JSON.stringify(normalizedValue),
              JSON.stringify(item.boundingBox),
              item.confidence,
              item.authorityRole,
              item.governedStatus,
              JSON.stringify(item.hardReviewReasons || []),
              JSON.stringify(evidence),
              JSON.stringify(item.sourceEntity?.sourceReferences || []),
              item.extractionMethod,
              extractionVersion,
              reviewStatus,
              now(),
              now(),
            ]),
      ),
    );
  }
  for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
};

const readProposals = async (env, intakeVersion) => {
  const rows = await env.DB.prepare("SELECT * FROM drawing_extraction_proposals WHERE intake_version_id=? ORDER BY page_number,proposal_type").bind(intakeVersion.id).all();
  return (rows.results || []).map(hydrateProposal);
};

const syncProposals = async (env, document, user) => {
  const intakeVersion = await currentIntakeVersion(env.DB, document.id);
  if (!intakeVersion) return { error: { code: "DRAWING_INTAKE_REQUIRED", message: "Complete Drawing Intake first." } };
  const { pages, assets } = await hydratedAssetsAndPages(env.DB, intakeVersion.id);
  const context = await intelligenceContext(env.DB, document, intakeVersion);

  const proposals = buildGeneralDrawingExtractionProposals({ pages, assets });
  const generalItems = buildGeneralExtractionOverlayItems(proposals).map((item) => ({ item, extractionVersion: EXTRACTION_ENGINE_VERSION }));

  // Drawing-type-specific intelligence (Legend/Notes, Riser/Schematic,
  // Layout, Cause & Effect, Detail) -- dispatches to the ONE family
  // matching this sheet's own classified type; a sheet type with no
  // matching family (e.g. a Schedule sheet, already covered by the general
  // engine above) simply contributes nothing here, which is correct, not
  // an extraction failure.
  const intelligence = buildDrawingIntelligenceProposals({
    sourceDocument: context.sourceDocument,
    revision: context.revision,
    pageNumber: pages[0]?.page_number ?? null,
    assets,
    legendEntries: [],
    legendConfidence: null,
    classifications: context.classifications,
    documentRegistry: context.documentRegistry,
  });
  // Intake permits one legend per page and a legend sheet can span many pages.
  // Build definitions once per defining page so every current entry keeps both
  // its own confidence and page provenance. This calls the same domain builder
  // used by the family dispatcher, so authority/status precedence is unchanged.
  if (intelligence.families.legend) {
    intelligence.families.legend.legendDefinitions = context.legendGroups.flatMap((legend) =>
      buildLegendDefinitionProposals({
        sourceDocument: context.sourceDocument,
        pageNumber: legend.pageNumber,
        legendEntries: legend.entries,
        legendConfidence: legend.confidence,
      }),
    );
  }
  const intelligenceItems = buildDrawingIntelligenceOverlayItems(intelligence, { sourceDocument: context.sourceDocument, revision: context.revision }).map((item) => ({
    item,
    extractionVersion: INTELLIGENCE_ENGINE_VERSION,
  }));

  await persistProposalItems(env, document, intakeVersion, [...generalItems, ...intelligenceItems], context);

  return {
    intakeVersionId: intakeVersion.id,
    proposals: await readProposals(env, intakeVersion),
    excludedCallouts: proposals.excludedCallouts,
    unresolved: proposals.unresolved,
    drawingType: intelligence.drawingType,
  };
};

// images: request-body images, already rendered client-side by the SAME
// rotation-correct PDF.js canvas Visual Review paints from (the Worker
// runtime itself cannot rasterize a PDF -- see
// build/napi-canvas-shim.mjs's deliberate "Canvas rendering is unavailable"
// stub). Each { base64, kind: "overview"|"crop", cropRect, pageNumber }.
// textEvidence is NOT taken from the request -- it is read fresh from this
// document's own already-persisted Drawing Intake assets, the same source
// every deterministic engine uses, so the model never sees anything the
// engineer could not also see in Visual Review.
const analyzeVisually = async (env, document, images, requestedPageNumber) => {
  const readiness = visualUnderstandingProviderReadiness(env);
  if (readiness.state !== "Ready — native Workers AI binding") {
    return { error: { code: "AI_PROVIDER_UNAVAILABLE", message: "No configured image-capable AI provider is available in this environment.", detail: readiness.detail } };
  }
  const intakeVersion = await currentIntakeVersion(env.DB, document.id);
  if (!intakeVersion) return { error: { code: "DRAWING_INTAKE_REQUIRED", message: "Complete Drawing Intake first." } };
  const { assets, pages } = await hydratedAssetsAndPages(env.DB, intakeVersion.id);
  const context = await intelligenceContext(env.DB, document, intakeVersion);
  const pageNumber = Number.isFinite(requestedPageNumber) ? requestedPageNumber : 1;
  const page = pages.find(p => p.page_number === pageNumber);
  if (!page) return { error: { code: "DRAWING_PAGE_NOT_FOUND", message: "The requested page is not indexed." } };
  const textEvidence = assets.filter(a => a.page_id === page.id && a.asset_type === "Text" && a.text_content)
    .map(a => ({ sourceId: a.id, pageNumber, text: a.text_content, boundingBox: a.bounding_box }));

  const boundedImages = (images || []).slice(0, MAX_VISUAL_ANALYSIS_IMAGES);
  if (!boundedImages.length) return { error: { code: "AI_VISUAL_INPUT_MISSING", message: "At least one rendered page image is required." } };
  for (const image of boundedImages) {
    if (typeof image.base64 !== "string" || !image.base64 || image.base64.length > MAX_IMAGE_BASE64_LENGTH) {
      return { error: { code: "AI_VISUAL_INPUT_INVALID", message: "Each image must be a non-empty, reasonably sized base64-encoded PNG/JPEG." } };
    }
  }

  if (!env.FILES?.put) return { error: { code: "AI_TRACE_STORAGE_REQUIRED", message: "Protected file storage is required to preserve analysis inputs." } };
  const runId = id("drawingVisualRun");
  const startedAt = now();
  const manifest = { documentId: document.id, documentVersionId: document.version_id, documentSha256: document.sha256,
    intakeVersionId: intakeVersion.id, pageNumber, rotation: page.rotation ?? 0, pageWidth: page.width, pageHeight: page.height,
    sourceDocument: context.sourceDocument, revision: context.revision, textEvidence, images: [] };
  const responses = [];
  const configuredModels = { visionModel: readiness.visionModel, synthesisModel: env.DRAWING_VISUAL_AI_SYNTHESIS_MODEL || env.BOQ_AI_ESCALATION_MODEL || env.BOQ_AI_MODEL };
  try {
    // A bounded lease makes a terminated attempt recoverable. No findings are
    // retired until a later attempt has durably completed in one transaction.
    await env.DB.prepare("UPDATE drawing_visual_runs SET status='Interrupted', error_code='RUN_INTERRUPTED', completed_at=? WHERE intake_version_id=? AND page_number=? AND status='Running' AND COALESCE(json_extract(input_manifest,'$.purpose'),'Understanding')='Understanding' AND created_at<?")
      .bind(startedAt, intakeVersion.id, pageNumber, new Date(Date.now()-15*60*1000).toISOString()).run();
    await env.DB.prepare("INSERT INTO drawing_visual_runs (id,project_id,document_id,document_version_id,intake_version_id,page_number,status,input_manifest,created_at,model_info) VALUES (?,?,?,?,?,?,'Running',?,?,?)")
      .bind(runId,document.project_id,document.id,document.version_id,intakeVersion.id,pageNumber,JSON.stringify(manifest),startedAt,JSON.stringify(configuredModels)).run();
  } catch {
    return { error: { code: "AI_RUN_UNAVAILABLE", message: "Another analysis is running, or the visual-run storage migration is missing." } };
  }
  try {
    const decoded = [];
    for (const [index,image] of boundedImages.entries()) {
      const bytes=base64ToBytes(image.base64);
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
      const objectKey=`projects/${document.project_id}/documents/${document.id}/visual-runs/${runId}/image-${index}.png`;
      await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:"image/png"}});
      const provenance={index,kind:image.kind === "crop" ? "crop" : "overview",cropRect:image.cropRect ?? null,pageNumber,sha256,objectKey};
      manifest.images.push(provenance);
      decoded.push({...provenance,bytes});
    }
    await env.DB.prepare("UPDATE drawing_visual_runs SET input_manifest=? WHERE id=?").bind(JSON.stringify(manifest),runId).run();
    const outcome = await runVisualUnderstanding(env, {
      images: decoded, textEvidence, sourceDocument:context.sourceDocument, revision:context.revision,
      onModelResponse: async (record) => {
        responses[record.callIndex] = record;
        // Persist before parsing/synthesis: invalid JSON and partial failures
        // retain the exact returned response and the request that produced it.
        await env.DB.prepare("UPDATE drawing_visual_runs SET raw_responses=? WHERE id=?").bind(JSON.stringify(responses),runId).run();
      },
    });
    if (!validateVisualUnderstanding(outcome.result)) {
      throw Object.assign(new Error("Invalid drawing analysis structure."),{code:"AI_OUTPUT_INVALID"});
    }
    const aiItems = linkVisualEvidence(buildAiVisualUnderstandingProposals({result:outcome.result,sourceDocument:context.sourceDocument,
      revision:context.revision,pageNumber,imageProvenance:manifest.images,modelInfo:outcome.modelInfo}),textEvidence);
    const prior=(await env.DB.prepare("SELECT * FROM drawing_extraction_proposals WHERE intake_version_id=? AND page_number=? AND extraction_method LIKE 'AI visual analysis%' AND superseded_at IS NULL").bind(intakeVersion.id,pageNumber).all()).results || [];
    const seen=new Set();
    const statements=[];
    const timestamp=now();
    // Preserve human decisions AND their original evidence. Identical results
    // keep the reviewed row; changed evidence is a new unreviewed proposal.
    const reviewedKeys=new Set(prior.filter(r=>r.reviewed_by).map(r=>`${r.proposal_type}:${r.raw_label}:${JSON.stringify(parse(r.evidence,{}).evidenceQuote ?? null)}`));
    for(const item of aiItems) {
      const contentKey=`${item.semanticType}:${item.label}:${JSON.stringify(item.evidence?.evidenceQuote ?? null)}`;
      if(seen.has(contentKey)||reviewedKeys.has(contentKey))continue;
      seen.add(contentKey);
      const evidence={...item.evidence,visualRunId:runId};
      statements.push(env.DB.prepare("INSERT INTO drawing_extraction_proposals (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,normalized_value,bounding_box,confidence,authority_role,governed_status,hard_review_reasons,evidence,source_references,extraction_method,extraction_version,review_status,created_at,updated_at,visual_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id("drawingExtractionProposal"),document.project_id,document.id,intakeVersion.id,pageNumber,`${runId}:${item.id}`,item.semanticType,item.label,
          JSON.stringify(item.evidence?.normalizedValue ?? null),JSON.stringify(item.boundingBox),item.confidence,item.authorityRole,item.governedStatus,
          JSON.stringify(item.hardReviewReasons),JSON.stringify(evidence),JSON.stringify(item.sourceEntity?.sourceReferences || []),item.extractionMethod,
          AI_VISUAL_UNDERSTANDING_VERSION,"Needs Review",timestamp,timestamp,runId));
    }
    statements.push(env.DB.prepare("UPDATE drawing_extraction_proposals SET superseded_at=?, superseded_by_run_id=?, history_warning=CASE WHEN visual_run_id IS NULL AND review_status='Not Found' THEN 'Legacy Not Found has no recorded transition history; omission does not establish drawing absence. Original status cannot be reconstructed.' ELSE history_warning END WHERE intake_version_id=? AND page_number=? AND extraction_method LIKE 'AI visual analysis%' AND reviewed_by IS NULL AND superseded_at IS NULL AND (visual_run_id IS NULL OR visual_run_id<>?)")
      .bind(timestamp,runId,intakeVersion.id,pageNumber,runId));
    statements.push(env.DB.prepare("UPDATE drawing_visual_runs SET superseded_at=? WHERE intake_version_id=? AND page_number=? AND status='Completed' AND COALESCE(json_extract(input_manifest,'$.purpose'),'Understanding')='Understanding' AND superseded_at IS NULL AND id<>?").bind(timestamp,intakeVersion.id,pageNumber,runId));
    statements.push(env.DB.prepare("UPDATE drawing_visual_runs SET status='Completed',model_info=?,result=?,completed_at=? WHERE id=? AND status='Running'").bind(JSON.stringify(outcome.modelInfo),JSON.stringify(outcome.result),timestamp,runId));
    await env.DB.batch(statements);
    return {intakeVersionId:intakeVersion.id,runId,proposals:await readProposals(env,intakeVersion),modelInfo:outcome.modelInfo,
      imagesAnalyzed:manifest.images,findingCount:seen.size,visionFindings:outcome.visionFindings};
  } catch(error) {
    const code = ["AI_OUTPUT_INVALID","AI_PROVIDER_TIMEOUT","AI_PROVIDER_ERROR"].includes(error?.code) ? error.code : "AI_VISUAL_ANALYSIS_FAILED";
    await env.DB.prepare("UPDATE drawing_visual_runs SET status='Failed',error_code=?,completed_at=? WHERE id=?").bind(code,now(),runId).run();
    return {error:{code,message:"Visual analysis did not complete. Saved findings are unchanged; available model responses are retained in run history.",runId}};
  }
};

const REVIEW_ACTIONS = ["approve", "reject", "correct", "conflict", "restore"];

export const handleDrawingExtractionApi = async (request, env) => {
  const url = new URL(request.url);
  const listRoute = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-extraction(?:\/(sync|visual-analysis|candidate-comparison))?$/);
  const runRoute = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-extraction\/runs\/([^/]+)(?:\/images\/(\d+))?$/);
  const reviewRoute = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-extraction\/([^/]+)\/(approve|reject|correct|conflict|restore)$/);
  if (!listRoute && !reviewRoute && !runRoute) return null;
  if (!env.DB) return json({ error: { code: "DRAWING_EXTRACTION_UNAVAILABLE", message: "Drawing storage is unavailable." } }, 503);

  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const documentId = decodeURIComponent((listRoute || reviewRoute || runRoute)[1]);
  const document = await ownedDocument(env.DB, documentId, user.id, user.organizationId);
  if (!document) return json({ error: { code: "DRAWING_NOT_FOUND", message: "Drawing document not found." } }, 404);

  if (runRoute && request.method === "GET") {
    const run=await env.DB.prepare("SELECT * FROM drawing_visual_runs WHERE id=? AND document_id=?").bind(decodeURIComponent(runRoute[2]),document.id).first();
    if(!run)return json({error:{code:"DRAWING_RUN_NOT_FOUND",message:"Analysis run not found."}},404);
    if(runRoute[3]!==undefined) {
      const image=parse(run.input_manifest,{}).images?.[Number(runRoute[3])];
      if(!image)return json({error:{code:"DRAWING_IMAGE_NOT_FOUND",message:"Analysis image not found."}},404);
      const object=await env.FILES?.get(image.objectKey);
      if(!object)return json({error:{code:"DRAWING_IMAGE_NOT_FOUND",message:"Analysis image not found."}},404);
      return new Response(object.body,{headers:{"content-type":"image/png","cache-control":"private, no-store","x-content-type-options":"nosniff"}});
    }
    return json({...run,input_manifest:parse(run.input_manifest,{}),raw_responses:parse(run.raw_responses,[]),result:parse(run.result)});
  }

  if (listRoute && !listRoute[2] && request.method === "GET") {
    const intakeVersion = await currentIntakeVersion(env.DB, document.id);
    if (!intakeVersion) return json({ error: { code: "DRAWING_INTAKE_REQUIRED", message: "Start drawing intake first." } }, 409);
    const rows = await env.DB.prepare("SELECT * FROM drawing_extraction_proposals WHERE intake_version_id=? ORDER BY page_number,proposal_type").bind(intakeVersion.id).all();
    const runs = await env.DB.prepare("SELECT * FROM drawing_visual_runs WHERE document_id=? ORDER BY created_at DESC").bind(document.id).all();
    return json({ intakeVersionId: intakeVersion.id, proposals: (rows.results || []).map(hydrateProposal),
      candidateComparisons: (runs.results || []).filter(r=>parse(r.input_manifest,{})?.purpose==='CandidateComparison').map(r=>({...r,input_manifest:parse(r.input_manifest,{}),raw_responses:parse(r.raw_responses,[]),result:parse(r.result)})),
      runs: (runs.results || []).filter(r=>parse(r.input_manifest,{})?.purpose!=='CandidateComparison').map(r=>({...r,input_manifest:parse(r.input_manifest,{}),raw_responses:parse(r.raw_responses,[]),result:parse(r.result)})),
      synced: (rows.results || []).length > 0 });
  }

  if (listRoute && listRoute[2] === "sync" && request.method === "POST") {
    const result = await syncProposals(env, document, user);
    if (result.error) return json({ error: result.error }, 409);
    return json(result, 201);
  }

  if (listRoute && listRoute[2] === "candidate-comparison" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const candidate = await ownedDocument(env.DB, String(body.candidateDocumentId || ""), user.id, user.organizationId);
    if (!candidate || candidate.project_id !== document.project_id) return json({error:{code:"CANDIDATE_NOT_FOUND"}},404);
    const result = await runCandidateComparison(env, document, candidate, body);
    return json(result, result.error ? 422 : 201);
  }

  if (listRoute && listRoute[2] === "visual-analysis" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const result = await analyzeVisually(env, document, Array.isArray(body.images) ? body.images : [], Number(body.pageNumber));
    if (result.error) return json({ error: result.error }, result.error.code === "AI_PROVIDER_UNAVAILABLE" ? 503 : 422);
    return json(result, 201);
  }

  if (reviewRoute && request.method === "POST") {
    const proposalId = decodeURIComponent(reviewRoute[2]);
    const action = reviewRoute[3];
    if (!REVIEW_ACTIONS.includes(action)) return json({ error: { code: "DRAWING_EXTRACTION_ACTION_UNKNOWN", message: "Unknown review action." } }, 404);
    const row = await env.DB.prepare("SELECT * FROM drawing_extraction_proposals WHERE id=? AND document_id=?").bind(proposalId, document.id).first();
    if (!row) return json({ error: { code: "DRAWING_EXTRACTION_PROPOSAL_NOT_FOUND", message: "Proposal not found." } }, 404);

    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (reason.length < MIN_GOVERNED_REASON_LENGTH) {
      return json({ error: { code: "DRAWING_EXTRACTION_REASON_REQUIRED", message: "Provide a substantive review reason." } }, 422);
    }
    // Hard-review gate enforced SERVER-SIDE, not just advisory in the UI:
    // an item the system itself flagged Conflict cannot be waved through by
    // a plain approve -- it must be resolved (corrected, or explicitly
    // marked as a still-open conflict) first. This is the one blanket rule
    // that can be checked generically here; the deeper per-fieldType
    // evidence requirements (Rule E's full hard-review list) are the
    // engine's job to have already reflected into governed_status before
    // this row was persisted.
    // Checks the CURRENT review_status (which reflects either the
    // system's own original governed_status, or a later human "conflict"
    // action) -- not the frozen governed_status alone -- so an engineer
    // who has explicitly flagged an item as Conflict also blocks a later
    // approve on it, not only the system's own original computation.
    if (action === "approve" && row.review_status === "Conflict") {
      return json(
        {
          error: {
            code: "DRAWING_EXTRACTION_CONFLICT_BLOCKS_APPROVAL",
            message: "This proposal is in Conflict and cannot be approved directly. Correct or resolve the conflict first.",
            suggestedAction: "Use the correct or conflict action, or resolve the underlying discrepancy, before approving.",
          },
        },
        422,
      );
    }
    // WORKSTREAM 4: an EquipmentCandidate/PanelCandidate row is a Potential
    // Alias observation (e.g. "FACP" seen near "MFACP"), never a confirmed
    // equipment-identity merge. Rule D requires matching tag/location/panel
    // number/direct cross-reference evidence to merge two identities -- this
    // schema has no such structured fields to verify that against, so
    // "approve" (which would read as "this identity is confirmed") is never
    // offered for these proposal types in v0. Reject/restore/conflict
    // remain available (acknowledging or dismissing the observation is
    // safe; confirming a merge is not).
    if (action === "approve" && ["Equipment Candidate", "Panel Candidate"].includes(row.proposal_type)) {
      return json(
        {
          error: {
            code: "DRAWING_EXTRACTION_IDENTITY_MERGE_NOT_SUPPORTED",
            message: "A Potential Alias cannot be approved as a confirmed equipment identity in v0 -- there is no tag/location evidence to verify a merge against.",
            suggestedAction: "Reject this alias observation if it is not useful, or leave it Needs Review for engineer awareness.",
          },
        },
        422,
      );
    }

    const requestId = request.headers.get("x-request-id") || id("request");
    const previous = { reviewStatus: row.review_status, correctedValue: parse(row.corrected_value, null) };
    const next =
      action === "restore"
        ? { reviewStatus: row.governed_status, correctedValue: null }
        : action === "correct"
          ? { reviewStatus: "Verified with Assumption", correctedValue: body.correctedValue ?? null }
          : { reviewStatus: { approve: "Verified", reject: "Rejected", conflict: "Conflict" }[action], correctedValue: previous.correctedValue };

    await env.DB.batch([
      env.DB.prepare("UPDATE drawing_extraction_proposals SET review_status=?,corrected_value=?,reviewed_by=?,reviewed_at=?,review_reason=?,updated_at=? WHERE id=?").bind(
        next.reviewStatus,
        next.correctedValue === null ? null : JSON.stringify(next.correctedValue),
        user.id,
        now(),
        reason,
        now(),
        row.id,
      ),
      env.DB.prepare(
        "INSERT INTO drawing_extraction_review_events (id,project_id,document_id,proposal_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).bind(id("drawingExtractionReview"), document.project_id, document.id, row.id, action, JSON.stringify(previous), JSON.stringify(next), reason, user.id, requestId),
    ]);
    return json({ proposalId: row.id, action, reviewStatus: next.reviewStatus });
  }

  return json({ error: { code: "DRAWING_EXTRACTION_API_NOT_FOUND", message: "Drawing extraction operation not found." } }, 404);
};
