// CROSS-SHEET GOVERNED OCCURRENCE EVIDENCE LOADER (worker layer).
//
// Reads ONLY governed, project-scoped, current rows and hands them to the pure
// domain resolver. It performs no decision of its own: if any eligibility
// condition fails, the domain module refuses the handoff and this loader
// reports that refusal verbatim.
//
// Field occurrences are re-derived through the CANONICAL occurrence path
// (`buildOccurrenceEvidenceFromAssets`) from persisted intake assets, with the
// governed legend-definition symbols excluded. Nothing is written here.
import { buildOccurrenceEvidenceFromAssets } from "../app/domain/drawing-occurrence-evidence.mjs";
import { resolveLegendApplicability, buildLegendDictionary } from "../app/domain/drawing-intelligence.mjs";
import { resolveCrossSheetGovernedQuantityEvidence, CROSS_SHEET_EVIDENCE_MODE } from "../app/domain/drawing-cross-sheet-quantity-evidence.mjs";

const currentIntakeFor = async (db, documentId) => (await db.prepare(
  "SELECT * FROM drawing_intake_versions WHERE document_id=? AND status='Completed' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
).bind(documentId).first()) || null;

// Governed legend definitions: rows promoted into a CURRENT approved structure
// version. This is the same table the architecture review already treats as
// governed legend identity.
const governedLegendDefinitions = async (db, projectId) => {
  const versions = (await db.prepare(
    "SELECT * FROM drawing_structure_approved_versions WHERE project_id=? AND superseded_at IS NULL AND status='Approved' ORDER BY version_number DESC",
  ).bind(projectId).all()).results || [];
  const definitions = [];
  for (const version of versions) {
    const rows = (await db.prepare(
      "SELECT * FROM drawing_structure_approved_rows WHERE approved_version_id=? AND abbreviation IS NOT NULL AND trim(abbreviation)<>''",
    ).bind(version.id).all()).results || [];
    for (const row of rows) {
      definitions.push({
        token: String(row.abbreviation || "").trim(),
        description: String(row.description || "").trim(),
        legendDocumentId: version.document_id,
        legendApprovedVersionId: version.id,
        // The approval provenance records the exact symbol asset that defines
        // this symbol; that membership is what excludes a legend definition
        // from field occurrence detection.
        symbolAssetId: /symbol=([A-Za-z0-9_-]+)/.exec(String(row.notes || ""))?.[1] ?? null,
        reviewActorId: row.review_actor_id ?? null,
        sourcePage: row.source_page ?? null,
        sourceRow: row.source_row ?? null,
      });
    }
  }
  return definitions;
};

// Governed cross-sheet applicability: approved architecture facts in a CURRENT
// approved architecture version. A fact that is not in the current version is
// history, not authority.
const governedApplicabilityFacts = async (db, projectId) => {
  const versions = (await db.prepare(
    "SELECT * FROM drawing_architecture_approved_versions WHERE project_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
  ).bind(projectId).all()).results || [];
  const version = versions[0] || null;
  if (!version) return [];
  const rows = (await db.prepare(
    "SELECT * FROM drawing_architecture_approved_rows WHERE approved_version_id=? AND fact_type='LAYOUT_LEGEND_LINK' AND relation='MATCHES_GOVERNED_LEGEND'",
  ).bind(version.id).all()).results || [];
  return rows.map((row) => ({
    id: row.id,
    token: String(row.subject || "").trim(),
    object: String(row.object || "").trim(),
    targetDocumentId: row.document_id,
    targetDocumentVersionId: row.document_version_id,
    targetIntakeVersionId: row.drawing_intake_version_id,
    approvedArchitectureVersionId: version.id,
    reviewActorId: row.review_actor_id ?? null,
    sourceDrawingNumber: row.source_drawing_number ?? null,
  }));
};

const governedDrawingNumber = async (db, intakeId) => {
  if (!intakeId) return { drawingNumber: null, governed: false };
  const row = await db.prepare("SELECT drawing_number, review_status FROM drawing_metadata WHERE intake_version_id=?").bind(intakeId).first();
  const drawingNumber = String(row?.drawing_number || "").trim();
  return { drawingNumber: drawingNumber || null, governed: drawingNumber !== "" && row?.review_status === "Approved" };
};

const intakeAssets = async (db, intakeId) => (await db.prepare(
  "SELECT a.id, a.text_content, a.bounding_box, a.page_id, p.page_number FROM drawing_assets a JOIN drawing_pages p ON p.id=a.page_id WHERE a.intake_version_id=? ORDER BY p.page_number",
).bind(intakeId).all()).results || [];

/**
 * Load and evaluate the cross-sheet handoff for one legend document.
 * Returns { ok:true, handoff } or { ok:false, failedConditions }.
 */
