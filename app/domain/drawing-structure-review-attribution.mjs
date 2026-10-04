import { LEGEND_JOIN_CLASSIFICATION } from "./drawing-legend-spatial-join.mjs";

export const STRUCTURE_REVIEW_ATTRIBUTION = Object.freeze({
  ATTRIBUTED: "ATTRIBUTED",
  PARTIAL: "PARTIALLY_ATTRIBUTED",
  UNATTRIBUTED: "UNATTRIBUTED",
});

const meaningful = value => typeof value === "string" && value.trim().length > 0;
const fragmentIdsFor = snapshot => {
  const ids = new Set(Array.isArray(snapshot.sourceFragmentIds) ? snapshot.sourceFragmentIds.filter(Boolean) : []);
  for (const cell of snapshot.cells || []) for (const fragment of cell.original_fragments || []) if (fragment?.id) ids.add(fragment.id);
  return [...ids].sort();
};

export const classifyStructureReviewAttribution = (snapshot, joinedCandidates = []) => {
  const sourceFragmentIds = fragmentIdsFor(snapshot);
  const hasCanonicalText = [snapshot.abbreviation, snapshot.description, snapshot.notes, ...(snapshot.cells || []).flatMap(cell => [cell.raw_content, cell.reconstructed_content])].some(meaningful);
  const hasDescription = meaningful(snapshot.description);
  const hasTextualSymbolCode = meaningful(snapshot.abbreviation);
  const hasVectorSymbol = Array.isArray(snapshot.symbolGeometry) && snapshot.symbolGeometry.length > 0;
  const deterministicCandidates = joinedCandidates.filter(candidate => [LEGEND_JOIN_CLASSIFICATION.EXACT, LEGEND_JOIN_CLASSIFICATION.HIGH].includes(candidate.classification));
  const hasStructuralProvenance = sourceFragmentIds.length > 0;
  const noEvidence = !hasCanonicalText && !hasVectorSymbol && !hasStructuralProvenance && deterministicCandidates.length === 0;
  if (noEvidence) return { state: STRUCTURE_REVIEW_ATTRIBUTION.UNATTRIBUTED, sourceFragmentIds, warnings: ["UNATTRIBUTED_LEGEND_ROW_BLOCKED"], hasTextualSymbolCode, hasVectorSymbol };
  const complete = deterministicCandidates.length > 0 && hasDescription && (hasTextualSymbolCode || hasVectorSymbol) && hasStructuralProvenance;
  const warnings = [];
  if (!deterministicCandidates.length) warnings.push("NO_DETERMINISTIC_PROPOSAL_ATTRIBUTION");
  if (!hasDescription) warnings.push("CANONICAL_DESCRIPTION_MISSING");
  if (!hasTextualSymbolCode && !hasVectorSymbol) warnings.push("SYMBOL_ATTRIBUTION_MISSING");
  if (!hasStructuralProvenance) warnings.push("STRUCTURAL_PROVENANCE_MISSING");
  return { state: complete ? STRUCTURE_REVIEW_ATTRIBUTION.ATTRIBUTED : STRUCTURE_REVIEW_ATTRIBUTION.PARTIAL, sourceFragmentIds, warnings, hasTextualSymbolCode, hasVectorSymbol };
};

const proposalSnapshot = (candidate, proposal) => ({
  proposalId: candidate.proposalId,
  visualRunId: candidate.visualRunId,
  classification: candidate.classification,
  reasons: candidate.reasons,
  rawLabel: proposal?.rawLabel ?? null,
  description: proposal?.description ?? null,
  originalBoundingBox: proposal?.originalBoundingBox ?? null,
  originalSymbolBoundingBox: proposal?.originalSymbolBoundingBox ?? null,
  canonicalBoundingBox: proposal?.canonicalBoundingBox ?? null,
  canonicalSymbolBoundingBox: proposal?.canonicalSymbolBoundingBox ?? null,
  coordinateSpace: proposal?.coordinateSpace ?? null,
  mappingMode: proposal?.mappingMode ?? null,
  sourceImage: proposal?.sourceImage ?? null,
  proposalProvenance: proposal?.proposalProvenance ?? null,
  metrics: {
    row: candidate.rowMetrics,
    symbol: candidate.symbolMetrics,
    descriptionAgreement: candidate.descriptionAgreement,
    labelAgreement: candidate.labelAgreement,
  },
});

export const buildAttributedStructureReviewSnapshot = ({ snapshot, joinRow, proposalsById, structure, evidenceFingerprint }) => {
  const joinedCandidates = joinRow?.candidates || [];
  const attribution = classifyStructureReviewAttribution(snapshot, joinedCandidates);
  const proposalCandidates = joinedCandidates.map(candidate => proposalSnapshot(candidate, proposalsById.get(candidate.proposalId)));
  const bestClassification = joinRow?.classification || LEGEND_JOIN_CLASSIFICATION.NONE;
  return {
    ...snapshot,
    sourceFragmentIds: attribution.sourceFragmentIds,
    symbolRepresentation: attribution.hasTextualSymbolCode ? "TEXT_CODE" : attribution.hasVectorSymbol ? "VECTOR_GEOMETRY" : "NONE",
    attributionState: attribution.state,
    attributionWarnings: attribution.warnings,
    joinClassification: bestClassification,
    joinConfidence: bestClassification === LEGEND_JOIN_CLASSIFICATION.EXACT ? "Exact" : bestClassification === LEGEND_JOIN_CLASSIFICATION.HIGH ? "High" : bestClassification === LEGEND_JOIN_CLASSIFICATION.AMBIGUOUS ? "Ambiguous" : "None",
    proposalCandidates,
    proposalCandidateCount: proposalCandidates.length,
    duplicateProposalEvidence: proposalCandidates.length > 1,
    initializationProvenance: {
      structureVersionId: structure.id,
      documentVersionId: structure.document_version_id,
      structureInputFingerprint: structure.input_fingerprint,
      structureOutputFingerprint: structure.output_fingerprint,
      parserVersion: structure.parser_version,
      proposalEvidenceFingerprint: evidenceFingerprint,
    },
  };
};
