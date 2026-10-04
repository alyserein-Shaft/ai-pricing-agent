// DOWNSTREAM DRAWING EVIDENCE HANDOFF -- read-model rebuild after the governed
// legend approvals. READ-ONLY: every value is read back through the canonical
// HTTP routes (never a second write, never a direct SQL read of the live file).
//
// This is NOT a Drawing Intelligence rerun: no vision, no AI, no Muse, no
// extraction. It recomputes the handoff from live canonical authority and
// reports exactly what is now governed and what is still NOT_PROVEN.

import { buildOccurrenceEvidenceFromAssets } from "../app/domain/drawing-occurrence-evidence.mjs";
import { buildLegendDictionary, resolveLegendApplicability } from "../app/domain/drawing-intelligence.mjs";

const BASE = "http://localhost:4183";
const PROJECT_ID = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const LEGEND_DOCUMENT_ID = "doc_18e8db55-d75c-474f-827c-f1a21413b244";
const TOKEN = "T";

const get = async (path) => {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`GET_FAILED:${path}:${response.status}`);
  return response.json();
};

// ── 1. Governed legend definitions (canonical approved-structure read) ──────
const approved = await get(`/api/documents/${LEGEND_DOCUMENT_ID}/drawing-structure/approved`);
const governedDefinitions = (approved.rows || []).map((row) => ({
  token: row.abbreviation,
  meaning: row.description,
  sourceDocumentId: LEGEND_DOCUMENT_ID,
  sourceDocumentVersionId: approved.version ? null : null,
  sourcePage: row.source_page,
  sourceRow: row.source_row,
  boundingBox: row.bounding_box,
  reviewedBy: row.review_actor_id,
  reviewReason: row.review_reason,
  notes: row.notes,
  sourceSnapshotKeys: Object.keys(row.source_snapshot || {}),
}));

// The approved version carries the document version it was built from; read it
// from the legend document's own current intake so provenance is exact.
const legendIntake = await get(`/api/documents/${LEGEND_DOCUMENT_ID}/drawing-intake`);
const legendDocumentVersionId = legendIntake.version.document_version_id;
for (const definition of governedDefinitions) definition.sourceDocumentVersionId = legendDocumentVersionId;

// Symbol-asset membership per document, taken from the governed approval
// provenance (never from geometry heuristics or filenames).
const governedLegendSymbolMembership = new Map();
for (const definition of governedDefinitions) {
  const notes = String(definition.notes ?? "");
  const symbolAssetId = /symbol=([A-Za-z0-9_-]+)/.exec(notes)?.[1] ?? null;
  if (!symbolAssetId) continue;
  const list = governedLegendSymbolMembership.get(definition.sourceDocumentId) ?? [];
  list.push({ assetId: symbolAssetId, token: definition.token });
  governedLegendSymbolMembership.set(definition.sourceDocumentId, list);
}
console.log(`GOVERNED_LEGEND_SYMBOL_MEMBERSHIP = ${[...governedLegendSymbolMembership.values()].flat().length} symbol assets across ${governedLegendSymbolMembership.size} document(s)`);

const dictionary = buildLegendDictionary({ entries: governedDefinitions });
console.log(`GOVERNED_LEGEND_DEFINITIONS = ${governedDefinitions.length} (actor ${[...new Set(governedDefinitions.map((d) => d.reviewedBy))].join(",")})`);
for (const definition of governedDefinitions) {
  console.log(`  ${definition.token} => ${definition.meaning} | p${definition.sourcePage} row${definition.sourceRow} | docVersion ${definition.sourceDocumentVersionId}`);
}

// ── 2. Current drawings, read back from canonical intake reads ──────────────
const documents = await get(`/api/projects/${PROJECT_ID}/documents`).catch(() => null);
const drawingDocs = (documents?.documents || documents?.items || []).filter((doc) => doc.documentType === "Drawing" || doc.document_type === "Drawing");
if (!drawingDocs.length) throw new Error("NO_CURRENT_DRAWING_DOCUMENTS_VIA_CANONICAL_ROUTE");

