// Type bridge for drawing-cause-effect-intelligence.mjs (checkJs is off).
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

export type MatrixHeaderCandidate = Base & { proposalType: "MatrixHeaderCandidate" };
export type MatrixRelationshipCandidate = Base & {
  proposalType: "MatrixRelationshipCandidate";
  initiatingCondition: string;
  resultingAction: string;
};

export declare function buildCauseEffectIntelligence(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string };
  pageNumber?: number | null;
  drawingType?: string;
  assets?: Array<Record<string, any>>;
}): { headers: MatrixHeaderCandidate[]; relationships: MatrixRelationshipCandidate[] };
