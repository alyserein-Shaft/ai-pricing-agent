import { mapCanonicalBoxToViewport, mapViewportBoxToCanonical } from "./drawing-coordinate-mapper.mjs";

export const LEGEND_JOIN_CLASSIFICATION = Object.freeze({
  EXACT: "EXACT_JOIN",
  HIGH: "HIGH_CONFIDENCE_JOIN",
  AMBIGUOUS: "AMBIGUOUS",
  NONE: "NO_MATCH",
});

const finiteBox = box => box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const normalizedText = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizedLabel = value => normalizedText(clean(value).replace(/\([^)]*\)/g, ""));
const stable = (a, b) => String(a ?? "").localeCompare(String(b ?? ""));

const canonicalIntersection = (box, page) => {
  if (!finiteBox(box)) return null;
  // Reuse the authoritative forward/inverse pair rather than maintaining a
  // second clamping model for boxes that are already canonical.
  const viewportBox = mapCanonicalBoxToViewport(box, page, { scale: 1, rotation: 0 });
  return viewportBox ? mapViewportBoxToCanonical(viewportBox, page, { scale: 1, rotation: 0 }) : null;
};

// Proposal crops created by the candidate-comparison pipeline currently
// persist canonical boxes even though the PNG itself was rendered in a
// rotated viewport. New callers may provide actual viewport boxes. The
// coordinateSpace flag is mandatory so an already-canonical crop can never
// be accidentally inverse-transformed a second time.
export const normalizeLegendProposalGeometry = (proposal, page, source = {}) => {
  if (!proposal || !page) return null;
  const coordinateSpace = source.coordinateSpace;
  if (!['Canonical', 'Viewport'].includes(coordinateSpace)) return null;
  const originalBoundingBox = proposal.boundingBox || null;
  const originalSymbolBoundingBox = proposal.symbolBoundingBox || proposal.evidence?.symbolBoundingBox || null;
  const viewport = { scale: source.scale, rotation: source.rotation };
  const convert = box => {
    if (!box) return null;
    if (coordinateSpace === 'Canonical') return canonicalIntersection(box, page);
    return mapViewportBoxToCanonical({ left: box.left ?? box.x, top: box.top ?? box.y, width: box.width, height: box.height }, page, viewport);
  };
  const canonicalBoundingBox = convert(originalBoundingBox);
  const canonicalSymbolBoundingBox = convert(originalSymbolBoundingBox);
  if (!canonicalBoundingBox) return null;
  return {
    proposalId: proposal.id || proposal.proposalKey || proposal.sourceReferences?.[0] || `${proposal.evidence?.visualRunId || source.visualRunId || 'proposal'}:${proposal.evidence?.sequence ?? source.sequence ?? 0}`,
    proposalType: proposal.proposalType,
    projectId: proposal.projectId || proposal.project_id || source.projectId || null,
    documentId: proposal.documentId || proposal.sourceDocumentId || proposal.evidence?.sourceDocumentId || source.documentId || null,
    documentVersionId: proposal.documentVersionId || proposal.evidence?.sourceDocumentVersionId || source.documentVersionId || null,
    pageNumber: Number(proposal.pageNumber ?? proposal.page_number ?? source.pageNumber),
    visualRunId: proposal.visualRunId || proposal.evidence?.visualRunId || source.visualRunId || null,
    rawLabel: proposal.rawLabel ?? proposal.evidence?.rawLabel ?? null,
    description: proposal.normalizedMeaning ?? proposal.normalizedValue ?? proposal.evidence?.rawDescription ?? source.description ?? null,
    section: proposal.evidence?.section || source.section || null,
    coordinateSpace,
    mappingMode: coordinateSpace === 'Viewport' ? 'ViewportToCanonicalInverse' : 'AlreadyCanonicalValidatedByRoundTrip',
    viewport: coordinateSpace === 'Viewport' ? { scale: Number(source.scale) || 1, rotation: Number(source.rotation) || 0 } : null,
    sourceImage: source.sourceImage || null,
    originalBoundingBox,
    originalSymbolBoundingBox,
    canonicalBoundingBox,
    canonicalSymbolBoundingBox,
  };
};

