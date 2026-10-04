// DRAWING INTELLIGENCE -- PRODUCT INTEGRATION.
//
// The canonical internal proposal contract every drawing-type-specific
// intelligence family (Legend/Notes, Riser/Schematic, Layout, Cause &
// Effect, Detail) is normalized into before persistence/API/UI ever see
// it. This is the SAME flat overlay-item shape drawing-general-extraction-
// view-model.mjs already established for schedule/callout/candidate
// proposals -- this module extends that same contract to the five newer
// families rather than inventing a second shape, exactly as
// DrawingVisualReviewPanel.tsx already expects one uniform item type.
//
// Canonical contract (every field below, though not every family
// populates every optional one):
//   id                 stable proposal key (idempotent across reruns)
//   pageNumber
//   sourceType         coarse UI filter bucket (Legend, Loop, Connection, ...)
//   semanticType       human-readable proposal type name
//   proposalType       raw domain proposalType (e.g. "LoopCandidate")
//   label              short display label
//   confidence         informational only -- never the approval gate
//   authorityRole      Primary | Verification | Unsupported
//   governedStatus     Verified | Verified with Assumption | Needs Review | Conflict | Not Found
//   hardReviewReasons  string[] -- why governedStatus is what it is
//   boundingBox        canonical bbox, or null when not positionable
//   extractionMethod
//   evidence           raw + normalized fields specific to this family
//   drawingType        this SHEET's classified type (uniform per document)
//   sourceDrawingNumber / sourceSheet / sourceRevision  provenance
//   sourceEntity       { kind, id, sourceReferences, documentId, intakeVersionId }
// review metadata (reviewStatus/reviewedBy/reviewedAt/reviewReason/
// correctedValue) is added by the PERSISTENCE layer on top of this
// contract, not by this pure view-model -- it is per-row DB state, not a
// domain computation.
//
// Pure domain logic: no DOM, no fetch, no DB.

import { classifyDrawingType } from "./drawing-type-classifier.mjs";
import { buildLegendNotesIntelligence } from "./drawing-legend-notes-intelligence.mjs";
import { buildRiserSchematicIntelligence } from "./drawing-riser-schematic-intelligence.mjs";
import { buildLayoutIntelligence } from "./drawing-layout-intelligence.mjs";
import { buildCauseEffectIntelligence } from "./drawing-cause-effect-intelligence.mjs";
import { buildDetailIntelligence } from "./drawing-detail-intelligence.mjs";
import { detectCrossSheetReferences, resolveCrossSheetReferenceTargets } from "./drawing-cross-sheet-references.mjs";

