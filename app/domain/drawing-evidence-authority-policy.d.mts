// Type bridge for drawing-evidence-authority-policy.mjs (checkJs is off).
export type FieldType =
  | "DevicePlacement"
  | "DeviceQuantity"
  | "SystemConnectivity"
  | "CableTypeSize"
  | "LoopCircuitAssignment"
  | "DeviceIdentity"
  | "MountingInstallation"
  | "PanelIO"
  | "FunctionalOperation"
  | "SymbolsAbbreviations"
  | "TechnicalRequirements"
  | "CommercialQuantity";

export type GovernedStatus = "Verified" | "Verified with Assumption" | "Needs Review" | "Conflict" | "Not Found";
export type AuthorityRole = "Primary" | "Verification" | "Unsupported";

export declare const FIELD_TYPES: readonly FieldType[];
export declare const GOVERNED_STATUSES: readonly GovernedStatus[];
export declare const HARD_REVIEW_TRIGGERS: readonly string[];

export type DrawingEvidenceAuthorityResult = {
  authorityRole: AuthorityRole;
  approvalEligibility: boolean;
  hardReviewReasons: string[];
  finalStatus: GovernedStatus;
  provenanceRequirements: string[];
};

export declare function evaluateDrawingEvidenceAuthority(input?: {
  fieldType: FieldType;
  drawingType?: string | null;
  sourceType?: string;
  projectType?: string | null;
  revisionState?: { isLatestValid?: boolean } | null;
  applicableLegend?: { defined?: boolean; sheetSpecific?: boolean; revisionCompatible?: boolean } | null;
  corroboratingEvidence?: string[];
  conflicts?: string[];
  hardReviewTriggers?: string[];
  explicit?: boolean;
  notFound?: boolean;
  assumption?: string | null;
}): DrawingEvidenceAuthorityResult;