export const legendBoxMetrics = (left, right) => {
  if (!finiteBox(left) || !finiteBox(right)) return null;
  const x0 = Math.max(left.x, right.x), y0 = Math.max(left.y, right.y), x1 = Math.min(left.x + left.width, right.x + right.width), y1 = Math.min(left.y + left.height, right.y + right.height);
  const intersectionWidth = Math.max(0, x1 - x0), intersectionHeight = Math.max(0, y1 - y0), intersectionArea = intersectionWidth * intersectionHeight, leftArea = left.width * left.height, rightArea = right.width * right.height, unionArea = leftArea + rightArea - intersectionArea;
  const leftCenter = { x: left.x + left.width / 2, y: left.y + left.height / 2 }, rightCenter = { x: right.x + right.width / 2, y: right.y + right.height / 2 }, centerDistance = Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y), diagonal = Math.max(Math.hypot(left.width, left.height), Math.hypot(right.width, right.height), 1);
  const ratio=value=>Math.max(0,Math.min(1,value));
  return {
    intersectionArea,
    iou: unionArea ? ratio(intersectionArea / unionArea) : 0,
    containment: ratio(intersectionArea / Math.min(leftArea, rightArea)),
    xOverlapRatio: ratio(intersectionWidth / Math.min(left.width, right.width)),
    yOverlapRatio: ratio(intersectionHeight / Math.min(left.height, right.height)),
    centerDistance,
    normalizedCenterDistance: centerDistance / diagonal,
  };
};

const scopeReasons = (row, proposal) => {
  const reasons = [];
  if (!row.projectId || !proposal.projectId || row.projectId !== proposal.projectId) reasons.push('PROJECT_MISMATCH');
  if (!row.documentId || !proposal.documentId || row.documentId !== proposal.documentId) reasons.push('DOCUMENT_MISMATCH');
  if (!Number.isInteger(row.pageNumber) || row.pageNumber !== proposal.pageNumber) reasons.push('PAGE_MISMATCH');
  if (proposal.proposalType !== 'LegendDefinition') reasons.push('UNRELATED_PROPOSAL_TYPE');
  if (row.section && proposal.section && normalizedText(row.section) !== normalizedText(proposal.section)) reasons.push('LEGEND_SECTION_MISMATCH');
  return reasons;
};

const classifyRelationship = (row, proposal) => {
  const scope = scopeReasons(row, proposal);
  if (scope.length) return { classification: LEGEND_JOIN_CLASSIFICATION.NONE, reasons: scope, rowMetrics: null, symbolMetrics: null, descriptionAgreement: false, labelAgreement: false };
  const rowMetrics = legendBoxMetrics(row.boundingBox, proposal.canonicalBoundingBox), symbolMetrics = row.symbolCell?.boundingBox && proposal.canonicalSymbolBoundingBox ? legendBoxMetrics(row.symbolCell.boundingBox, proposal.canonicalSymbolBoundingBox) : null;
  const descriptionAgreement = Boolean(normalizedText(row.description) && normalizedText(row.description) === normalizedText(proposal.description));
  const rowLabel = normalizedLabel(row.abbreviation), proposalLabel = normalizedLabel(proposal.rawLabel), labelAgreement = !rowLabel || !proposalLabel || rowLabel === proposalLabel;
  const spatiallyCompatible = Boolean(rowMetrics && rowMetrics.intersectionArea > 0 && rowMetrics.containment >= .5 && rowMetrics.xOverlapRatio >= .5);
  if (!spatiallyCompatible) return { classification: LEGEND_JOIN_CLASSIFICATION.NONE, reasons: ['INSUFFICIENT_SPATIAL_OVERLAP', ...(descriptionAgreement ? ['TEXT_ONLY_MATCH_REJECTED'] : [])], rowMetrics, symbolMetrics, descriptionAgreement, labelAgreement };
  const symbolRequired = Boolean(row.symbolCell?.boundingBox && proposal.canonicalSymbolBoundingBox), symbolExact = !symbolRequired || (symbolMetrics?.containment >= .75 && symbolMetrics?.intersectionArea > 0);
  if (rowMetrics.containment >= .9 && symbolExact && descriptionAgreement && labelAgreement) return { classification: LEGEND_JOIN_CLASSIFICATION.EXACT, reasons: ['PRIMARY_GEOMETRY_CONTAINS_ROW', ...(symbolRequired ? ['SYMBOL_GEOMETRY_OVERLAP'] : []), 'DESCRIPTION_CORROBORATED', 'LABEL_COMPATIBLE'], rowMetrics, symbolMetrics, descriptionAgreement, labelAgreement };
  if (rowMetrics.containment >= .75 && descriptionAgreement && labelAgreement && (!symbolRequired || symbolMetrics?.containment >= .5)) return { classification: LEGEND_JOIN_CLASSIFICATION.HIGH, reasons: ['STRONG_ROW_OVERLAP', 'DESCRIPTION_CORROBORATED', 'LABEL_COMPATIBLE'], rowMetrics, symbolMetrics, descriptionAgreement, labelAgreement };
  return { classification: LEGEND_JOIN_CLASSIFICATION.AMBIGUOUS, reasons: ['SPATIAL_CANDIDATE_REQUIRES_REVIEW', ...(descriptionAgreement ? [] : ['DESCRIPTION_CONFLICT']), ...(labelAgreement ? [] : ['LABEL_CONFLICT']), ...(symbolRequired && !(symbolMetrics?.intersectionArea > 0) ? ['SYMBOL_GEOMETRY_CONFLICT'] : [])], rowMetrics, symbolMetrics, descriptionAgreement, labelAgreement };
};

