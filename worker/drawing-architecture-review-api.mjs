// STEP 14.7 -- DRAWING ARCHITECTURE REVIEW API (project-scoped).
//
// Governed system-architecture fact surface for the Fire Alarm drawing set:
//   POST /api/projects/:projectId/drawing-architecture/review/initialize
//     -- extract deterministic architecture-fact candidates from the current
//        riser / schematic / network-diagram intake evidence and persist
//        governed review cases (idempotent; pristine-stale safe).
//   POST /api/projects/:projectId/drawing-architecture/review/evaluate
//     -- read-only dry-run of the decision ladder over every case. NO writes.
//   POST /api/projects/:projectId/drawing-architecture/review/deterministic-confirm
//     -- same ladder performed WITH the governed canonical promotion steps.
//        Only deterministic + fully evidenced + unambiguous facts auto-confirm;
//        the SYSTEM actor is never read from the request.
//   GET  /api/projects/:projectId/drawing-architecture/review
//   GET  /api/projects/:projectId/drawing-architecture/approved/current
//   GET  /api/projects/:projectId/drawing-architecture/approved/history
//
// STEP 14.8 -- governed exception adjudication surface:
//   POST /api/projects/:projectId/drawing-architecture/adjudication/evaluate
//     -- read-only dry-run of the exception-adjudication ladder (21 pending
//        -> 12 UNIQUE exceptions, 9 cross-sheet + 3 generic FACP). NO writes.
//   POST /api/projects/:projectId/drawing-architecture/adjudication/apply
//     -- persists adjudication rows (supersede-on-change, history kept),
//        approves the primary review case of each CONFIRMED exception, writes
//        the governed Stage-4 readiness row, and promotes the next approved
//        version (live corpus v1 = 116 -> v2 = 128). Idempotent on re-run.
//   GET  /api/projects/:projectId/drawing-architecture/adjudication
//   GET  /api/projects/:projectId/drawing-architecture/adjudication/current
//   GET  /api/projects/:projectId/drawing-architecture/adjudication/history
//   GET  /api/projects/:projectId/drawing-architecture/readiness
//   GET  /api/projects/:projectId/drawing-architecture/readiness/history
//
// STAGE 4 DRAWING BRIDGE -- governed, READ-ONLY projection of the approved
// Drawing Architecture evidence onto the Stage 4 project-evidence surface:
//   GET  /api/projects/:projectId/drawing-architecture/bridge
//     -- deterministic projection of the CURRENT (non-superseded) approved
//        architecture version + active adjudications + unresolved review
//        cases onto project-side technical evidence channels. NO writes, NO
//        schema change, NO knowledge-store duplication; SLC / panel-network /
//        interface / cross-sheet relations remain project ARCHITECTURE
//        evidence (never protocol, never product compatibility). Unresolved
//        evidence stays non-blocking UNKNOWN_PROJECT.
//
// Architecture facts are PROJECT-scoped (a campus topology lives across many
// sheets), so approved versions are keyed by project_id. No Technical
// Approval, no product-match, and no pricing/commercial surface is ever
// touched; confirmed facts mean ONLY "the drawing evidence deterministically
// establishes this interpretation."
import {
  ARCHITECTURE_FACT_DECISION_STATES,
  ARCHITECTURE_FACT_DECISION_POLICY_VERSION,
  SYSTEM_ARCHITECTURE_EVALUATION_ACTOR,
  isArchitectureAutoConfirmEligible,
  decideArchitectureFact,
} from "../app/domain/drawing-architecture-decision-policy.mjs";
import {
  ARCHITECTURE_PARSER_VERSION,
  sheetEvidenceFingerprint,
  extractArchitectureFacts,
  extractCrossSheetReferenceFacts,
  extractLayoutLegendFacts,
  detectArchitectureDiscrepancies,
  resolveCrossSheetPanelIdentities,
  crossSheetConflictDiscrepancyFact,
} from "../app/domain/drawing-architecture-intelligence.mjs";
import { classifyDrawingType } from "../app/domain/drawing-type-classifier.mjs";
import {
  ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
  ARCHITECTURE_EXCEPTION_ADJUDICATION_ACTOR,
  EXCEPTION_ADJUDICATION_DECISION_STATES,
  STAGE4_BLOCKING_CLASS,
  ARCHITECTURE_STATUS_VALUES,
  STAGE4_READINESS_VALUES,
  normalizeExceptionInventory,
  adjudicateCrossSheetReference,
  adjudicateGenericFacp,
  stage4BlockingSemantics,
  recomputeArchitectureStatus,
} from "../app/domain/drawing-architecture-adjudication.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import { buildDrawingArchitectureBridge } from "../app/domain/drawing-architecture-bridge.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback = null) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const ownedProject = (db, projectId, userId, organizationId) =>
  db.prepare("SELECT * FROM projects WHERE id=? AND owner_user_id=? AND organization_id=? AND archived_at IS NULL").bind(projectId, userId, organizationId).first();

// All drawing documents of a project with a CURRENT Completed intake whose
// sheet is architecture-relevant (riser/schematic/layout/detail/legend/cause
// & effect -- every ingested FA sheet contributes references; legend rows are
// consumed separately as governed rows, never as architecture sources).
const projectArchitectureDocuments = async (db, projectId) => {
  const rows = (await db.prepare(`
    SELECT d.id document_id, d.logical_name, d.current_version_id, iv.id intake_id,
           iv.version_number intake_version, iv.status intake_status, iv.superseded_at intake_superseded_at
    FROM documents d
    JOIN drawing_intake_versions iv ON iv.document_id = d.id
    WHERE d.project_id = ? AND d.deleted_at IS NULL
      AND iv.document_version_id = d.current_version_id
      AND iv.status = 'Completed' AND iv.superseded_at IS NULL
    ORDER BY iv.created_at DESC
  `).bind(projectId).all()).results || [];
  return rows;
};

const metadataFor = async (db, intakeId) =>
  db.prepare("SELECT id, intake_version_id, drawing_number, revision, sheet_name, discipline, scale, review_status FROM drawing_metadata WHERE intake_version_id=? ORDER BY created_at DESC LIMIT 1").bind(intakeId).first();

const classificationsFor = async (db, intakeId) =>
  (db.prepare("SELECT id, classification_type, confidence, extraction_method, review_status FROM drawing_document_classifications WHERE intake_version_id=? ORDER BY confidence DESC").bind(intakeId).all()).results || [];

const pagesFor = async (db, intakeId) =>
  (db.prepare("SELECT id, page_number, width, height, coordinate_mode FROM drawing_pages WHERE intake_version_id=? ORDER BY page_number").bind(intakeId).all()).results || [];

const assetsFor = async (db, intakeId) =>
  (await db.prepare("SELECT id, page_id, asset_type, text_content, bounding_box FROM drawing_assets WHERE intake_version_id=? AND asset_type IN ('Text','Legend') ORDER BY id").bind(intakeId).all()).results || [];

const governedLegendRowsFor = async (db, projectId) => {
  // GOVERNED legend identities only: rows promoted into an active, current
  // approved drawing structure version (Step 14.6). A legend establishes
  // symbol identity; only approved, FIRE-ALARM-scoped legend rows anchor
  // LAYOUT_LEGEND_LINK. FA scope is determined deterministically by the
  // sheet's discipline segment in its own drawing number (this project
  // numbers all Fire Alarm drawings `-DR-T-*`: T-00 legend, T-91..T-94).
  const approved = (await db.prepare(`
    SELECT rol.abbreviation, rol.description, av.document_id
    FROM drawing_structure_approved_rows rol
    JOIN drawing_structure_approved_versions av ON av.id = rol.approved_version_id
    WHERE av.project_id = ? AND av.superseded_at IS NULL
      AND rol.abbreviation IS NOT NULL AND trim(rol.abbreviation) <> ''
    GROUP BY av.document_id, rol.abbreviation, rol.description
  `).bind(projectId).all()).results || [];
  const docIds = [...new Set(approved.map((r) => r.document_id))];
  const numbers = {};
  if (docIds.length) {
    const placeholders = docIds.map(() => "?").join(",");
    const metaRows = (await db.prepare(`
      SELECT d.id document_id, m.drawing_number
      FROM documents d
      JOIN drawing_intake_versions iv ON iv.document_id = d.id AND iv.document_version_id = d.current_version_id AND iv.status = 'Completed' AND iv.superseded_at IS NULL
      JOIN drawing_metadata m ON m.intake_version_id = iv.id
      WHERE d.id IN (${placeholders})
    `).bind(...docIds).all()).results || [];
    for (const m of metaRows) numbers[m.document_id] = m.drawing_number ?? null;
  }
  return approved
    .map((r) => ({ id: null, abbreviation: r.abbreviation, description: r.description, documentId: r.document_id, source: "governed-approved-structure-row", drawingNumber: numbers[r.document_id] ?? null }))
    .filter((r) => {
      if (!r.drawingNumber) return false;
      const normalized = String(r.drawingNumber).replace(/\s+/g, "").toUpperCase();
      return /-DR-T-/.test(normalized);
    });
};

const currentIntakeForDocument = async (db, documentId) =>
  db.prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND status='Completed' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(documentId).first();

