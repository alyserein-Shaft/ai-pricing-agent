// Stage 6A (2026-08-31): APPROVED DRAWING QUANTITY EVIDENCE INFRASTRUCTURE.
//
// This is deliberately NOT a claim of drawing quantity understanding.
// Stage 5.6 established (real Opera CCTV floor plan): sheet-wide recall is
// unknown, only a very small reviewed positive set exists (2 approved real
// camera occurrences), and the recognizer is intentionally conservative.
// This module answers a narrower, governed question only: "how many
// currently APPROVED occurrences of this approved legend identity exist on
// this reviewed drawing evidence set" -- never "how many devices exist in
// the project."
//
// Governance carried through every function here:
//   - only review_status==="Approved" occurrences ever count (never Needs
//     Review, Rejected, or a stale/superseded recognition version)
//   - drawing quantity is EVIDENCE, never BOQ/tender/engineer-approved
//     truth -- comparisons return a status, never a silent overwrite
//   - a BOQ comparison is only ever "conclusive" when both a real governed
//     link and a real coverage/review state justify that conclusion --
//     never from loose text similarity, and never merely because a count
//     was produced
import { buildTaxonomyContext, familiesAreSynonyms } from "./system-knowledge-registry.mjs";

export const DRAWING_QUANTITY_EVIDENCE_ENGINE_VERSION = "drawing-quantity-evidence-1.0.0";

// Coverage is an explicit engineer judgement, never inferred from a count.
// A count of 2 approved occurrences means nothing about completeness on
// its own -- the recognizer's own sheet-wide recall is unknown (Stage 5.6).
export const COVERAGE_STATES = ["Partial", "Reviewed Sheet", "Reviewed Drawing Set", "Complete / Engineer Confirmed"];
export const DEFAULT_COVERAGE_STATE = "Partial";
// Only these coverage states justify treating a quantity mismatch as a real
// conflict rather than incomplete review -- see compareDrawingEvidenceToBoq.
const CONCLUSIVE_COVERAGE_STATES = new Set(["Reviewed Drawing Set", "Complete / Engineer Confirmed"]);
export const isConclusiveCoverageState = (state) => CONCLUSIVE_COVERAGE_STATES.has(state);

