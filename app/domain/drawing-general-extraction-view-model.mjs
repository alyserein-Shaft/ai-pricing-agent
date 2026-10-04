// GENERAL DRAWING EXTRACTION ENGINE v0 -- overlay view model.
//
// Normalizes buildGeneralDrawingExtractionProposals()'s output (see
// drawing-general-extraction-engine.mjs) into the same flat overlay-item
// shape drawing-overlay-view-model.mjs already produces for Text/Symbol/
// UnknownSymbol/Structure evidence, so DrawingVisualReviewPanel can render
// and filter both through one mechanism. This is a frontend-only
// presentation view -- normalizing here creates no new authoritative record
// and changes no review state.
//
// Two new sourceTypes are introduced: "Equipment" (schedule rows, alias/
// acronym candidates, and the schedule-list region envelope) and "Callout"
// (numbered references back to a schedule row). Nothing here ever produces
// a "SystemConnection" sourceType -- that proposal type does not exist in
// this engine.
//
// Pure domain logic: no DOM, no React, no fetch.

const truncate = (text, max = 80) => {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

export const GENERAL_EXTRACTION_SOURCE_TYPES = Object.freeze(["Equipment", "Callout"]);

// Every proposal now carries authorityRole/governedStatus/hardReviewReasons
// from evaluateDrawingEvidenceAuthority() (drawing-evidence-authority-
// policy.mjs) -- surfaced at the top level (not buried in evidence) so the
// inspector can show WHY a status was reached, not just what it is.
const governanceFields = (item) => ({
  authorityRole: item.authorityRole,
  governedStatus: item.governedStatus,
  hardReviewReasons: item.hardReviewReasons,
});

const scheduleItemToOverlayItem = (item, index) => ({
  id: `schedule:${item.sourceReferences.join(":")}`,
  pageNumber: item.pageNumber,
  sourceType: "Equipment",
  semanticType: "Equipment Schedule Item",
  label: `${item.itemNumber}. ${truncate(item.description)}`,
  confidence: item.confidence,
  reviewStatus: item.reviewStatus,
  ...governanceFields(item),
  boundingBox: item.boundingBox,
  extractionMethod: item.extractionMethod,
  evidence: {
    reference: item.itemNumber,
    normalizedLabel: item.normalizedLabel,
    category: item.category,
    aliases: item.aliases,
    numberBoundingBox: item.evidence.numberBoundingBox,
    descriptionBoundingBox: item.evidence.descriptionBoundingBox,
  },
  sourceEntity: { kind: "general-extraction-schedule-item", id: `schedule:${index}`, sourceReferences: item.sourceReferences },
});

const calloutToOverlayItem = (callout, index) => ({
  id: `callout:${callout.sourceReferences[0]}`,
  pageNumber: callout.pageNumber,
  sourceType: "Callout",
  semanticType: "Callout Reference",
  label: `Callout ${callout.reference}`,
  confidence: callout.confidence,
  reviewStatus: callout.reviewStatus,
  ...governanceFields(callout),
  boundingBox: callout.boundingBox,
  extractionMethod: callout.extractionMethod,
  evidence: {
    reference: callout.reference,
    linkedScheduleItem: callout.matchedScheduleItem,
    numberBoundingBox: callout.evidence.numberBoundingBox,
    scheduleRowBoundingBox: callout.evidence.scheduleRowBoundingBox,
    leaderGeometry: callout.evidence.leaderGeometry,
    ambiguityNote: callout.evidence.ambiguityNote || null,
  },
  sourceEntity: { kind: "general-extraction-callout", id: `callout:${index}`, sourceReferences: callout.sourceReferences },
});

const equipmentCandidateToOverlayItem = (candidate, index) => ({
  id: `equipment-candidate:${candidate.sourceReferences[0]}`,
  pageNumber: candidate.pageNumber,
  sourceType: "Equipment",
  semanticType: candidate.proposalType === "PanelCandidate" ? "Panel Candidate" : "Equipment Candidate",
  label: `${candidate.rawLabel} · ${truncate(candidate.label)} (${candidate.identityStatus})`,
  confidence: candidate.confidence,
  reviewStatus: candidate.reviewStatus,
  ...governanceFields(candidate),
  boundingBox: candidate.boundingBox,
  extractionMethod: candidate.extractionMethod,
  evidence: {
    alias: candidate.alias,
    rawLabel: candidate.rawLabel,
    canonicalType: candidate.canonicalType,
    identityStatus: candidate.identityStatus,
    matchBasis: candidate.matchBasis,
    potentialMatch: candidate.potentialMatch,
    linkedScheduleItem: candidate.matchedScheduleItem,
    aliasBoundingBox: candidate.evidence.aliasBoundingBox,
    scheduleRowBoundingBox: candidate.evidence.scheduleRowBoundingBox,
  },
  sourceEntity: { kind: "general-extraction-equipment-candidate", id: `equipment-candidate:${index}`, sourceReferences: candidate.sourceReferences },
});

const regionCandidateToOverlayItem = (region) => ({
  id: `general-extraction-region:${region.id}`,
  pageNumber: region.pageNumber,
  sourceType: "Equipment",
  semanticType: region.regionKind,
  label: `${region.regionKind} (${region.rowCount} rows)`,
  confidence: region.confidence,
  reviewStatus: region.reviewStatus,
  ...governanceFields(region),
  boundingBox: region.boundingBox,
  extractionMethod: region.extractionMethod,
  evidence: {},
  sourceEntity: { kind: "general-extraction-region", id: region.id, sourceReferences: region.sourceReferences },
});

// proposals: the { scheduleItems, callouts, equipmentCandidates,
// regionCandidates } shape buildGeneralDrawingExtractionProposals returns.
// unresolved entries are deliberately NOT rendered as overlay items (they
// have no confirmed single position/label) -- callers that want to surface
// them can read proposals.unresolved directly.
export const buildGeneralExtractionOverlayItems = (proposals) => {
  if (!proposals) return [];
  return [
    ...proposals.scheduleItems.map(scheduleItemToOverlayItem),
    ...proposals.callouts.map(calloutToOverlayItem),
    ...proposals.equipmentCandidates.map(equipmentCandidateToOverlayItem),
    ...proposals.regionCandidates.map(regionCandidateToOverlayItem),
  ];
};