const sheetContextForDocument = async (db, { documentId, intakeId }) => {
  const metadata = await metadataFor(db, intakeId);
  const classifications = await classificationsFor(db, intakeId);
  const pages = await pagesFor(db, intakeId);
  const assets = await assetsFor(db, intakeId);
  const pageNumberById = new Map(pages.map((p) => [p.id, Number(p.page_number)]));
  const sheetName = metadata?.sheet_name ?? null;
  const drawingNumber = metadata?.drawing_number ?? null;
  const classification = classifications[0] || null;
  const classificationResult = classifyDrawingType({ classifications: classification ? [{ type: classification.classification_type, confidence: classification.confidence }] : [], sheetName });
  const drawingType = classificationResult?.drawingType ?? null;
  const shapedAssets = assets.map((a) => ({
    id: a.id,
    pageId: a.page_id,
    assetType: a.asset_type ?? "Text",
    pageNumber: pageNumberById.get(a.page_id) ?? 1,
    textContent: a.text_content,
    boundingBox: parse(a.bounding_box),
  })).filter((a) => a.boundingBox && typeof a.textContent === "string");
  // Cross-sheet reference detection is TEXT-scoped: a composite Legend/Notes
  // region legitimately carries "refer to drawing <number>" evidence even when
  // the PDF pipeline emitted it without a bounding box. Geometry is only ever
  // used for spatial assignment (architecture/layout facts), never for
  // reference detection -- so the reference candidate set keeps every
  // text-bearing asset that has page provenance, bbox or not.
  const referenceAssets = assets.map((a) => ({
    id: a.id,
    pageId: a.page_id,
    assetType: a.asset_type ?? "Text",
    pageNumber: pageNumberById.get(a.page_id) ?? 1,
    textContent: a.text_content,
    boundingBox: parse(a.bounding_box),
  })).filter((a) => typeof a.textContent === "string");
  return { metadata, classification, drawingNumber, sheetName, drawingType, pages, assets: shapedAssets, referenceAssets };
};

const registryFor = (sheets) => sheets
  .map((s) => ({ id: s.documentId, drawingNumber: s.sheet?.drawingNumber ?? null }))
  .filter((r) => r.drawingNumber);

const buildSheets = async (db, projectId) => {
  const docs = await projectArchitectureDocuments(db, projectId);
  const sheets = [];
  for (const doc of docs) {
    const sheet = await sheetContextForDocument(db, { documentId: doc.document_id, intakeId: doc.intake_id });
    sheets.push({
      documentId: doc.document_id,
      documentVersionId: doc.current_version_id,
      intakeId: doc.intake_id,
      intake: { id: doc.intake_id, status: doc.intake_status, supersededAt: doc.intake_superseded_at },
      sheet,
      sheetFacts: null,
      referenceFacts: null,
      layoutFacts: null,
      discrepancyFacts: null,
      evidenceFingerprint: null,
      allFacts: null,
    });
  }
  return sheets;
};

// Build the full candidate set for every sheet of the project (pure extraction
// over freshly-read current evidence). Deterministic for a fixed DB state.
const buildCandidateSets = async (db, projectId, governedLegendRows) => {
  const sheets = await buildSheets(db, projectId);
  const registry = registryFor(sheets);
  for (const s of sheets) {
    const { factFacts, referenceFacts, layoutFacts, discrepancyFacts } = await buildSheetCandidates(s, registry, governedLegendRows);
    s.sheetFacts = factFacts;
    s.referenceFacts = referenceFacts;
    s.layoutFacts = layoutFacts;
    s.discrepancyFacts = discrepancyFacts;
    s.allFacts = [...factFacts, ...referenceFacts, ...layoutFacts, ...discrepancyFacts];
    s.evidenceFingerprint = sheetEvidenceFingerprint({ sheet: s.sheet, facts: s.allFacts });
  }
  const { resolved, conflicts } = resolveCrossSheetPanelIdentities(sheets.map((s) => ({ documentId: s.documentId, drawingNumber: s.sheet.drawingNumber, facts: s.allFacts })));
  // A proven cross-sheet identity located at two different named places is a
  // deterministic conflict record attached to the SECOND sheet of the pair.
  for (const conflict of conflicts) {
    const priority = sheets
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => conflict.acrossDocuments.includes(s.documentId))
      .sort((a, b) => b.index - a.index);
    const target = priority[0]?.s;
    if (!target) continue;
    target.allFacts.push(crossSheetConflictDiscrepancyFact(target.sheet, conflict));
    target.evidenceFingerprint = sheetEvidenceFingerprint({ sheet: target.sheet, facts: target.allFacts });
  }
  return { sheets, identities: resolved, conflicts };
};

const buildSheetCandidates = async (s, registry, governedLegendRows) => {
  const sheet = {
    projectId: null,
    documentId: s.documentId,
    documentVersionId: s.documentVersionId,
    intakeVersionId: s.intakeId,
    structureVersionId: null,
    drawingNumber: s.sheet.drawingNumber ?? null,
    sheetName: s.sheet.sheetName ?? null,
    drawingType: s.sheet.drawingType ?? null,
  };
  const assets = s.sheet.assets;
  const textAssets = assets.filter((a) => a.assetType === "Text");
  // Architecture facts exist ONLY on architecture-authoritative sheets (Riser
  // Diagram / Schematic / Single-Line). Legend / Cause & Effect / Detail /
  // Schedule / Layout sheets are supporting sources -- they may carry
  // references and legend links, but they never author a panel/loop/interface.
  // Fact extraction consumes TEXT fragments only; composite Legend-region
  // assets are legitimate cross-sheet/legend-link carriers but never author a
  // panel/loop/interface themselves (established Text+Legend cross-sheet
  // contract, facts stay Text-scoped).
  const architectureAuthoritative = ["Riser Diagram", "Schematic / Single-Line"].includes(s.sheet.drawingType);
  const { facts } = architectureAuthoritative ? extractArchitectureFacts({ sheet, assets: textAssets }) : { facts: [] };
  const referenceResult = extractCrossSheetReferenceFacts({ sheet, assets: s.sheet.referenceAssets, documentRegistry: registry });
  const referenceFacts = referenceResult.facts;
  // Layout <-> legend links only make sense on sheets that bear symbols
  // (Layout / Detail / Schematic / Riser). A legend sheet's own rows are the
  // identity authority -- they never "link" back to themselves as layout, and
  // Cause & Effect / Schedule matrices are semantic tables, not layouts.
  const layoutEligible = !["Legend / Notes", "Cause & Effect", "Schedule"].includes(s.sheet.drawingType);
  const layoutFacts = layoutEligible ? extractLayoutLegendFacts({ sheet, assets: textAssets, governedLegendRows }).facts : [];
  const panelFacts = [...facts, ...referenceFacts, ...layoutFacts];
  const discrepancyResult = detectArchitectureDiscrepancies({ sheet, crossSheetFacts: referenceFacts, panelFacts });
  return { factFacts: facts, referenceFacts, layoutFacts, discrepancyFacts: discrepancyResult.facts };
};

const snapshotFor = (fact, initializationEvidenceFingerprint) => ({
  factType: fact.factType,
  factKey: fact.factKey,
  subject: fact.subject,
  relation: fact.relation ?? null,
  object: fact.object ?? null,
  scope: fact.scope ?? "FIRE_ALARM",
  evidenceKind: fact.evidenceKind,
  authorityClass: fact.authorityClass ?? null,
  source: fact.source ?? null,
  identity: fact.identity ?? {},
  assignment: fact.assignment ?? null,
  resolution: fact.resolution ?? null,
  crossSheetIdentity: fact.crossSheetIdentity ?? null,
  discrepancy: fact.discrepancy ?? null,
  supportingSourceAllowed: Boolean(fact.supportingSourceAllowed),
  parserVersion: ARCHITECTURE_PARSER_VERSION,
  initializationProvenance: { evidenceFingerprint: initializationEvidenceFingerprint, actor: SYSTEM_ARCHITECTURE_EVALUATION_ACTOR },
});