// Approved Drawing Quantity Evidence = count of CURRENT approved occurrences
// for the same approved legend/device identity within the same governed
// drawing version/scope. Groups by legend identity (definitionKey), never
// by loose shape/text similarity. Every occurrence id is preserved behind
// the aggregate so the count is fully traceable, never opaque.
export const computeApprovedQuantityEvidence = ({
  occurrences = [],
  definitions = [],
  recognitionVersionId,
  documentId,
} = {}) => {
  const approved = occurrences.filter(
    (occurrence) => occurrence.reviewStatus === "Approved" && occurrence.matchedDefinitionKey,
  );
  const byDefinition = new Map();
  for (const occurrence of approved) {
    const list = byDefinition.get(occurrence.matchedDefinitionKey) || [];
    list.push(occurrence);
    byDefinition.set(occurrence.matchedDefinitionKey, list);
  }
  const groups = [...byDefinition.entries()]
    .map(([definitionKey, groupOccurrences]) => {
      const definition = definitions.find((candidate) => candidate.definitionKey === definitionKey) || null;
      // System Knowledge Registry handoff: resolves to an engineering
      // system/family (e.g. CCTV / Cameras / Dome Camera), never a
      // manufacturer part number. An unregistered system (e.g. Access
      // Control) honestly returns system:null -- never fabricated.
      const taxonomy = definition?.description
        ? buildTaxonomyContext({ description: definition.description })
        : { system: null, families: [] };
      return {
        definitionKey,
        abbreviation: definition?.abbreviation || null,
        description: definition?.description || null,
        system: taxonomy.system,
        families: taxonomy.families,
        recognitionVersionId,
        documentId,
        approvedOccurrenceCount: groupOccurrences.length,
        // DRAW-QTY-1 (2026-09-27): approvedOccurrenceCount is a RECOGNITION
        // METRIC, never a device quantity. One approved occurrence is one
        // recognised legend row on a reviewed sheet, not one installed device
        // -- a fire-alarm riser prints its device count as text beside the row
        // ("36 Nos"), so the row and the device are different things. These
        // three fields exist so no consumer can read the count above as a
        // quantity even by accident. See drawing-printed-quantity-contract.mjs.
        occurrenceCountUnit: "approved_occurrences",
        isDeviceQuantity: false,
        deviceQuantity: null,
        deviceQuantityStatus: "PRINTED_QUANTITY_AUTHORITY_REQUIRED",
        approvedOccurrences: groupOccurrences
          .map((occurrence) => ({
            id: occurrence.id ?? occurrence.occurrenceKey,
            pageNumber: occurrence.pageNumber,
            boundingBox: occurrence.boundingBox,
            matchType: occurrence.matchType,
            confidence: occurrence.confidence,
            reviewStatus: occurrence.reviewStatus,
            scoreComponents: occurrence.scoreComponents ?? null,
          }))
          .sort((a, b) => a.pageNumber - b.pageNumber || String(a.id).localeCompare(String(b.id))),
        pages: [...new Set(groupOccurrences.map((occurrence) => occurrence.pageNumber))].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => (a.description || "").localeCompare(b.description || ""));
  return {
    engineVersion: DRAWING_QUANTITY_EVIDENCE_ENGINE_VERSION,
    recognitionVersionId,
    documentId,
    groups,
    totalApprovedOccurrenceCount: approved.length,
    isEvidence: true,
    isBoqTruth: false,
    isTenderQuantity: false,
    isEngineerApprovedQuantity: false,
  };
};

// A governed link is the SAME real mechanism already used elsewhere in this
// codebase to connect a BOQ item to a canonical System/Family: an APPROVED
// (never AWAITING_REVIEW/REJECTED) estimator_understanding_review_versions
// row's own canonical_interpretation (system + productFamily/category),
// compared against the drawing evidence group's own System Knowledge
// Registry resolution using the SAME governed family-synonym logic the
// rest of the codebase uses (familiesAreSynonyms) -- never loose text
// similarity invented for this stage. boq_items itself has no governed
// family column and no FK to a drawing recognition version -- see
// worker/drawing-quantity-evidence-api.mjs for how the caller resolves
// these two real, separately-persisted records via a shared project_id.
export const resolveGovernedLink = ({ evidenceGroup, canonicalInterpretation, reviewStatus }) => {
  if (reviewStatus !== "APPROVED") return false;
  if (!evidenceGroup?.system || !canonicalInterpretation?.system) return false;
  if (evidenceGroup.system !== canonicalInterpretation.system) return false;
  const boqFamily = canonicalInterpretation.productFamily || canonicalInterpretation.category || null;
  if (!boqFamily) return false;
  return evidenceGroup.families.some(
    (candidate) =>
      candidate.family === boqFamily ||
      familiesAreSynonyms(evidenceGroup.system, candidate.family, boqFamily),
  );
};

// Drawing quantity is EVIDENCE. It must never overwrite BOQ/tender/
// engineer-approved quantity -- it can only ever report a comparison
// status alongside both real numbers. A mismatch is only ever reported as
// a real conflict when the coverage state is conclusive; otherwise it is
// honestly reported as incomplete evidence, never a false alarm.
export const compareDrawingEvidenceToBoq = ({
  evidenceGroup,
  boqItem,
  canonicalInterpretation,
  reviewStatus,
  coverageState = DEFAULT_COVERAGE_STATE,
}) => {
  const governedLink = resolveGovernedLink({ evidenceGroup, canonicalInterpretation, reviewStatus });
  if (!evidenceGroup || !boqItem || !governedLink)
    return {
      status: "No governed link",
      comparable: false,
      conclusive: false,
      reason: "No governed (engineer-approved) link exists between this drawing-derived family/device identity and this BOQ item.",
    };
  // DRAW-QTY-1 (2026-09-27): the number below is a count of approved
  // occurrences. It is retained under its existing name so no caller breaks,
  // but it is labelled as what it is on every return path, and it is never
  // treated here as a device quantity.
  const drawingQuantity = evidenceGroup.approvedOccurrenceCount;
  const quantityBasis = "APPROVED_OCCURRENCE_COUNT";
  const quantityBasisNote = "This number counts approved recognised legend rows, not installed devices. A device quantity requires a printed drawing count -- see drawing-printed-quantity-contract.mjs.";
  const boqQuantity = Number(boqItem.numeric_quantity ?? boqItem.quantity);
  if (!Number.isFinite(boqQuantity))
    return { status: "No governed link", comparable: false, conclusive: false, reason: "BOQ item has no numeric quantity." };
  if (drawingQuantity === boqQuantity)
    // DRAW-QTY-1: an approved-occurrence count happening to equal the BOQ
    // quantity is NOT confirmation. A mismatch may legitimately be raised for
    // review, but a match must never be reported as a settled all-clear,
    // because the two numbers measure different things. Hence conclusive is
    // false here while the Quantity Conflict path below keeps conclusive true.
    return { status: "Aligned", comparable: true, conclusive: false, drawingQuantity, boqQuantity, coverageState, quantityBasis, deviceQuantityAvailable: false, reason: quantityBasisNote };
  if (!isConclusiveCoverageState(coverageState))
    return {
      status: "PARTIAL DRAWING EVIDENCE / Needs Review",
      comparable: true,
      conclusive: false,
      drawingQuantity,
      boqQuantity,
      coverageState,
      quantityBasis,
      deviceQuantityAvailable: false,
      reason: "Drawing review coverage is not yet complete; a lower drawing count does not by itself mean a conflict.",
    };
  return {
    status: "Quantity Conflict — Needs Review",
    comparable: true,
    conclusive: true,
    drawingQuantity,
    boqQuantity,
    coverageState,
    quantityBasis,
    deviceQuantityAvailable: false,
    reason: quantityBasisNote,
  };
};
