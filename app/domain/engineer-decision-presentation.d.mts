// Type bridge for the high-volume .mjs presentation exports consumed by
// EngineerDecisionWorkspace.tsx. Without it, checkJs infers each parameter from
// its `= null` default, so a real `DecisionModel`/`BomModel` is rejected as
// "not assignable to type null". This declares only what the component already
// passes and reads; the .mjs remains the single source of behaviour.
export interface DecisionModelForPresentation {
  boqItemId?: string;
  itemReference: string | null;
  description: string;
  understanding: {
    status: string;
    familyClassification: {
      productFamily: string | null;
      decisionBasis: string;
      origin: string;
      confidence: number | null;
    } | null;
  };
  requirements: {
    consolidated: Array<{ id: string; normalizedRequirement: string; priority: string }>;
    openClarifications: Array<{ question: string }>;
  };
  candidates: Array<Record<string, unknown>>;
  safety: {
    safetyState: string;
    complianceState: string;
    explanation: string;
    blocks?: Array<Record<string, unknown>>;
  } | null;
  recalculation: { status: string };
  composite: { state: string; label: string };
}

export interface BomModelForPresentation {
  readiness: { state: string; label: string };
  primaryProduct: {
    productId: string;
    manufacturer: string;
    partNumber: string;
    family: string | null;
    approved: boolean;
  } | null;
  primaryQuantity: Record<string, unknown>;
  components: Array<Record<string, unknown>>;
}

export declare function engineerDecisionTechnicalModel(input: {
  decision?: DecisionModelForPresentation | null;
  bom?: BomModelForPresentation | null;
}): Readonly<
  | { available: false; reason: string }
  | {
      available: true;
      itemReference: string | null;
      description: string | null;
      compositeState: string | null;
      selectedProduct: {
        partNumber: string | null;
        manufacturer: string | null;
        family: string | null;
        approved: boolean;
        label: string;
      } | null;
      why: Array<{ label: string; detail: string }>;
      evidence: {
        applicableRequirements: number;
        applicableRequirementsLabel: string;
        openClarifications: number;
        openClarificationsLabel: string;
        safetyState: string;
        complianceState: string;
        recalculationStatus: string;
        sources: Array<{ id: string | null; priority: string; text: string }>;
      };
      openIssues: Array<{
        kind: string;
        code: string | null;
        detail: string;
        owner: string | null;
        resolutionAction: string | null;
      }>;
      alternatives: Array<{
        candidateId: string;
        partNumber: string | null;
        manufacturer: string | null;
        technicalStatus: string;
        confidence: string;
        viable: boolean;
        fallback: boolean;
      }>;
      primaryAction: {
        kind: string;
        workspace: string;
        label: string;
        blockCode: string | null;
        resolutionAction: string | null;
        owner: string | null;
      } | null;
    }
>;

export declare function bomAccessorySummary(bom?: BomModelForPresentation | null): Readonly<
  | { available: false; reason: string; totals: null; byRole: never[]; unresolved: never[]; link: null }
  | {
      available: true;
      totals: {
        components: number;
        componentsLabel: string;
        unresolved: number;
        unresolvedLabel: string;
        missingQuantity: number;
        missingQuantityLabel: string;
      };
      byRole: Array<{ role: string; label: string; count: number; countLabel: string }>;
      unresolved: Array<{ role: string; roleLabel: string; partNumber: string | null; relationshipType: string | null }>;
      primaryQuantity: { value: number | null; label: string; origin: string } | null;
      readiness: { state: string; label: string };
      link: { workspace: string; label: string };
    }
>;

export declare function assertNoCommercialFields(payload: unknown): void;

export declare const count: (value: unknown) => string;