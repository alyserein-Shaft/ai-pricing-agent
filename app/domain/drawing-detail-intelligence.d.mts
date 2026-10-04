// Type bridge for drawing-detail-intelligence.mjs (checkJs is off).
import type { CanonicalBoundingBox } from "./drawing-coordinate-mapper.d.mts";
import type { GovernedStatus, AuthorityRole } from "./drawing-evidence-authority-policy.d.mts";

type Governed = { authorityRole: AuthorityRole; governedStatus: GovernedStatus; hardReviewReasons: string[] };
type Base = Governed & {
  pageNumber: number | null;
  rawLabel: string;
  sourceDocumentId: string | null;
  sourceSheet: string | null;
  boundingBox?: CanonicalBoundingBox | null;
  confidence: number | null;
  extractionMethod: string;
  evidence: Record<string, unknown>;
  sourceReferences: string[];
};

export type InstallationRequirementCandidate = Base & {
  proposalType: "InstallationRequirementCandidate";
  mountingDimension: { value: number; unit: string } | null;
  isTypical: boolean;
};
export type DetailNumberCandidate = Base & { proposalType: "DetailNumberCandidate"; detailNumber: number; isTypical: boolean };

export declare function buildDetailIntelligence(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string };
  pageNumber?: number | null;
  drawingType?: string;
  assets?: Array<Record<string, any>>;
}): { installationRequirements: InstallationRequirementCandidate[]; detailNumbers: DetailNumberCandidate[] };