const truncate = (text, max = 80) => {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

// One sourceType bucket per proposal family the task lists explicitly,
// plus "CrossSheetRef" for cross-sheet evidence itself.
export const DRAWING_INTELLIGENCE_SOURCE_TYPES = Object.freeze([
  "Legend",
  "Note",
  "Loop",
  "Cable",
  "Interface",
  "Connection",
  "DeviceCode",
  "Placement",
  "DetailRef",
  "MatrixHeader",
  "MatrixRelation",
  "Installation",
  "DetailNumber",
  "CrossSheetRef",
]);

// "high-value semantic proposals visible, noisy/general text not shown by
// default" -- General Notes, bare device codes, and matrix headers are
// structural/volume noise (a single Legend sheet can carry 40+ notes);
// everything else is a distinct, load-bearing engineering observation.
export const DEFAULT_VISIBLE_SOURCE_TYPES = Object.freeze(
  DRAWING_INTELLIGENCE_SOURCE_TYPES.filter((type) => !["Note", "DeviceCode", "MatrixHeader"].includes(type)),
);

const FAMILY_BY_DRAWING_TYPE = {
  "Legend / Notes": "legend",
  "Riser Diagram": "riser",
  "Schematic / Single-Line": "riser",
  Layout: "layout",
  "Cause & Effect": "causeEffect",
  "Detail / Enlarged Detail": "detail",
};

// context: { sourceDocument: {id, drawingNumber, sheetName}, revision,
// pageNumber, assets, legendEntries, drawingType (optional -- classified
// from classifications/sheetName if omitted), classifications,
// documentRegistry (for cross-sheet resolution, optional) }.
export const buildDrawingIntelligenceProposals = ({
  sourceDocument = {},
  revision = null,
  pageNumber = null,
  assets = [],
  legendEntries = [],
  legendConfidence = null,
  drawingType = null,
  classifications = [],
  documentRegistry = [],
} = {}) => {
  const typeResult = drawingType ? { drawingType } : classifyDrawingType({ classifications, sheetName: sourceDocument.sheetName });
  const resolvedDrawingType = typeResult.drawingType;
  const family = FAMILY_BY_DRAWING_TYPE[resolvedDrawingType] || null;

  const families = { legend: null, riser: null, layout: null, causeEffect: null, detail: null };
  if (family === "legend") families.legend = buildLegendNotesIntelligence({ sourceDocument, pageNumber, assets, legendEntries, legendConfidence });
  else if (family === "riser") families.riser = buildRiserSchematicIntelligence({ sourceDocument, pageNumber, drawingType: resolvedDrawingType, assets });
  else if (family === "layout") families.layout = buildLayoutIntelligence({ sourceDocument, pageNumber, drawingType: resolvedDrawingType, assets });
  else if (family === "causeEffect") families.causeEffect = buildCauseEffectIntelligence({ sourceDocument, pageNumber, drawingType: resolvedDrawingType, assets });
  else if (family === "detail") families.detail = buildDetailIntelligence({ sourceDocument, pageNumber, drawingType: resolvedDrawingType, assets });

  // Cross-sheet references are detected regardless of this sheet's own
  // type -- any sheet can carry an explicit "refer to drawing X" note.
  const textAndCompositeAssets = assets.filter((asset) => asset.asset_type === "Text" || asset.asset_type === "Legend");
  const rawReferences = [];
  for (const asset of textAndCompositeAssets) {
    rawReferences.push(...detectCrossSheetReferences({ sourceDocument, pageNumber, assets: [asset] }));
  }
  const crossSheetReferences = resolveCrossSheetReferenceTargets(rawReferences, documentRegistry);

  return { drawingType: resolvedDrawingType, drawingTypeConfidence: typeResult.confidence ?? null, families, crossSheetReferences };
};

const baseItem = (proposal, { sourceDocument, drawingType, revision, index, kind }) => ({
  pageNumber: proposal.pageNumber,
  confidence: proposal.confidence ?? null,
  authorityRole: proposal.authorityRole,
  governedStatus: proposal.governedStatus,
  // Same "reviewStatus defaults to the system's own governedStatus until an
  // engineer acts" contract every other overlay item shape already uses --
  // a fresh, never-reviewed proposal's reviewStatus IS its governedStatus.
  reviewStatus: proposal.governedStatus,
  hardReviewReasons: proposal.hardReviewReasons || [],
  boundingBox: proposal.boundingBox ?? null,
  extractionMethod: proposal.extractionMethod,
  drawingType,
  sourceDrawingNumber: sourceDocument.drawingNumber ?? null,
  sourceSheet: sourceDocument.sheetName ?? null,
  sourceRevision: revision ?? null,
  sourceEntity: {
    kind,
    id: `${kind}:${index}`,
    sourceReferences: proposal.sourceReferences || [],
    documentId: sourceDocument.id ?? null,
  },
});

const legendItems = (result, context) => [
  ...(result?.legendDefinitions || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "legend-definition" }),
    id: `legend:${proposal.sourceReferences.join(":") || index}`,
    sourceType: "Legend",
    semanticType: "Legend Definition",
    proposalType: "LegendDefinition",
    label: `${proposal.rawLabel} -- ${truncate(proposal.normalizedMeaning)}`,
    evidence: {
      rawLabel: proposal.rawLabel,
      normalizedValue: proposal.normalizedMeaning,
      entryType: proposal.entryType,
      applicableSystem: proposal.applicableSystem,
      applicabilityStatus: proposal.applicabilityStatus,
      ...proposal.evidence,
    },
  })),
  ...(result?.generalNotes || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "general-note" }),
    id: `note:${proposal.sourceReferences.join(":") || index}`,
    sourceType: "Note",
    semanticType: "General Note",
    proposalType: "GeneralNote",
    label: `${proposal.noteNumber}. ${truncate(proposal.normalizedMeaning)}`,
    evidence: {
      normalizedValue: proposal.normalizedMeaning,
      noteNumber: proposal.noteNumber,
      applicableSystem: proposal.applicableSystem,
      applicabilityStatus: proposal.applicabilityStatus,
      ...proposal.evidence,
    },
  })),
];

const riserItems = (result, context) => [
  ...(result?.loops || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "loop-candidate" }),
    id: `loop:${proposal.sourceReferences[0] || index}`,
    sourceType: "Loop",
    semanticType: "Loop Candidate",
    proposalType: "LoopCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.loopNumber, ...proposal.evidence },
  })),
  ...(result?.cableSpecs || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "cable-spec-candidate" }),
    id: `cable:${proposal.sourceReferences[0] || index}`,
    sourceType: "Cable",
    semanticType: "Cable Spec Candidate",
    proposalType: "CableSpecCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: `${proposal.coreCount}x${proposal.crossSectionSqmm}sq.mm`, ...proposal.evidence },
  })),
  ...(result?.systemInterfaces || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "system-interface-candidate" }),
    id: `interface:${proposal.sourceReferences[0] || index}`,
    sourceType: "Interface",
    semanticType: "System Interface Candidate",
    proposalType: "SystemInterfaceCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.interfacedSystem, ...proposal.evidence },
  })),
  ...(result?.connectionCandidates || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "connection-candidate" }),
    id: `connection:${proposal.sourceReferences[0] || index}`,
    sourceType: "Connection",
    semanticType: "Possible Connection",
    proposalType: "ConnectionCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.destination, ...proposal.evidence },
  })),
  ...(result?.deviceCodes || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "device-code-candidate" }),
    id: `device-code:${proposal.rawLabel}:${index}`,
    sourceType: "DeviceCode",
    semanticType: "Device Code Candidate",
    proposalType: "DeviceCodeCandidate",
    label: `${proposal.rawLabel} (x${proposal.occurrenceCount})`,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.occurrenceCount, ...proposal.evidence },
  })),
];

