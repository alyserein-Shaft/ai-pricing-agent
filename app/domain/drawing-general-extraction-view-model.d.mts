// Type bridge for drawing-general-extraction-view-model.mjs (checkJs is
// off, so without this declaration TS infers `never[]` from the `= []`
// default parameter values rather than the real record shapes these pure
// normalizers accept/return).
import type { CanonicalBoundingBox } from "./drawing-coordinate-mapper.d.mts";
import type { GeneralDrawingExtractionProposals } from "./drawing-general-extraction-engine.d.mts";
import type { GovernedStatus, AuthorityRole } from "./drawing-evidence-authority-policy.d.mts";

export type GeneralExtractionSourceType = "Equipment" | "Callout";

export type GeneralExtractionOverlayItem = {
  id: string;
  pageNumber: number;
  sourceType: GeneralExtractionSourceType;
  semanticType: string;
  label: string;
  confidence: number | null;
  reviewStatus: string;
  authorityRole: AuthorityRole;
  governedStatus: GovernedStatus;
  hardReviewReasons: string[];
  boundingBox: CanonicalBoundingBox;
  extractionMethod: string | null;
  evidence: Record<string, unknown>;
  sourceEntity: { kind: string; id: string; sourceReferences: string[] };
};

export declare const GENERAL_EXTRACTION_SOURCE_TYPES: readonly GeneralExtractionSourceType[];

export declare function buildGeneralExtractionOverlayItems(
  proposals: GeneralDrawingExtractionProposals | null | undefined,
): GeneralExtractionOverlayItem[];
