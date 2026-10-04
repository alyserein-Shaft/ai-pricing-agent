// Type bridge for drawing-layout-intelligence.mjs (checkJs is off).
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

export type DevicePlacementCandidate = Base & {
  proposalType: "DevicePlacementCandidate";
  devicePrefix: string;
  deviceNumber: number;
  repeatedInstanceCount: number;
};
export type DetailReferenceCandidate = Base & { proposalType: "DetailReferenceCandidate"; referencedDetailNumber: number };

export declare function buildLayoutIntelligence(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string };
  pageNumber?: number | null;
  drawingType?: string;
  assets?: Array<Record<string, any>>;
}): { devicePlacements: DevicePlacementCandidate[]; detailReferences: DetailReferenceCandidate[] };
