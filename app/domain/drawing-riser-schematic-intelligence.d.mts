// Type bridge for drawing-riser-schematic-intelligence.mjs (checkJs is off).
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

export type LoopCandidate = Base & { proposalType: "LoopCandidate"; loopNumber: number | null };
export type CableSpecCandidate = Base & { proposalType: "CableSpecCandidate"; coreCount: number; crossSectionSqmm: number };
export type SystemInterfaceCandidate = Base & { proposalType: "SystemInterfaceCandidate"; interfacedSystem: string };
export type ConnectionCandidate = Base & { proposalType: "ConnectionCandidate"; destination: string };
export type DeviceCodeCandidate = Base & { proposalType: "DeviceCodeCandidate"; occurrenceCount: number };

export declare function buildRiserSchematicIntelligence(input?: {
  sourceDocument?: { id?: string; drawingNumber?: string; sheetName?: string };
  pageNumber?: number | null;
  drawingType?: string;
  assets?: Array<Record<string, any>>;
}): {
  loops: LoopCandidate[];
  cableSpecs: CableSpecCandidate[];
  systemInterfaces: SystemInterfaceCandidate[];
  connectionCandidates: ConnectionCandidate[];
  deviceCodes: DeviceCodeCandidate[];
};
