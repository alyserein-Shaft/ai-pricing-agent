// Type bridge for drawing-cross-sheet-references.mjs (checkJs is off).
export type CrossSheetReference = {
  sourceDocumentId: string | null;
  sourceDrawingNumber: string | null;
  sourceSheet: string | null;
  pageNumber: number | null;
  referencedDrawingNumber: string;
  applicableSystem: string | null;
  applicableDrawingTypes: string[];
  applicabilityStatus: string;
  applicabilitySource: string;
  resolvedTargetDocumentId: string | null;
  revisionCompatibility: "Unknown" | "Compatible" | "Incompatible";
  status: "Resolved" | "Unresolved";
  evidence: { noteText: string; sourceAssetId: string };
  governedStatus: "Needs Review";
};

export declare function detectCrossSheetReferences(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string };
  pageNumber?: number | null;
  assets?: Array<{ id: string; text_content: string }>;
}): CrossSheetReference[];

export declare function resolveCrossSheetReferenceTargets(
  references: CrossSheetReference[],
  documentRegistry?: Array<{ id: string; drawingNumber: string }>,
): CrossSheetReference[];