const intakes = [];
for (const doc of drawingDocs) {
  const intake = await get(`/api/documents/${doc.id}/drawing-intake`);
  const version = intake.version || {};
  if (version.superseded_at || version.status !== "Completed") continue;
  // The occurrence engine consumes the persisted asset-row shape (bounding_box
  // as a JSON string). The canonical read hydrates it as an object, so re-encode
  // it here rather than weakening the engine's own parse-failure branch.
  const assets = (intake.assets || []).map((asset) => ({
    ...asset,
    bounding_box: asset.bounding_box == null || typeof asset.bounding_box === "string"
      ? asset.bounding_box
      : JSON.stringify(asset.bounding_box),
  }));
  intakes.push({ doc, version, assets });
}
console.log(`CURRENT_COMPLETED_INTAKES = ${intakes.length}`);

const assetsByDocument = new Map();
for (const entry of intakes) {
  const assets = entry.assets || [];
  assetsByDocument.set(entry.doc.id, assets);
}

// ── 3. Explicit cross-sheet legend references, from the sheets' own text ───
// A reference is only usable when the referenced drawing number can be resolved
// to a document through evidence OTHER than a filename. This project currently
// has no extracted drawing number for any current intake, so the reference is
// recorded as UNRESOLVED rather than guessed.
const legendReferencePattern = /FOR\s+ELV\s+LEGENDS/i;
const drawingNumberPattern = /DWG\s+NO\.?\s*([A-Z0-9][A-Z0-9-]*)/i;

const metadataByDocument = new Map();
for (const entry of intakes) {
  const metadata = await get(`/api/documents/${entry.doc.id}/drawing-metadata`);
  metadataByDocument.set(entry.doc.id, metadata);
}

// A reference resolves ONLY through a governed drawing number. Sheets abbreviate
// their references ("2401232-PC-AMS-T-00-ZZZ-002" for the governed
// "2401232-PC-AMS-DR-T-00-ZZZ-002"), so the comparison is made on the segment
// sequence with the optional discipline token removed. A filename is never used.
const numberKey = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace("DR", "");
const governedByNumber = new Map();
for (const [documentId, metadata] of metadataByDocument) {
  if (!metadata.drawingNumber) continue;
  governedByNumber.set(numberKey(metadata.drawingNumber), { documentId, metadata });
}

const crossSheetRefsByDocument = new Map();
for (const entry of intakes) {
  const assets = assetsByDocument.get(entry.doc.id) || [];
  const note = assets.find((asset) => legendReferencePattern.test(asset.text_content || ""));
  if (!note) continue;
  const numberAsset = assets.find((asset) => drawingNumberPattern.test(asset.text_content || ""));
  const referencedNumber = numberAsset ? String(drawingNumberPattern.exec(numberAsset.text_content)[1]).toUpperCase() : null;
  const target = referencedNumber ? governedByNumber.get(numberKey(referencedNumber)) : null;
  crossSheetRefsByDocument.set(entry.doc.id, [{
    kind: "LEGEND_FOR",
    noteText: note.text_content,
    noteAssetId: note.id,
    referencedDrawingNumber: referencedNumber,
    targetDocumentId: target?.documentId ?? null,
    targetResolution: !referencedNumber
      ? "NO_REFERENCE_FOUND"
      : target
        ? `GOVERNED_CURRENT_METADATA:${target.metadata.drawingNumber}`
        : "REFERENCED_NUMBER_ONLY_NO_GOVERNED_TARGET",
  }]);
}
console.log(`EXPLICIT_LEGEND_FOR_NOTES = ${crossSheetRefsByDocument.size}`);

