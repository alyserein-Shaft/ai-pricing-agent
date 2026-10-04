// Type bridge for drawing-type-classifier.mjs (checkJs is off).
export type DrawingTypeBucket =
  | "Layout"
  | "Riser Diagram"
  | "Schematic / Single-Line"
  | "Legend / Notes"
  | "Cause & Effect"
  | "Detail / Enlarged Detail"
  | "Schedule"
  | "Unknown / Mixed";

export declare const DRAWING_TYPE_BUCKETS: readonly DrawingTypeBucket[];

export type DrawingTypeClassification = {
  drawingType: DrawingTypeBucket;
  confidence: number;
  evidence: string;
  extractionMethod: string;
  governedStatus: "Verified" | "Needs Review";
};

export declare function classifyDrawingType(input?: {
  classifications?: Array<{ type: string; confidence: number }>;
  sheetName?: string | null;
}): DrawingTypeClassification;