// Pure and intentionally non-persisting. Duplicate proposals remain separate
// ranked candidates; no winner is selected and no review state is changed.
export const joinLegendRowsToProposals = ({ structureRows = [], proposals = [] } = {}) => {
  const orderedRows = [...structureRows].sort((a, b) => stable(a.rowId, b.rowId)), orderedProposals = [...proposals].sort((a, b) => stable(a.proposalId, b.proposalId));
  const proposalMatches = new Map(orderedProposals.map(proposal => [proposal.proposalId, []]));
  const rows = orderedRows.map(row => {
    const relationships = orderedProposals.map(proposal => ({ proposalId: proposal.proposalId, visualRunId: proposal.visualRunId, ...classifyRelationship(row, proposal) }));
    const rank = { EXACT_JOIN: 0, HIGH_CONFIDENCE_JOIN: 1, AMBIGUOUS: 2, NO_MATCH: 3 };
    relationships.sort((a, b) => rank[a.classification] - rank[b.classification] || (b.rowMetrics?.containment || 0) - (a.rowMetrics?.containment || 0) || stable(a.proposalId, b.proposalId));
    const candidates = relationships.filter(item => item.classification !== LEGEND_JOIN_CLASSIFICATION.NONE);
    for (const candidate of candidates) proposalMatches.get(candidate.proposalId).push({ rowId: row.rowId, classification: candidate.classification });
    const bestRank = candidates.length ? rank[candidates[0].classification] : rank.NO_MATCH, best = candidates.filter(candidate => rank[candidate.classification] === bestRank), classification = candidates[0]?.classification || LEGEND_JOIN_CLASSIFICATION.NONE;
    return { rowId: row.rowId, tableId: row.tableId, classification, duplicateProposalCandidates: best.length > 1, candidates, rejected: relationships.filter(item => item.classification === LEGEND_JOIN_CLASSIFICATION.NONE) };
  });
  const unmatchedProposals = orderedProposals.filter(proposal => !proposalMatches.get(proposal.proposalId).length).map(proposal => proposal.proposalId), multiplyMatchedProposals = [...proposalMatches].filter(([, matches]) => matches.length > 1).map(([proposalId, matches]) => ({ proposalId, matches }));
  return {
    rows,
    unmatchedStructureRows: rows.filter(row => row.classification === LEGEND_JOIN_CLASSIFICATION.NONE).map(row => row.rowId),
    unmatchedProposals,
    multiplyMatchedProposals,
    summary: {
      exactJoins: rows.filter(row => row.classification === LEGEND_JOIN_CLASSIFICATION.EXACT).length,
      highConfidenceJoins: rows.filter(row => row.classification === LEGEND_JOIN_CLASSIFICATION.HIGH).length,
      ambiguousJoins: rows.filter(row => row.classification === LEGEND_JOIN_CLASSIFICATION.AMBIGUOUS).length,
      unmatchedStructureRows: rows.filter(row => row.classification === LEGEND_JOIN_CLASSIFICATION.NONE).length,
      unmatchedProposals: unmatchedProposals.length,
      rowsWithDuplicateProposalCandidates: rows.filter(row => row.duplicateProposalCandidates).length,
      multiplyMatchedProposals: multiplyMatchedProposals.length,
    },
  };
};