const layoutItems = (result, context) => [
  ...(result?.devicePlacements || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "device-placement-candidate" }),
    id: `placement:${proposal.sourceReferences[0] || index}`,
    sourceType: "Placement",
    semanticType: "Device Placement Candidate",
    proposalType: "DevicePlacementCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: `${proposal.devicePrefix}-${proposal.deviceNumber}`, ...proposal.evidence },
  })),
  ...(result?.detailReferences || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "detail-reference-candidate" }),
    id: `detail-ref:${proposal.sourceReferences[0] || index}`,
    sourceType: "DetailRef",
    semanticType: "Detail Reference Candidate",
    proposalType: "DetailReferenceCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.referencedDetailNumber, ...proposal.evidence },
  })),
];

const causeEffectItems = (result, context) => [
  ...(result?.headers || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "matrix-header-candidate" }),
    id: `matrix-header:${proposal.sourceReferences[0] || index}`,
    sourceType: "MatrixHeader",
    semanticType: "Matrix Header Candidate",
    proposalType: "MatrixHeaderCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, ...proposal.evidence },
  })),
  ...(result?.relationships || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "matrix-relationship-candidate" }),
    id: `matrix-relation:${proposal.sourceReferences[0] || index}`,
    sourceType: "MatrixRelation",
    semanticType: "Matrix Relationship Candidate",
    proposalType: "MatrixRelationshipCandidate",
    label: `${proposal.initiatingCondition} -> ${proposal.resultingAction}`,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: `${proposal.initiatingCondition} -> ${proposal.resultingAction}`, ...proposal.evidence },
  })),
];

const detailItems = (result, context) => [
  ...(result?.installationRequirements || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "installation-requirement-candidate" }),
    id: `installation:${proposal.sourceReferences[0] || index}`,
    sourceType: "Installation",
    semanticType: "Installation Requirement Candidate",
    proposalType: "InstallationRequirementCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.mountingDimension, isTypical: proposal.isTypical, ...proposal.evidence },
  })),
  ...(result?.detailNumbers || []).map((proposal, index) => ({
    ...baseItem(proposal, { ...context, index, kind: "detail-number-candidate" }),
    id: `detail-number:${proposal.sourceReferences[0] || index}`,
    sourceType: "DetailNumber",
    semanticType: "Detail Number Candidate",
    proposalType: "DetailNumberCandidate",
    label: proposal.rawLabel,
    evidence: { rawLabel: proposal.rawLabel, normalizedValue: proposal.detailNumber, isTypical: proposal.isTypical, ...proposal.evidence },
  })),
];

const crossSheetItems = (references, context) =>
  references.map((reference, index) => ({
    ...baseItem(
      { pageNumber: reference.pageNumber, confidence: null, authorityRole: "Unsupported", governedStatus: reference.governedStatus, hardReviewReasons: [], boundingBox: null, extractionMethod: "Explicit cross-sheet reference note", sourceReferences: [reference.evidence?.sourceAssetId].filter(Boolean) },
      { ...context, index, kind: "cross-sheet-reference" },
    ),
    id: `cross-sheet:${reference.evidence?.sourceAssetId || index}`,
    sourceType: "CrossSheetRef",
    semanticType: "Cross-Sheet Reference",
    proposalType: "CrossSheetReference",
    label: `-> ${reference.referencedDrawingNumber} (${reference.status})`,
    evidence: {
      referencedDrawingNumber: reference.referencedDrawingNumber,
      resolvedTargetDocumentId: reference.resolvedTargetDocumentId,
      applicableSystem: reference.applicableSystem,
      applicableDrawingTypes: reference.applicableDrawingTypes,
      applicabilityStatus: reference.applicabilityStatus,
      applicabilitySource: reference.applicabilitySource,
      revisionCompatibility: reference.revisionCompatibility,
      status: reference.status,
      noteText: reference.evidence?.noteText ?? null,
    },
  }));

// Flattens buildDrawingIntelligenceProposals()'s output into the canonical
// overlay-item contract. sourceDocument/revision are passed again here
// (not read off the `result`, which does not carry them) so every item
// gets the same provenance fields.
export const buildDrawingIntelligenceOverlayItems = (result, { sourceDocument = {}, revision = null } = {}) => {
  if (!result) return [];
  const context = { sourceDocument, drawingType: result.drawingType, revision };
  return [
    ...legendItems(result.families.legend, context),
    ...riserItems(result.families.riser, context),
    ...layoutItems(result.families.layout, context),
    ...causeEffectItems(result.families.causeEffect, context),
    ...detailItems(result.families.detail, context),
    ...crossSheetItems(result.crossSheetReferences, context),
  ];
};
