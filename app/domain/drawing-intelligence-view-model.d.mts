// Type bridge for drawing-intelligence-view-model.mjs (checkJs is off).
import type { CanonicalBoundingBox } from "./drawing-coordinate-mapper.d.mts";
import type { GovernedStatus, AuthorityRole } from "./drawing-evidence-authority-policy.d.mts";
import type { DrawingTypeBucket } from "./drawing-type-classifier.d.mts";

export type DrawingIntelligenceSourceType =
  | "Legend"
  | "Note"
  | "Loop"
  | "Cable"
  | "Interface"
  | "Connection"
  | "DeviceCode"
  | "Placement"
  | "DetailRef"
  | "MatrixHeader"
  | "MatrixRelation"
  | "Installation"
  | "DetailNumber"
  | "CrossSheetRef";

export declare const DRAWING_INTELLIGENCE_SOURCE_TYPES: readonly DrawingIntelligenceSourceType[];
export declare const DEFAULT_VISIBLE_SOURCE_TYPES: readonly DrawingIntelligenceSourceType[];

export type DrawingIntelligenceProposalsResult = {
  drawingType: DrawingTypeBucket;
  drawingTypeConfidence: number | null;
  families: {
    legend: { legendDefinitions: any[]; generalNotes: any[] } | null;
    riser: { loops: any[]; cableSpecs: any[]; systemInterfaces: any[]; connectionCandidates: any[]; deviceCodes: any[] } | null;
    layout: { devicePlacements: any[]; detailReferences: any[] } | null;
    causeEffect: { headers: any[]; relationships: any[] } | null;
    detail: { installationRequirements: any[]; detailNumbers: any[] } | null;
  };
  crossSheetReferences: Array<Record<string, any>>;
};

export declare function buildDrawingIntelligenceProposals(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string };
  revision?: string | null;
  pageNumber?: number | null;
  assets?: Array<Record<string, any>>;
  legendEntries?: Array<Record<string, any>>;
  legendConfidence?: number | null;
  drawingType?: DrawingTypeBucket | null;
  classifications?: Array<{ type: string; confidence: number }>;
  documentRegistry?: Array<{ id: string; drawingNumber: string }>;
}): DrawingIntelligenceProposalsResult;

export type DrawingIntelligenceOverlayItem = {
  id: string;
  pageNumber: number | null;
  sourceType: DrawingIntelligenceSourceType;
  semanticType: string;
  proposalType: string;
  label: string;
  confidence: number | null;
  authorityRole: AuthorityRole;
  governedStatus: GovernedStatus;
  reviewStatus: string;
  hardReviewReasons: string[];
  boundingBox: CanonicalBoundingBox | null;
  extractionMethod: string | null;
  drawingType: DrawingTypeBucket;
  sourceDrawingNumber: string | null;
  sourceSheet: string | null;
  sourceRevision: string | null;
  evidence: Record<string, unknown>;
  sourceEntity: { kind: string; id: string; sourceReferences: string[]; documentId: string | null };
};

export declare function buildDrawingIntelligenceOverlayItems(
  result: DrawingIntelligenceProposalsResult | null | undefined,
  context?: { sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string }; revision?: string | null },
): DrawingIntelligenceOverlayItem[];