const initialize = async (db, project, governedLegendRows) => {
  const projectId = project.id;
  const { sheets, identities } = await buildCandidateSets(db, projectId, governedLegendRows);
  const statements = [];
  const refreshStatements = [];
  const blocked = [];
  let createdCount = 0, refreshedCount = 0, skipped = 0, total = 0;
  const byType = new Map();
  for (const s of sheets) {
    for (const fact of s.allFacts) {
      total++;
      const entry = byType.get(fact.factType) || { factType: fact.factType, total: 0, created: 0, refreshed: 0 };
      entry.total++;
      byType.set(fact.factType, entry);
      const key = fact.factKey;
      const fingerprint = s.evidenceFingerprint;
      const existing = await db.prepare("SELECT id,status,reviewed_by,case_version,current_snapshot FROM drawing_architecture_review_cases WHERE document_id=? AND drawing_intake_version_id=? AND fact_key=?").bind(s.documentId, s.intakeId, key).first();
      if (existing) {
        const pristine = existing.status === "Needs Review" && !existing.reviewed_by && Number(existing.case_version) === 1;
        const stored = parse(existing.current_snapshot, {}) || {};
        const staleEvidence = pristine && stored.initializationProvenance?.evidenceFingerprint !== fingerprint;
        if (!staleEvidence) { skipped++; continue; }
        const snapshot = snapshotFor(fact, fingerprint);
        refreshStatements.push(db.prepare("UPDATE drawing_architecture_review_cases SET original_snapshot=?,current_snapshot=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND case_version=?").bind(JSON.stringify(snapshot), JSON.stringify(snapshot), existing.id, existing.case_version));
        refreshedCount++; entry.refreshed++;
        continue;
      }
      const snapshot = snapshotFor(fact, fingerprint);
      statements.push(db.prepare("INSERT INTO drawing_architecture_review_cases (id,project_id,document_id,document_version_id,drawing_intake_version_id,structure_version_id,fact_key,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,source_region,source_fragment_ids,parser_version,evidence_fingerprint,decision_state,decision_reason,decision_policy_version,case_version,status,original_snapshot,current_snapshot,adjustments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id("architectureCase"), projectId, s.documentId, s.documentVersionId, s.intakeId, null, key, fact.factType, fact.subject, fact.relation ?? null, fact.object ?? null, fact.scope ?? "FIRE_ALARM", fact.evidenceKind, fact.authorityClass ?? null, s.sheet.drawingNumber ?? null, fact.source?.pageNumber ?? null, fact.source?.sourceRegion ? JSON.stringify(fact.source.sourceRegion) : null, JSON.stringify(fact.source?.sourceFragmentIds || []), ARCHITECTURE_PARSER_VERSION, fingerprint, "Pending", "[]", null, 1, "Needs Review", JSON.stringify(snapshot), JSON.stringify(snapshot), "[]"));
      createdCount++; entry.created++;
    }
  }
  for (let index = 0; index < statements.length; index += 75) await db.batch(statements.slice(index, index + 75));
  for (let index = 0; index < refreshStatements.length; index += 75) await db.batch(refreshStatements.slice(index, index + 75));
  return {
    created: createdCount,
    refreshed: refreshedCount,
    skipped,
    total,
    documents: sheets.length,
    identities,
    byType: [...byType.values()],
    idempotent: createdCount === 0 && refreshedCount === 0 && total > 0,
  };
};

// Recompute CURRENT per-sheet fingerprints from the live evidence so each
// case's stored fingerprint can be compared (staleness anchor).
const currentEvidenceContext = async (db, projectId, governedLegendRows) => {
  const { sheets } = await buildCandidateSets(db, projectId, governedLegendRows);
  const fingerprintByIntake = new Map(sheets.map((s) => [s.intakeId, s.evidenceFingerprint]));
  return { fingerprintByIntake };
};

const evaluateArchitectureFacts = async (request, env, project, mutate) => {
  const governedLegendRows = await governedLegendRowsFor(env.DB, project.id);
  const context = await currentEvidenceContext(env.DB, project.id, governedLegendRows);
  const docs = await projectArchitectureDocuments(env.DB, project.id);
  const currentIntakeIdByDocument = new Map(docs.map((d) => [d.document_id, d.intake_id]));
  const cases = (await env.DB.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? ORDER BY created_at,id").bind(project.id).all()).results || [];
  const intakeIds = [...new Set(cases.map((c) => c.drawing_intake_version_id).filter(Boolean))];
  const intakeById = new Map();
  if (intakeIds.length) {
    const placeholders = intakeIds.map(() => "?").join(",");
    const intakeRows = (await env.DB.prepare(`SELECT id,status,superseded_at FROM drawing_intake_versions WHERE id IN (${placeholders})`).bind(...intakeIds).all()).results || [];
    for (const i of intakeRows) intakeById.set(i.id, i);
  }
  const requestId = request?.headers?.get?.("x-request-id") || id("request");
  const outcomes = [];
  const updates = [];
  let wouldConfirm = 0, wouldRequireEngineer = 0, wouldReject = 0, stale = 0, alreadyConfirmed = 0, humanProtected = 0;
  for (const row of cases) {
    const snapshot = parse(row.current_snapshot, {}) || {};
    const storedFingerprint = snapshot.initializationProvenance?.evidenceFingerprint ?? row.evidence_fingerprint ?? null;
    const currentFingerprint = context.fingerprintByIntake.get(row.drawing_intake_version_id) ?? null;
    const intake = intakeById.get(row.drawing_intake_version_id) || null;
    const currentIntakeId = currentIntakeIdByDocument.get(row.document_id) ?? row.drawing_intake_version_id;

    if (row.status !== "Needs Review") {
      const viaSystemEarlier = row.reviewed_by === SYSTEM_ARCHITECTURE_EVALUATION_ACTOR && row.status === "Approved" && storedFingerprint && currentFingerprint && storedFingerprint === currentFingerprint;
      if (viaSystemEarlier) { alreadyConfirmed++; outcomes.push({ reviewCaseId: row.id, factId: row.id, decision: { state: ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT, alreadyConfirmed: true } }); }
      else if (row.reviewed_by === SYSTEM_ARCHITECTURE_EVALUATION_ACTOR && row.status === "Approved") {
        // The evidence this approved case was built on changed / its intake is
        // no longer the current Completed intake. The approval stays in its own
        // history but is NEVER re-confirmed silently -- it needs fresh evidence
        // and a fresh governed decision to be promoted again.
        stale++;
        outcomes.push({ reviewCaseId: row.id, factId: row.id, factType: row.fact_type, subject: row.subject, object: row.object ?? null, decision: { state: ARCHITECTURE_FACT_DECISION_STATES.STALE, charged: "APPROVED_EVIDENCE_CHANGED", decisionReasons: ["ARCHITECTURE_EVIDENCE_CHANGED", "REAPPROVAL_REQUIRED"], decisionPolicyVersion: ARCHITECTURE_FACT_DECISION_POLICY_VERSION } });
      }
      else { humanProtected++; outcomes.push({ reviewCaseId: row.id, factId: row.id, protectedHumanDecision: true, status: row.status, decidedBy: row.reviewed_by }); }
      continue;
    }

    const decision = decideArchitectureFact({
      fact: { ...snapshot, source: snapshot.source ?? null, identity: snapshot.identity ?? {}, assignment: snapshot.assignment ?? null, resolution: snapshot.resolution ?? null, crossSheetIdentity: snapshot.crossSheetIdentity ?? null },
      source: {
        fact: snapshot,
        intake: intake ? { id: intake.id, status: intake.status, supersededAt: intake.superseded_at } : { id: row.drawing_intake_version_id, status: "Unknown", supersededAt: null },
        currentIntakeId,
        documentCurrentVersionId: row.document_version_id,
      },
      stored: { evidenceFingerprint: storedFingerprint, caseVersion: row.case_version, status: row.status, reviewedBy: row.reviewed_by },
      current: { evidenceFingerprint: currentFingerprint },
      assignment: snapshot.assignment ?? null,
      resolution: snapshot.resolution ?? null,
    });

    if (decision.state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT || decision.state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING) wouldConfirm++;
    else if (decision.state === ARCHITECTURE_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED) wouldRequireEngineer++;
    else if (decision.state === ARCHITECTURE_FACT_DECISION_STATES.REJECTED_INTERPRETATION) wouldReject++;
    else stale++;
    outcomes.push({ reviewCaseId: row.id, factId: row.id, factType: row.fact_type, subject: row.subject, object: row.object ?? null, decision });
    if (mutate && decision.eligible) {
      const version = Number(row.case_version) + 1;
      const decisionReason = `System deterministic architecture evaluation: ${decision.state} (${decision.decisionReasons.join(", ")}) ${decision.decisionPolicyVersion}`;
      updates.push(env.DB.prepare("UPDATE drawing_architecture_review_cases SET status='Approved',decision_state=?,decision_reason=?,decision_policy_version=?,case_version=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND case_version=?")
        .bind(decision.state, JSON.stringify(decision.decisionReasons), decision.decisionPolicyVersion, version, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR, decisionReason, row.id, row.case_version));
    }
  }
  if (mutate) {
    for (let index = 0; index < updates.length; index += 75) await env.DB.batch(updates.slice(index, index + 75));
  }
  let promotion = null;
  const confirmedTotal = wouldConfirm + alreadyConfirmed;
  if (mutate && confirmedTotal > 0) {
    // Governed currency guard: a case can only be PROMOTED while its own
    // intake is still the document's current Completed intake AND its stored
    // evidence fingerprint equals the freshly recomputed one. An approved case
    // whose evidence changed stays in its own approved history but is never
    // silently re-promoted into the current canonical version.
    const approvedRows = (await env.DB.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? AND status='Approved'").bind(project.id).all()).results || [];
    const verifiedCurrentCaseIds = [];
    for (const ar of approvedRows) {
      const stored = parse(ar.current_snapshot, {}) || {};
      const fp = stored.initializationProvenance?.evidenceFingerprint ?? ar.evidence_fingerprint ?? null;
      const currentIntake = currentIntakeIdByDocument.get(ar.document_id) ?? ar.drawing_intake_version_id;
      const currentFp = context.fingerprintByIntake.get(ar.drawing_intake_version_id) ?? null;
      if (ar.drawing_intake_version_id === currentIntake && fp && currentFp && fp === currentFp) verifiedCurrentCaseIds.push(ar.id);
    }
    promotion = await promoteApprovedArchitectureVersion({ db: env.DB, project, verifiedCurrentCaseIds: verifiedCurrentCaseIds.length ? verifiedCurrentCaseIds : null, actorId: SYSTEM_ARCHITECTURE_EVALUATION_ACTOR, reason: `Canonical promotion of ${wouldConfirm} deterministic drawing architecture facts confirmed by governed evidence evaluation (${ARCHITECTURE_FACT_DECISION_POLICY_VERSION}).`, requestId });
  }
  return {
    dryRun: !mutate,
    projectId: project.id,
    decisionPolicyVersion: ARCHITECTURE_FACT_DECISION_POLICY_VERSION,
    counts: { wouldConfirm, wouldRequireEngineer, wouldReject, stale, alreadyConfirmed, humanProtected, total: cases.length },
    outcomes,
    promotion,
  };
};

const promoteApprovedArchitectureVersion = async ({ db, project, actorId, reason, requestId, verifiedCurrentCaseIds = null }) => {
  const allRows = (await db.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? AND status='Approved' ORDER BY id").bind(project.id).all()).results || [];
  const rows = verifiedCurrentCaseIds ? allRows.filter((row) => verifiedCurrentCaseIds.includes(row.id)) : allRows;
  const all = (await db.prepare("SELECT count(*) count FROM drawing_architecture_review_cases WHERE project_id=?").bind(project.id).first())?.count || 0;
  const snapshots = rows.flatMap((row) => {
    const snapshot = parse(row.current_snapshot, {}) || {};
    return [{
      reviewCaseId: row.id,
      factType: snapshot.factType ?? row.fact_type,
      subject: snapshot.subject ?? row.subject,
      relation: snapshot.relation ?? row.relation ?? null,
      object: snapshot.object ?? row.object ?? null,
      scope: snapshot.scope ?? row.scope ?? "FIRE_ALARM",
      evidenceKind: snapshot.evidenceKind ?? row.evidence_kind,
      authorityClass: snapshot.authorityClass ?? row.authority_class ?? null,
      source: snapshot.source ?? null,
      identity: snapshot.identity ?? {},
      assignment: snapshot.assignment ?? null,
      resolution: snapshot.resolution ?? null,
      crossSheetIdentity: snapshot.crossSheetIdentity ?? null,
      discrepancy: snapshot.discrepancy ?? null,
      reviewActorId: row.reviewed_by,
      reviewReason: row.review_reason,
      evidenceFingerprint: snapshot.initializationProvenance?.evidenceFingerprint ?? row.evidence_fingerprint ?? null,
      sourceSnapshot: snapshot,
    }];
  });
  const inputFingerprint = await digest({ projectId: project.id, cases: rows.map((row) => [row.id, row.case_version, row.status, row.decision_state]) });
  const outputFingerprint = await digest(snapshots.map((s) => ({ factKey: s.sourceSnapshot?.factKey, reviewCaseId: s.reviewCaseId, factType: s.factType, subject: s.subject, relation: s.relation, object: s.object, scope: s.scope, evidenceKind: s.evidenceKind, source: s.source })));
  const previous = await db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(project.id).first();
  if (previous?.input_fingerprint === inputFingerprint && previous?.output_fingerprint === outputFingerprint) {
    return { approvedVersionId: previous.id, version: previous.version_number, approvedRows: previous.approved_fact_count, idempotent: true };
  }
  const versionId = id("approvedArchitecture");
  const version = Number(previous?.version_number || 0) + 1;
  await db.batch([
    db.prepare("INSERT INTO drawing_architecture_approved_versions (id,project_id,version_number,input_fingerprint,output_fingerprint,status,approved_fact_count,excluded_fact_count,created_by,reason) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(versionId, project.id, version, inputFingerprint, outputFingerprint, "Active", snapshots.length, Math.max(all - snapshots.length, 0), actorId, reason),
    db.prepare("UPDATE drawing_architecture_approved_versions SET status='Superseded',superseded_at=CURRENT_TIMESTAMP WHERE project_id=? AND superseded_at IS NULL AND id<>?").bind(project.id, versionId),
    db.prepare("INSERT INTO drawing_architecture_approved_audit_events (id,project_id,document_id,approved_version_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id("architectureAudit"), project.id, null, versionId, "version-created", previous ? String(previous.version_number) : "none", String(version), reason, actorId, requestId),
  ]);
  const rowStatements = snapshots.map((s) => db.prepare("INSERT INTO drawing_architecture_approved_rows (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,structure_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,source_region,source_fragment_ids,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id("approvedArchRow"), versionId, s.reviewCaseId, s.source?.documentId ?? null, s.source?.documentVersionId ?? null, s.source?.intakeVersionId ?? null, null, s.factType, s.subject, s.relation, s.object, s.scope, s.evidenceKind, s.authorityClass, s.source?.drawingNumber ?? null, s.source?.pageNumber ?? null, s.source?.sourceRegion ? JSON.stringify(s.source.sourceRegion) : null, JSON.stringify(s.source?.sourceFragmentIds || []), ARCHITECTURE_PARSER_VERSION, s.evidenceFingerprint, s.reviewActorId, s.reviewReason, JSON.stringify(s.sourceSnapshot)));
  for (let index = 0; index < rowStatements.length; index += 75) await db.batch(rowStatements.slice(index, index + 75));
  return { approvedVersionId: versionId, version, approvedRows: snapshots.length, idempotent: false };
};

const loadReview = async (db, project) => {
  const cases = (await db.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? ORDER BY fact_type,created_at,id").bind(project.id).all()).results || [];
  return cases.map((row) => ({
    id: row.id,
    factType: row.fact_type,
    subject: row.subject,
    relation: row.relation,
    object: row.object,
    scope: row.scope,
    evidenceKind: row.evidence_kind,
    sourceDrawingNumber: row.source_drawing_number,
    sourcePage: row.source_page,
    status: row.status,
    decisionState: row.decision_state,
    decisionReasons: parse(row.decision_reason, []),
    decisionPolicyVersion: row.decision_policy_version,
    caseVersion: row.case_version,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason,
    sourceFragmentIds: parse(row.source_fragment_ids, []),
    evidenceFingerprint: row.evidence_fingerprint,
    snapshot: parse(row.current_snapshot, {}),
  }));
};

export const loadApprovedVersion = async (db, project, versionId = null) => {
  const version = versionId
    ? await db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE id=? AND project_id=?").bind(versionId, project.id).first()
    : await db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(project.id).first();
  if (!version) return null;
  const rows = (await db.prepare("SELECT * FROM drawing_architecture_approved_rows WHERE approved_version_id=? ORDER BY fact_type,subject,id").bind(version.id).all()).results || [];
  return {
    approvedVersionId: version.id,
    projectId: project.id,
    version: version.version_number,
    status: version.status,
    approvedFactCount: version.approved_fact_count,
    excludedFactCount: version.excluded_fact_count,
    createdBy: version.created_by,
    reason: version.reason,
    createdAt: version.created_at,
    supersededAt: version.superseded_at,
    inputFingerprint: version.input_fingerprint,
    outputFingerprint: version.output_fingerprint,
    approvedRows: rows.map((r) => ({
      id: r.id,
      approvedVersionId: r.approved_version_id,
      reviewCaseId: r.review_case_id,
      documentId: r.document_id,
      documentVersionId: r.document_version_id,
      structureVersionId: r.structure_version_id,
      drawingIntakeVersionId: r.drawing_intake_version_id,
      factType: r.fact_type,
      subject: r.subject,
      relation: r.relation,
      object: r.object,
      scope: r.scope,
      evidenceKind: r.evidence_kind,
      authorityClass: r.authority_class,
      sourceDrawingNumber: r.source_drawing_number,
      sourcePage: r.source_page,
      sourceRegion: parse(r.source_region, null),
      sourceFragmentIds: parse(r.source_fragment_ids, []),
      evidenceFingerprint: r.evidence_fingerprint,
      parserVersion: r.parser_version,
      reviewActorId: r.review_actor_id,
      reviewReason: r.review_reason,
      snapshot: parse(r.source_snapshot, {}),
    })),
  };
};

const loadApprovedHistory = async (db, project) => {
  const versions = (await db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=? ORDER BY version_number DESC").bind(project.id).all()).results || [];
  return versions.map((v) => ({
    approvedVersionId: v.id,
    version: v.version_number,
    status: v.status,
    approvedFactCount: v.approved_fact_count,
    excludedFactCount: v.excluded_fact_count,
    createdBy: v.created_by,
    reason: v.reason,
    createdAt: v.created_at,
    supersededAt: v.superseded_at,
  }));
};

// ---------------------------------------------------------------------------
// STEP 14.8 -- Architecture exception adjudication surface.
//
// Consumes ONLY app/domain/drawing-architecture-adjudication.mjs as the
// governed decision authority. The surface:
//   1. loads the project's pending (Needs Review) review cases,
//   2. normalizes the 21-record pending corpus -> 12 UNIQUE exceptions
//      (9 CROSS_SHEET_REFERENCE groups folding their mirrored
//      ARCHITECTURE_DISCREPANCY 1:1 + 3 GENERIC_FACP_IDENTITY),
//   3. adjudicates each exception against fresh, evidence-only inputs
//      (registered drawing register + corpus citation conventions for
//      references; building asset code + cross-sheet identity tokens +
//      served areas + loop ownership + topology position for generic FACP),
//   4. recomputes architecture status + Stage-4 readiness,
//   5. on apply: persists adjudication rows (supersede-on-change, history
//      kept, ONE active row per exception_key), persists the governed
//      readiness row, approves the primary review case of each CONFIRMED
//      exception, and promotes the next approved version (v1=116 -> v2=128
//      on the live corpus). Re-runs are idempotent.
// ---------------------------------------------------------------------------

const pendingCaseRecords = async (db, project) => {
  const cases = (await db.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? AND status='Needs Review' ORDER BY created_at,id").bind(project.id).all()).results || [];
  return cases.map((c) => ({
    id: c.id,
    status: c.status,
    factType: c.fact_type,
    subject: c.subject,
    object: c.object ?? null,
    sourceDrawingNumber: c.source_drawing_number ?? null,
    sourceFragmentIds: parse(c.source_fragment_ids, []),
    snapshot: parse(c.current_snapshot, {}) || {},
    drawingIntakeVersionId: c.drawing_intake_version_id,
    documentId: c.document_id,
  }));
};

// The project's registered drawing register (every current Completed intake's
// drawing number + title) -- the universe adjudicateCrossSheetReference
// resolves citations against (E-00 and T-00 legends, schematics, matrices...).
const registeredDrawingRegister = async (db, projectId) => {
  const docs = await projectArchitectureDocuments(db, projectId);
  const register = [];
  for (const doc of docs) {
    const meta = await metadataFor(db, doc.intake_id);
    if (meta?.drawing_number) register.push({ id: doc.document_id, documentId: doc.document_id, drawingNumber: meta.drawing_number, sheetName: meta.sheet_name ?? null });
  }
  return register;
};

// Corpus citation conventions: how many pending cross-sheet references cite the
// project's DR-less form (2401232-PC-AMS-T-00-ZZZ-002) vs the registered -DR-
// form, plus how many citations target the T-00 legend series.
const corpusCountsFor = (records) => {
  let withoutDr = 0, withDr = 0, totalT00 = 0;
  for (const r of records) {
    // Every pending record naming a referenced drawing counts -- a mirrored
    // ARCHITECTURE_DISCREPANCY carries the referenced drawing in its `object`
    // (snapshot.resolution is null on a discrepancy), so corpus counts are
    // stable whether the primary CROSS_SHEET_REFERENCE case is still pending
    // (first run) or only the mirrored discrepancy remains (idempotent re-run).
    const ref = r.snapshot?.resolution?.referencedDrawingNumber ?? r.snapshot?.referencedDrawingNumber ?? r.object ?? null;
    if (!ref) continue;
    const normalized = String(ref).replace(/\s+/g, "").toUpperCase();
    if (normalized.includes("-DR-")) withDr++; else withoutDr++;
    if (/\bT-\d{2}-ZZZ\b/.test(normalized)) totalT00++;
  }
  return { withoutDr, withDr, totalT00 };
};

const intakeIdForDrawingNumber = async (db, projectId, drawingNumber) => {
  const row = await db.prepare(`
    SELECT m.intake_version_id FROM drawing_metadata m
    JOIN drawing_intake_versions iv ON iv.id = m.intake_version_id
    WHERE iv.project_id=? AND iv.status='Completed' AND iv.superseded_at IS NULL AND m.drawing_number=?
    ORDER BY iv.version_number DESC LIMIT 1`).bind(projectId, drawingNumber).first();
  return row?.intake_version_id ?? null;
};

// Project-wide FACP identity tokens ("TO FACP @GRS BUILDING", "FROM MFACP @BOS
// BUILDING") -- the cross-sheet identity + source/target connection evidence.
const facpIdentityTokens = async (db, projectId) => {
  const docs = await projectArchitectureDocuments(db, projectId);
  const tokens = [];
  for (const doc of docs) {
    const assets = (await db.prepare("SELECT asset_type,text_content FROM drawing_assets WHERE intake_version_id=? AND asset_type='Text'").bind(doc.intake_id).all()).results || [];
    for (const a of assets) {
      const text = typeof a.text_content === "string" ? a.text_content : "";
      if (/(?:TO|FROM)\s+[A-Z]?FACP\s*@/i.test(text)) tokens.push(text);
    }
  }
  return tokens;
};

// Evidence for ONE generic FACP exception: title-block building asset code,
// served area names, loop ownership, topology position, cross-sheet identity
// tokens and source/target connections -- all verbatim from Text assets.
const facpEvidenceFor = async (db, projectId, exception) => {
  const intakeId = await intakeIdForDrawingNumber(db, projectId, exception.sourceDrawingNumber);
  const sourceAssets = intakeId
    ? (await db.prepare("SELECT asset_type,text_content FROM drawing_assets WHERE intake_version_id=? AND asset_type='Text'").bind(intakeId).all()).results || []
    : [];
  const tokens = sourceAssets.map((a) => (typeof a.text_content === "string" ? a.text_content : "")).filter(Boolean);
  const loopOwnership = tokens.filter((t) => /^LOOP-\d+$/i.test(t.trim()));
  const servedAreas = tokens.filter((t) => /BOYS SCHOOL|GIRLS SCHOOL|WELCOME CENTER|FCC ROOM/i.test(t));
  // Title block: the "BUILDING ASSET CODE" annotation is immediately followed
  // by the 2-4 letter building code token (BOS/GRS/WLC) on the same fixture.
  let titleBlockBuildingCode = null;
  const codeIndex = tokens.findIndex((t) => /BUILDING ASSET CODE/i.test(t));
  if (codeIndex >= 0) {
    for (let i = codeIndex + 1; i < Math.min(codeIndex + 6, tokens.length); i++) {
      const candidate = tokens[i].trim();
      if (/^[A-Z]{2,4}$/i.test(candidate)) { titleBlockBuildingCode = candidate.toUpperCase(); break; }
    }
  }
  const crossSheetIdentityTokens = await facpIdentityTokens(db, projectId);
  const sourceTargetConnections = crossSheetIdentityTokens;
  return {
    observations: Number(exception.observations ?? 0),
    titleBlockBuildingCode,
    servedAreas,
    loopOwnership,
    crossSheetIdentityTokens,
    sourceTargetConnections,
    weakEvidenceOnly: false,
  };
};

// The full treated inventory = exceptions freshly derived from the pending
// corpus UNION any exception_key that already has an ACTIVE adjudication row
// (re-runs converge the same 12 unique exceptions with stable counts; a
// pending-only view would shrink after the primary cases are approved).
const mergeActiveAdjudicationExceptions = (pendingInventory, activeRows) => {
  const byKey = new Map(pendingInventory.exceptions.map((e) => [e.exceptionKey, e]));
  for (const row of activeRows) {
    if (byKey.has(row.exception_key)) continue;
    byKey.set(row.exception_key, {
      exceptionKey: row.exception_key,
      exceptionType: row.exception_type,
      factType: row.exception_type === "CROSS_SHEET_REFERENCE" ? "CROSS_SHEET_REFERENCE" : "PANEL_EXISTS",
      subject: row.exception_type === "GENERIC_FACP_IDENTITY" ? "FACP" : null,
      sourceDrawingNumber: row.source_drawing_number ?? null,
      referencedDrawingNumber: row.canonical_target_drawing_number_raw ?? null,
      buildingCode: row.building_code ?? null,
      observations: row.evidence_observations_count ?? null,
      sourceReviewCaseIds: parse(row.review_case_ids, []),
      sourceFragmentIds: [],
      recordTypes: [row.exception_type],
      noteText: row.evidence_summary ? (parse(row.evidence_summary, {})?.noteText ?? null) : null,
      sourceSheetName: row.source_drawing_name ?? null,
    });
  }
  return [...byKey.values()];
};

// ACTIVE adjudication rows for a project (superseded history excluded). The
// governed table may not exist yet (live dry-runs run before migration 0079
// applies) -- on a missing table there are simply no active rows.
const activeAdjudicationRows = async (db, projectId) => {
  try {
    return (await db.prepare("SELECT * FROM drawing_architecture_exception_adjudications WHERE project_id=? AND superseded_at IS NULL").bind(projectId).all()).results || [];
  } catch {
    return [];
  }
};

const adjudicateCorpus = async ({ db, project, mutate = false, requestId = null }) => {
  const projectId = project.id;
  const records = await pendingCaseRecords(db, project);
  const pendingInventory = normalizeExceptionInventory({ records });
  const register = await registeredDrawingRegister(db, projectId);
  const corpusCounts = corpusCountsFor(records);

  // Active adjudication rows (first run: none; re-runs: the earlier decision
  // set -- used for stable recompute counts and raw-subject preservation).
  const activeRows = await activeAdjudicationRows(db, projectId);
  const activeByKey = new Map(activeRows.map((r) => [r.exception_key, r]));
  const inventory = { ...pendingInventory, exceptions: mergeActiveAdjudicationExceptions(pendingInventory, activeRows) };
  const recordById = new Map(records.map((r) => [r.id, r]));

  const decisions = [];
  for (const exception of pendingInventory.exceptions) {
    let entry = { exception, decision: null };
    // Preserve the RAW subject/relation/object verbatim from its source review
    // case (never "fixed", never re-authored).
    const primary = recordById.get(exception.sourceReviewCaseIds?.[0]);
    exception.rawSubject = (primary?.subject ?? primary?.object ?? exception.subject ?? exception.referencedDrawingNumber ?? "") ?? "";
    exception.rawRelation = primary?.relation ?? null;
    exception.rawObject = primary?.object ?? exception.object ?? null;
    if (exception.exceptionType === "CROSS_SHEET_REFERENCE") {
      entry.decision = adjudicateCrossSheetReference({ exception, evidence: { register, corpusCounts, noteText: exception.noteText ?? null } });
    } else if (exception.exceptionType === "GENERIC_FACP_IDENTITY") {
      const evidence = await facpEvidenceFor(db, projectId, exception);
      entry.decision = adjudicateGenericFacp({ exception, evidence });
    }
    if (entry.decision) decisions.push(entry);
  }

  // Recomputed status over the FULL treated inventory (pending-derived +
  // previously-adjudicated) so architecture status is stable across re-runs.
  // Every exception must carry a decision state: the fresh decision when the
  // exception is pending-derived, else its ACTIVE adjudication row's state
  // (primary cases already approved on a first apply are not pending again).
  const canonicalAdjudications = [];
  for (const exception of inventory.exceptions) {
    const fresh = decisions.find((d) => d.exception.exceptionKey === exception.exceptionKey);
    if (fresh) { canonicalAdjudications.push({ exceptionKey: exception.exceptionKey, decisionState: fresh.decision.decisionState }); continue; }
    const active = activeByKey.get(exception.exceptionKey);
    if (active) canonicalAdjudications.push({ exceptionKey: exception.exceptionKey, decisionState: active.decision_state });
  }
  // The canonical adjudication set is order-independent state: sort by key so
  // the readiness evidence fingerprint is stable across re-runs regardless of
  // pending-record iteration order (idempotent readiness persistence).
  canonicalAdjudications.sort((a, b) => (a.exceptionKey < b.exceptionKey ? -1 : a.exceptionKey > b.exceptionKey ? 1 : 0));
  const status = recomputeArchitectureStatus({ exceptions: inventory.exceptions, adjudications: canonicalAdjudications });

  const confirmed = decisions.filter((d) => d.decision.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_PROJECT_REFERENCE || d.decision.decisionState === EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_SAME_PANEL);
  const primaryCaseIds = [];
  for (const { exception, decision } of confirmed) {
    // The primary review case of the exception is the record whose fact type
    // matches the exception itself (CROSS_SHEET_REFERENCE / PANEL_EXISTS). The
    // mirrored ARCHITECTURE_DISCREPANCY folds into the same exception and is
    // resolved by it, but never becomes a separate approved row.
    const target = records.find((r) => exception.sourceReviewCaseIds.includes(r.id) && r.factType === (exception.exceptionType === "CROSS_SHEET_REFERENCE" ? "CROSS_SHEET_REFERENCE" : "PANEL_EXISTS"));
    if (target) primaryCaseIds.push(target.id);
  }
  // Mirrored ARCHITECTURE_DISCREPANCY records resolved through their reference
  // exception (one per unique source drawing in the pending corpus).
  const mirroredDiscrepancyResolved = new Set(records.filter((r) => r.factType === "ARCHITECTURE_DISCREPANCY").map((r) => r.sourceDrawingNumber ?? r.id)).size;

  let promotion = null;
  if (mutate) {
    // 1) Persist adjudication rows: supersede an ACTIVE row only when the new
    //    decision differs; never duplicate, never delete -- history kept.
    let created = 0, superseded = 0, unchanged = 0;
    for (const entry of decisions) {
      const existing = await db.prepare("SELECT id,decision_fingerprint FROM drawing_architecture_exception_adjudications WHERE project_id=? AND exception_key=? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(projectId, entry.exception.exceptionKey).first();
      const fingerprint = await digest({ exceptionKey: entry.exception.exceptionKey, decisionState: entry.decision.decisionState, decisionReasons: entry.decision.decisionReasons, canonicalTargetDrawingNumber: entry.decision.canonicalTargetDrawingNumber ?? entry.decision.canonicalPanelIdentity ?? null });
      if (existing && existing.decision_fingerprint === fingerprint) { unchanged++; continue; }
      if (existing) {
        await db.prepare("UPDATE drawing_architecture_exception_adjudications SET superseded_at=CURRENT_TIMESTAMP,superseding_adjudication_id=? WHERE id=? AND superseded_at IS NULL").bind(await id("adjudication"), existing.id).run();
        superseded++;
      }
      await insertAdjudicationRow(db, projectId, entry, fingerprint, requestId);
      created++;
    }
    // 2) Approve the primary review case of each CONFIRMED exception (system
    //    architecture evaluation actor; decision recorded with provenance).
    let approved = 0;
    const approvals = [];
    for (const entry of confirmed) {
      const target = records.find((r) => entry.exception.sourceReviewCaseIds.includes(r.id) && r.factType === (entry.exception.exceptionType === "CROSS_SHEET_REFERENCE" ? "CROSS_SHEET_REFERENCE" : "PANEL_EXISTS"));
      if (!target) continue;
      const reason = `Architecture exception adjudication: ${entry.decision.decisionState} (${entry.decision.decisionReasons.join(", ")}) ${entry.decision.decisionPolicyVersion}`;
      const result = await db.prepare("UPDATE drawing_architecture_review_cases SET status='Approved',decision_state=?,decision_reason=?,decision_policy_version=?,case_version=case_version+1,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Needs Review'").bind(entry.decision.decisionState, JSON.stringify(entry.decision.decisionReasons), entry.decision.decisionPolicyVersion, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR, reason, target.id).run();
      if (Number(result?.meta?.changes ?? 0) > 0) { approved++; approvals.push(target.id); }
    }
    // 3) Promote the next approved version now that primary cases are approved
    //    (verified-current-only currency guard; idempotent on fingerprint).
    const governedLegendRows = await governedLegendRowsFor(db, project.id);
    const context = await currentEvidenceContext(db, project.id, governedLegendRows);
    const docs = await projectArchitectureDocuments(db, project.id);
    const currentIntakeIdByDocument = new Map(docs.map((d) => [d.document_id, d.intake_id]));
    const approvedRows = (await db.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? AND status='Approved'").bind(project.id).all()).results || [];
    const verifiedCurrentCaseIds = [];
    for (const ar of approvedRows) {
      const stored = parse(ar.current_snapshot, {}) || {};
      const fp = stored.initializationProvenance?.evidenceFingerprint ?? ar.evidence_fingerprint ?? null;
      const currentIntake = currentIntakeIdByDocument.get(ar.document_id) ?? ar.drawing_intake_version_id;
      const currentFp = context.fingerprintByIntake.get(ar.drawing_intake_version_id) ?? null;
      if (ar.drawing_intake_version_id === currentIntake && fp && currentFp && fp === currentFp) verifiedCurrentCaseIds.push(ar.id);
    }
    if (verifiedCurrentCaseIds.length) {
      promotion = await promoteApprovedArchitectureVersion({
        db, project, verifiedCurrentCaseIds, actorId: SYSTEM_ARCHITECTURE_EVALUATION_ACTOR,
        reason: `Canonical promotion of ${approved} architecture exceptions resolved by governed exception adjudication (${ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION}).`,
        requestId,
      });
    }
    // 4) Persist / supersede the governed Stage-4 readiness row (approved facts
    //    are read AFTER promotion so prior/next are authoritative; the
    //    readiness fingerprint is anchored on the stable 12-exception
    //    canonical adjudication set so re-runs are idempotent).
    const readiness = {
      architectureStatus: status.after.architectureStatus,
      stage4Readiness: status.after.stage4Readiness,
      stage4BlockingClassSummary: status.after.stage4BlockingCount > 0 ? "STAGE4_BLOCKING" : "NONBLOCKING_DRAWING_REVIEW",
      uniqueExceptionCount: inventory.exceptions.length,
      crossSheetReferenceCount: inventory.exceptions.filter((e) => e.exceptionType === "CROSS_SHEET_REFERENCE").length,
      genericFacpCount: inventory.exceptions.filter((e) => e.exceptionType === "GENERIC_FACP_IDENTITY").length,
      remainingEngineerReviewRequired: status.after.engineerReviewExceptionCount,
      remainingConfirmProjectReference: inventory.exceptions.filter((e) => e.exceptionType === "CROSS_SHEET_REFERENCE").length,
      remainingConfirmSamePanel: inventory.exceptions.filter((e) => e.exceptionType === "GENERIC_FACP_IDENTITY").length,
      resolvedCount: status.after.resolvedExceptionCount,
      mirroredDiscrepancyResolved,
      staleCount: 0,
      realArchitectureConflictRemaining: 0,
    };
    const approvedVersion = await db.prepare("SELECT approved_fact_count,version_number FROM drawing_architecture_approved_versions WHERE project_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(projectId).first();
    readiness.approvedPriorRowCount = Math.max(Number(approvedVersion?.approved_fact_count ?? 0) - approved, 0);
    readiness.approvedNextRowCount = Number(approvedVersion?.approved_fact_count ?? 0);
    readiness.approvedNextVersionNumber = Number(approvedVersion?.version_number ?? 0);
    const policyVersion = ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION;
    const evidenceFingerprint = await digest({ projectId, adjudications: canonicalAdjudications });
    const priorReadiness = await db.prepare("SELECT * FROM drawing_architecture_stage4_readiness WHERE project_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(projectId).first();
    // The readiness identity is the governed STATE (status + counts + the
    // canonical adjudication set); promotion facts (approved prior/next) are
    // run-context captured on the row but never part of the identity, so a
    // re-run that changes nothing is idempotent (no new row).
    const readinessFingerprint = await digest({
      architectureStatus: readiness.architectureStatus,
      stage4Readiness: readiness.stage4Readiness,
      stage4BlockingClassSummary: readiness.stage4BlockingClassSummary,
      uniqueExceptionCount: readiness.uniqueExceptionCount,
      crossSheetReferenceCount: readiness.crossSheetReferenceCount,
      genericFacpCount: readiness.genericFacpCount,
      remainingEngineerReviewRequired: readiness.remainingEngineerReviewRequired,
      remainingConfirmProjectReference: readiness.remainingConfirmProjectReference,
      remainingConfirmSamePanel: readiness.remainingConfirmSamePanel,
      resolvedCount: readiness.resolvedCount,
      mirroredDiscrepancyResolved: readiness.mirroredDiscrepancyResolved,
      staleCount: readiness.staleCount,
      realArchitectureConflictRemaining: readiness.realArchitectureConflictRemaining,
      policyVersion,
      evidenceFingerprint,
    });
    let readinessRow = null;
    if (priorReadiness && priorReadiness.evidence_fingerprint === readinessFingerprint) {
      readinessRow = { id: priorReadiness.id, idempotent: true };
    } else {
      if (priorReadiness) await db.prepare("UPDATE drawing_architecture_stage4_readiness SET superseded_at=CURRENT_TIMESTAMP,superseding_readiness_id=? WHERE id=? AND superseded_at IS NULL").bind(await id("stage4Readiness"), priorReadiness.id).run();
      const readinessId = await id("stage4Readiness");
      await db.prepare(`INSERT INTO drawing_architecture_stage4_readiness
        (id,project_id,version_number,architecture_status,stage4_readiness,stage4_blocking_class_summary,
         unique_exception_count,cross_sheet_reference_count,generic_facp_count,remaining_engineer_review_required,
         remaining_confirm_project_reference,remaining_confirm_same_panel,resolved_count,mirrored_discrepancy_resolved,
         stale_count,real_architecture_conflict_remaining,approved_prior_row_count,approved_next_row_count,
         approved_next_version_number,policy_version,computed_by,evidence_fingerprint,reason,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
        .bind(readinessId, projectId, Number((priorReadiness?.version_number ?? 0)) + 1, readiness.architectureStatus, readiness.stage4Readiness, readiness.stage4BlockingClassSummary,
          readiness.uniqueExceptionCount, readiness.crossSheetReferenceCount, readiness.genericFacpCount, readiness.remainingEngineerReviewRequired,
          readiness.remainingConfirmProjectReference, readiness.remainingConfirmSamePanel, readiness.resolvedCount, readiness.mirroredDiscrepancyResolved,
          readiness.staleCount, readiness.realArchitectureConflictRemaining, readiness.approvedPriorRowCount, readiness.approvedNextRowCount,
          readiness.approvedNextVersionNumber, policyVersion, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR, readinessFingerprint,
          `Step 14.8 adjudication: ${readiness.uniqueExceptionCount} unique exceptions (${readiness.crossSheetReferenceCount} cross-sheet + ${readiness.genericFacpCount} generic FACP) resolved -> ${readiness.architectureStatus} / ${readiness.stage4Readiness}.`).run();
      readinessRow = { id: readinessId, idempotent: false };
    }
    return {
      projectId,
      dryRun: false,
      records: records.length,
      inventory,
      adjudications: decisions.map((d) => ({
        exceptionKey: d.exception.exceptionKey,
        exceptionType: d.exception.exceptionType,
        sourceDrawingNumber: d.exception.sourceDrawingNumber,
        referencedDrawingNumber: d.exception.referencedDrawingNumber ?? null,
        buildingCode: d.exception.buildingCode ?? null,
        decision: d.decision,
      })),
      status,
      persistence: { created, superseded, unchanged, approvedPrimaryCases: approved, primaryCaseIds: approvals, readiness: readinessRow },
      promotion,
    };
  }
  return {
    projectId,
    dryRun: true,
    records: records.length,
    inventory,
    adjudications: decisions.map((d) => ({
      exceptionKey: d.exception.exceptionKey,
      exceptionType: d.exception.exceptionType,
      sourceDrawingNumber: d.exception.sourceDrawingNumber,
      referencedDrawingNumber: d.exception.referencedDrawingNumber ?? null,
      buildingCode: d.exception.buildingCode ?? null,
      decision: d.decision,
    })),
    status,
    persistence: { created: null, superseded: null, unchanged: null, approvedPrimaryCases: confirmed.length, primaryCaseIds, readiness: null },
    promotion,
  };
};

const insertAdjudicationRow = async (db, projectId, entry, fingerprint, requestId) => {
  const exception = entry.exception;
  const decision = entry.decision;
  const canonicalPanel = decision.canonicalPanelIdentity ?? null;
  await db.prepare(`INSERT INTO drawing_architecture_exception_adjudications
    (id,project_id,exception_key,exception_type,raw_subject,raw_relation,raw_object,raw_drawing_number,building_code,
     source_drawing_number,source_drawing_name,decision_state,decision_reasons,decision_policy_version,decision_actor,
     decision_fingerprint,canonical_target_drawing_number,canonical_target_document_id,canonical_target_drawing_number_raw,
     canonical_building_asset_code,canonical_building_name,canonical_panel_identity,stage4_blocking_class,
     evidence_observations_count,evidence_fingerprint,evidence_summary,review_case_ids,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(await id("adjudication"), projectId, exception.exceptionKey, exception.exceptionType, exception.rawSubject ?? exception.subject ?? "", exception.rawRelation ?? exception.relation ?? null, exception.rawObject ?? exception.object ?? null,
      exception.sourceDrawingNumber ?? "", exception.buildingCode ?? "", exception.sourceDrawingNumber ?? "", exception.sourceSheetName ?? null,
      decision.decisionState, JSON.stringify(decision.decisionReasons ?? []), decision.decisionPolicyVersion, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR,
      fingerprint, decision.canonicalTargetDrawingNumber ?? null, decision.canonicalTargetDocumentId ?? null, exception.referencedDrawingNumber ?? null,
      exception.buildingCode ?? null, null, canonicalPanel, decision.stage4BlockingClass ?? STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW,
      exception.observations ?? null, await digest({ exceptionKey: exception.exceptionKey, decisionState: decision.decisionState }),
      JSON.stringify(decision.evidenceSummary ?? {}), JSON.stringify(exception.sourceReviewCaseIds ?? []), SYSTEM_ARCHITECTURE_EVALUATION_ACTOR).run();
};

export const loadAdjudications = async (db, project, includeSuperseded = false) => {
  const rows = (await db.prepare(`SELECT * FROM drawing_architecture_exception_adjudications WHERE project_id=?${includeSuperseded ? "" : " AND superseded_at IS NULL"} ORDER BY exception_key,created_at`).bind(project.id).all()).results || [];
  return rows.map((r) => ({
    id: r.id,
    exceptionKey: r.exception_key,
    exceptionType: r.exception_type,
    sourceDrawingNumber: r.source_drawing_number,
    decisionState: r.decision_state,
    decisionReasons: parse(r.decision_reasons, []),
    decisionPolicyVersion: r.decision_policy_version,
    decisionActor: r.decision_actor,
    canonicalTargetDrawingNumber: r.canonical_target_drawing_number,
    canonicalTargetDrawingNumberRaw: r.canonical_target_drawing_number_raw,
    canonicalBuildingAssetCode: r.canonical_building_asset_code,
    canonicalPanelIdentity: r.canonical_panel_identity,
    stage4BlockingClass: r.stage4_blocking_class,
    reviewCaseIds: parse(r.review_case_ids, []),
    createdBy: r.created_by,
    createdAt: r.created_at,
    supersededAt: r.superseded_at,
  }));
};

export const loadReadinessRow = async (db, project, includeSuperseded = false) =>
  (await db.prepare(`SELECT * FROM drawing_architecture_stage4_readiness WHERE project_id=?${includeSuperseded ? "" : " AND superseded_at IS NULL"} ORDER BY version_number DESC,created_at DESC`).bind(project.id).all()).results || [];

// SCOPED HUMAN CONFIRMATION of exactly one staged architecture fact.
//
// The deterministic evaluation path is BULK: it confirms every staged fact whose
// evidence passes policy. That is correct for a machine pass and the wrong tool
// for a human decision that covers one symbol on named sheets, so this action
// exists for the scoped case. It deliberately:
//   * requires an explicit caseId (never "every eligible fact"),
//   * refuses a case belonging to another project,
//   * refuses a case whose intake, document version or evidence fingerprint is no
//     longer current,
//   * reuses the SAME deterministic policy for eligibility (a human may
//     authorise a fact, never invent one),
//   * writes exactly one case row plus one audit event,
//   * republishes the canonical approved version for the VERIFIED CURRENT approved
//     set, so one scoped confirmation never truncates facts already governed.
const confirmArchitectureCase = async ({ request, env, project, requestId }) => {
  const human = requireHumanActor(env);
  if (human.error) return { status: 403, error: { code: human.error, message: human.message } };
  const body = await request.json().catch(() => ({}));
  const caseId = String(body.caseId || "").trim();
  const reason = String(body.reason || "").trim();
  if (!caseId) return { status: 422, error: { code: "ARCHITECTURE_CASE_ID_REQUIRED", message: "Name exactly one architecture review case to confirm." } };
  if (reason.length < 5) return { status: 422, error: { code: "ARCHITECTURE_REVIEW_REASON_REQUIRED", message: "Provide a substantive review reason." } };

  const row = await env.DB.prepare("SELECT * FROM drawing_architecture_review_cases WHERE id=? AND project_id=?").bind(caseId, project.id).first();
  if (!row) return { status: 404, error: { code: "ARCHITECTURE_REVIEW_CASE_NOT_FOUND", message: "Architecture review case not found for this project." } };

  const governedLegendRows = await governedLegendRowsFor(env.DB, project.id);
  const context = await currentEvidenceContext(env.DB, project.id, governedLegendRows);
  const docs = await projectArchitectureDocuments(env.DB, project.id);
  const currentIntakeIdByDocument = new Map(docs.map((doc) => [doc.document_id, doc.intake_id]));
  const currentIntake = currentIntakeIdByDocument.get(row.document_id) ?? row.drawing_intake_version_id;
  if (row.drawing_intake_version_id !== currentIntake) {
    return { status: 409, error: { code: "ARCHITECTURE_CASE_STALE_INTAKE", message: "The case evidence is not the document's current Completed intake." } };
  }
  const document = await env.DB.prepare("SELECT current_version_id FROM documents WHERE id=?").bind(row.document_id).first();
  if (document && document.current_version_id && document.current_version_id !== row.document_version_id) {
    return { status: 409, error: { code: "ARCHITECTURE_CASE_STALE_DOCUMENT_VERSION", message: "The case is bound to a superseded document version." } };
  }
  const snapshot = parse(row.current_snapshot, {}) || {};
  const storedFingerprint = snapshot.initializationProvenance?.evidenceFingerprint ?? row.evidence_fingerprint ?? null;
  const currentFingerprint = context.fingerprintByIntake.get(row.drawing_intake_version_id) ?? null;
  if (!storedFingerprint || !currentFingerprint || storedFingerprint !== currentFingerprint) {
    return { status: 409, error: { code: "ARCHITECTURE_CASE_STALE_EVIDENCE", message: "The evidence fingerprint changed; re-initialize before confirming." } };
  }

  const decision = decideArchitectureFact({
    fact: { ...snapshot, source: snapshot.source ?? null, identity: snapshot.identity ?? {}, assignment: snapshot.assignment ?? null, resolution: snapshot.resolution ?? null, crossSheetIdentity: snapshot.crossSheetIdentity ?? null },
    source: { fact: snapshot, intake: { id: row.drawing_intake_version_id, status: "Completed", supersededAt: null }, currentIntakeId: currentIntake, documentCurrentVersionId: row.document_version_id },
    stored: { evidenceFingerprint: storedFingerprint, caseVersion: row.case_version, status: row.status, reviewedBy: row.reviewed_by },
    current: { evidenceFingerprint: currentFingerprint },
    assignment: snapshot.assignment ?? null,
    resolution: snapshot.resolution ?? null,
  });
  if (!decision.eligible) {
    return { status: 422, error: { code: "ARCHITECTURE_FACT_NOT_CONFIRMABLE", message: `${decision.state}: ${(decision.decisionReasons || []).join(", ")}` } };
  }

  if (row.status === "Approved" && row.decision_state === decision.state) {
    return { caseId: row.id, status: "Approved", decisionState: decision.state, factType: row.fact_type, subject: row.subject, object: row.object, idempotent: true, confirmedBy: row.reviewed_by };
  }

  const version = Number(row.case_version) + 1;
  const decisionReason = `Scoped human confirmation: ${decision.state} (${decision.decisionReasons.join(", ")}) ${decision.decisionPolicyVersion}. ${reason}`;
  await env.DB.batch([
    env.DB.prepare("UPDATE drawing_architecture_review_cases SET status='Approved',decision_state=?,decision_reason=?,decision_policy_version=?,case_version=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND case_version=?").bind(decision.state, JSON.stringify(decision.decisionReasons), decision.decisionPolicyVersion, version, human.actor.id, reason, row.id, row.case_version),
    env.DB.prepare("INSERT INTO drawing_architecture_review_events (id,project_id,document_id,drawing_intake_version_id,review_case_id,action,previous_snapshot,new_snapshot,reason,actor_user_id,actor_permission,request_id,case_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id("architectureReviewEvent"), project.id, row.document_id, row.drawing_intake_version_id, row.id, "confirm-case", JSON.stringify({ status: row.status, decisionState: row.decision_state, snapshot }), JSON.stringify({ status: "Approved", decisionState: decision.state, snapshot }), reason, human.actor.id, "Administrator", requestId, version),
  ]);

  // Republish for the VERIFIED CURRENT approved set (this case plus whatever is
  // already governed), so a scoped confirmation cannot truncate history.
  const approvedRows = (await env.DB.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? AND status='Approved'").bind(project.id).all()).results || [];
  const verifiedCurrentCaseIds = [];
  for (const approved of approvedRows) {
    const approvedSnapshot = parse(approved.current_snapshot, {}) || {};
    const approvedFingerprint = approvedSnapshot.initializationProvenance?.evidenceFingerprint ?? approved.evidence_fingerprint ?? null;
    const approvedCurrentIntake = currentIntakeIdByDocument.get(approved.document_id) ?? approved.drawing_intake_version_id;
    const approvedCurrentFingerprint = context.fingerprintByIntake.get(approved.drawing_intake_version_id) ?? null;
    if (approved.drawing_intake_version_id === approvedCurrentIntake && approvedFingerprint && approvedCurrentFingerprint && approvedFingerprint === approvedCurrentFingerprint) verifiedCurrentCaseIds.push(approved.id);
  }
  const promotion = await promoteApprovedArchitectureVersion({
    db: env.DB,
    project,
    verifiedCurrentCaseIds: verifiedCurrentCaseIds.length ? verifiedCurrentCaseIds : null,
    actorId: human.actor.id,
    reason: `Scoped promotion of one human-confirmed architecture fact (${row.fact_type} ${row.subject}). ${reason}`,
    requestId,
  });

  return { caseId: row.id, status: "Approved", decisionState: decision.state, factType: row.fact_type, subject: row.subject, relation: row.relation, object: row.object, documentId: row.document_id, documentVersionId: row.document_version_id, drawingIntakeVersionId: row.drawing_intake_version_id, confirmedBy: human.actor.id, idempotent: false, promotion };
};

export const handleDrawingArchitectureReviewApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("drawing-architecture/review") && !url.pathname.includes("drawing-architecture/approved") && !url.pathname.includes("drawing-architecture/adjudication") && !url.pathname.includes("drawing-architecture/readiness") && !url.pathname.includes("drawing-architecture/bridge")) return null;
  if (!env.DB) return json({ error: { code: "ARCHITECTURE_REVIEW_UNAVAILABLE", message: "Architecture review storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const route = url.pathname.match(/^\/api\/projects\/([^/]+)\/drawing-architecture\/(review|approved|adjudication|readiness|bridge)(?:\/(initialize|evaluate|deterministic-confirm|confirm-case|current|history|apply))?$/);
  if (!route) return json({ error: { code: "ARCHITECTURE_REVIEW_API_NOT_FOUND", message: "Architecture review operation not found." } }, 404);
  const project = await ownedProject(env.DB, decodeURIComponent(route[1]), user.id, user.organizationId);
  if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
  try {
    if (route[2] === "review" && route[3] === "initialize") {
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
      const governedLegendRows = await governedLegendRowsFor(env.DB, project.id);
      const result = await initialize(env.DB, project, governedLegendRows);
      return json({ ...result, operation: "initialize" });
    }
    if (route[2] === "review" && route[3] === "confirm-case" && request.method === "POST") {
      const scopedRequestId = request?.headers?.get?.("x-request-id") || id("request");
      const scoped = await confirmArchitectureCase({ request, env, project, requestId: scopedRequestId });
      if (scoped.error) return json({ error: scoped.error }, scoped.status || 422);
      return json({ ...scoped, operation: "review/confirm-case" });
    }
    if (route[2] === "review" && route[3] === "evaluate") {
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
      const result = await evaluateArchitectureFacts(request, env, project, false);
      return json({ ...result, operation: "evaluate-dry-run" });
    }
    if (route[2] === "review" && route[3] === "deterministic-confirm") {
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
      const result = await evaluateArchitectureFacts(request, env, project, true);
      return json({ ...result, operation: "deterministic-confirm" });
    }
    if (route[2] === "review" && !route[3]) {
      const cases = await loadReview(env.DB, project);
      return json({ projectId: project.id, total: cases.length, cases, operation: "review" });
    }
    if (route[2] === "approved" && (route[3] === "current" || !route[3])) {
      const current = await loadApprovedVersion(env.DB, project);
      return json({ projectId: project.id, current, operation: "approved-current" });
    }
    if (route[2] === "approved" && route[3] === "history") {
      const history = await loadApprovedHistory(env.DB, project);
      return json({ projectId: project.id, history, operation: "approved-history" });
    }
    if (route[2] === "adjudication" && route[3] === "evaluate") {
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
      const result = await adjudicateCorpus({ db: env.DB, project, mutate: false });
      return json({ ...result, operation: "adjudication-evaluate-dry-run" });
    }
    if (route[2] === "adjudication" && route[3] === "apply") {
      if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
      const requestId = request?.headers?.get?.("x-request-id") || id("request");
      const result = await adjudicateCorpus({ db: env.DB, project, mutate: true, requestId });
      return json({ ...result, operation: "adjudication-apply" });
    }
    if (route[2] === "adjudication" && (route[3] === "current" || !route[3])) {
      const adjudications = await loadAdjudications(env.DB, project);
      const readiness = await loadReadinessRow(env.DB, project);
      return json({ projectId: project.id, adjudications, readiness, operation: "adjudication-current" });
    }
    if (route[2] === "adjudication" && route[3] === "history") {
      const adjudications = await loadAdjudications(env.DB, project, true);
      const readiness = await loadReadinessRow(env.DB, project, true);
      return json({ projectId: project.id, adjudications, readiness, operation: "adjudication-history" });
    }
    if (route[2] === "readiness" && (route[3] === "current" || !route[3])) {
      const readiness = await loadReadinessRow(env.DB, project);
      const currentApprovedVersion = await loadApprovedVersion(env.DB, project);
      const pending = (await env.DB.prepare("SELECT count(*) count FROM drawing_architecture_review_cases WHERE project_id=? AND status='Needs Review'").bind(project.id).first())?.count || 0;
      return json({
        projectId: project.id,
        status: readiness[0] || null,
        pendingCaseCount: pending,
        currentApprovedVersion,
        operation: "readiness-current",
      });
    }
    if (route[2] === "readiness" && route[3] === "history") {
      const readiness = await loadReadinessRow(env.DB, project, true);
      return json({ projectId: project.id, readiness, operation: "readiness-history" });
    }
    if (route[2] === "bridge" && !route[3]) {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
      const [approvedVersion, adjudications, readinessRows, unresolved] = await Promise.all([
        loadApprovedVersion(env.DB, project),
        loadAdjudications(env.DB, project),
        loadReadinessRow(env.DB, project),
        env.DB.prepare("SELECT * FROM drawing_architecture_review_cases WHERE project_id=? AND status <> 'Approved' AND superseded_at IS NULL ORDER BY id").bind(project.id).all(),
      ]);
      const bridge = buildDrawingArchitectureBridge({
        approvedVersion,
        adjudications,
        readinessRow: readinessRows[0] || null,
        unresolvedCases: (unresolved.results || []),
      });
      return json({
        projectId: project.id,
        bridge,
        consumedBy: "Stage 4 project-evidence context (panel identity / circuit-bus / network / interface / reference resolution). Read by Stage 4 context consumers only; NEVER fed to product-compatibility matching.",
        operation: "bridge",
      });
    }
    return json({ error: { code: "ARCHITECTURE_REVIEW_OPERATION_UNKNOWN", message: "Unknown architecture review operation." } }, 404);
  } catch (error) {
    return json({ error: { code: "ARCHITECTURE_REVIEW_FAILED", message: error?.message || "Architecture review failed." } }, 500);
  }
};