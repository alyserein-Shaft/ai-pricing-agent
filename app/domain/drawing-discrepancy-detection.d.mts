// Type bridge for drawing-discrepancy-detection.mjs (checkJs is off).
import type { FieldType, GovernedStatus } from "./drawing-evidence-authority-policy.d.mts";

export type EvidenceSide = { source: string; value: string | number; documentId?: string | null; sheetName?: string | null };

export declare function compareEvidenceForConflict(input: {
  fieldType: FieldType;
  itemLabel: string;
  left: EvidenceSide;
  right: EvidenceSide;
}): {
  hasConflict: boolean;
  conflict: {
    proposalType: "ConflictCandidate";
    fieldType: FieldType;
    itemLabel: string;
    governedStatus: GovernedStatus;
    approvalEligibility: boolean;
    hardReviewReasons: string[];
    evidenceSources: EvidenceSide[];
  } | null;
  rfiCandidate: {
    proposalType: "RfiDiscrepancyCandidate";
    itemLabel: string;
    question: string;
    affectedFieldType: FieldType;
    evidenceSources: EvidenceSide[];
    governedStatus: "Needs Review";
  } | null;
};
