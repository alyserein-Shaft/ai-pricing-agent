import type { PreSalesWorkflow } from "../project/types";

export type PricingScenarioView = { id: string; name: string; version_number: number; project_currency: string; status: string };
export type EngineerPriceSuggestionView = {
  status: "Suggested";
  sourceId: string;
  sourceType: string;
  reference: string;
  unitPrice: number;
  currency: string;
  validity: string;
  authoritative: false;
  requiresExplicitSelection: true;
};

export type PricingLineView = {
  itemId: string;
  itemNumber?: string | null;
  description: string;
  status: string;
  version: number;
  selectedSource?: {
    id?: string;
    type?: string;
    supplier?: string;
    currency?: string;
    amount?: number;
    validUntil?: string | null;
    eligibleForCosting?: boolean;
  } | null;
  result?: {
    totalCost?: number;
    netSelling?: number;
    vat?: number;
    finalValue?: number;
    margin?: number;
    markup?: number;
    blockers?: string[];
    explanation?: string;
    approvalReady?: boolean;
    engineerSuggestion?: EngineerPriceSuggestionView | null;
  } | null;
};
export type PriceSourceView = { id: string; sourceId: string; productId: string; sourceType: string; supplier?: string | null; amount: number; currency: string; validityState: string; validUntil?: string | null; projectId?: string | null; provenance: string; approvalStatus: string; downstreamUse: string; reviewState: string; eligibleForCosting: boolean };
export type CommercialReviewView = { id: string; boq_description?: string | null; review_type: string; priority: string; status: string; blocking: number; reason_for_review: string; required_decision: string; required_role: string; version_number: number };
export type CommercialSummaryView = { total: number; open: number; inReview: number; blocked: number; approved: number; readiness: string };
export type QuotationView = { id: string; revision_number?: number; revisionNumber?: number; status: "Draft" | "Approved" | "Issued"; currency: string; subtotal_minor?: number; subtotalMinor?: number; vat_minor?: number; vatMinor?: number; total_minor?: number; totalMinor?: number };
export type { PreSalesWorkflow };
