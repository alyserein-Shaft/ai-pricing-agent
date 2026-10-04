// Backend & Codebase Consolidation Sprint, item 4 (Priority B: shared type
// bridge for a high-volume .mjs export): mirrors technical-matching-models.mjs's
// two exported functions so MatchingWorkspace.tsx's callers stop losing the
// "| null" argument type (checkJs otherwise infers the parameter type as
// "null | undefined" from the `= null` default, rejecting a real
// SafetyDecisionView | null value).
import type {
  TechnicalRequirementView,
  MatchCandidateView,
  SafetyDecisionView,
} from "./technical-matching-types";

export declare function technicalRequirementModel(
  requirement: TechnicalRequirementView | null | undefined,
): Readonly<{
  id: string;
  reviewStatus: string;
  approvedForDownstream: number;
  confidence: number;
  confidenceState: string;
  evidence: string;
  sourceLocation: TechnicalRequirementView["source_location"];
  currentValues: Record<string, unknown>;
}> | null;

export declare function matchingCandidateModel(
  candidate: MatchCandidateView | null | undefined,
  safetyDecision?: SafetyDecisionView | null,
): Readonly<{
  id: string;
  confidence: string;
  technicalStatus: string;
  recommendationTier: string;
  discoveryOnly: boolean;
  approvalEligible: boolean;
}> | null;

export declare function confidenceBadgeClass(confidenceState: string): string;

export declare function validSelectedItem(
  items: Array<{ id: string }>,
  requestedId: string | null | undefined,
): string | null;

export declare function selectionAfterProjectChange(
  previousProjectId: string | null | undefined,
  nextProjectId: string | null | undefined,
  selectedItemId: string | null | undefined,
): string | null;