// ── 4. Applicability + occurrence evidence for the approved token ───────────
const perSheet = [];
let totalOccurrences = 0;
let governedOccurrences = 0;
for (const entry of intakes) {
  const assets = assetsByDocument.get(entry.doc.id) || [];
  const crossSheetRefs = crossSheetRefsByDocument.get(entry.doc.id) || [];
  const applicability = resolveLegendApplicability({
    token: TOKEN,
    targetDocumentId: entry.doc.id,
    targetDocumentVersionId: entry.version.document_version_id,
    dictionary,
    crossSheetRefs,
    architectureRows: [], // no governed architecture rows exist for this project
  });
  // Governed legend regions come from the document's own completed structural
  // parse (Legend tables). A symbol inside one is a legend DEFINITION, never a
  // physical field device, whatever the pixel distance to its description.
  let governedLegendRegions = [];
  try {
    const structure = await get(`/api/documents/${entry.doc.id}/drawing-structure`);
    governedLegendRegions = (structure.tables || [])
      .filter((table) => String(table.tableType || "").toLowerCase() === "legend" && table.boundingBox)
      .map((table) => ({ boundingBox: table.boundingBox, source: table.tableKey ?? "structural:legend-table" }));
  } catch { governedLegendRegions = []; }
  const occurrence = buildOccurrenceEvidenceFromAssets({
    assets,
    allTexts: assets,
    governedLegendRegions,
    // Governed MEMBERSHIP: the approved legend rows carry the exact symbol asset
    // that defines each governed symbol. Region evidence alone is insufficient
    // here because the structural parser's detected Legend tables do not cover
    // the Fire Alarm symbol/description block, so the definition's own symbol
    // would otherwise be counted as a physical device.
    governedLegendSymbols: governedLegendSymbolMembership.get(entry.doc.id) ?? [],
    location: {
      projectId: PROJECT_ID,
      documentId: entry.doc.id,
      documentVersionId: entry.version.document_version_id,
      sheet: entry.doc.logical_name,
    },
    resolution: applicability,
  });
  const accepted = occurrence.accepted || occurrence.occurrences || [];
  totalOccurrences += accepted.length;
  if (applicability.applicable) governedOccurrences += accepted.length;
  if (accepted.length || applicability.applicable || crossSheetRefs.length) {
    perSheet.push({
      sheet: entry.doc.logical_name,
      documentId: entry.doc.id,
      documentVersionId: entry.version.document_version_id,
      intakeVersionId: entry.version.id,
      occurrenceCount: accepted.length,
      applicability: applicability.applicable ? applicability.authority : "NOT_PROVEN",
      governedMeaning: applicability.meaning ?? null,
      legendReference: crossSheetRefs[0]
        ? { noteAssetId: crossSheetRefs[0].noteAssetId, referencedDrawingNumber: crossSheetRefs[0].referencedDrawingNumber, targetResolution: crossSheetRefs[0].targetResolution }
        : null,
      identityAuthorityPerOccurrence: accepted.length ? (accepted[0].identity_authority ?? null) : null,
    });
  }
}
console.log(`\nTOKEN_OCCURRENCES_RECOMPUTED = ${totalOccurrences}`);
console.log(`TOKEN_OCCURRENCES_WITH_GOVERNED_IDENTITY = ${governedOccurrences}`);
for (const sheet of perSheet) {
  console.log(`  ${sheet.sheet} | occ ${sheet.occurrenceCount} | identity ${sheet.applicability} | ref ${sheet.legendReference ? sheet.legendReference.referencedDrawingNumber ?? "n/a" : "none"} (${sheet.legendReference?.targetResolution ?? "n/a"})`);
}

// ── 5. WLC printed multiplicity: stays fail-closed ─────────────────────────
const wlc = intakes.find((entry) => /WLC-DR-T-93/.test(entry.doc.logical_name || ""));
const wlcAssets = wlc ? (assetsByDocument.get(wlc.doc.id) || []) : [];
const multiplicityLabels = wlcAssets.filter((asset) => /^2\s+Nos$/i.test(String(asset.text_content || "").trim()));
const cableNotes = wlcAssets.filter((asset) => /PAIR\s+TELEPHONE\s+CABLE|FIREMAN\s+TELEPHONE\s+JACK/i.test(asset.text_content || ""));
console.log(`\nWLC_PRINTED_MULTIPLICITY_LABELS = ${multiplicityLabels.length} (label assets: ${multiplicityLabels.slice(0, 3).map((a) => a.id).join(", ")})`);
console.log(`WLC_LOCAL_CABLE_NOTE_ASSETS = ${cableNotes.length}`);
console.log("WLC_2_NOS_REFERENT = AMBIGUOUS (no current-project evidence binds the printed label to an object; no 6x2 computed)");

// ── 6. Safety invariants ───────────────────────────────────────────────────
const legacyIds = JSON.stringify(perSheet).match(/ae501b85|LEGACY_REFERENCE_ONLY/g) || [];
const quantityClaimKeys = perSheet.filter((sheet) => /quantity/i.test(JSON.stringify(sheet)));
console.log(`\nLEGACY_PROJECT_EVIDENCE_USED = ${legacyIds.length}`);
console.log(`QUANTITY_CLAIMS_CREATED = ${quantityClaimKeys.length}`);
console.log(`CURRENTNESS = re-read from canonical routes during this run`);
