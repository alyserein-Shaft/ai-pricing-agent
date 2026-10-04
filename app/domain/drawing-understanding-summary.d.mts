// Type bridge for drawing-understanding-summary.mjs (checkJs is off, so
// without this declaration TS infers overly-narrow types -- e.g. `null` or
// `never[]` -- from the `= null`/`= []` default parameter values rather
// than the real shapes this pure summarizer accepts/returns).

export type DrawingUnderstandingSummary = {
  whatThisExplains: string;
  mainFindings: string[];
  needsClarification: string[];
  groupedFindings: Array<{
    family: string;
    items: Array<Record<string, any>>;
    // Every OTHER source interpretation grouped under each representative
    // item, keyed by that representative's id. Reviewing the representative
    // is NOT a review of these -- they keep their own evidence and status.
    members: Record<string, Array<Record<string, any>>>;
  }>;
  hasAiFindings: boolean;
  counts: { currentEngineering: number; overlappingSources: number; sourceFragments: number; historical: number; needsSourceClarification: number };
};

export declare function buildDrawingUnderstandingSummary(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string; revision?: string };
  historicalCount?: number;
  drawingType?: string | null;
  items?: Array<Record<string, any>>;
}): DrawingUnderstandingSummary;

export type DrawingAttentionEntry = {
  id: string;
  itemId: string | null;
  title: string;
  why: string;
  requestedDrawingNumber?: string | null;
  candidateDrawingNumber?: string | null;
  // Run/pair/model-history detail kept OUT of `why` (the main explanation) on
  // purpose -- shown only in a secondary/technical line when present.
  historyNote?: string | null;
};

export type DrawingAttention = {
  decisions: DrawingAttentionEntry[];
  missing: DrawingAttentionEntry[];
  pending: { awaitingReview: Array<Record<string, any>> };
  processingNotes: string[];
};

export declare function buildDrawingAttention(input?: {
  items?: Array<Record<string, any>>;
  groupedFindings?: DrawingUnderstandingSummary["groupedFindings"];
  referenceMismatches?: Array<{
    id?: string;
    itemId?: string | null;
    requestedDrawingNumber?: string | null;
    candidateDrawingNumber?: string | null;
    comparisonCount?: number;
    runCount?: number;
  }>;
}): DrawingAttention;