export const loadCrossSheetGovernedQuantityEvidence = async (db, { projectId, legendDocumentId }) => {
  const legendDocument = await db.prepare("SELECT * FROM documents WHERE id=?").bind(legendDocumentId).first();
  if (!legendDocument) return { ok: false, failedConditions: [{ condition: "LEGEND_SOURCE_CURRENT", detail: "legend document not found" }] };
  const legendIntake = await currentIntakeFor(db, legendDocumentId);
  const legendNumber = await governedDrawingNumber(db, legendIntake?.id ?? null);

  // The chain is rooted at the REQUESTED document. Serving it from any drawing
  // URL would imply that document is the legend source when it is not, so
  // definitions are scoped to this document and a sheet without a governed
  // legend definition fails closed instead.
  const definitions = (await governedLegendDefinitions(db, projectId))
    .filter((definition) => definition.legendDocumentId === legendDocumentId);
  const definitionTokens = new Set(definitions.map((definition) => definition.token));
  const applicability = (await governedApplicabilityFacts(db, projectId))
    .filter((fact) => definitionTokens.has(fact.token));

  const targetDocumentIds = [...new Set(applicability.map((fact) => fact.targetDocumentId))];
  const targets = [];
  const occurrenceEvidence = [];
  const coverage = [];
  const exclusions = [];
  const targetNumberById = new Map();

  for (const targetDocumentId of targetDocumentIds) {
    const document = await db.prepare("SELECT * FROM documents WHERE id=?").bind(targetDocumentId).first();
    const intake = await currentIntakeFor(db, targetDocumentId);
    const number = await governedDrawingNumber(db, intake?.id ?? null);
    targetNumberById.set(targetDocumentId, number);
    targets.push({
      documentId: targetDocumentId,
      documentVersionId: document?.current_version_id ?? null,
      drawingIntakeVersionId: intake?.id ?? null,
      drawingNumber: number.drawingNumber,
      drawingNumberGoverned: number.governed,
      currentIntakeCompleted: Boolean(intake),
    });

    if (!intake) continue;
    const assets = await intakeAssets(db, intake.id);
    const symbolMembership = definitions
      .filter((definition) => definition.legendDocumentId === targetDocumentId && definition.symbolAssetId)
      .map((definition) => ({ assetId: definition.symbolAssetId, token: definition.token }));
    // Applicability for this target comes from the governed fact itself, so the
    // occurrence engine records the governed authority rather than a guess.
    const facts = applicability.filter((fact) => fact.targetDocumentId === targetDocumentId);
    for (const fact of facts) {
      const resolution = resolveLegendApplicability({
        token: fact.token,
        targetDocumentId,
        targetDocumentVersionId: document?.current_version_id ?? null,
        dictionary: buildLegendDictionary({ entries: [{ token: fact.token, meaning: fact.object, sourceDocumentId: legendDocumentId, sourceDocumentVersionId: document?.current_version_id ?? null }] }),
        crossSheetRefs: [],
        architectureRows: [{ id: fact.id, subject: fact.token, relation: "MATCHES_GOVERNED_LEGEND", object: fact.object, document_id: targetDocumentId, document_version_id: fact.targetDocumentVersionId }],
      });
      const built = buildOccurrenceEvidenceFromAssets({
        assets,
        allTexts: assets,
        location: { projectId, documentId: targetDocumentId, documentVersionId: document?.current_version_id ?? null, sheet: document?.logical_name ?? null },
        resolution,
        governedLegendSymbols: symbolMembership,
      });
      for (const entry of built.accepted || []) {
        occurrenceEvidence.push({
          projectId,
          occurrenceId: (entry.source_object_ids || [])[0] ?? null,
          token: fact.token,
          documentId: targetDocumentId,
          documentVersionId: entry.document_version_id,
          intakeVersionId: intake.id,
          pageNumber: Number(((assets.find((asset) => asset.id === (entry.source_object_ids || [])[0]) || {}).page_number) ?? 0) || 1,
          boundingBox: entry.bbox ?? null,
          sourceAssetIds: entry.source_object_ids || [],
          identityAuthority: entry.identity_authority ?? null,
        });
      }
      exclusions.push(...(built.excludedNonPhysical || []).map((entry) => ({
        documentId: targetDocumentId,
        sourceAssetId: entry.assetId ?? null,
        reason: entry.reason,
        near: entry.near ?? null,
      })));
      if (built.coverage) coverage.push({ documentId: targetDocumentId, ...built.coverage });
    }
  }

  // The governed legend definitions live on the legend sheet itself, so their
  // symbols are excluded there rather than on a target sheet. Report that
  // exclusion explicitly: a reader must be able to SEE that the definition was
  // excluded, not infer it from a count.
  for (const definition of definitions) {
    if (!definition.symbolAssetId) continue;
    exclusions.push({
      documentId: definition.legendDocumentId,
      sourceAssetId: definition.symbolAssetId,
      reason: "GOVERNED_LEGEND_SYMBOL",
      near: definition.token,
    });
  }

  // Printed multiplicity ambiguity travels WITH the evidence and is never
  // interpreted here.
  const ambiguity = [];
  for (const target of targets) {
    const intake = await currentIntakeFor(db, target.documentId);
    if (!intake) continue;
    const labels = (await db.prepare(
      "SELECT COUNT(*) AS count FROM drawing_assets WHERE intake_version_id=? AND asset_type='Text' AND trim(text_content)='2 Nos'",
    ).bind(intake.id).first())?.count ?? 0;
    if (labels > 0) {
      ambiguity.push({
        documentId: target.documentId,
        label: "PRINTED_MULTIPLICITY_LABEL",
        printedLabel: "2 Nos",
        labelCount: labels,
        status: "AMBIGUOUS",
        interpretation: null,
        note: "A printed multiplicity label is present but no current-project evidence binds it to an object. It is carried as an open question and is never multiplied out.",
      });
    }
  }

  return resolveCrossSheetGovernedQuantityEvidence({
    projectId,
    legendSource: {
      documentId: legendDocumentId,
      documentVersionId: legendDocument.current_version_id ?? null,
      drawingIntakeVersionId: legendIntake?.id ?? null,
      drawingNumber: legendNumber.drawingNumber,
      currentIntakeCompleted: Boolean(legendIntake),
    },
    definitions,
    applicability,
    targets,
    occurrences: occurrenceEvidence,
    coverage,
    exclusions,
    ambiguity,
    foreignEvidencePresent: false,
  });
};

export { CROSS_SHEET_EVIDENCE_MODE };
