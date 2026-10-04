// Type bridge for drawing-legend-notes-intelligence.mjs (checkJs is off).
import type { CanonicalBoundingBox } from "./drawing-coordinate-mapper.d.mts";
import type { GovernedStatus, AuthorityRole } from "./drawing-evidence-authority-policy.d.mts";

export type SourceDocumentRef = { id?: string; drawingNumber?: string; sheetName?: string };

type Governed = { authorityRole: AuthorityRole; governedStatus: GovernedStatus; hardReviewReasons: string[] };

export type LegendDefinitionProposal = Governed & {
  proposalType: "LegendDefinition";
  pageNumber: number | null;
  rawLabel: string;
  normalizedMeaning: string;
  entryType: string;
  applicableSystem: string | null;
  applicableDrawingTypes: string[];
  applicabilityStatus: string;
  sourceDocumentId: string | null;
  sourceDrawingNumber: string | null;
  sourceSheet: string | null;
  confidence: number | null;
  extractionMethod: string;
  evidence: { sequence: number; rawLabel: string; rawDescription: string };
  sourceReferences: string[];
};

export type GeneralNoteProposal = Governed & {
  proposalType: "GeneralNote";
  pageNumber: number | null;
  noteNumber: number;
  normalizedMeaning: string;
  applicableSystem: string | null;
  applicabilityStatus: string;
  sourceDocumentId: string | null;
  sourceDrawingNumber: string | null;
  sourceSheet: string | null;
  boundingBox: CanonicalBoundingBox | null;
  confidence: number | null;
  extractionMethod: string;
  evidence: { rawText: string };
  sourceReferences: string[];
};

export declare function buildLegendDefinitionProposals(input?: {
  sourceDocument?: SourceDocumentRef;
  pageNumber?: number | null;
  legendEntries?: Array<Record<string, any>>;
  legendConfidence?: number | null;
}): LegendDefinitionProposal[];

export declare function buildGeneralNoteProposals(input?: {
  sourceDocument?: SourceDocumentRef;
  pageNumber?: number | null;
  assets?: Array<Record<string, any>>;
}): GeneralNoteProposal[];

export declare function buildLegendNotesIntelligence(input?: {
  sourceDocument?: SourceDocumentRef;
  pageNumber?: number | null;
  assets?: Array<Record<string, any>>;
  legendEntries?: Array<Record<string, any>>;
  legendConfidence?: number | null;
}): { legendDefinitions: LegendDefinitionProposal[]; generalNotes: GeneralNoteProposal[] };
