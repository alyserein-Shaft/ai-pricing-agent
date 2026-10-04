// Type bridge for drawing-general-extraction-engine.mjs (checkJs is off, so
// without this declaration TS infers `never[]` from the `= []` default
// parameter values rather than the real record shapes this pure engine
// accepts/returns).
import type { CanonicalBoundingBox } from "./drawing-coordinate-mapper.d.mts";
import type { GovernedStatus, AuthorityRole } from "./drawing-evidence-authority-policy.d.mts";

export type ScheduleReference = { itemNumber: number; description: string; boundingBox: CanonicalBoundingBox };

type Governed = {
  authorityRole: AuthorityRole;
  governedStatus: GovernedStatus;
  hardReviewReasons: string[];
  reviewStatus: GovernedStatus;
};

export type EquipmentScheduleItem = Governed & {
  proposalType: "EquipmentScheduleItem";
  pageNumber: number;
  itemNumber: number;
  description: string;
  normalizedLabel: string;
  category: string;
  aliases: string[];
  boundingBox: CanonicalBoundingBox;
  sourceText: string;
  confidence: number;
  extractionMethod: string;
  evidence: { numberBoundingBox: CanonicalBoundingBox; descriptionBoundingBox: CanonicalBoundingBox };
  sourceReferences: string[];
};

export type CalloutReference = Governed & {
  proposalType: "CalloutReference";
  pageNumber: number;
  reference: number;
  matchedScheduleItem: ScheduleReference;
  boundingBox: CanonicalBoundingBox;
  confidence: number;
  extractionMethod: string;
  evidence: {
    numberBoundingBox: CanonicalBoundingBox;
    scheduleRowBoundingBox: CanonicalBoundingBox;
    leaderGeometry: null;
    ambiguityNote?: string;
  };
  sourceReferences: string[];
};

export type ExcludedCallout = { assetId: string; reference: number; reason: string; pageNumber: number };

// identityStatus is always "Potential Alias" in v0 -- see WORKSTREAM 4 in
// drawing-general-extraction-engine.mjs: this engine never emits an
// identity status that would read as a confirmed merge.
export type EquipmentCandidate = Governed & {
  proposalType: "EquipmentCandidate" | "PanelCandidate";
  pageNumber: number;
  rawLabel: string;
  alias: string;
  canonicalType: null;
  identityStatus: "Potential Alias";
  matchBasis: string | null;
  potentialMatch: { itemNumber: number; rawLabel: string; boundingBox: CanonicalBoundingBox };
  /** @deprecated prefer rawLabel/potentialMatch, which do not read as an identity claim */
  label: string;
  /** @deprecated prefer potentialMatch */
  matchedScheduleItem: ScheduleReference;
  boundingBox: CanonicalBoundingBox;
  confidence: number;
  extractionMethod: string;
  evidence: { aliasBoundingBox: CanonicalBoundingBox; scheduleRowBoundingBox: CanonicalBoundingBox };
  sourceReferences: string[];
};

export type RegionCandidate = Governed & {
  proposalType: "RegionCandidate";
  pageNumber: number;
  regionKind: string;
  rowCount: number;
  boundingBox: CanonicalBoundingBox;
  confidence: number;
  extractionMethod: string;
  evidence: Record<string, unknown>;
  sourceReferences: string[];
  id: string;
};

export type UnresolvedEngineeringObject = {
  proposalType: "UnknownEngineeringObject";
  pageNumber: number;
  reason: string;
  boundingBox: CanonicalBoundingBox;
  sourceEntity: { kind: string; id: string };
};

export type GeneralDrawingExtractionProposals = {
  scheduleItems: EquipmentScheduleItem[];
  callouts: CalloutReference[];
  equipmentCandidates: EquipmentCandidate[];
  regionCandidates: RegionCandidate[];
  unresolved: UnresolvedEngineeringObject[];
  excludedCallouts: ExcludedCallout[];
};

export declare function buildGeneralDrawingExtractionProposals(sources?: {
  pages?: Array<Record<string, any>>;
  assets?: Array<Record<string, any>>;
  documentContext?: { revisionState?: { isLatestValid?: boolean } | null } | null;
}): GeneralDrawingExtractionProposals;
