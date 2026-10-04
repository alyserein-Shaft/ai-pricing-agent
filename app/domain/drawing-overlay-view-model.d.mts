// Type bridge for drawing-overlay-view-model.mjs (checkJs is off, so
// without this declaration TS infers `never[]` from the `= []` default
// parameter values rather than the real record shapes these pure
// normalizers accept/return).
import type { CanonicalBoundingBox } from "./drawing-coordinate-mapper.d.mts";

export type DrawingOverlaySourceType = "Text" | "Symbol" | "UnknownSymbol" | "Structure";

export type DrawingOverlayItem = {
  id: string;
  pageNumber: number;
  sourceType: DrawingOverlaySourceType;
  semanticType: string;
  label: string;
  confidence: number | null;
  reviewStatus: string;
  boundingBox: CanonicalBoundingBox;
  boxOrigin?: "pdf-text" | "vector-path" | null;
  extractionMethod: string | null;
  evidence: Record<string, unknown>;
  sourceEntity: { kind: string; id: string; definitionId?: string | null };
};

export declare function buildDrawingOverlayItems(sources?: {
  pages?: Array<Record<string, any>>;
  assets?: Array<Record<string, any>>;
  occurrences?: Array<Record<string, any>>;
  regions?: Array<Record<string, any>>;
}): DrawingOverlayItem[];

export declare const DRAWING_OVERLAY_SOURCE_TYPES: readonly DrawingOverlaySourceType[];

// Accepts any overlay item shape (only occurrence items carry boxOrigin).
export declare function highlightBoxNeedsPdfTextCheck(item: unknown): boolean;

export type HighlightVerificationMode = "none" | "tag-geometry" | "text-angle";
export declare function highlightVerificationMode(item: unknown): HighlightVerificationMode;
export declare const TEXT_TAG_EDGE_TOLERANCE: number;
export declare function verifyTextTagHighlight(
  item: unknown,
  textItems: ReadonlyArray<unknown> | null | undefined,
  pageView: ArrayLike<number> | null | undefined,
): { valid: boolean; reason: "tag-geometry-verified" | "missing-tag-evidence" | "tag-text-not-found" | "box-does-not-match-tag" };

// Generic on T (constrained to the pageNumber/sourceType fields this
// function actually reads) so callers merging DrawingOverlayItem[] with
// another module's overlay-item shape (e.g. GeneralExtractionOverlayItem
// from drawing-general-extraction-view-model.mjs, or
// DrawingIntelligenceOverlayItem from drawing-intelligence-view-model.mjs,
// whose pageNumber is nullable for proposal types Drawing Intake never
// positions on a page) can filter the combined array through this same
// function without a lossy cast.
export declare function filterDrawingOverlayItems<T extends { pageNumber: number | null; sourceType: string }>(
  items: T[] | null | undefined,
  filters?: { pageNumber?: number | null; sourceTypes?: Set<string> | null },
): T[];
