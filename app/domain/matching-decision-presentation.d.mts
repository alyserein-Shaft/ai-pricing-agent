// Type bridge for the .mjs presentation exports consumed by
// MatchingWorkspace.tsx. checkJs infers each parameter from its `= null`/`= []`
// default, which rejects a real candidate array. This declares only the shape
// the component already passes and reads; the .mjs stays the single source of
// behaviour.
export interface MatchingCandidateForPresentation {
  id: string;
  rank?: number | null;
  manufacturer?: string | null;
  part_number?: string | null;
  partNumber?: string | null;
  family?: string | null;
  technical_status?: string | null;
  technicalStatus?: string | null;
  matchingBasis?: string[];
  mandatoryFailures?: unknown[];
  confidence_state?: string | null;
  confidence_score?: number | null;
  isFallbackCandidate?: boolean;
  rankingReason?: string | null;
}

export interface MatchingSafetyDecisionForPresentation {
  warnings?: Array<{ code?: string; message?: string; acknowledged_at?: string | null }>;
}

export interface ProjectStrategyForPresentation {
  targetBrand?: string | null;
  targetManufacturer?: string | null;
  standardRegime?: string | null;
  reviewState?: string | null;
  contractuallyMandated?: boolean;
}

export interface MatchingNextActionForPresentation {
  kind: string;
  label: string;
  detail: string;
  workspace: string;
  action: string;
}

export interface MatchingDimensionForPresentation {
  state: "EVIDENCED" | "NOT_EVIDENCED" | "BLOCKED" | "CONFLICT";
  tone: string;
  label: string;
  detail: string;
}

export interface MatchingDimensionPanelForPresentation {
  candidateId: string | null;
  partNumber: string | null;
  manufacturer: string | null;
  dimensions: Record<string, MatchingDimensionForPresentation>;
  blockedDimensions: string[];
  approvalBlocked: boolean;
  unknownDimensions: string[];
}

export interface StagedCandidateForPresentation<T = MatchingCandidateForPresentation> {
  candidate: T;
  panel: MatchingDimensionPanelForPresentation;
  fallbackPromoted?: boolean;
}

// Callers pass their own richer view types (MatchCandidateView,
// SafetyDecisionView); only the fields the model reads are constrained here.
export declare function matchingDecisionModel<T = MatchingCandidateForPresentation>(input?: {
  candidates?: T[];
  status?: string;
  matchStale?: boolean;
  matchStaleReason?: string;
  projectStrategy?: ProjectStrategyForPresentation | null;
  safetyFor?: (candidate: T) => MatchingSafetyDecisionForPresentation | null;
  blockers?: string[];
  stageStatus?: string;
  approvedUnderstanding?: number;
  awaitingUnderstanding?: number;
  itemCount?: number;
  pendingRequirements?: number;
}): Readonly<{
  status: string;
  stale: boolean;
  staleReason: string | null;
  recommended: StagedCandidateForPresentation<T> | null;
  alternatives: StagedCandidateForPresentation<T>[];
  projectStrategy: ProjectStrategyForPresentation | null;
  nextAction: MatchingNextActionForPresentation;
}>;

export declare function matchingNextAction(input?: {
  blockers?: string[];
  stageStatus?: string;
  approvedUnderstanding?: number;
  awaitingUnderstanding?: number;
  itemCount?: number;
  pendingRequirements?: number;
  matchStale?: boolean;
}): MatchingNextActionForPresentation;

export declare function stagedCandidates(candidates?: MatchingCandidateForPresentation[]): Readonly<{
  recommended: MatchingCandidateForPresentation | null;
  alternatives: MatchingCandidateForPresentation[];
  fallbackPromoted: boolean;
}>;

export declare function candidateDimensionPanel(
  candidate: MatchingCandidateForPresentation,
  options?: {
    safetyDecision?: MatchingSafetyDecisionForPresentation | null;
    projectStrategy?: ProjectStrategyForPresentation | null;
  },
): Readonly<MatchingDimensionPanelForPresentation>;

export declare const MATCHING_DIMENSIONS: readonly string[];
export declare const MATCHING_DIMENSION_LABELS: Readonly<Record<string, string>>;
export declare const DIMENSION_TONE: Readonly<Record<string, string>>;