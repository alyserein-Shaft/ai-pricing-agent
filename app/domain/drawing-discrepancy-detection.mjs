// DRAWING INTELLIGENCE -- WORKSTREAM 8: real conflict exercise support.
//
// Compares two pieces of governed evidence for the SAME real-world field
// (e.g. a BOQ quantity vs. a drawing-derived quantity for the same
// described item) and, when they genuinely disagree, produces a Conflict
// proposal plus an RFI/discrepancy candidate -- never a pricing decision,
// only a governed flag that blocks the affected item until an engineer
// resolves it.
//
// This module makes NO business decision about which value is correct.
//
// Pure domain logic: no DOM, no fetch, no DB.

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";

// left/right: { source: string (e.g. "BOQ", "Drawing Schedule"), value:
// string|number, documentId?: string, sheetName?: string, evidence?: any }.
// fieldType: the same FIELD_TYPES vocabulary evaluateDrawingEvidenceAuthority
// uses (e.g. "DeviceQuantity", "DeviceIdentity").
export const compareEvidenceForConflict = ({ fieldType, itemLabel, left, right }) => {
  const valuesDiffer = String(left.value).trim().toLowerCase() !== String(right.value).trim().toLowerCase();
  if (!valuesDiffer) {
    return { hasConflict: false, conflict: null, rfiCandidate: null };
  }
  const conflictDescription = `${itemLabel}: ${left.source} reports "${left.value}", ${right.source} reports "${right.value}"`;
  const authority = evaluateDrawingEvidenceAuthority({
    fieldType,
    conflicts: [conflictDescription],
  });
  const conflict = {
    proposalType: "ConflictCandidate",
    fieldType,
    itemLabel,
    governedStatus: authority.finalStatus, // always "Conflict" -- evaluateDrawingEvidenceAuthority short-circuits on any conflicts[] entry
    // A Conflict proposal can never be approved -- approvalEligibility is
    // structurally false the moment any conflicts[] entry is passed in,
    // regardless of authority role or evidence strength (the hard-review
    // ladder's first rung). This is what "blocks downstream readiness for
    // the affected field/item" actually means in this pipeline: the item
    // cannot reach Verified/Verified with Assumption until the conflict
    // itself is resolved (corrected or the discrepancy explained).
    approvalEligibility: authority.approvalEligibility,
    hardReviewReasons: authority.hardReviewReasons,
    evidenceSources: [
      { source: left.source, value: left.value, documentId: left.documentId ?? null, sheetName: left.sheetName ?? null },
      { source: right.source, value: right.value, documentId: right.documentId ?? null, sheetName: right.sheetName ?? null },
    ],
  };
  const rfiCandidate = {
    proposalType: "RfiDiscrepancyCandidate",
    itemLabel,
    question: `${itemLabel}: please confirm the correct value -- ${left.source} states "${left.value}" while ${right.source} states "${right.value}".`,
    affectedFieldType: fieldType,
    evidenceSources: conflict.evidenceSources,
    governedStatus: "Needs Review",
    // This module never recommends a resolution or a price -- it only
    // states the discrepancy and names the two sources.
  };
  return { hasConflict: true, conflict, rfiCandidate };
};
