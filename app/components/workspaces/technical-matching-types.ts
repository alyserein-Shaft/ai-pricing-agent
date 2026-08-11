export type TechnicalRequirementView = {
  id: string; sequence: number; original_text: string; normalized_requirement: string;
  engineering_domain: string; category?: string | null; requirement_type: string;
  requirement_category: string; condition?: string | null; exception?: string | null;
  confidence: number; confidence_state: string; review_status: string;
  approved_for_downstream: number;
  source_location: { pageFrom?: number; pageTo?: number; section?: string | null;
    clause?: string | null; clausePath?: string[]; originalClauseText?: string };
  original_values: Record<string, unknown>; current_values: Record<string, unknown>;
  updated_at: string;
};
export type RequirementHistoryView = {
  id: string; action: string; reason: string; decided_by: string; decided_at: string;
  previous_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null;
};
export type MatchCandidateView = {
  id: string; product_id: string; rank: number; part_number: string; description: string;
  manufacturer: string; family?: string; technical_status: string;
  recommendation_tier: string; confidence_state: string; confidence_score: number;
  matchingBasis: string[]; commercial_availability: string; explanation: string;
  mandatoryFailures: unknown[]; score: number;
};
export type SafetyDecisionView = {
  id: string; version_number: number; safety_state: string; compliance_state: string;
  confidence_level: string; overall_confidence: number; technical_eligibility: string;
  price_eligibility: string; explanation: string;
  blocks: Array<{ id: string; code: string; user_message: string; resolution_action: string; owner: string; status: string }>;
  warnings: Array<{ id: string; code: string; message: string; resolution_action: string; acknowledged_at?: string | null }>;
};
export type MatchingBoqItemView = {
  id: string; sequence: number; item_number?: string | null; description?: string | null;
  section?: string | null; review_status: string; confidence_state: string;
  original_unit?: string | null; original_quantity?: string | null;
};
